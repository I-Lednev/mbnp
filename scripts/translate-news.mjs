#!/usr/bin/env node
/**
 * Переводит заголовки и описания англоязычных/украиноязычных новостей на русский.
 * Результат — data/translations.json, который подхватывает переключатель «По-русски».
 *
 * Провайдеры по приоритету:
 *   1. DeepL  — если задан DEEPL_API_KEY (бесплатный тариф 500 тыс. знаков/мес).
 *   2. Ollama — если локально запущен Ollama (удобно для проверки и локальной сборки).
 *   3. Google Translate — резервный вариант без ключа для GitHub Actions.
 *
 * Запуск:
 *   node scripts/translate-news.mjs
 *   DEEPL_API_KEY=... node scripts/translate-news.mjs
 *   OLLAMA_MODEL=qwen3-coder:30b node scripts/translate-news.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_FILE = join(ROOT, 'data', 'news.json');
const ARTICLES_FILE = join(ROOT, 'data', 'articles.json');
const OUT_FILE = join(ROOT, 'data', 'translations.json');

const DEEPL_KEY = process.env.DEEPL_API_KEY || '';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || '';
const MAX_ITEMS = Number(process.env.MAX_TRANSLATE_ITEMS) || 0;
const TIME_LIMIT_MS = Number(process.env.TRANSLATE_TIME_LIMIT_MS) || 240_000;

const LANGUAGE_NAMES = {
  en: 'английского',
  uk: 'украинского',
  ru: 'русского',
  de: 'немецкого',
  fr: 'французского',
};

// ── Утилиты ──────────────────────────────────────────────────────────────

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function sourceHash(item, content) {
  return hash(`${item.lang || ''}\n${item.title}\n${item.excerpt || ''}\n${(content || '').slice(0, 1500)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Провайдеры ───────────────────────────────────────────────────────────

async function detectOllama() {
  try {
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 2500);
    if (!response.ok) return null;

    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((model) => model.name) : [];
    if (models.length === 0) return null;

    if (OLLAMA_MODEL && models.includes(OLLAMA_MODEL)) return OLLAMA_MODEL;
    if (OLLAMA_MODEL) {
      console.warn(`Модель ${OLLAMA_MODEL} не найдена в Ollama, использую ${models[0]}.`);
    }
    return models[0];
  } catch {
    return null;
  }
}

async function translateOllama(texts, lang, model, depth = 0) {
  try {
    return await translateOllamaOnce(texts, lang, model);
  } catch (error) {
    // Модель иногда добавляет лишние строки. Дробим пакет и пробуем ещё раз.
    if (depth < 2 && texts.length > 1) {
      const middle = Math.ceil(texts.length / 2);
      const [left, right] = await Promise.all([
        translateOllama(texts.slice(0, middle), lang, model, depth + 1),
        translateOllama(texts.slice(middle), lang, model, depth + 1),
      ]);
      return [...left, ...right];
    }

    throw error;
  }
}

async function translateOllamaOnce(texts, lang, model) {
  const language = LANGUAGE_NAMES[lang] || 'исходного языка';
  const prompt = [
    `Ты — аккуратный переводчик новостей. Переведи каждый текст с ${language} на русский язык.`,
    'Сохраняй имена, названия компаний и смысл. Не добавляй пояснений.',
    `Верни строго JSON-объект {"translations": {"0": "...", "1": "..."}} — ключи от 0 до ${texts.length - 1}.`,
    '',
    JSON.stringify({ texts }, null, 2),
  ].join('\n');

  const response = await fetchWithTimeout(
    `${OLLAMA_URL}/api/generate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 8192 },
      }),
    },
    180_000,
  );

  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

  const data = await response.json();
  const raw = String(data.response || '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Ниже попробуем разобрать построчно.
  }

  const values = Array.isArray(parsed) ? parsed : parsed?.translations ?? parsed;

  if (Array.isArray(values) && values.length === texts.length) {
    return values.map((value) => String(value).trim());
  }

  if (values && typeof values === 'object') {
    const byIndex = texts.map((_, index) => values[index] ?? values[String(index)]);
    if (byIndex.every((value) => value !== undefined && value !== null)) {
      return byIndex.map((value) => String(value).trim());
    }
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*]\s*)/, '').trim())
    .filter(Boolean);

  if (lines.length !== texts.length) {
    throw new Error(`Ollama вернул ${lines.length} строк вместо ${texts.length}`);
  }

  return lines;
}

async function translateDeepl(texts, lang) {
  const body = {
    text: texts,
    target_lang: 'RU',
  };

  if (lang && lang !== 'auto') body.source_lang = lang.toUpperCase();

  const response = await fetchWithTimeout('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      authorization: `DeepL-Auth-Key ${DEEPL_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`DeepL HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 120)}` : ''}`);
  }

  const data = await response.json();
  const translations = Array.isArray(data.translations) ? data.translations.map((item) => item.text) : [];

  if (translations.length !== texts.length) {
    throw new Error(`DeepL вернул ${translations.length} переводов вместо ${texts.length}`);
  }

  return translations;
}

async function translateGoogle(text, lang) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=${encodeURIComponent(lang || 'auto')}&tl=ru&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      },
    },
    20_000,
  );

  if (!response.ok) throw new Error(`Google HTTP ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data?.[0])) throw new Error('Google вернул неожиданный ответ');

  return data[0].map((part) => part?.[0] || '').join('').trim();
}

async function translateMyMemory(text, lang) {
  const source = lang && lang !== 'auto' ? lang : 'en';
  const url =
    'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${source}|ru`)}`;

  const response = await fetchWithTimeout(url, {}, 20_000);
  if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);

  const data = await response.json();
  const translated = data?.responseData?.translatedText || '';

  if (!translated || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) {
    throw new Error('MyMemory не вернул перевод');
  }

  return translated.trim();
}

async function translateGoogleBatch(texts, lang) {
  const results = [];
  const concurrency = 4;

  for (let index = 0; index < texts.length; index += concurrency) {
    const chunk = texts.slice(index, index + concurrency);
    const translated = await Promise.all(
      chunk.map(async (text) => {
        try {
          return await translateGoogle(text, lang);
        } catch (error) {
          console.warn(`  Google не смог перевести фрагмент: ${error.message}`);
          return null;
        }
      }),
    );

    results.push(...translated);
    if (index + concurrency < texts.length) await sleep(250);
  }

  return results;
}

async function translateMyMemoryFallback(texts, lang) {
  const results = [];

  for (const text of texts) {
    try {
      results.push(await translateMyMemory(text, lang));
    } catch {
      results.push(null);
    }
    await sleep(120);
  }

  return results;
}

// ── Сборка ───────────────────────────────────────────────────────────────

async function main() {
  const news = await readJson(NEWS_FILE);
  if (!news || !Array.isArray(news.items)) {
    console.error(`Не найден ${NEWS_FILE}. Сначала запустите scripts/fetch-news.mjs.`);
    process.exitCode = 1;
    return;
  }

  const previous = await readJson(OUT_FILE, { translations: {} });
  const translations = previous?.translations && typeof previous.translations === 'object' ? previous.translations : {};
  const previousContent = JSON.stringify(translations);

  const articleData = await readJson(ARTICLES_FILE, { articles: {} });
  const enrichedArticles =
    articleData?.articles && typeof articleData.articles === 'object' ? articleData.articles : {};

  function contentFor(item) {
    const enriched = enrichedArticles[item.id]?.content || '';
    return enriched.length > (item.content || '').length ? enriched : item.content || '';
  }

  const currentIds = new Set(news.items.map((item) => item.id));
  for (const id of Object.keys(translations)) {
    if (!currentIds.has(id)) delete translations[id];
  }

  const pending = [];
  for (const item of news.items) {
    if (!item?.id || !item?.title || item.lang === 'ru') continue;

    const cached = translations[item.id];
    const content = contentFor(item);
    const hashValue = sourceHash(item, content);

    if (cached?.hash === hashValue && cached?.title) continue;
    pending.push({ item, hash: hashValue, content });
  }

  if (pending.length === 0) {
    console.log('Все переводы уже актуальны.');
    return;
  }

  const forcedProvider = (process.env.TRANSLATE_PROVIDER || '').toLowerCase();
  const deeplAvailable = Boolean(DEEPL_KEY);
  let provider;
  let ollamaModel = null;

  if (['google', 'deepl', 'ollama'].includes(forcedProvider)) {
    provider = forcedProvider;
  } else if (deeplAvailable) {
    provider = 'deepl';
  } else {
    ollamaModel = await detectOllama();
    provider = ollamaModel ? 'ollama' : 'google';
  }

  if (provider === 'ollama' && !ollamaModel) {
    ollamaModel = await detectOllama();
    if (!ollamaModel) {
      console.warn('Ollama недоступна — переключаюсь на Google Translate.');
      provider = 'google';
    }
  }

  if (provider === 'deepl' && !deeplAvailable) {
    console.warn('TRANSLATE_PROVIDER=deepl, но DEEPL_API_KEY не задан — использую Google Translate.');
    provider = 'google';
  }

  const limit = MAX_ITEMS > 0 ? MAX_ITEMS : provider === 'google' ? 120 : 500;
  const queue = pending.slice(0, limit);

  console.log(
    `Перевод: ${queue.length} из ${pending.length} новых материалов. Провайдер: ${provider}` +
      (ollamaModel ? ` (${ollamaModel})` : '') +
      '.',
  );

  const byLanguage = new Map();
  for (const entry of queue) {
    const lang = entry.item.lang || 'auto';
    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
    byLanguage.get(lang).push(entry);
  }

  let done = 0;
  let failed = 0;
  const deadline = Date.now() + TIME_LIMIT_MS;

  outer: for (const [lang, entries] of byLanguage) {
    const batchSize = provider === 'deepl' ? 20 : provider === 'ollama' ? 6 : 4;

    for (let offset = 0; offset < entries.length; offset += batchSize) {
      if (Date.now() > deadline) {
        console.warn('Лимит времени перевода исчерпан — остальные материалы переведём в следующий раз.');
        break outer;
      }

      const group = entries.slice(offset, offset + batchSize);
      const tasks = [];

      for (const entry of group) {
        tasks.push({ entry, field: 'title', text: entry.item.title });
        if (entry.item.excerpt) tasks.push({ entry, field: 'excerpt', text: entry.item.excerpt });
        if (entry.content) {
          tasks.push({ entry, field: 'content', text: entry.content.slice(0, 1500) });
        }
      }

      const texts = tasks.map((task) => task.text);
      let translated = null;

      try {
        if (provider === 'deepl') {
          translated = await translateDeepl(texts, lang);
        } else if (provider === 'ollama') {
          translated = await translateOllama(texts, lang, ollamaModel);
        } else {
          translated = await translateGoogleBatch(texts, lang);
          if (translated.some((value) => value === null)) {
            const fallback = await translateMyMemoryFallback(
              texts.filter((_, index) => translated[index] === null),
              lang,
            );
            let fallbackIndex = 0;
            translated = translated.map((value) =>
              value === null ? fallback[fallbackIndex++] || null : value,
            );
          }
        }
      } catch (error) {
        console.warn(`  Пакет ${lang} не переведён: ${error.message}`);
        failed += group.length;
        continue;
      }

      for (let index = 0; index < group.length; index += 1) {
        const entry = group[index];
        const titleIndex = tasks.findIndex((task) => task.entry === entry && task.field === 'title');
        const excerptIndex = tasks.findIndex((task) => task.entry === entry && task.field === 'excerpt');
        const contentIndex = tasks.findIndex((task) => task.entry === entry && task.field === 'content');
        const title = translated?.[titleIndex] || '';
        const excerpt = excerptIndex >= 0 ? translated?.[excerptIndex] || '' : '';
        const content = contentIndex >= 0 ? translated?.[contentIndex] || '' : '';

        if (!title) {
          failed += 1;
          continue;
        }

        entry.title = title;
        entry.excerpt = excerpt;
        entry.content = content;

        translations[entry.item.id] = {
          title,
          excerpt,
          content,
          hash: entry.hash,
          lang: entry.item.lang || 'auto',
          translatedAt: new Date().toISOString(),
          provider,
        };
        done += 1;
      }

      console.log(`  ${lang}: ${Math.min(offset + batchSize, entries.length)} / ${entries.length}`);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    provider,
    count: Object.keys(translations).length,
    translations,
  };

  const newContent = JSON.stringify(translations);

  if (previousContent === newContent) {
    console.log('Набор переводов не изменился — файл не перезаписываем.');
    return;
  }

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Готово: переведено ${done}, ошибок ${failed}. Всего в файле: ${payload.count}.`);
  console.log(`Файл: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error('Критическая ошибка перевода:', error);
  // Перевод не должен ломать сборку новостей: оставляем оригиналы.
  process.exitCode = 0;
});
