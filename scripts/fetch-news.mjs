#!/usr/bin/env node
/**
 * Собирает RSS/Atom-ленты и складывает нормализованный news.json.
 * Без внешних зависимостей — работает на чистом Node.js 20+.
 *
 * Запуск:  node scripts/fetch-news.mjs
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'data', 'news.json');
const DIGEST_DIR = join(ROOT, 'data', 'digest');
const DIGEST_RETENTION_WEEKS = Number(process.env.DIGEST_RETENTION_WEEKS) || 12;
const MAX_DIGEST_ITEMS_PER_WEEK = 1000;

const MAX_PER_SOURCE = 10;
const MAX_PER_CATEGORY = 600;
const NEWS_RETENTION_DAYS = Number(process.env.NEWS_RETENTION_DAYS) || 7;
const FETCH_TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

/**
 * Ключевые слова для общих лент: в тематический раздел попадают только
 * материалы, где встречается хотя бы одно из них.
 */
const AI_MODS_KEYWORDS = [
  'mod', 'mods', 'modding', 'modder', 'decompil', 'reverse engineer', 'reverse-engineering',
  'ai', 'neural', 'generative', 'generated', 'llm', 'machine learning', 'fan remake',
  'unofficial port', 'source code', 'rom hack', 'texture pack', 'asset',
  'мод', 'моды', 'модифик', 'декомпил', 'нейросет', 'искусственн', 'сгенерир', 'реверс', 'исходн',
];

const AI_SOFT_KEYWORDS = [
  'ai', 'artificial intelligence', 'llm', 'large language model', 'language model', 'copilot',
  'code generation', 'codegen', 'vibe coding', 'agent', 'agentic', 'decompil', 'reverse engineer',
  'reverse-engineering', 'generative', 'neural', 'machine learning', 'chatgpt', 'claude', 'gemini',
  'gpt', 'open source model', 'model context protocol', 'mcp',
  'искусственн', 'нейросет', 'декомпил', 'реверс', 'генератив', 'языков', 'агент',
];

const WAR_KEYWORDS = [
  'ukrain', 'kyiv', 'kiev', 'russia', 'russian', 'putin', 'kremlin', 'zelensk',
  'donbas', 'zaporizh', 'kherson', 'kharkiv', 'kursk', 'crimea', 'nato', 'frontline',
  'украин', 'киев', 'росси', 'путин', 'кремл', 'зеленск', 'донбасс', 'запорож',
  'херсон', 'харьков', 'курск', 'крым', 'нато', 'фронт',
];

const CONSOLE_KEYWORDS = [
  'playstation', 'ps5', 'ps4', 'ps3', 'xbox', 'nintendo', 'switch', 'steam deck',
  'game pass', 'dualsense', 'joy-con', 'handheld', 'series x', 'series s', 'sony',
  'консол', 'приставк', 'портативн',
];

const PC_HARDWARE_KEYWORDS = [
  'видеокарт', 'gpu', 'nvidia', 'amd', 'intel', 'rtx', 'radeon', 'ryzen',
  'core i', 'core ultra', 'процессор', 'материнск', 'ssd', 'hdd', 'ddr',
  'оперативн', 'блок питания', 'корпус', 'thermalright', 'монитор', 'ноутбук',
  'клавиатур', 'мышь', 'роутер', 'чип', 'желез', 'комплектующ', 'pcie', 'usb',
  'thunderbolt', 'geekbench', 'dlss', 'l3-кэш',
];

const INDUSTRY_KEYWORDS = [
  'рынок', 'продаж', 'выручк', 'компан', 'издател', 'студи', 'увольнен',
  'сокращен', 'сделк', 'покупк', 'инвест', 'акци', 'отчет', 'прибыл', 'убыт',
  'лиценз', 'судебн', 'бюджет', 'финанс', 'капитал', 'доход', 'контракт',
  'поглощ', 'слиян',
  'microsoft', 'sony', 'nintendo', 'tencent', 'embracer', 'ubisoft', 'take-two',
  'electronic arts', 'ea', 'activision', 'blizzard', 'layoff', 'acquisition',
  'merger', 'revenue', 'earnings', 'market', 'publisher', 'invest', 'lawsuit', 'ipo',
];

const PC_KEYWORDS = [
  'пк', 'pc', 'steam', 'windows', 'linux', 'epic games', 'gog', 'мод', 'моды',
  'модифик', 'патч', 'обновлен', 'драйвер', 'видеокарт', 'процессор', 'ssd', 'hdd',
  'клавиатур', 'мышь', 'монитор', 'сборка', 'железо', 'бенчмарк', 'fps', 'dlss',
  'rtx', 'amd', 'intel', 'nvidia', 'steam deck', 'ранний доступ', 'early access',
];

const UPDATES_KEYWORDS = [
  'обновлен', 'патч', 'апдейт', 'dlc', 'длс', 'дополнен', 'сезон', 'ивент',
  'событие', 'версия', 'hotfix', 'update', 'patch', 'expansion', 'season',
  'event', 'version', 'early access', 'ранний доступ', 'balance', 'фикс',
  'исправлен', 'release', 'релиз',
];

const ANNOUNCE_KEYWORDS = [
  'анонс', 'анонсир', 'представ', 'объяв', 'объявил', 'объявлен', 'выйдет',
  'выпустят', 'дата выхода', 'трейлер', 'дебют', 'первый взгляд',
  'announc', 'reveal', 'unveil', 'coming', 'launch', 'release date', 'trailer',
  'first look', 'world premiere', 'debut', 'set for', 'officially',
];

const MOBILE_KEYWORDS = [
  'мобильн', 'mobile', 'android', 'ios', 'iphone', 'ipad', 'app store',
  'google play', 'gacha', 'гача', 'смартфон', 'телефон', 'мобильная игра',
  'pubg mobile', 'genshin', 'honkai', 'free fire', 'call of duty mobile',
  'brawl stars', 'clash of clans', 'clash royale', 'pokemon go', 'roblox',
  'pocket gamer', 'toucharcade', 'droid', 'apk',
];

const RELEASE_KEYWORDS = [
  'релиз', 'вышл', 'вышел', 'вышла', 'вышло', 'вышли', 'доступн', 'запущ',
  'уже в продаже', 'поступил в продажу', 'новинк',
  'release', 'released', 'launch', 'launched', 'out now', 'now available',
  'available now', 'is out', 'hits stores', 'new release',
];

const RUMOR_KEYWORDS = [
  'слух', 'слухи', 'инсайд', 'утечк', 'утеч', 'якобы', 'неофициальн',
  'по данным', 'источник', 'возможн',
  'rumor', 'rumour', 'leak', 'leaked', 'insider', 'reportedly', 'allegedly',
  'unconfirmed', 'datamine', 'datamined', 'according to', 'hint',
];

const SOFTWARE_KEYWORDS = [
  'софт', 'программ', 'приложен', 'утилит', 'браузер', 'операционн',
  'windows', 'macos', 'linux', 'android', 'ios', 'chrome', 'firefox', 'edge',
  'office', 'photoshop', 'антивирус', 'драйвер', 'архиватор', 'мессенджер',
  'telegram', 'whatsapp', 'discord', 'zoom',
  'software', 'application', 'browser', 'utility', 'tool', 'operating system',
  'driver', 'antivirus', 'desktop app', 'download',
];

const PORT_KEYWORDS = [
  'port', 'порт', 'ported', 'pc port', 'switch', 'ps2', 'ps3', 'ps4', 'psp',
  'wii', 'gamecube', 'n64', 'dreamcast', 'saturn', 'linux', 'steam deck',
  'android', 'ios', 'emulator', 'эмулятор', 'decompil', 'декомпил', 'recompil',
  'source code', 'исходн', 'remaster', 'ремастер', 'fan remake', 'фанатск',
];

/**
 * Источники. id — стабильный ключ, category — вкладка, lang — язык.
 * keywords — необязательный фильтр для общих лент.
 * Чтобы добавить источник, просто допишите объект в массив.
 */
const FEEDS = [
  // ── ИИ ────────────────────────────────────────────────────────────────
  { id: 'techcrunch-ai', category: 'ai', name: 'TechCrunch AI', lang: 'en', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'verge-ai', category: 'ai', name: 'The Verge AI', lang: 'en', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'habr-ai', category: 'ai', name: 'Habr AI', lang: 'ru', url: 'https://habr.com/ru/rss/hub/artificial_intelligence/all/?fl=ru' },
  { id: 'openai-news', category: 'ai', name: 'OpenAI News', lang: 'en', url: 'https://openai.com/news/rss.xml' },
  { id: 'hf-blog', category: 'ai', name: 'Hugging Face', lang: 'en', url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'mit-ai', category: 'ai', name: 'MIT Technology Review', lang: 'en', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { id: 'wired-ai', category: 'ai', name: 'WIRED AI', lang: 'en', url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
  { id: 'ieee-ai', category: 'ai', name: 'IEEE Spectrum AI', lang: 'en', url: 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss' },

  // ── Игры ──────────────────────────────────────────────────────────────
  { id: 'stopgame', category: 'games', name: 'StopGame', lang: 'ru', url: 'https://stopgame.ru/rss/rss_news.xml' },
  { id: 'dtf', category: 'games', name: 'DTF', lang: 'ru', url: 'https://dtf.ru/rss' },
  { id: 'igromania', category: 'games', name: 'Игромания', lang: 'ru', url: 'https://www.igromania.ru/rss/news.xml' },
  { id: '3dnews-games', category: 'games', name: '3DNews Игры', lang: 'ru', url: 'https://3dnews.ru/games/rss' },
  { id: 'ign', category: 'games', name: 'IGN', lang: 'en', url: 'https://feeds.ign.com/ign/games-all' },
  { id: 'eurogamer', category: 'games', name: 'Eurogamer', lang: 'en', url: 'https://www.eurogamer.net/feed' },
  { id: 'ars-gaming', category: 'games', name: 'Ars Technica Gaming', lang: 'en', url: 'https://feeds.arstechnica.com/arstechnica/gaming' },

  // ── Анонсы игр ─────────────────────────────────────────────────────────
  { id: 'playground-announces', category: 'announces', name: 'Playground Анонсы', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: ANNOUNCE_KEYWORDS },
  { id: 'siliconera', category: 'announces', name: 'Siliconera', lang: 'en', url: 'https://www.siliconera.com/feed/', keywords: ANNOUNCE_KEYWORDS },
  { id: 'gamingbolt', category: 'announces', name: 'GamingBolt', lang: 'en', url: 'https://gamingbolt.com/feed', keywords: ANNOUNCE_KEYWORDS },
  { id: 'vg247', category: 'announces', name: 'VG247', lang: 'en', url: 'https://www.vg247.com/feed', keywords: ANNOUNCE_KEYWORDS },

  // ── Мобильные игры ─────────────────────────────────────────────────────
  { id: 'playground-mobile', category: 'mobile', name: 'Playground Мобильные', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: MOBILE_KEYWORDS },
  { id: 'toucharcade', category: 'mobile', name: 'TouchArcade', lang: 'en', url: 'https://toucharcade.com/feed/', keywords: MOBILE_KEYWORDS },

  // ── Релизы игр ─────────────────────────────────────────────────────────
  { id: 'playground-releases', category: 'releases', name: 'Playground Релизы', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: RELEASE_KEYWORDS },
  { id: 'steam-newreleases', category: 'releases', name: 'Steam Новинки', lang: 'en', url: 'https://store.steampowered.com/feeds/newreleases.xml' },
  { id: 'gog-news', category: 'releases', name: 'GOG', lang: 'en', url: 'https://www.gog.com/news/feed', keywords: RELEASE_KEYWORDS },

  // ── Слухи и утечки ─────────────────────────────────────────────────────
  { id: 'playground-rumors', category: 'rumors', name: 'Playground Слухи', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: RUMOR_KEYWORDS },
  { id: 'reddit-leaks', category: 'rumors', name: 'r/GamingLeaksAndRumours', lang: 'en', url: 'https://www.reddit.com/r/GamingLeaksAndRumours/new/.rss', keywords: RUMOR_KEYWORDS },
  { id: 'dexerto', category: 'rumors', name: 'Dexerto', lang: 'en', url: 'https://www.dexerto.com/feed/', keywords: RUMOR_KEYWORDS },

  // ── Софт ───────────────────────────────────────────────────────────────
  { id: 'playground-software', category: 'software', name: 'Playground Софт', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: SOFTWARE_KEYWORDS },
  { id: 'ghacks', category: 'software', name: 'gHacks', lang: 'en', url: 'https://www.ghacks.net/feed/', keywords: SOFTWARE_KEYWORDS },
  { id: 'macrumors', category: 'software', name: 'MacRumors', lang: 'en', url: 'https://www.macrumors.com/macrumors.xml', keywords: SOFTWARE_KEYWORDS },
  { id: 'omgubuntu', category: 'software', name: 'OMG! Ubuntu', lang: 'en', url: 'https://www.omgubuntu.co.uk/feed', keywords: SOFTWARE_KEYWORDS },
  { id: '9to5google', category: 'software', name: '9to5Google', lang: 'en', url: 'https://9to5google.com/feed/', keywords: SOFTWARE_KEYWORDS },

  // ── Наука ──────────────────────────────────────────────────────────────
  { id: 'sciencedaily', category: 'science', name: 'ScienceDaily', lang: 'en', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
  { id: 'physorg', category: 'science', name: 'Phys.org', lang: 'en', url: 'https://phys.org/rss-feed/' },
  { id: 'nature', category: 'science', name: 'Nature', lang: 'en', url: 'https://www.nature.com/nature.rss' },
  { id: 'arsscience', category: 'science', name: 'Ars Technica Science', lang: 'en', url: 'https://feeds.arstechnica.com/arstechnica/science' },
  { id: 'quanta', category: 'science', name: 'Quanta Magazine', lang: 'en', url: 'https://www.quantamagazine.org/feed/' },

  // ── Развлечения ────────────────────────────────────────────────────────
  { id: 'verge-ent', category: 'entertainment', name: 'The Verge Entertainment', lang: 'en', url: 'https://www.theverge.com/rss/entertainment/index.xml' },
  { id: 'variety', category: 'entertainment', name: 'Variety', lang: 'en', url: 'https://variety.com/feed/' },
  { id: 'hollywoodreporter', category: 'entertainment', name: 'The Hollywood Reporter', lang: 'en', url: 'https://www.hollywoodreporter.com/feed/' },
  { id: 'deadline', category: 'entertainment', name: 'Deadline', lang: 'en', url: 'https://deadline.com/feed/' },
  { id: 'slashfilm', category: 'entertainment', name: 'SlashFilm', lang: 'en', url: 'https://www.slashfilm.com/feed/' },
  { id: 'avclub', category: 'entertainment', name: 'The A.V. Club', lang: 'en', url: 'https://www.avclub.com/rss' },
  { id: 'intermedia', category: 'entertainment', name: 'InterMedia', lang: 'ru', url: 'https://www.intermedia.ru/rss' },

  // ── Порты игр ──────────────────────────────────────────────────────────
  { id: 'github-ports', category: 'ports', name: 'GitHub: порты', lang: 'en', type: 'github', url: 'https://github.com/topics/game-port', queries: ['topic:game-port', 'topic:source-port', 'topic:recompilation', 'topic:decompilation'], maxItems: 24 },
  { id: 'reddit-emulation', category: 'ports', name: 'r/emulation', lang: 'en', url: 'https://www.reddit.com/r/emulation/new/.rss', keywords: PORT_KEYWORDS },

  // ── Индустрия игр ──────────────────────────────────────────────────────
  { id: 'gamesindustry', category: 'industry', name: 'GamesIndustry.biz', lang: 'en', url: 'https://www.gamesindustry.biz/feed' },
  { id: 'vgc', category: 'industry', name: 'VGC', lang: 'en', url: 'https://www.videogameschronicle.com/feed/' },
  { id: 'playground-industry', category: 'industry', name: 'Playground Индустрия', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: INDUSTRY_KEYWORDS },

  // ── Обновления игр ─────────────────────────────────────────────────────
  { id: 'playground-updates', category: 'updates', name: 'Playground Обновления', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: UPDATES_KEYWORDS },
  { id: 'ps-blog', category: 'updates', name: 'PlayStation Blog', lang: 'en', url: 'https://blog.playstation.com/feed/' },
  { id: 'xbox-wire', category: 'updates', name: 'Xbox Wire', lang: 'en', url: 'https://news.xbox.com/en-us/feed/' },
  { id: 'steam-news', category: 'updates', name: 'Steam News', lang: 'en', url: 'https://store.steampowered.com/feeds/news.xml' },

  // ── ПК ─────────────────────────────────────────────────────────────────
  { id: 'pcgamer', category: 'pc', name: 'PC Gamer', lang: 'en', url: 'https://www.pcgamer.com/rss/' },
  { id: 'rps', category: 'pc', name: 'Rock Paper Shotgun', lang: 'en', url: 'https://www.rockpapershotgun.com/feed' },
  { id: 'playground-pc', category: 'pc', name: 'Playground ПК', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: PC_KEYWORDS },

  // ── Консоли ────────────────────────────────────────────────────────────
  { id: 'playground-consoles', category: 'consoles', name: 'Playground Консоли', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: CONSOLE_KEYWORDS },
  { id: 'nintendolife', category: 'consoles', name: 'Nintendo Life', lang: 'en', url: 'https://www.nintendolife.com/feeds/latest' },
  { id: 'nintendoeverything', category: 'consoles', name: 'Nintendo Everything', lang: 'en', url: 'https://www.nintendoeverything.com/feed/' },
  { id: 'pushsquare', category: 'consoles', name: 'Push Square', lang: 'en', url: 'https://www.pushsquare.com/feeds/latest' },
  { id: 'psu', category: 'consoles', name: 'PlayStation Universe', lang: 'en', url: 'https://www.psu.com/feed/' },
  { id: 'purexbox', category: 'consoles', name: 'Pure Xbox', lang: 'en', url: 'https://www.purexbox.com/feeds/latest' },
  { id: 'gematsu', category: 'consoles', name: 'Gematsu', lang: 'en', url: 'https://www.gematsu.com/feed' },
  { id: 'timeextension', category: 'consoles', name: 'Time Extension', lang: 'en', url: 'https://www.timeextension.com/feeds/latest' },
  { id: 'steamdeckhq', category: 'consoles', name: 'SteamDeckHQ', lang: 'en', url: 'https://steamdeckhq.com/feed/' },

  // ── Железо ─────────────────────────────────────────────────────────────
  { id: 'playground-hardware', category: 'hardware', name: 'Playground Железо', lang: 'ru', url: 'https://www.playground.ru/rss/news.xml', keywords: PC_HARDWARE_KEYWORDS },
  { id: '3dnews-hardware', category: 'hardware', name: '3DNews Железо', lang: 'ru', url: 'https://3dnews.ru/news/rss', keywords: PC_HARDWARE_KEYWORDS },
  { id: 'tomshardware', category: 'hardware', name: "Tom's Hardware", lang: 'en', url: 'https://www.tomshardware.com/feeds/all' },

  // ── ИИ-моды, декомпиляции, игры, сделанные нейросетями ────────────────
  { id: '80lv', category: 'aimods', name: '80.lv', lang: 'en', url: 'https://80.lv/feed/', keywords: AI_MODS_KEYWORDS },
  { id: 'gamesradar', category: 'aimods', name: 'GamesRadar+', lang: 'en', url: 'https://www.gamesradar.com/rss/', keywords: AI_MODS_KEYWORDS },

  // ── Софт, созданный или разобранный нейросетями ───────────────────────
  { id: 'githubblog', category: 'aisoft', name: 'GitHub Blog', lang: 'en', url: 'https://github.blog/feed/', keywords: AI_SOFT_KEYWORDS },
  { id: 'stackoverflow', category: 'aisoft', name: 'Stack Overflow', lang: 'en', url: 'https://stackoverflow.blog/feed/', keywords: AI_SOFT_KEYWORDS },
  { id: 'hn', category: 'aisoft', name: 'Hacker News', lang: 'en', url: 'https://hnrss.org/frontpage?points=100', keywords: AI_SOFT_KEYWORDS },
  { id: 'infoq-ai', category: 'aisoft', name: 'InfoQ AI/ML', lang: 'en', url: 'https://feed.infoq.com/ai-ml-data-eng/' },
  { id: 'ars-techlab', category: 'aisoft', name: 'Ars Technica Tech', lang: 'en', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', keywords: AI_SOFT_KEYWORDS },
  { id: 'bleeping', category: 'aisoft', name: 'BleepingComputer', lang: 'en', url: 'https://www.bleepingcomputer.com/feed/', keywords: AI_SOFT_KEYWORDS },
  { id: 'simonw', category: 'aisoft', name: 'Simon Willison', lang: 'en', url: 'https://simonwillison.net/atom/everything/' },

  // ── Авто ──────────────────────────────────────────────────────────────
  { id: 'kolesa', category: 'cars', name: 'Kolesa.ru', lang: 'ru', url: 'https://www.kolesa.ru/export/rss.xml' },
  { id: 'zr', category: 'cars', name: 'За рулём', lang: 'ru', url: 'https://www.zr.ru/rss-news/' },
  { id: '5koleso', category: 'cars', name: '5 колесо', lang: 'ru', url: 'https://www.5koleso.ru/rss/' },
  { id: 'gazeta-auto', category: 'cars', name: 'Газета.Ru Авто', lang: 'ru', url: 'https://www.gazeta.ru/export/rss/auto.xml' },
  { id: 'motor1', category: 'cars', name: 'Motor1', lang: 'en', url: 'https://www.motor1.com/rss/news/all/' },
  { id: 'caranddriver', category: 'cars', name: 'Car and Driver', lang: 'en', url: 'https://www.caranddriver.com/rss/all.xml/' },
  { id: 'insideevs', category: 'cars', name: 'InsideEVs', lang: 'en', url: 'https://insideevs.com/rss/news/all/' },

  // ── Война в Украине ───────────────────────────────────────────────────
  { id: 'kyivindependent', category: 'war', name: 'Kyiv Independent', lang: 'en', url: 'https://kyivindependent.com/feed/', keywords: WAR_KEYWORDS },
  { id: 'ukrinform', category: 'war', name: 'Ukrinform', lang: 'uk', url: 'https://www.ukrinform.ua/rss/block-lastnews', keywords: WAR_KEYWORDS },
  { id: 'pravda', category: 'war', name: 'Ukrainska Pravda', lang: 'uk', url: 'https://www.pravda.com.ua/rss/', keywords: WAR_KEYWORDS },
  { id: 'bbc-ua', category: 'war', name: 'BBC Ukrainian', lang: 'uk', url: 'https://feeds.bbci.co.uk/ukrainian/rss.xml', keywords: WAR_KEYWORDS },
  { id: 'radiosvoboda', category: 'war', name: 'Radio Svoboda', lang: 'uk', url: 'https://www.radiosvoboda.org/api/zrqiteuuir', keywords: WAR_KEYWORDS },
  { id: 'meduza', category: 'war', name: 'Meduza', lang: 'ru', url: 'https://meduza.io/rss/all', keywords: WAR_KEYWORDS },
  { id: 'moscowtimes', category: 'war', name: 'The Moscow Times', lang: 'en', url: 'https://www.themoscowtimes.com/rss/news', keywords: WAR_KEYWORDS },
  { id: 'novaya', category: 'war', name: 'Novaya Gazeta Europe', lang: 'ru', url: 'https://novayagazeta.eu/feed/', keywords: WAR_KEYWORDS },
  { id: 'guardian-ukraine', category: 'war', name: 'The Guardian', lang: 'en', url: 'https://www.theguardian.com/world/ukraine/rss', keywords: WAR_KEYWORDS },
  { id: 'un-news', category: 'war', name: 'UN News', lang: 'en', url: 'https://news.un.org/feed/subscribe/en/news/topic/peace-and-security/feed/rss.xml', keywords: WAR_KEYWORDS },
  { id: 'aljazeera', category: 'war', name: 'Al Jazeera', lang: 'en', url: 'https://www.aljazeera.com/xml/rss/all.xml', keywords: WAR_KEYWORDS },
  { id: 'nyt-world', category: 'war', name: 'The New York Times', lang: 'en', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', keywords: WAR_KEYWORDS },
  { id: 'bbc-ru', category: 'war', name: 'BBC Russian', lang: 'ru', url: 'https://feeds.bbci.co.uk/russian/rss.xml', keywords: WAR_KEYWORDS },
  { id: 'dw-ru', category: 'war', name: 'DW Russian', lang: 'ru', url: 'https://rss.dw.com/rdf/rss-ru-all', keywords: WAR_KEYWORDS },
];

const CATEGORY_TITLES = {
  ai: 'ИИ',
  games: 'Игры',
  announces: 'Анонсы',
  mobile: 'Мобильные',
  releases: 'Релизы',
  rumors: 'Слухи',
  software: 'Софт',
  science: 'Наука',
  entertainment: 'Развлечения',
  ports: 'Порты',
  pc: 'ПК',
  consoles: 'Консоли',
  hardware: 'Железо',
  industry: 'Индустрия',
  updates: 'Обновления',
  aimods: 'ИИ-моды',
  aisoft: 'ИИ-софт',
  cars: 'Авто',
  war: 'Война',
};

// ── Сеть ─────────────────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 MyBestNEWSPaper/1.0';

async function fetchFeed(feed) {
  const attempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchFeedOnce(feed);
    } catch (error) {
      lastError = error;

      const code = error?.cause?.code;
      const httpStatus = Number((error?.message || '').match(/^HTTP (\d+)/)?.[1]);

      // Для мёртвого домена и явных 4xx повторы только тратят время.
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429)) {
        break;
      }

      if (attempt < attempts) {
        // Короткая пауза перед повтором: часть сайтов отдаёт ошибку при пачке запросов.
        await sleep(400 * attempt + Math.floor(Math.random() * 300));
      }
    }
  }

  throw lastError;
}

async function fetchFeedOnce(feed) {
  if (feed.type === 'github') return fetchGithubFeed(feed);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        'accept-language': 'ru,en;q=0.8',
        'cache-control': 'no-cache',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    const xml = decodeXml(buffer);

    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) {
      throw new Error('ответ не похож на RSS/Atom');
    }

    const items = parseFeed(xml, feed);
    return { feed, items, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGithubFeed(feed) {
  const started = Date.now();
  const token = process.env.GITHUB_TOKEN || '';
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  const headers = {
    'user-agent': USER_AGENT,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const collected = [];

  for (const query of feed.queries || []) {
    const search = `${query} pushed:>${since}`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(search)}&sort=updated&order=desc&per_page=10`;

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      for (const repo of data.items || []) {
        if (!repo?.html_url || repo.fork) continue;

        const haystack = `${repo.name || ''} ${repo.description || ''}`;
        // Списки, каталоги и инструменты — не новости о портах.
        if (/awesome|curated|list of|collection of|database|wiki|decompiler designed|toolkit/i.test(haystack)) continue;

        collected.push({
          id: `gh-${repo.id}`,
          title: `${repo.full_name}: ${repo.description || 'обновлённый порт'}`,
          url: repo.html_url,
          excerpt: repo.description || '',
          image: '',
          publishedAt: repo.pushed_at || repo.updated_at || new Date().toISOString(),
          addedAt: new Date().toISOString(),
          sourceId: feed.id,
          source: feed.name,
          category: feed.category,
          lang: feed.lang,
        });
      }
    } catch (error) {
      console.warn(`  GitHub ${query}: ${errorMessage(error)}`);
    }
  }

  const items = [];
  const seen = new Set();

  for (const item of collected) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  if (items.length === 0) throw new Error('GitHub не вернул репозиториев');

  return { feed, items: items.slice(0, feed.maxItems || 24), ms: Date.now() - started };
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  if (error?.name === 'AbortError') return 'таймаут';
  return error?.cause?.code || error?.message || 'ошибка';
}

// ── Разбор XML ───────────────────────────────────────────────────────────

function decodeXml(buffer) {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 500));
  const declared = head.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i)?.[1]?.toLowerCase();
  const encoding = declared === 'cp1251' ? 'windows-1251' : declared || 'utf-8';

  let text;
  try {
    text = new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  return text.replace(/^\uFEFF/, '').replace(/\0/g, '');
}

function parseFeed(xml, feed) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  const items = [];

  for (const block of blocks) {
    const item = parseItem(block, feed);
    if (item) items.push(item);
    if (items.length >= MAX_PER_SOURCE) break;
  }

  return items;
}

function parseItem(block, feed) {
  const title = cleanText(getTag(block, 'title'));
  if (!title) return null;

  let rawLink = getLink(block);
  if (!rawLink) {
    const guid = cleanText(getTag(block, 'guid'));
    if (/^https?:\/\//i.test(guid)) rawLink = guid;
  }

  const url = normalizeUrl(rawLink, feed.url);
  if (!url) return null;

  const rawDescription =
    getTag(block, 'content:encoded') ||
    getTag(block, 'content') ||
    getTag(block, 'description') ||
    getTag(block, 'summary');

  const excerpt = makeExcerpt(cleanText(rawDescription), title);
  const content = makeContent(rawDescription, title);
  const images = getImages(block, url);

  if (feed.keywords?.length) {
    const haystack = `${title} ${excerpt} ${content.slice(0, 600)}`.toLowerCase();
    if (!feed.keywords.some((keyword) => matchesKeyword(haystack, keyword))) return null;
  }

  return {
    id: hashId(url),
    title,
    url,
    excerpt,
    content,
    image: images[0]?.url || '',
    images,
    publishedAt: getDate(block),
    sourceId: feed.id,
    source: feed.name,
    category: feed.category,
    lang: feed.lang,
  };
}

function getTag(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1] : '';
}

function getLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/link>)/gi)];

  for (const match of links) {
    const attrs = match[1] || '';
    const body = (match[2] || '').trim();
    const rel = attr(attrs, 'rel');
    const href = attr(attrs, 'href');

    if (href && (!rel || rel === 'alternate')) return decodeEntities(href);
    if (!href && body) return decodeEntities(textOf(body));
  }

  return '';
}

function getImages(block, base) {
  const candidates = [];

  for (const match of block.matchAll(/<(?:media:content|media:thumbnail)\b([^>]*?)(?:\/>|>)/gi)) {
    const url = attr(match[1], 'url');
    const width = Number(attr(match[1], 'width')) || 0;
    const height = Number(attr(match[1], 'height')) || 0;
    const alt = decodeEntities(attr(match[1], 'title') || '');
    if (url) candidates.push({ url, alt, weight: 3, width, height });
  }

  for (const match of block.matchAll(/<enclosure\b([^>]*?)(?:\/>|>)/gi)) {
    const url = attr(match[1], 'url');
    const type = attr(match[1], 'type');
    if (url && (!type || /^image\//i.test(type))) {
      candidates.push({ url, alt: '', weight: 2, width: 0, height: 0 });
    }
  }

  // Картинки могут быть в summary, description или полном content —
  // собираем все, чтобы в читалке была не только обложка.
  const html = [
    getTag(block, 'content:encoded'),
    getTag(block, 'content'),
    getTag(block, 'description'),
    getTag(block, 'summary'),
  ].join(' ');

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const url = attr(attrs, 'src') || attr(attrs, 'data-src') || attr(attrs, 'data-lazy-src');
    const alt = decodeEntities(attr(attrs, 'alt') || '');
    const width = Number(attr(attrs, 'width')) || 0;
    const height = Number(attr(attrs, 'height')) || 0;
    if (url) candidates.push({ url, alt, weight: 1, width, height });
  }

  const seen = new Set();
  const images = [];

  for (const candidate of candidates.sort((a, b) => b.weight - a.weight)) {
    if ((candidate.width > 0 && candidate.width < 80) || (candidate.height > 0 && candidate.height < 80)) {
      continue;
    }

    const url = resolveImage(candidate.url, base);
    if (!url || seen.has(url)) continue;

    seen.add(url);
    images.push({ url, alt: cleanText(candidate.alt).slice(0, 160) });

    if (images.length >= 12) break;
  }

  return images;
}

function getDate(block) {
  for (const name of ['pubDate', 'published', 'updated', 'dc:date', 'date']) {
    const raw = cleanText(getTag(block, name));
    if (!raw) continue;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function attr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? match[1] : '';
}

function textOf(raw) {
  if (!raw) return '';
  let value = String(raw).trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1];
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
  euro: '€',
  pound: '£',
  yen: '¥',
  deg: '°',
  times: '×',
};

function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, code) => {
    if (code.startsWith('#')) {
      const hex = code[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
      if (Number.isFinite(number) && number > 0 && number <= 0x10ffff) {
        try {
          return String.fromCodePoint(number);
        } catch {
          return entity;
        }
      }
      return entity;
    }
    return ENTITIES[code.toLowerCase()] ?? entity;
  });
}

function cleanText(raw) {
  if (!raw) return '';
  return decodeEntities(textOf(raw))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesKeyword(text, keyword) {
  const needle = keyword.toLowerCase();

  // Для латиницы используем границы слова, чтобы «ai» не срабатывал на «said».
  if (/^[a-z0-9+#.\- ]+$/i.test(keyword)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  }

  return text.includes(needle);
}

function makeExcerpt(text, title) {
  if (!text) return '';
  if (text.toLowerCase() === title.toLowerCase()) return '';

  const limit = 260;
  if (text.length <= limit) return text;

  let cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 160) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[.,;:!?\-–—\s]+$/, '')}…`;
}

function makeContent(raw, title) {
  if (!raw) return '';

  let text = decodeEntities(textOf(raw))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article|tr|table)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  text = text
    .replace(/Read the full story at[^.\n]*\.?/gi, '')
    .replace(/Continue reading[^.\n]*\.?/gi, '')
    .replace(/The post .*? appeared first on .*?\.?/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text || text.toLowerCase() === title.toLowerCase()) return '';

  return text.slice(0, 12_000);
}

function normalizeUrl(raw, base) {
  if (!raw) return '';
  try {
    const url = new URL(decodeEntities(String(raw).trim()), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|yclid$|mc_cid$|mc_eid$|ref$|ref_src$|source$|from$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }

    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function resolveImage(raw, base) {
  if (!raw) return '';
  const value = decodeEntities(String(raw).trim());
  if (!value || /^data:/i.test(value)) return '';

  try {
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (/(?:^|[/._-])(?:1x1|pixel|spacer|transparent)(?:[/._-]|$)/i.test(url.pathname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function hashId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ── Сборка ───────────────────────────────────────────────────────────────

function byDateDesc(a, b) {
  const left = Date.parse(a.addedAt || a.publishedAt || 0) || 0;
  const right = Date.parse(b.addedAt || b.publishedAt || 0) || 0;

  if (right !== left) return right - left;

  const leftPublished = Date.parse(a.publishedAt || 0) || 0;
  const rightPublished = Date.parse(b.publishedAt || 0) || 0;
  return rightPublished - leftPublished;
}

async function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function isoWeekKey(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / 86_400_000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function isoWeekRange(key) {
  const [year, week] = key.split('-W').map(Number);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;

  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + (week - 1) * 7);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function digestItem(item) {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    excerpt: item.excerpt,
    image: item.image,
    addedAt: item.addedAt,
    publishedAt: item.publishedAt,
    sourceId: item.sourceId,
    source: item.source,
    category: item.category,
    lang: item.lang,
  };
}

async function updateDigest(items, generatedAt) {
  await mkdir(DIGEST_DIR, { recursive: true });

  const indexFile = join(DIGEST_DIR, 'index.json');
  const existingIndex = await readJsonFile(indexFile, { weeks: [] });
  const weeksByKey = new Map((existingIndex.weeks || []).map((week) => [week.key, week]));

  const groups = new Map();
  for (const item of items) {
    const date = item.publishedAt ? new Date(item.publishedAt) : new Date();
    const key = isoWeekKey(Number.isNaN(date.getTime()) ? new Date() : date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(digestItem(item));
  }

  const changedWeeks = [];

  for (const [key, weekItems] of groups) {
    const file = join(DIGEST_DIR, `${key}.json`);
    const existing = await readJsonFile(file, { key, items: [] });
    const seen = new Set((existing.items || []).map((item) => item.id));
    let added = 0;

    for (const item of weekItems) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      existing.items.push(item);
      added += 1;
    }

    if (added === 0) {
      if (!weeksByKey.has(key)) {
        weeksByKey.set(key, { key, ...isoWeekRange(key), count: existing.items.length });
      }
      continue;
    }

    existing.items.sort(byDateDesc);
    if (existing.items.length > MAX_DIGEST_ITEMS_PER_WEEK) {
      existing.items = existing.items.slice(0, MAX_DIGEST_ITEMS_PER_WEEK);
    }

    const range = isoWeekRange(key);
    const payload = {
      generatedAt,
      key,
      start: range.start,
      end: range.end,
      count: existing.items.length,
      items: existing.items,
    };

    await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    weeksByKey.set(key, { key, ...range, count: payload.count });
    changedWeeks.push({ key, added, total: payload.count });
  }

  // Храним только последние N недель, старые файлы удаляем.
  const allKeys = [...weeksByKey.keys()].sort();
  const keepKeys = new Set(allKeys.slice(-DIGEST_RETENTION_WEEKS));

  for (const key of allKeys) {
    if (keepKeys.has(key)) continue;
    weeksByKey.delete(key);
    try {
      await unlink(join(DIGEST_DIR, `${key}.json`));
    } catch {
      // Файла уже нет — ничего страшного.
    }
  }

  const weeks = [...weeksByKey.values()].sort((a, b) => b.key.localeCompare(a.key));
  const previousWeeks = JSON.stringify(existingIndex.weeks || []);
  const nextWeeks = JSON.stringify(weeks);

  if (nextWeeks !== previousWeeks) {
    await writeFile(
      indexFile,
      `${JSON.stringify({ generatedAt, retentionWeeks: DIGEST_RETENTION_WEEKS, weeks }, null, 2)}\n`,
      'utf8',
    );
  }

  if (changedWeeks.length > 0) {
    console.log(
      `Дайджест: ${changedWeeks.map((week) => `${week.key} +${week.added} (${week.total})`).join(', ')}.`,
    );
  } else {
    console.log('Дайджест: новых материалов нет.');
  }
}

async function main() {
  const startedAt = new Date();
  const fetchedAt = startedAt.toISOString();
  console.log(`Собираем ${FEEDS.length} лент…\n`);

  // Прошлый выпуск нужен как страховка: если источник временно недоступен,
  // показываем его новости из предыдущего data/news.json, а не теряем вкладку.
  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT_FILE, 'utf8'));
  } catch {
    // Первый запуск или битый файл — просто соберём новый.
  }

  const previousBySource = new Map();
  for (const item of previous?.items || []) {
    if (!item?.sourceId) continue;
    if (!previousBySource.has(item.sourceId)) previousBySource.set(item.sourceId, []);
    previousBySource.get(item.sourceId).push(item);
  }

  const results = await mapPool(FEEDS, CONCURRENCY, fetchFeed);

  const allItems = [];
  const errors = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  let successfulFeeds = 0;

  function acceptItems(items) {
    let accepted = 0;

    for (const item of items) {
      // В старых выпусках и части RSS может сохраниться HTML — вычищаем его.
      if (/<[a-z][\s\S]*>/i.test(item.content || '')) {
        item.content = makeContent(item.content, item.title);
      }
      if (/<[a-z][\s\S]*>/i.test(item.excerpt || '')) {
        item.excerpt = cleanText(item.excerpt);
      }

      const urlKey = item.url.toLowerCase().replace(/\/$/, '');
      const titleKey = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

      if (seenUrls.has(urlKey) || (titleKey && seenTitles.has(titleKey))) continue;

      seenUrls.add(urlKey);
      if (titleKey) seenTitles.add(titleKey);

      allItems.push(item);
      accepted += 1;
    }

    return accepted;
  }

  function filterByKeywords(items, feed) {
    if (!feed.keywords?.length) return items;

    return items.filter((item) => {
      const haystack = `${item.title} ${item.excerpt || ''}`.toLowerCase();
      return feed.keywords.some((keyword) => matchesKeyword(haystack, keyword));
    });
  }

  results.forEach((result, index) => {
    const feed = FEEDS[index];
    const fallback = filterByKeywords(previousBySource.get(feed.id) || [], feed).slice(0, MAX_PER_SOURCE);

    if (result.status === 'rejected') {
      const message = errorMessage(result.reason);

      if (fallback.length > 0) {
        const accepted = acceptItems(fallback);
        errors.push({ source: feed.name, url: feed.url, error: message, reused: accepted });
        console.log(
          `  ↻ ${feed.name.padEnd(28)} ${String(accepted).padStart(2)} из прошлого выпуска (${message})`,
        );
      } else {
        errors.push({ source: feed.name, url: feed.url, error: message });
        console.log(`  ✗ ${feed.name.padEnd(28)} ${message}`);
      }

      return;
    }

    const { items, ms } = result.value;

    if (items.length === 0 && fallback.length > 0) {
      const accepted = acceptItems(fallback);
      errors.push({ source: feed.name, url: feed.url, error: 'лента пуста', reused: accepted });
      console.log(
        `  ↻ ${feed.name.padEnd(28)} ${String(accepted).padStart(2)} из прошлого выпуска (лента пуста)`,
      );
      return;
    }

    successfulFeeds += 1;
    for (const item of items) {
      if (!item.addedAt) item.addedAt = fetchedAt;
    }
    const accepted = acceptItems(items);
    console.log(`  ✓ ${feed.name.padEnd(28)} ${String(accepted).padStart(2)} новостей  ${ms} мс`);
  });

  if (successfulFeeds === 0 && previous) {
    console.warn('\nНи один источник не ответил — используется прошлый выпуск.');
  }

  // Собираем пул за последние N дней: прошлый выпуск + всё, что пришло сейчас.
  // addedAt — когда материал впервые появился на агрегаторе; он не меняется
  // при повторных запусках, поэтому сортировка и срок хранения стабильны.
  const previousGeneratedAt = previous?.generatedAt || fetchedAt;
  const sourceCategories = new Map(FEEDS.map((feed) => [feed.id, feed.category]));
  const currentSourceIds = new Set(sourceCategories.keys());
  const pool = new Map();

  for (const item of previous?.items || []) {
    // Источник могли убрать из конфига — его старые материалы тоже убираем.
    if (!item?.id || !currentSourceIds.has(item.sourceId)) continue;
    // Старые записи GitHub-портов могли попасть в выпуск до появления фильтра.
    if (
      item.sourceId === 'github-ports' &&
      /awesome|curated|list of|collection of|database|wiki|toolkit/i.test(item.title || '')
    ) {
      continue;
    }

    // В старых выпусках мог сохраниться HTML из RSS — вычищаем его.
    const hasHtml = /<[a-z][\s\S]*>/i.test(item.content || '') || /<[a-z][\s\S]*>/i.test(item.excerpt || '');
    const content = hasHtml ? makeContent(item.content, item.title) : item.content;
    const excerpt = hasHtml ? cleanText(item.excerpt) : item.excerpt;

    const category = sourceCategories.get(item.sourceId) || item.category;
    pool.set(item.id, {
      ...item,
      content,
      excerpt,
      category,
      addedAt: item.addedAt || previousGeneratedAt,
    });
  }

  for (const item of allItems) {
    if (!item?.id) continue;

    const category = sourceCategories.get(item.sourceId) || item.category;
    const existing = pool.get(item.id);
    if (existing) {
      pool.set(item.id, {
        ...existing,
        ...item,
        category,
        addedAt: existing.addedAt || item.addedAt || fetchedAt,
      });
    } else {
      pool.set(item.id, { ...item, category, addedAt: item.addedAt || fetchedAt });
    }
  }

  const cutoff = Date.now() - NEWS_RETENTION_DAYS * 86_400_000;
  const retained = [...pool.values()].filter((item) => {
    const added = Date.parse(item.addedAt || '');
    return Number.isFinite(added) && added >= cutoff;
  });

  const byCategory = Object.fromEntries(Object.keys(CATEGORY_TITLES).map((category) => [category, []]));
  for (const item of retained) {
    if (byCategory[item.category]) byCategory[item.category].push(item);
  }

  const items = [];
  const counts = {};

  for (const category of Object.keys(byCategory)) {
    const categoryItems = byCategory[category].sort(byDateDesc).slice(0, MAX_PER_CATEGORY);
    counts[category] = categoryItems.length;
    items.push(...categoryItems);
  }

  items.sort(byDateDesc);
  counts.total = items.length;

  if (items.length === 0) {
    console.error('\nНе удалось получить ни одной новости. Проверьте доступ к источникам.');
    process.exitCode = 1;
    return;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    tookMs: Date.now() - startedAt.getTime(),
    retentionDays: NEWS_RETENTION_DAYS,
    categories: CATEGORY_TITLES,
    counts,
    sourceCount: FEEDS.length,
    sources: FEEDS.map(({ id, name, category, lang, url }) => ({ id, name, category, lang, url })),
    errors,
    items,
  };

  // Дайджест пополняем всем пулом, включая материалы, которые вот-вот
  // выйдут из семидневного выпуска.
  await updateDigest(retained, payload.generatedAt);

  await mkdir(dirname(OUT_FILE), { recursive: true });

  // Не создаём коммит каждые 30 минут, если набор новостей не изменился.
  if (previous) {
    const { generatedAt: _oldGeneratedAt, tookMs: _oldTookMs, ...previousContent } = previous;
    const { generatedAt: _newGeneratedAt, tookMs: _newTookMs, ...newContent } = payload;

    if (JSON.stringify(previousContent) === JSON.stringify(newContent)) {
      console.log('\nНовости не изменились — data/news.json оставлен без изменений.');
      return;
    }
  }

  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const categorySummary = Object.entries(CATEGORY_TITLES)
    .map(([category, title]) => `${title} ${counts[category] ?? 0}`)
    .join(', ');

  console.log(
    `\nГотово: ${counts.total} новостей за ${NEWS_RETENTION_DAYS} дн. (${categorySummary}) за ${payload.tookMs} мс.`,
  );
  console.log(`Файл: ${OUT_FILE}`);

  if (errors.length > 0) {
    console.log(`Источников с ошибками: ${errors.length}. Остальные данные собраны.`);
  }
}

main().catch((error) => {
  console.error('Критическая ошибка:', error);
  process.exitCode = 1;
});
