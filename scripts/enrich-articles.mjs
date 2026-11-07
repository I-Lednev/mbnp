#!/usr/bin/env node
/**
 * Достаёт полный текст и все картинки со страниц статей.
 *
 * RSS часто отдаёт только анонс. Этот шаг скачивает страницу, вырезает
 * основной текст через @mozilla/readability и складывает результат в
 * data/articles.json. Читалка подхватывает файл лениво, при открытии новости.
 *
 * Запуск:
 *   node scripts/enrich-articles.mjs
 *   MAX_ENRICH=40 node scripts/enrich-articles.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_FILE = join(ROOT, 'data', 'news.json');
const OUT_FILE = join(ROOT, 'data', 'articles.json');

const MAX_ENRICH = Number(process.env.MAX_ENRICH) || 60;
const TIME_LIMIT_MS = Number(process.env.ENRICH_TIME_LIMIT_MS) || 240_000;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONTENT = 20_000;
const MAX_IMAGES = 20;
const EXTRACTOR_VERSION = 4;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 MyBestNEWSPaper/1.0';

// ── Утилиты ──────────────────────────────────────────────────────────────

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error) {
  if (error?.name === 'AbortError') return 'таймаут';
  return error?.cause?.code || error?.message || 'ошибка';
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanAlt(text) {
  return normalizeText(text).replace(/\s+/g, ' ').slice(0, 160);
}

function cleanArticleText(text) {
  let result = normalizeText(text);

  // Readability иногда захватывает служебную шапку статьи.
  const metaPatterns = [
    /^In Brief\s*\n/i,
    /^Posted:\s*\n/i,
    /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)[^\n]*\n/i,
    /^Image Credits?:[^\n]*\n/i,
    /^Advertisement\s*\n/i,
  ];

  for (let index = 0; index < 6; index += 1) {
    const before = result;
    for (const pattern of metaPatterns) result = result.replace(pattern, '').trimStart();
    if (result === before) break;
  }

  return result;
}

function resolveUrl(raw, base) {
  if (!raw) return '';

  try {
    const url = new URL(String(raw).trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.href === base) return '';

    if (/(?:^|[/._-])(?:1x1|pixel|spacer|transparent|blank)(?:[/._-]|$)/i.test(url.pathname)) {
      return '';
    }

    if (
      /(?:^|[/._-])(?:banner|advert|promo|sponsor|newsletter|subscribe|logos?|icons?|avatars?|sprites?|tracking|lettermark|wordmark)(?:[/._-]|$)/i.test(
        url.pathname,
      )
    ) {
      return '';
    }

    if (/(?:doubleclick|googletagmanager|google-analytics|facebook\.com\/tr)/i.test(url.href)) {
      return '';
    }

    // Иногда в <img> попадает ссылка на саму статью, а не на картинку.
    const hasImageExtension = /\.(?:jpe?g|png|webp|gif|avif|svg)(?:$|[?#])/i.test(url.href);
    const looksLikeImageHost =
      /(?:^|\.)(?:images?|img|cdn|media|static|uploads?|photos?|assets?)\./i.test(url.hostname) ||
      /(?:images?|uploads?|media|photos?|assets?)/i.test(url.pathname);

    if (!hasImageExtension && !looksLikeImageHost && !url.search) return '';

    return url.href;
  } catch {
    return '';
  }
}

function bestFromSrcset(srcset) {
  if (!srcset) return '';

  const candidates = srcset
    .split(',')
    .map((part) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const width = descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : 0;
      return { url, width };
    })
    .filter((candidate) => candidate.url);

  candidates.sort((a, b) => b.width - a.width);
  return candidates[0]?.url || '';
}

function collectImages(document, articleHtml, baseUrl) {
  const candidates = [];

  for (const meta of document.querySelectorAll(
    'meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]',
  )) {
    const content = meta.getAttribute('content');
    if (content) candidates.push({ url: content, alt: '', width: 0, height: 0 });
  }

  let articleDocument = document;
  if (articleHtml) {
    try {
      articleDocument = new JSDOM(articleHtml, { url: baseUrl }).window.document;
    } catch {
      articleDocument = document;
    }
  }

  for (const image of articleDocument.querySelectorAll('img')) {
    const srcset = image.getAttribute('srcset') || image.getAttribute('data-srcset');
    const src =
      image.getAttribute('src') ||
      image.getAttribute('data-src') ||
      image.getAttribute('data-lazy-src') ||
      image.getAttribute('data-original');
    const srcsetUrl = bestFromSrcset(srcset);
    const url = srcsetUrl || src;
    const alt = image.getAttribute('alt') || '';
    const width = Number(image.getAttribute('width')) || 0;
    const height = Number(image.getAttribute('height')) || 0;

    if (url) candidates.push({ url, alt, width, height });
  }

  for (const source of articleDocument.querySelectorAll('source[srcset]')) {
    const url = bestFromSrcset(source.getAttribute('srcset'));
    if (url) candidates.push({ url, alt: '', width: 0, height: 0 });
  }

  // Если в очищенной статье картинок не оказалось, смотрим исходный документ.
  if (!candidates.some((candidate) => !candidate.url.startsWith('data:'))) {
    for (const image of document.querySelectorAll('img')) {
      const src = image.getAttribute('src') || image.getAttribute('data-src');
      const width = Number(image.getAttribute('width')) || 0;
      const height = Number(image.getAttribute('height')) || 0;
      if (src) candidates.push({ url: src, alt: image.getAttribute('alt') || '', width, height });
    }
  }

  const seen = new Set();
  const images = [];

  for (const candidate of candidates) {
    if ((candidate.width > 0 && candidate.width < 80) || (candidate.height > 0 && candidate.height < 80)) {
      continue;
    }

    const url = resolveUrl(candidate.url, baseUrl);
    if (!url) continue;

    const key = `${new URL(url).origin}${new URL(url).pathname}`;
    if (seen.has(key)) continue;

    seen.add(key);
    images.push({ url, alt: cleanAlt(candidate.alt) });

    if (images.length >= MAX_IMAGES) break;
  }

  return images;
}

// ── Извлечение статьи ────────────────────────────────────────────────────

async function enrichArticle(item) {
  const response = await fetchWithTimeout(item.url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ru,en;q=0.8',
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`не HTML (${contentType || 'без content-type'})`);
  }

  const html = await response.text();
  if (html.length < 500) throw new Error('пустая страница');

  const dom = new JSDOM(html, { url: item.url });

  try {
    const document = dom.window.document;
    const article = new Readability(document, { charThreshold: 80 }).parse();

    if (!article?.textContent || article.textContent.trim().length < 300) {
      throw new Error('не удалось выделить основной текст');
    }

    const content = cleanArticleText(article.textContent).slice(0, MAX_CONTENT);
    if (content.length < 300) throw new Error('слишком короткий текст');

    return {
      title: article.title || item.title,
      byline: article.byline || '',
      siteName: article.siteName || '',
      content,
      images: collectImages(document, article.content, item.url),
    };
  } finally {
    dom.window.close();
  }
}

// ── Сборка ───────────────────────────────────────────────────────────────

function needScore(item) {
  const contentLength = (item.content || '').length;
  const imageCount = (item.images || []).length;

  let score = 0;
  if (contentLength < 500) score += 3;
  else if (contentLength < 1500) score += 2;
  else if (contentLength < 4000) score += 1;
  if (imageCount < 2) score += 1;

  return score;
}

async function main() {
  const news = await readJson(NEWS_FILE);
  if (!news || !Array.isArray(news.items)) {
    console.error(`Не найден ${NEWS_FILE}. Сначала запустите scripts/fetch-news.mjs.`);
    process.exitCode = 1;
    return;
  }

  const previous = await readJson(OUT_FILE, { articles: {} });
  const articles = previous?.articles && typeof previous.articles === 'object' ? previous.articles : {};
  const previousContent = JSON.stringify(articles);

  const currentIds = new Set(news.items.map((item) => item.id));
  for (const id of Object.keys(articles)) {
    if (!currentIds.has(id)) delete articles[id];
  }

  const now = Date.now();

  const candidates = news.items
    .filter((item) => {
      if (!item?.url) return false;
      const cached = articles[item.id];
      if (!cached) return true;
      if (cached.version !== EXTRACTOR_VERSION) return true;
      if (cached.url !== item.url) return true;
      if (!cached.fetchedAt) return true;
      return now - Date.parse(cached.fetchedAt) > CACHE_TTL_MS;
    })
    .sort((a, b) => {
      const scoreDiff = needScore(b) - needScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
    });

  if (candidates.length === 0) {
    console.log('Все статьи уже обогащены — новых страниц нет.');
    return;
  }

  const queue = candidates.slice(0, MAX_ENRICH);
  const deadline = Date.now() + TIME_LIMIT_MS;
  let done = 0;
  let failed = 0;
  let kept = 0;
  let cursor = 0;

  console.log(
    `Обогащаем ${queue.length} из ${candidates.length} статей (полный текст и фото). ` +
      `Лимит времени: ${Math.round(TIME_LIMIT_MS / 1000)} с.`,
  );

  async function worker() {
    while (cursor < queue.length) {
      if (Date.now() > deadline) return;

      const item = queue[cursor++];

      try {
        const enriched = await enrichArticle(item);

        articles[item.id] = {
          version: EXTRACTOR_VERSION,
          url: item.url,
          fetchedAt: new Date().toISOString(),
          title: enriched.title,
          byline: enriched.byline,
          siteName: enriched.siteName,
          content: enriched.content,
          images: enriched.images,
          length: enriched.content.length,
          imageCount: enriched.images.length,
        };

        done += 1;
        console.log(
          `  ✓ ${item.source.padEnd(22)} ${String(enriched.content.length).padStart(5)} симв. ` +
            `${String(enriched.images.length).padStart(2)} фото`,
        );
      } catch (error) {
        failed += 1;

        const cached = articles[item.id];
        if (cached?.content && cached.content.length >= 300) {
          // Старый хороший текст лучше, чем ничего: не затираем его ошибкой.
          kept += 1;
          console.log(`  ↻ ${item.source.padEnd(22)} сохраняю прошлый текст (${errorMessage(error)})`);
        } else {
          articles[item.id] = {
            version: EXTRACTOR_VERSION,
            url: item.url,
            fetchedAt: new Date().toISOString(),
            error: errorMessage(error),
          };
          console.log(`  ✗ ${item.source.padEnd(22)} ${errorMessage(error)}`);
        }
      }

      await sleep(120);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  const payload = {
    generatedAt: new Date().toISOString(),
    count: Object.values(articles).filter((article) => article?.content).length,
    articles,
  };

  const newContent = JSON.stringify(articles);
  if (previousContent === newContent) {
    console.log('\nСтатьи не изменились — data/articles.json оставлен без изменений.');
    return;
  }

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`\nГотово: +${done}, ошибок ${failed}, сохранено прошлых ${kept}.`);
  console.log(`Всего статей с полным текстом: ${payload.count}.`);
  console.log(`Файл: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error('Критическая ошибка обогащения статей:', error);
  // Не ломаем сборку новостей: читалка просто останется на RSS-тексте.
  process.exitCode = 0;
});
