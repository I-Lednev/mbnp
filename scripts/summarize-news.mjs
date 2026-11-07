#!/usr/bin/env node
/**
 * Делает краткую выжимку по каждому разделу.
 *
 * Бесплатные варианты нейросети:
 *   - Gemini:       GEMINI_API_KEY
 *   - Groq:         GROQ_API_KEY
 *   - Cloudflare:   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
 * Если ключей нет — строится аккуратная выжимка из заголовков (extractive).
 *
 * Результат: data/summaries.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_FILE = join(ROOT, 'data', 'news.json');
const TRANSLATIONS_FILE = join(ROOT, 'data', 'translations.json');
const OUT_FILE = join(ROOT, 'data', 'summaries.json');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const TIME_LIMIT_MS = Number(process.env.SUMMARIZE_TIME_LIMIT_MS) || 180_000;
const PERIOD_HOURS = 24;
const MAX_ITEMS = 8;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'into', 'over',
  'under', 'about', 'after', 'before', 'will', 'would', 'could', 'should', 'more',
  'most', 'than', 'then', 'they', 'their', 'there', 'here', 'what', 'when', 'where',
  'which', 'while', 'your', 'you', 'our', 'its', 'his', 'her', 'has', 'have', 'had',
  'not', 'but', 'are', 'was', 'were', 'been', 'being', 'new', 'news', 'game', 'games',
  'gaming', 'company', 'report', 'reports', 'says', 'said', 'update', 'updates',
  'first', 'best', 'top', 'how', 'why', 'who', 'all', 'can', 'may', 'now', 'out',
  'и', 'в', 'на', 'с', 'по', 'для', 'из', 'от', 'до', 'что', 'как', 'это', 'все',
  'уже', 'или', 'но', 'не', 'за', 'к', 'о', 'об', 'у', 'же', 'бы', 'ли', 'при',
  'над', 'под', 'без', 'более', 'самый', 'самая', 'самое', 'новый', 'новая', 'новое',
  'новые', 'новост', 'новости', 'игра', 'игры', 'игру', 'играх', 'игровой', 'игроки',
  'игроков', 'геймеры', 'компания', 'который', 'которая', 'которые', 'стала', 'стал',
  'будет', 'могут', 'может', 'своих', 'свой', 'свои', 'после', 'перед', 'через',
  'также', 'только', 'есть', 'был', 'была', 'было', 'они', 'она', 'оно', 'его',
  'ее', 'их', 'мы', 'вы', 'я', 'ты', 'он', 'эта', 'этот', 'эти', 'той', 'тот',
  'тех', 'так', 'там', 'тут', 'где', 'когда', 'почему', 'чтобы', 'чем', 'кто',
  'еще', 'теперь', 'очень', 'почти', 'менее', 'против', 'между', 'около', 'более',
  'игр', 'игро', 'год', 'года', 'году', 'лет', 'день', 'дня', 'дней', 'днях',
  'недел', 'месяц', 'раза', 'раз', 'этом', 'этого', 'сейчас', 'можно', 'нужно',
  'стало', 'стали', 'стать', 'получил', 'получит', 'получили', 'вышел', 'вышла',
  'вышло', 'вышли', 'выпуск', 'доступн', 'представ', 'рассказ', 'сообщ', 'объяв',
  'показал', 'показали', 'назвал', 'назвали', 'делятся', 'мнением', 'мнение',
  'планам', 'планы', 'против', 'котором', 'которая', 'которые', 'которых',
  'work', 'works', 'working', 'gets', 'getting', 'today', 'restoration', 'layer',
  'agent', 'agentic', 'code', 'muse', 'thanks', 'into', 'just', 'like', 'make',
  'makes', 'made', 'look', 'looks', 'say', 'says', 'week', 'day', 'days', 'year',
  'years', 'time', 'times', 'people', 'world', 'one', 'two', 'way', 'ways', 'get',
  'got', 'using', 'use', 'used', 'first', 'release', 'released', 'launch',
  'brings', 'bring', 'beyond', 'developer', 'developers', 'develop', 'guide',
]);

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}+-]+/u)
    .map((token) => token.replace(/^[-+]+|[-+]+$/g, ''))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

const TOPIC_LABELS = {
  openai: 'OpenAI',
  nvidia: 'NVIDIA',
  amd: 'AMD',
  intel: 'Intel',
  gta: 'GTA',
  ps5: 'PS5',
  xbox: 'Xbox',
  nintendo: 'Nintendo',
  sony: 'Sony',
  microsoft: 'Microsoft',
  steam: 'Steam',
  switch: 'Switch',
  rtx: 'RTX',
  dlss: 'DLSS',
  ubisoft: 'Ubisoft',
  tencent: 'Tencent',
  ea: 'EA',
  mass: 'Mass Effect',
};

function hotTopics(items) {
  const topicSources = new Map();
  const topicCounts = new Map();

  for (const item of items) {
    const tokens = new Set(tokenize(item.title));
    for (const token of tokens) {
      topicCounts.set(token, (topicCounts.get(token) || 0) + 1);
      if (!topicSources.has(token)) topicSources.set(token, new Set());
      topicSources.get(token).add(item.sourceId || item.source || '');
    }
  }

  return [...topicCounts.entries()]
    .filter(([token, count]) => count >= 2 && !/^\d+$/.test(token))
    .map(([token, count]) => ({
      token,
      score: count * (1 + (topicSources.get(token)?.size || 1)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => TOPIC_LABELS[entry.token] || entry.token[0].toUpperCase() + entry.token.slice(1));
}

function scoreItems(items) {
  const topics = hotTopics(items);
  const tokens = topics.map((topic) => topic.toLowerCase());

  return items
    .map((item) => {
      const haystack = `${item.title} ${item.excerpt || ''}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

const provider = GEMINI_KEY ? 'gemini' : GROQ_KEY ? 'groq' : CF_ACCOUNT && CF_TOKEN ? 'cloudflare' : 'extractive';

function readJson(file, fallback = null) {
  return readFile(file, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => fallback);
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function trim(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { promise, controller, timer };
}

async function callGemini(prompt) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 240 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

async function callGroq(prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${GROQ_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 240,
    }),
  });
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function callCloudflare(prompt) {
  const model = process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CF_ACCOUNT)}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CF_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 240,
      }),
    },
  );
  if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}`);
  const data = await response.json();
  return data?.result?.response || '';
}

async function llmSummary(label, items, topics) {
  if (provider === 'extractive') return '';

  const lines = items
    .map((item, index) => `${index + 1}. ${item.title}${item.excerpt ? ` — ${trim(item.excerpt, 180)}` : ''}`)
    .join('\n');

  const prompt = [
    `Ты редактор новостного агрегатора MBNP. Сделай краткую сводку на русском языке по разделу «${label}» за последние 24 часа.`,
    'Напиши 2–3 предложения о главном. Выдели самые громкие и обсуждаемые новости, но не выдумывай факты.',
    'Используй только заголовки ниже. Без вступлений, списков и обращения к читателю.',
    topics.length ? `Чаще всего в заголовках встречаются: ${topics.join(', ')}.` : '',
    '',
    lines,
  ].join('\n');

  const call = provider === 'gemini' ? callGemini : provider === 'groq' ? callGroq : callCloudflare;
  const result = await call(prompt);
  return trim(result, 520);
}

function isBrokenTitle(value) {
  const text = String(value || '');
  return (
    text.length < 12 ||
    /\n/.test(text) ||
    /["\\]\s*:\s*["\\]/.test(text) ||
    /^\s*["'{\[]/.test(text) ||
    /…{2,}|\.{4,}/.test(text)
  );
}

function extractiveSummary(label, items, total, sourceCount, topics) {
  if (items.length === 0) return '';

  const subject = label === 'Все разделы' ? 'За сутки' : `За сутки в разделе «${label}»`;
  const trend = topics.length > 0 ? `заметнее всего: ${topics.slice(0, 3).join(', ')}.` : 'собрали главное.';
  const main = `Главное: ${trim(items[0].title, 150)}.`;

  return `${subject} — ${trend} ${main}`.replace(/\s+/g, ' ').trim();
}

async function main() {
  const news = await readJson(NEWS_FILE);
  if (!news || !Array.isArray(news.items)) {
    console.error(`Не найден ${NEWS_FILE}. Сначала запустите scripts/fetch-news.mjs.`);
    process.exitCode = 1;
    return;
  }

  const translationsData = await readJson(TRANSLATIONS_FILE, { translations: {} });
  const translations = translationsData?.translations || {};
  const previous = await readJson(OUT_FILE, { categories: {} });
  const previousCategories = previous?.categories || {};
  const previousContent = JSON.stringify(previousCategories);

  const currentCategories = {};
  const started = Date.now();

  const categories = [
    { key: 'all', label: 'Все разделы', items: news.items },
    ...Object.entries(news.categories || {}).map(([key, label]) => ({
      key,
      label,
      items: news.items.filter((item) => item.category === key),
    })),
  ];

  for (const category of categories) {
    const categoryItems = category.items;
    if (categoryItems.length === 0) continue;

    const cutoff = Date.now() - PERIOD_HOURS * 3_600_000;
    const recentItems = categoryItems.filter((item) => {
      const date = Date.parse(item.addedAt || item.publishedAt || 0);
      return Number.isFinite(date) && date >= cutoff;
    });

    const pool = recentItems.length >= 3 ? recentItems : categoryItems.slice(0, 12);

    const prepared = pool
      .map((item) => {
        const translation = translations[item.id];
        const title = translation?.title || item.title;
        return {
          id: item.id,
          title,
          excerpt: translation?.excerpt || item.excerpt || '',
          sourceId: item.sourceId,
          source: item.source,
          url: item.url,
        };
      })
      .filter((item) => !isBrokenTitle(item.title));

    if (prepared.length === 0) continue;

    const topics = hotTopics(prepared);
    const ranked = scoreItems(prepared);
    const selected = ranked.slice(0, MAX_ITEMS);
    const sourceCount = new Set(pool.map((item) => item.sourceId)).size;
    const sourceHash = hash(
      `${provider}\n${category.key}\n${pool.length}\n${selected.map((item) => `${item.id}:${item.title}`).join('|')}`,
    );
    const cached = previousCategories[category.key];

    if (cached?.hash === sourceHash && cached?.text) {
      currentCategories[category.key] = cached;
      continue;
    }

    let text = '';
    const timeLeft = TIME_LIMIT_MS - (Date.now() - started);

    if (provider !== 'extractive' && timeLeft > 3000) {
      try {
        text = await Promise.race([
          llmSummary(category.label, selected, topics),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), Math.min(25_000, timeLeft))),
        ]);
      } catch (error) {
        console.warn(`  ${category.key}: нейросеть не ответила (${error.message}), делаю выжимку из заголовков`);
      }
    }

    if (!text) {
      text = extractiveSummary(category.label, ranked, pool.length, sourceCount, topics);
    }

    currentCategories[category.key] = {
      label: category.label,
      text,
      bullets: ranked.slice(0, 3).map((item) => ({
        title: trim(item.title, 120),
        source: item.source,
        url: item.url,
      })),
      count: pool.length,
      periodHours: PERIOD_HOURS,
      sourceCount,
      hash: sourceHash,
      generatedAt: new Date().toISOString(),
    };

    console.log(`  ✓ ${category.label}: ${trim(text, 80)}`);
  }

  const newContent = JSON.stringify(currentCategories);
  if (previousContent === newContent) {
    console.log('Выжимки не изменились.');
    return;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    provider,
    categories: currentCategories,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\nГотово: ${Object.keys(currentCategories).length} выжимок, провайдер ${provider}.`);
  console.log(`Файл: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error('Критическая ошибка выжимок:', error);
  process.exitCode = 0;
});
