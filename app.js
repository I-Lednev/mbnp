import { AUTH_CONFIG } from './auth-config.js';

const PAGE_SIZE = 40;
const AUTO_REFRESH_MS = 10 * 60 * 1000;

const SESSION_KEY = 'mbn:session:v1';
const GH_TOKEN_KEY = 'mbn:gh-token';
const INVITES_KEY = 'mbn:invites:v1';

const STORAGE = {
  bookmarks: 'mbn:bookmarks:v1',
  theme: 'mbn:theme',
  translation: 'mbn:translation',
  hiddenSources: 'mbn:hiddenSources:v1',
  read: 'mbn:read:v1',
  layout: 'mbn:layout:v1',
};

const CATEGORY_LABELS = {
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

const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

const FALLBACK_LABELS = {
  ai: 'AI',
  games: 'GAME',
  announces: 'NEWS',
  mobile: 'MOB',
  releases: 'REL',
  rumors: 'RUM',
  software: 'SOFT',
  science: 'SCI',
  entertainment: 'SHOW',
  ports: 'PORT',
  pc: 'PC',
  consoles: 'CONS',
  hardware: 'HW',
  industry: 'BIZ',
  updates: 'UPD',
  aimods: 'MOD',
  aisoft: 'SOFT',
  cars: 'AUTO',
  war: 'WAR',
};

const state = {
  data: null,
  category: 'all',
  query: '',
  source: 'all',
  bookmarks: new Map(loadBookmarks()),
  translation: loadStoredTranslation(),
  translations: new Map(),
  translationsLoaded: false,
  translationsLoading: false,
  translationsError: false,
  articles: new Map(),
  articlesLoaded: false,
  articlesLoading: false,
  summaries: new Map(),
  summariesLoaded: false,
  summariesLoading: false,
  digestIndex: null,
  digestIndexLoading: false,
  digestWeek: null,
  digestItems: [],
  digestWeekLoading: false,
  digestCategory: 'all',
  hiddenSources: new Set(loadHiddenSources()),
  read: new Set(loadRead()),
  layout: loadLayout(),
  sourceQuery: '',
  visible: PAGE_SIZE,
  lastAttempt: 0,
  loading: false,
  tabsExpanded: false,
  started: false,
  deferredPrompt: null,
  readerItem: null,
};

const els = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  emptyTitle: document.getElementById('emptyTitle'),
  emptyText: document.getElementById('emptyText'),
  emptyActionBtn: document.getElementById('emptyActionBtn'),
  status: document.getElementById('status'),
  lastUpdate: document.getElementById('lastUpdate'),
  generated: document.getElementById('generated'),
  search: document.getElementById('searchInput'),
  sourceSelect: document.getElementById('sourceSelect'),
  translationSelect: document.getElementById('translationSelect'),
  resetBtn: document.getElementById('resetBtn'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  themeBtn: document.getElementById('themeBtn'),
  installBtn: document.getElementById('installBtn'),
  toast: document.getElementById('toast'),
  tabs: [...document.querySelectorAll('.tab[data-category]')],
  tabsToggle: document.getElementById('tabsToggle'),
  layoutBtn: document.getElementById('layoutBtn'),
  warNote: document.getElementById('warNote'),
  sourcesBtn: document.getElementById('sourcesBtn'),
  hiddenSourcesBadge: document.getElementById('hiddenSourcesBadge'),
  sourcesDialog: document.getElementById('sourcesDialog'),
  sourcesCloseBtn: document.getElementById('sourcesCloseBtn'),
  sourcesDoneBtn: document.getElementById('sourcesDoneBtn'),
  sourceSearch: document.getElementById('sourceSearch'),
  sourceList: document.getElementById('sourceList'),
  showAllSourcesBtn: document.getElementById('showAllSourcesBtn'),
  hiddenSourcesCount: document.getElementById('hiddenSourcesCount'),
  readerDialog: document.getElementById('readerDialog'),
  readerScroll: document.getElementById('readerScroll'),
  readerCloseBtn: document.getElementById('readerCloseBtn'),
  readerBadge: document.getElementById('readerBadge'),
  readerSource: document.getElementById('readerSource'),
  readerTime: document.getElementById('readerTime'),
  readerTitle: document.getElementById('readerTitle'),
  readerOriginalTitle: document.getElementById('readerOriginalTitle'),
  readerImage: document.getElementById('readerImage'),
  readerContent: document.getElementById('readerContent'),
  readerGallery: document.getElementById('readerGallery'),
  readerNotice: document.getElementById('readerNotice'),
  readerSourceName: document.getElementById('readerSourceName'),
  readerCopyBtn: document.getElementById('readerCopyBtn'),
  readerOpenLink: document.getElementById('readerOpenLink'),
  digestBtn: document.getElementById('digestBtn'),
  digestDialog: document.getElementById('digestDialog'),
  digestCloseBtn: document.getElementById('digestCloseBtn'),
  digestDoneBtn: document.getElementById('digestDoneBtn'),
  digestWeeks: document.getElementById('digestWeeks'),
  digestCategory: document.getElementById('digestCategory'),
  digestList: document.getElementById('digestList'),
  digestCount: document.getElementById('digestCount'),
  authGate: document.getElementById('authGate'),
  authForm: document.getElementById('authForm'),
  authLogin: document.getElementById('authLogin'),
  authPassword: document.getElementById('authPassword'),
  authError: document.getElementById('authError'),
  authRecoveryBtn: document.getElementById('authRecoveryBtn'),
  authRecovery: document.getElementById('authRecovery'),
  cabinetBtn: document.getElementById('cabinetBtn'),
  cabinetDialog: document.getElementById('cabinetDialog'),
  cabinetCloseBtn: document.getElementById('cabinetCloseBtn'),
  cabinetDoneBtn: document.getElementById('cabinetDoneBtn'),
  cabinetToken: document.getElementById('cabinetToken'),
  createInviteBtn: document.getElementById('createInviteBtn'),
  revokeInvitesBtn: document.getElementById('revokeInvitesBtn'),
  cabinetStatus: document.getElementById('cabinetStatus'),
  inviteList: document.getElementById('inviteList'),
  logoutBtn: document.getElementById('logoutBtn'),
};

init();

async function init() {
  applyTheme(getStoredTheme());
  applyTabsState(false);
  applyLayout();
  bindAuthEvents();

  const authorized = await initAuth();
  if (!authorized) {
    showAuthGate();
    return;
  }

  startApp();
}

function startApp() {
  if (state.started) return;
  state.started = true;

  hideAuthGate();
  if (els.translationSelect) els.translationSelect.value = state.translation;
  bindEvents();
  updateCounts();
  updateHiddenBadge();
  renderSkeletons();
  loadData();
  registerServiceWorker();

  if (window.matchMedia('(display-mode: standalone)').matches) {
    els.installBtn.hidden = true;
  }

  if (isOwner(readSession())) {
    els.cabinetBtn.hidden = false;
  }
}

/* ── Авторизация ──────────────────────────────────────────────────────── */

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return session && typeof session === 'object' ? session : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Сессия не сохранится между визитами.
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ничего страшного.
  }
}

function isOwner(session) {
  return session?.login === AUTH_CONFIG.login;
}

function showAuthError(message) {
  if (!els.authError) return;
  els.authError.textContent = message || '';
  els.authError.hidden = !message;
}

function showAuthGate(message) {
  document.body.classList.add('is-locked');
  if (els.authGate) els.authGate.hidden = false;
  if (message !== undefined) showAuthError(message);
  els.authLogin?.focus();
}

function hideAuthGate() {
  document.body.classList.remove('is-locked');
  if (els.authGate) els.authGate.hidden = true;
}

function clearInviteHash() {
  if (location.hash.startsWith('#invite=')) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
}

async function fetchInviteConfig() {
  try {
    const response = await fetch(`${AUTH_CONFIG.configUrl}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function currentInviteVersion() {
  const config = await fetchInviteConfig();
  const version = Number(config?.inviteVersion);
  return Number.isFinite(version) && version > 0 ? version : AUTH_CONFIG.inviteVersion;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function derivePasswordHash(password) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(AUTH_CONFIG.salt),
      iterations: AUTH_CONFIG.iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  );

  return bytesToHex(new Uint8Array(bits));
}

async function verifyCredentials(login, password) {
  if (login.trim().toLowerCase() !== AUTH_CONFIG.login) return false;
  const hash = await derivePasswordHash(password);
  return hash === AUTH_CONFIG.hash;
}

async function acceptInvite(code) {
  const match = /^v(\d+)\.([a-z0-9-]+)$/i.exec(code || '');
  if (!match) return false;

  const version = await currentInviteVersion();
  if (Number(match[1]) !== version) {
    clearInviteHash();
    showAuthGate('Эта ссылка-приглашение больше не действует. Запросите новую у владельца.');
    return false;
  }

  writeSession({
    login: 'guest',
    invite: code,
    version,
    expires: Date.now() + AUTH_CONFIG.sessionDays * 86_400_000,
  });

  clearInviteHash();
  return true;
}

async function initAuth() {
  const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (invite && (await acceptInvite(invite))) return true;

  const session = readSession();
  if (!session) return false;

  if (!Number.isFinite(session.expires) || session.expires < Date.now()) {
    clearSession();
    return false;
  }

  if (!isOwner(session)) {
    const version = await currentInviteVersion();
    if (Number(session.version) !== version) {
      clearSession();
      showAuthGate('Приглашение аннулировано. Запросите новую ссылку у владельца.');
      return false;
    }
  }

  return true;
}

function bindAuthEvents() {
  els.authForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const login = els.authLogin.value.trim();
    const password = els.authPassword.value;
    const button = els.authForm.querySelector('button[type="submit"]');

    if (!login || !password || button?.disabled) return;

    if (button) button.disabled = true;
    showAuthError('');

    try {
      if (await verifyCredentials(login, password)) {
        writeSession({
          login: AUTH_CONFIG.login,
          expires: Date.now() + AUTH_CONFIG.sessionDays * 86_400_000,
        });
        els.authPassword.value = '';
        startApp();
      } else {
        showAuthError('Неверный логин или пароль.');
      }
    } catch {
      showAuthError('Не удалось проверить пароль. Обновите страницу и попробуйте ещё раз.');
    } finally {
      if (button) button.disabled = false;
    }
  });

  els.authRecoveryBtn?.addEventListener('click', () => {
    els.authRecovery.hidden = !els.authRecovery.hidden;
  });

  els.cabinetBtn?.addEventListener('click', openCabinet);
  els.cabinetCloseBtn?.addEventListener('click', closeCabinet);
  els.cabinetDoneBtn?.addEventListener('click', closeCabinet);
  els.cabinetDialog?.addEventListener('click', (event) => {
    if (event.target === els.cabinetDialog) closeCabinet();
  });

  els.createInviteBtn?.addEventListener('click', createInvite);
  els.revokeInvitesBtn?.addEventListener('click', revokeAllInvites);
  els.logoutBtn?.addEventListener('click', () => {
    clearSession();
    location.reload();
  });

  els.inviteList?.addEventListener('click', async (event) => {
    const code = event.target.closest('[data-copy-invite]')?.dataset.copyInvite;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      showCabinetStatus('Ссылка скопирована.');
    } catch {
      showCabinetStatus('Не удалось скопировать — выделите ссылку вручную.');
    }
  });
}

/* ── Личный кабинет ───────────────────────────────────────────────────── */

function loadInvites() {
  try {
    const list = JSON.parse(localStorage.getItem(INVITES_KEY) || '[]');
    return Array.isArray(list) ? list.filter((entry) => entry?.code) : [];
  } catch {
    return [];
  }
}

function saveInvites(list) {
  try {
    localStorage.setItem(INVITES_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    // Список не сохранится.
  }
}

function inviteUrl(code) {
  return `${location.origin}${location.pathname}#invite=${code}`;
}

function randomInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

function showCabinetStatus(message) {
  if (!els.cabinetStatus) return;
  els.cabinetStatus.textContent = message || '';
  els.cabinetStatus.hidden = !message;
}

function renderInviteList() {
  if (!els.inviteList) return;

  const invites = loadInvites();
  if (invites.length === 0) {
    els.inviteList.innerHTML = '<li class="invite-empty">Пока нет созданных приглашений.</li>';
    return;
  }

  els.inviteList.innerHTML = invites
    .map(
      (invite) => `
        <li class="invite-item">
          <span class="invite-link" title="${esc(inviteUrl(invite.code))}">${esc(inviteUrl(invite.code))}</span>
          <button class="invite-copy" type="button" data-copy-invite="${esc(invite.code)}">Копировать</button>
        </li>
      `,
    )
    .join('');
}

function openCabinet() {
  if (!els.cabinetDialog) return;
  els.cabinetToken.value = localStorage.getItem(GH_TOKEN_KEY) || '';
  renderInviteList();
  showCabinetStatus('');
  if (!els.cabinetDialog.open) els.cabinetDialog.showModal();
}

function closeCabinet() {
  if (els.cabinetDialog?.open) els.cabinetDialog.close();
}

async function createInvite() {
  if (!els.createInviteBtn) return;

  els.createInviteBtn.disabled = true;
  showCabinetStatus('Создаю приглашение…');

  try {
    const version = await currentInviteVersion();
    const code = `v${version}.${randomInviteToken()}`;
    const invites = loadInvites();
    invites.unshift({ code, createdAt: new Date().toISOString() });
    saveInvites(invites);

    renderInviteList();
    showCabinetStatus(`Ссылка создана: ${inviteUrl(code)}`);

    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      showCabinetStatus('Ссылка создана и скопирована в буфер обмена.');
    } catch {
      // Буфер обмена может быть недоступен.
    }
  } catch {
    showCabinetStatus('Не удалось создать приглашение. Попробуйте ещё раз.');
  } finally {
    els.createInviteBtn.disabled = false;
  }
}

async function revokeAllInvites() {
  if (!els.revokeInvitesBtn) return;

  const token = els.cabinetToken?.value.trim();
  if (!token) {
    showCabinetStatus('Укажите GitHub token — без него нельзя аннулировать приглашения.');
    return;
  }

  try {
    localStorage.setItem(GH_TOKEN_KEY, token);
  } catch {
    // Токен не сохранится.
  }

  els.revokeInvitesBtn.disabled = true;
  showCabinetStatus('Аннулирую приглашения…');

  const api = 'https://api.github.com/repos/I-Lednev/mbnp/contents/access/config.json';
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'MBNP-Cabinet',
  };

  try {
    const get = await fetch(`${api}?ts=${Date.now()}`, { headers, cache: 'no-store' });
    if (!get.ok) throw new Error(`GitHub HTTP ${get.status}`);

    const current = await get.json();
    const config = JSON.parse(atob((current.content || '').replace(/\s+/g, '')) || '{}');
    const next = {
      ...config,
      inviteVersion: (Number(config.inviteVersion) || AUTH_CONFIG.inviteVersion) + 1,
      revoked: [],
    };

    const put = await fetch(api, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'chore: аннулировать все приглашения',
        content: btoa(JSON.stringify(next, null, 2)),
        sha: current.sha,
        branch: 'main',
      }),
    });

    if (!put.ok) throw new Error(`GitHub HTTP ${put.status}`);

    saveInvites([]);
    renderInviteList();
    showCabinetStatus('Все приглашения аннулированы. Старые ссылки больше не действуют.');
  } catch (error) {
    showCabinetStatus(`Не удалось аннулировать: ${error.message}. Проверьте токен и права Contents: Read and write.`);
  } finally {
    els.revokeInvitesBtn.disabled = false;
  }
}

/* ── Данные ───────────────────────────────────────────────────────────── */

async function fetchJson(url, { retries = 1 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'no-store' });

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      if (data?.error === 'offline') throw new Error('нет соединения');
      return data;
    } catch (error) {
      lastError = error;
      const retryable = !error.status || error.status >= 500;

      if (attempt >= retries || !retryable) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function loadData({ silent = false } = {}) {
  if (state.loading) return;

  state.loading = true;
  state.lastAttempt = Date.now();
  els.refreshBtn.disabled = true;
  els.refreshBtn.classList.add('is-spinning');

  if (!state.data) {
    renderSkeletons();
    setStatus('Загружаем новости…', 'loading');
  } else if (!silent) {
    setStatus('Обновляем…', 'loading');
  }

  els.grid.setAttribute('aria-busy', 'true');

  try {
    const data = await fetchJson(`data/news.json?ts=${Date.now()}`);
    if (!data || !Array.isArray(data.items)) throw new Error('неверный формат JSON');

    state.data = data;
    state.visible = silent ? Math.max(state.visible, PAGE_SIZE) : PAGE_SIZE;
    // Следующая читалка перечитает data/articles.json со свежими текстами.
    state.articlesLoaded = false;
    render();

    if (state.translation === 'ru') {
      loadTranslations({ force: state.translationsLoaded });
    }
  } catch (error) {
    console.error('Не удалось загрузить новости:', error);

    if (!state.data) {
      renderError(error);
    } else {
      setStatus('Не удалось обновить — показаны предыдущие данные', 'error');
      toast('Не удалось обновить новости');
    }
  } finally {
    state.loading = false;
    els.refreshBtn.disabled = false;
    els.refreshBtn.classList.remove('is-spinning');
    els.grid.setAttribute('aria-busy', 'false');
  }
}

async function loadTranslations({ force = false } = {}) {
  if (state.translationsLoading || (state.translationsLoaded && !force)) return;

  state.translationsLoading = true;
  setStatus('Загружаем переводы…', 'loading');

  try {
    const data = await fetchJson(`data/translations.json?ts=${Date.now()}`);
    const entries = data?.translations && typeof data.translations === 'object' ? data.translations : {};
    const translations = new Map();

    for (const [id, value] of Object.entries(entries)) {
      const title = value?.title || value?.titleRu;
      const excerpt = value?.excerpt || value?.excerptRu;
      const content = value?.content || value?.contentRu;
      if (title) translations.set(id, { title, excerpt: excerpt || '', content: content || '' });
    }

    state.translations = translations;
    state.translationsLoaded = true;
    state.translationsError = false;
  } catch (error) {
    console.warn('Не удалось загрузить переводы:', error);
    state.translationsError = true;
    toast('Переводы ещё не собраны — показываем оригиналы');
  } finally {
    state.translationsLoading = false;
    render();
  }
}

async function loadArticles() {
  if (state.articlesLoading || state.articlesLoaded) return;

  state.articlesLoading = true;

  try {
    const data = await fetchJson(`data/articles.json?ts=${Date.now()}`);
    const entries = data?.articles && typeof data.articles === 'object' ? data.articles : {};
    state.articles = new Map(Object.entries(entries));
    state.articlesLoaded = true;
  } catch (error) {
    // Файла может ещё не быть — читалка спокойно остаётся на RSS-тексте.
    console.warn('Полные статьи пока недоступны:', error);
    state.articlesLoaded = true;
  } finally {
    state.articlesLoading = false;
    if (els.readerDialog.open) renderReader();
  }
}

/* ── Отрисовка ────────────────────────────────────────────────────────── */

function render() {
  if (!state.data) return;

  updateSourceOptions();

  const items = getFilteredItems();
  const shown = Math.min(state.visible, items.length);

  updateCounts();
  updateHiddenBadge();

  els.resetBtn.hidden = !hasActiveFilters();
  els.warNote.hidden = state.category !== 'war';

  els.grid.innerHTML = items.slice(0, state.visible).map(cardHtml).join('');
  wireImages();

  els.empty.hidden = items.length !== 0;
  els.loadMoreBtn.hidden = items.length <= state.visible;

  if (!els.loadMoreBtn.hidden) {
    const remaining = Math.min(PAGE_SIZE, items.length - state.visible);
    els.loadMoreBtn.textContent = `Показать ещё ${remaining}`;
  }

  if (items.length === 0) renderEmptyState();

  setStatus(statusText(items, shown));
  renderGenerated();
  renderLastUpdate();

  if (els.sourcesDialog.open) renderSourceList();
  if (els.readerDialog.open) renderReader();
}

function getCategoryItems({ ignoreHidden = false } = {}) {
  let items =
    state.category === 'saved'
      ? [...state.bookmarks.values()]
      : state.data?.items || [];

  if (state.category !== 'all' && state.category !== 'saved') {
    items = items.filter((item) => item.category === state.category);
  }

  if (!ignoreHidden) {
    items = items.filter((item) => !state.hiddenSources.has(item.sourceId));
  }

  return items;
}

function getFilteredItems() {
  let items = getCategoryItems();

  if (state.source !== 'all') {
    items = items.filter((item) => item.sourceId === state.source);
  }

  const query = state.query.toLocaleLowerCase('ru');
  if (query) {
    items = items.filter((item) => {
      const translation = state.translations.get(item.id);
      const haystack = [
        item.title,
        item.excerpt || '',
        item.source || '',
        translation?.title || '',
        translation?.excerpt || '',
      ]
        .join(' ')
        .toLocaleLowerCase('ru');

      return haystack.includes(query);
    });
  }

  if (state.category === 'saved') {
    items = items.sort(byDateDesc);
  }

  return items;
}

function byDateDesc(a, b) {
  const left = Date.parse(a.addedAt || a.publishedAt || 0) || 0;
  const right = Date.parse(b.addedAt || b.publishedAt || 0) || 0;

  if (right !== left) return right - left;

  const leftPublished = Date.parse(a.publishedAt || 0) || 0;
  const rightPublished = Date.parse(b.publishedAt || 0) || 0;
  return rightPublished - leftPublished;
}

function cardHtml(item) {
  const category = CATEGORY_KEYS.includes(item.category) ? item.category : 'ai';
  const url = safeUrl(item.url);
  const image = safeUrl(item.image);
  const saved = state.bookmarks.has(item.id);
  const translation = state.translation === 'ru' && item.lang !== 'ru' ? state.translations.get(item.id) : null;
  const translated = Boolean(translation);
  const title = translation?.title || item.title;
  const excerpt = translation?.excerpt || item.excerpt;
  const lang = (item.lang || '').toUpperCase();
  const langLabel = translated ? 'RU' : lang;
  const langTitle = translated
    ? 'Переведено автоматически'
    : state.translation === 'ru' && item.lang !== 'ru'
      ? 'Перевод пока недоступен'
      : '';
  const saveLabel = saved ? 'Убрать из избранного' : 'Добавить в избранное';
  const read = state.read.has(item.id);
  const addedAt = item.addedAt || item.publishedAt || '';
  const publishedAt = item.publishedAt || '';
  const addedLabel = addedAt ? formatCardTime(addedAt) : 'без даты';
  const publishedLabel = publishedAt ? formatCardTime(publishedAt) : 'нет даты';

  return `
    <article class="card ${read ? 'is-read' : ''}" data-id="${esc(item.id)}" ${translated ? 'data-translated="true"' : ''}>
      <a
        class="card-media ${image ? '' : 'no-image'}"
        href="${esc(url)}"
        target="_blank"
        rel="noopener noreferrer"
        data-category="${category}"
        data-read="${esc(item.id)}"
        tabindex="-1"
        aria-hidden="true"
      >
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-news-image />` : ''}
        <span class="media-fallback">
          <img class="fallback-img" src="icons/fallback/${category}.svg" alt="" loading="lazy" decoding="async" />
        </span>
        <span class="card-badge badge-${category}">${CATEGORY_LABELS[category]}</span>
      </a>
      <button
        class="bookmark-btn ${saved ? 'is-saved' : ''}"
        type="button"
        data-bookmark="${esc(item.id)}"
        aria-pressed="${saved}"
        aria-label="${saveLabel}"
        title="${saveLabel}"
      >${saved ? '★' : '☆'}</button>
      <div class="card-body">
        <div class="card-meta">
          <span class="card-source" title="${esc(item.source || '')}">${esc(item.source || 'Источник')}</span>
          ${read ? '<span class="read-badge" title="Вы уже открывали эту новость">✓ прочитано</span>' : ''}
        </div>
        <div class="card-dates">
          <span class="card-date card-date-added" title="Когда новость появилась на агрегаторе">
            <span class="card-date-label">В агрегаторе</span>
            <time datetime="${esc(addedAt)}">${esc(addedLabel)}</time>
          </span>
          <span class="card-date card-date-source" title="Когда новость опубликовал источник">
            <span class="card-date-label">Источник</span>
            <time datetime="${esc(publishedAt)}">${esc(publishedLabel)}</time>
          </span>
        </div>
        <h2 class="card-title" ${translated ? `title="${esc(item.title)}"` : ''}>
          <a href="${esc(url)}" data-read="${esc(item.id)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>
        </h2>
        ${excerpt ? `<p class="card-excerpt">${esc(cleanArticleText(excerpt))}</p>` : ''}
        <div class="card-actions">
          <a class="read-link" href="${esc(url)}" data-read="${esc(item.id)}" target="_blank" rel="noopener noreferrer">
            Читать <span aria-hidden="true">→</span>
          </a>
          <span class="card-lang ${translated ? 'is-translated' : ''}" ${langTitle ? `title="${esc(langTitle)}"` : ''}>${esc(langLabel)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderSkeletons() {
  els.grid.innerHTML = Array.from(
    { length: 8 },
    () => `
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-media"></div>
        <div class="skeleton-body">
          <div class="skeleton skeleton-line w-40"></div>
          <div class="skeleton skeleton-line w-90"></div>
          <div class="skeleton skeleton-line w-75"></div>
          <div class="skeleton skeleton-line w-60"></div>
        </div>
      </div>
    `,
  ).join('');

  els.empty.hidden = true;
  els.loadMoreBtn.hidden = true;
}

function renderError(error) {
  const isFile = window.location.protocol === 'file:';

  els.grid.innerHTML = `
    <div class="error-state">
      <h2>Не удалось загрузить новости</h2>
      <p>
        ${
          isFile
            ? 'Страница открыта как файл. Запустите локальный сервер: <code>node scripts/serve.mjs</code> и откройте <code>http://localhost:5173</code>.'
            : `Проверьте соединение и попробуйте ещё раз. <code>${esc(error?.message || 'ошибка сети')}</code>`
        }
      </p>
      <button class="primary-btn" type="button" data-retry>Повторить</button>
    </div>
  `;

  els.empty.hidden = true;
  els.loadMoreBtn.hidden = true;
  setStatus('Ошибка загрузки', 'error');
}

function wireImages() {
  els.grid.querySelectorAll('img[data-news-image]').forEach((image) => {
    image.addEventListener(
      'error',
      () => {
        image.closest('.card-media')?.classList.add('no-image');
        image.remove();
      },
      { once: true },
    );
  });
}

function renderEmptyState() {
  const categoryItems = getCategoryItems({ ignoreHidden: true });
  const hasFilters = Boolean(state.query) || state.source !== 'all';
  const allHidden = !hasFilters && state.hiddenSources.size > 0 && categoryItems.length > 0;

  if (allHidden) {
    els.emptyTitle.textContent = 'Все источники скрыты';
    els.emptyText.textContent =
      'Вы скрыли источники, из которых были новости этого раздела. Верните их в настройках — они снова появятся.';
    els.emptyActionBtn.textContent = 'Открыть источники';
    els.emptyActionBtn.dataset.action = 'sources';
  } else {
    els.emptyTitle.textContent = 'Ничего не нашлось';
    els.emptyText.textContent = 'Попробуйте изменить запрос или сбросить фильтры.';
    els.emptyActionBtn.textContent = 'Сбросить фильтры';
    els.emptyActionBtn.dataset.action = 'reset';
  }
}

function statusText(items, shown) {
  if (items.length === 0) return 'Ничего не найдено';

  const totalText = `${items.length} ${plural(items.length, 'новость', 'новости', 'новостей')}`;
  const shownText = shown < items.length ? `показано ${shown} из ${items.length}` : `показано ${shown}`;
  return `${totalText} · ${shownText}`;
}

function updateCounts() {
  const counts = { all: 0, saved: 0 };
  for (const key of CATEGORY_KEYS) counts[key] = 0;

  for (const item of state.data?.items || []) {
    if (state.hiddenSources.has(item.sourceId)) continue;
    counts.all += 1;
    if (counts[item.category] !== undefined) counts[item.category] += 1;
  }

  counts.saved = [...state.bookmarks.values()].filter((item) => !state.hiddenSources.has(item.sourceId)).length;

  for (const [key, value] of Object.entries(counts)) {
    const target = document.querySelector(`[data-count="${key}"]`);
    if (target) target.textContent = value;
  }
}

function updateSourceOptions() {
  if (!state.data) return;

  const pool = getCategoryItems();
  const sources = new Map();
  for (const item of pool) {
    if (item.sourceId && item.source) sources.set(item.sourceId, item.source);
  }

  const options = [...sources.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  els.sourceSelect.innerHTML =
    '<option value="all">Все источники</option>' +
    options.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');

  if (state.source === 'all' || sources.has(state.source)) {
    els.sourceSelect.value = state.source;
  } else {
    state.source = 'all';
    els.sourceSelect.value = 'all';
  }
}

function updateHiddenBadge() {
  const count = state.hiddenSources.size;
  els.hiddenSourcesBadge.hidden = count === 0;
  els.hiddenSourcesBadge.textContent = count;
  els.sourcesBtn.classList.toggle('has-hidden', count > 0);
  els.hiddenSourcesCount.textContent = count ? `Скрыто: ${count}` : 'Все источники включены';
  els.showAllSourcesBtn.hidden = count === 0;
}

function renderSourceList() {
  if (!state.data) {
    els.sourceList.innerHTML = '<p class="empty-sources">Новости ещё загружаются…</p>';
    return;
  }

  const query = state.sourceQuery.trim().toLocaleLowerCase('ru');
  const groups = new Map();

  for (const source of state.data.sources || []) {
    if (!groups.has(source.category)) groups.set(source.category, []);
    groups.get(source.category).push(source);
  }

  const html = [...groups.entries()]
    .map(([category, sources]) => {
      const label = CATEGORY_LABELS[category] || category;
      const filtered = sources.filter(
        (source) =>
          !query ||
          source.name.toLocaleLowerCase('ru').includes(query) ||
          label.toLocaleLowerCase('ru').includes(query),
      );

      if (filtered.length === 0) return '';

      const rows = filtered
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((source) => {
          const hidden = state.hiddenSources.has(source.id);
          return `
            <label class="source-row ${hidden ? 'is-hidden' : ''}">
              <input type="checkbox" data-source-toggle="${esc(source.id)}" ${hidden ? '' : 'checked'} />
              <span class="source-name">${esc(source.name)}</span>
              <span class="source-meta">${esc((source.lang || '').toUpperCase())} · ${esc(label)}</span>
            </label>
          `;
        })
        .join('');

      return `<section class="source-group"><h3>${esc(label)}</h3>${rows}</section>`;
    })
    .join('');

  els.sourceList.innerHTML = html || '<p class="empty-sources">Источник не найден.</p>';
  updateHiddenBadge();
}

function renderGenerated() {
  if (!state.data) {
    els.generated.textContent = '';
    return;
  }

  const parts = [];
  if (state.data.generatedAt) parts.push(`Обновлено ${formatDateTime(state.data.generatedAt)}`);
  if (state.data.sourceCount) parts.push(`${state.data.sourceCount} источников`);

  const errors = state.data.errors || [];
  if (errors.length > 0) parts.push(`${errors.length} недоступно`);

  els.generated.textContent = parts.join(' · ');
  els.generated.title = errors.map((error) => `${error.source}: ${error.error}`).join('\n');
}

function renderLastUpdate() {
  if (!els.lastUpdate) return;

  const ts = state.data?.generatedAt;
  if (!ts) {
    els.lastUpdate.hidden = true;
    return;
  }

  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    els.lastUpdate.hidden = true;
    return;
  }

  els.lastUpdate.hidden = false;

  const next = new Date(date.getTime() + 30 * 60_000);
  const overdue = next.getTime() < Date.now() - 5 * 60_000;
  const nextLabel = overdue
    ? 'следующее — в ближайшее время'
    : `следующее около ${formatNextTime(next)}`;

  els.lastUpdate.textContent = `Последнее обновление: ${formatDateTime(ts)} · ${nextLabel}`;
  els.lastUpdate.title = `Новости собираются автоматически каждые 30 минут. Последний сбор: ${formatDateTime(ts)} (${timeAgo(ts)}). Следующий: ${nextLabel}.`;
}

function setStatus(text, mode) {
  els.status.textContent = text;
  els.status.classList.toggle('is-loading', mode === 'loading');
  els.status.classList.toggle('is-error', mode === 'error');
}

/* ── Фильтры, разделы, источники ──────────────────────────────────────── */

function loadLayout() {
  try {
    return localStorage.getItem(STORAGE.layout) === 'compact' ? 'compact' : 'large';
  } catch {
    return 'large';
  }
}

function applyLayout(layout = state.layout) {
  state.layout = layout === 'compact' ? 'compact' : 'large';
  const compact = state.layout === 'compact';

  els.grid?.classList.toggle('is-compact', compact);

  if (els.layoutBtn) {
    els.layoutBtn.setAttribute('aria-pressed', String(compact));
    els.layoutBtn.setAttribute(
      'aria-label',
      compact ? 'Показать крупные карточки' : 'Показать по две карточки в ряд',
    );
    els.layoutBtn.title = compact ? 'Крупные карточки' : 'По две в ряд';
  }

  try {
    localStorage.setItem(STORAGE.layout, state.layout);
  } catch {
    // Настройка не сохранится между визитами.
  }
}

function applyTabsState(expanded = state.tabsExpanded) {
  state.tabsExpanded = expanded;

  const container = document.getElementById('tabs');
  if (container) container.classList.toggle('is-expanded', expanded);

  if (els.tabsToggle) {
    els.tabsToggle.setAttribute('aria-expanded', String(expanded));
    const label = els.tabsToggle.querySelector('.tabs-toggle-label');
    if (label) label.textContent = expanded ? 'Скрыть' : 'Ещё';
  }
}

function setCategory(category) {
  state.category = category;
  state.source = 'all';
  state.visible = PAGE_SIZE;
  els.sourceSelect.value = 'all';

  for (const tab of els.tabs) {
    const active = tab.dataset.category === category;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }

  applyTabsState(false);
  render();
}

function resetFilters({ includeCategory = false } = {}) {
  state.query = '';
  state.source = 'all';
  state.visible = PAGE_SIZE;
  els.search.value = '';
  els.sourceSelect.value = 'all';

  if (includeCategory && state.category === 'saved') {
    setCategory('all');
  } else {
    render();
  }
}

function hasActiveFilters() {
  return Boolean(state.query) || state.source !== 'all';
}

function openSourcesDialog() {
  if (!state.data) return;
  state.sourceQuery = '';
  els.sourceSearch.value = '';
  renderSourceList();
  if (!els.sourcesDialog.open) els.sourcesDialog.showModal();
}

function closeSourcesDialog() {
  if (els.sourcesDialog.open) els.sourcesDialog.close();
}

function toggleSource(sourceId, visible) {
  if (visible) state.hiddenSources.delete(sourceId);
  else state.hiddenSources.add(sourceId);

  persistHiddenSources();

  if (!visible && state.source === sourceId) {
    state.source = 'all';
    els.sourceSelect.value = 'all';
  }

  render();
  renderSourceList();
  toast(visible ? 'Источник снова включён' : 'Источник скрыт — вернуть можно в «Источниках»');
}

function loadHiddenSources() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.hiddenSources) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function persistHiddenSources() {
  try {
    localStorage.setItem(STORAGE.hiddenSources, JSON.stringify([...state.hiddenSources]));
  } catch {
    // Хранилище недоступно — настройка не сохранится между визитами.
  }
}

/* ── Прочитанные ──────────────────────────────────────────────────────── */

function loadRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.read) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

function persistRead() {
  try {
    localStorage.setItem(STORAGE.read, JSON.stringify([...state.read]));
  } catch (error) {
    console.warn('Не удалось сохранить прочитанные:', error);
  }
}

function markRead(id) {
  if (!id || state.read.has(id)) return;

  state.read.add(id);
  while (state.read.size > 2000) {
    state.read.delete(state.read.values().next().value);
  }
  persistRead();

  const card = els.grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;

  card.classList.add('is-read');
  const meta = card.querySelector('.card-meta');
  if (meta && !meta.querySelector('.read-badge')) {
    const badge = document.createElement('span');
    badge.className = 'read-badge';
    badge.title = 'Вы уже открывали эту новость';
    badge.textContent = '✓ прочитано';
    meta.append(badge);
  }
}

/* ── Избранное ────────────────────────────────────────────────────────── */

function loadBookmarks() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.bookmarks) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry) => Array.isArray(entry) && entry[0] && entry[1]);
  } catch {
    return [];
  }
}

function persistBookmarks() {
  try {
    localStorage.setItem(STORAGE.bookmarks, JSON.stringify([...state.bookmarks.entries()]));
  } catch (error) {
    console.warn('Не удалось сохранить избранное:', error);
  }
}

function snapshot(item) {
  const { id, title, url, excerpt, content, image, images, addedAt, publishedAt, sourceId, source, category, lang } = item;
  return { id, title, url, excerpt, content, image, images, addedAt, publishedAt, sourceId, source, category, lang };
}

function toggleBookmark(id) {
  const item = state.data?.items.find((entry) => entry.id === id) || state.bookmarks.get(id);
  if (!item) return;

  const wasSaved = state.bookmarks.has(id);

  if (wasSaved) {
    state.bookmarks.delete(id);
  } else {
    state.bookmarks.set(id, snapshot(item));
  }

  persistBookmarks();
  updateCounts();

  if (state.category === 'saved') {
    render();
  } else {
    const button = els.grid.querySelector(`[data-bookmark="${CSS.escape(id)}"]`);
    if (button) {
      const saved = !wasSaved;
      const label = saved ? 'Убрать из избранного' : 'Добавить в избранное';
      button.classList.toggle('is-saved', saved);
      button.textContent = saved ? '★' : '☆';
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  toast(wasSaved ? 'Удалено из избранного' : 'Добавлено в избранное');
}

/* ── Читалка новости ──────────────────────────────────────────────────── */

function openReader(id) {
  const item = state.data?.items.find((entry) => entry.id === id) || state.bookmarks.get(id);
  if (!item) return;

  markRead(id);
  state.readerItem = item;

  if (!state.articlesLoaded && !state.articlesLoading) {
    loadArticles();
  }

  renderReader();

  if (!els.readerDialog.open) els.readerDialog.showModal();
  els.readerScroll.scrollTop = 0;
}

function closeReader() {
  if (els.readerDialog.open) els.readerDialog.close();
  state.readerItem = null;
}

function renderReader() {
  const item = state.readerItem;
  if (!item) return;

  const category = CATEGORY_KEYS.includes(item.category) ? item.category : 'ai';
  const translation = state.translation === 'ru' && item.lang !== 'ru' ? state.translations.get(item.id) : null;
  const enriched = state.articles.get(item.id);
  const enrichedContent =
    enriched && !enriched.error && typeof enriched.content === 'string' ? enriched.content : '';
  const rssContent = item.content || '';
  const baseContent = enrichedContent.length > rssContent.length ? enrichedContent : rssContent;
  const usingEnriched = Boolean(enrichedContent) && enrichedContent.length > rssContent.length;
  const title = translation?.title || item.title;
  const content = translation?.content || baseContent;
  const excerpt = translation?.excerpt || item.excerpt || '';
  const body = cleanArticleText(content && content.length >= 40 ? content : excerpt);
  const images = mergeReaderImages(enriched?.images, item.images, item.image);
  const hero = safeUrl(images[0]?.url || '');

  els.readerBadge.className = `card-badge badge-${category}`;
  els.readerBadge.textContent = CATEGORY_LABELS[category];
  els.readerSource.textContent = item.source || 'Источник';
  els.readerSourceName.textContent = item.source || 'Источник';
  const readerAddedAt = item.addedAt || item.publishedAt || '';
  els.readerTime.textContent = readerAddedAt ? formatCardTime(readerAddedAt) : '';
  els.readerTime.dateTime = readerAddedAt;
  els.readerTime.title = 'Добавлено на агрегатор';
  els.readerTitle.textContent = title;
  els.readerOriginalTitle.hidden = !translation || translation.title === item.title;
  els.readerOriginalTitle.textContent = item.title;

  els.readerImage.hidden = !hero;
  if (hero) {
    els.readerImage.src = hero;
    els.readerImage.alt = '';
  } else {
    els.readerImage.removeAttribute('src');
  }

  els.readerContent.textContent = body || 'Полный текст в ленте отсутствует.';
  renderReaderGallery(images.slice(1));
  els.readerOpenLink.href = safeUrl(item.url) || '#';

  const notes = [];

  if (state.translation === 'ru' && item.lang !== 'ru' && !translation) {
    notes.push('Перевод пока не готов — показан оригинал; он появится после следующего автоматического обновления.');
  }

  if (state.translation === 'ru' && translation && !translation.content && baseContent) {
    notes.push('Заголовок переведён, полный текст пока на языке источника.');
  }

  if (translation?.content) {
    notes.push('Перевод выполнен автоматически.');
    if (baseContent.length > translation.content.length + 200) {
      notes.push('Перевод сокращён; полный текст — на сайте источника.');
    }
  }

  if (category === 'war') {
    notes.push('Материал из открытого источника; агрегатор не проверяет факты.');
  }

  if (item.publishedAt) {
    notes.push(`Опубликовано: ${formatDateTime(item.publishedAt)}.`);
  }

  if (usingEnriched) {
    notes.push('Полный текст со страницы источника.');
  } else if (enriched?.error) {
    notes.push('Полный текст со страницы недоступен — показан текст из RSS.');
  } else if (state.articlesLoading) {
    notes.push('Загружаем полный текст со страницы…');
  }

  if (!body) {
    notes.push('Текст недоступен — откройте оригинал.');
  } else if (!usingEnriched && body.length < 500) {
    notes.push('В RSS-ленте доступен только краткий анонс — полный текст на сайте источника.');
  } else if (!usingEnriched) {
    notes.push('Текст из RSS-ленты; форматирование упрощено.');
  }

  if (usingEnriched && enrichedContent.length >= 20_000) {
    notes.push('Полный текст сокращён до 20 000 символов.');
  } else if (!translation?.content && !usingEnriched && rssContent.length >= 12_000) {
    notes.push('Текст сокращён до 12 000 символов.');
  }

  els.readerNotice.textContent = notes.join(' ');
}

function mergeReaderImages(enrichedImages, rssImages, fallbackImage) {
  const images = [];
  const seen = new Set();

  function add(url, alt = '') {
    const safe = safeUrl(url);
    if (!safe || seen.has(safe)) return;
    seen.add(safe);
    images.push({ url: safe, alt: alt || '' });
  }

  for (const image of enrichedImages || []) add(image.url, image.alt);
  for (const image of rssImages || []) add(image.url, image.alt);
  add(fallbackImage, '');

  return images;
}

function renderReaderGallery(images) {
  const valid = images.map((image) => ({ url: safeUrl(image.url), alt: image.alt || '' })).filter((image) => image.url);

  els.readerGallery.hidden = valid.length === 0;
  els.readerGallery.innerHTML = valid
    .map(
      (image) =>
        `<img src="${esc(image.url)}" alt="${esc(image.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-reader-image />`,
    )
    .join('');

  els.readerGallery.querySelectorAll('img').forEach((image) => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
}

async function copyReaderLink() {
  const url = state.readerItem?.url;
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка скопирована');
  } catch {
    toast('Не удалось скопировать ссылку');
  }
}

/* ── Недельный дайджест ───────────────────────────────────────────────── */

function openDigestDialog() {
  if (!els.digestDialog.open) els.digestDialog.showModal();

  if (!state.digestIndex) {
    loadDigestIndex();
  } else {
    renderDigestWeeks();
    if (!state.digestWeek && state.digestIndex.length > 0) {
      loadDigestWeek(state.digestIndex[0].key);
    }
  }
}

async function loadDigestIndex() {
  if (state.digestIndexLoading) return;

  state.digestIndexLoading = true;
  els.digestWeeks.innerHTML = '';
  els.digestList.innerHTML = '<p class="digest-empty">Загружаем архив…</p>';
  els.digestCount.textContent = '';

  try {
    const data = await fetchJson(`data/digest/index.json?ts=${Date.now()}`);
    state.digestIndex = Array.isArray(data.weeks) ? data.weeks : [];
    renderDigestWeeks();

    if (state.digestIndex.length === 0) {
      els.digestList.innerHTML = '<p class="digest-empty">Архив пока пуст.</p>';
      return;
    }

    await loadDigestWeek(state.digestIndex[0].key);
  } catch (error) {
    console.warn('Дайджест пока недоступен:', error);

    if (error?.status === 404) {
      state.digestIndex = [];
      els.digestWeeks.innerHTML = '';
      els.digestList.innerHTML =
        '<p class="digest-empty">Архив ещё не собран. Он появится после первого запуска GitHub Actions.</p>';
    } else {
      // Сетевую ошибку не запоминаем: при следующем открытии попробуем снова.
      state.digestIndex = null;
      els.digestWeeks.innerHTML = '';
      els.digestList.innerHTML =
        '<p class="digest-empty">Не удалось загрузить архив. Закройте и откройте дайджест ещё раз.</p>';
    }
  } finally {
    state.digestIndexLoading = false;
  }
}

function renderDigestWeeks() {
  if (!Array.isArray(state.digestIndex) || state.digestIndex.length === 0) {
    els.digestWeeks.innerHTML = '';
    return;
  }

  els.digestWeeks.innerHTML = state.digestIndex
    .map((week, index) => {
      const label = index === 0 ? 'Эта неделя' : index === 1 ? 'Прошлая' : formatWeekRange(week);
      const active = week.key === state.digestWeek;
      return `<button class="digest-week ${active ? 'is-active' : ''}" type="button" role="tab" aria-selected="${active}" data-week="${esc(week.key)}" title="${esc(formatWeekRange(week))}">${esc(label)}</button>`;
    })
    .join('');
}

async function loadDigestWeek(key) {
  if (!key || state.digestWeekLoading) return;

  state.digestWeekLoading = true;
  state.digestWeek = key;
  renderDigestWeeks();
  els.digestList.innerHTML = '<p class="digest-empty">Загружаем неделю…</p>';

  try {
    const data = await fetchJson(`data/digest/${encodeURIComponent(key)}.json?ts=${Date.now()}`);
    const sourceCategories = new Map((state.data?.sources || []).map((source) => [source.id, source.category]));
    state.digestItems = (Array.isArray(data.items) ? data.items : []).map((item) => ({
      ...item,
      category: sourceCategories.get(item.sourceId) || item.category,
    }));
    populateDigestCategories();
    renderDigestList();
  } catch (error) {
    console.warn('Не удалось загрузить неделю дайджеста:', error);
    state.digestItems = [];
    els.digestList.innerHTML = '<p class="digest-empty">Не удалось загрузить этот выпуск.</p>';
    els.digestCount.textContent = '';
  } finally {
    state.digestWeekLoading = false;
  }
}

function populateDigestCategories() {
  const present = new Set(state.digestItems.map((item) => item.category));
  const categories = CATEGORY_KEYS.filter((key) => present.has(key));

  if (state.digestCategory !== 'all' && !present.has(state.digestCategory)) {
    state.digestCategory = 'all';
  }

  els.digestCategory.innerHTML =
    '<option value="all">Все разделы</option>' +
    categories.map((key) => `<option value="${esc(key)}">${esc(CATEGORY_LABELS[key])}</option>`).join('');
  els.digestCategory.value = state.digestCategory;
}

function renderDigestList() {
  const items =
    state.digestCategory === 'all'
      ? state.digestItems
      : state.digestItems.filter((item) => item.category === state.digestCategory);

  const week = state.digestIndex?.find((entry) => entry.key === state.digestWeek);
  els.digestCount.textContent = week
    ? `${items.length} материалов · ${formatWeekRange(week)}`
    : `${items.length} материалов`;

  if (items.length === 0) {
    els.digestList.innerHTML = '<p class="digest-empty">За эту неделю в выбранном разделе пока нет материалов.</p>';
    return;
  }

  els.digestList.innerHTML = items.map(digestItemHtml).join('');

  els.digestList.querySelectorAll('img[data-digest-image]').forEach((image) => {
    image.addEventListener(
      'error',
      () => {
        image.closest('.digest-thumb')?.classList.add('no-image');
        image.remove();
      },
      { once: true },
    );
  });
}

function digestItemHtml(item) {
  const category = CATEGORY_KEYS.includes(item.category) ? item.category : 'ai';
  const image = safeUrl(item.image);
  const url = safeUrl(item.url);
  const addedDate = item.addedAt || item.publishedAt || '';
  const publishedDate = item.publishedAt || '';
  const addedLabel = addedDate ? formatCardTime(addedDate) : 'нет даты';
  const publishedLabel = publishedDate ? formatCardTime(publishedDate) : 'нет даты';

  return `
    <a class="digest-item" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      <span class="digest-thumb ${image ? '' : 'no-image'}" data-category="${category}">
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-digest-image />` : ''}
        <span class="digest-fallback">
          <img class="digest-fallback-img" src="icons/fallback/${category}.svg" alt="" loading="lazy" decoding="async" />
        </span>
      </span>
      <span class="digest-body">
        <span class="digest-meta">
          <span class="category">${esc(CATEGORY_LABELS[category])}</span>
          ${esc(item.source || '')}
        </span>
        <span class="digest-dates">
          <span class="added">В агрегаторе: <time datetime="${esc(addedDate)}">${esc(addedLabel)}</time></span>
          <span>Источник: <time datetime="${esc(publishedDate)}">${esc(publishedLabel)}</time></span>
        </span>
        <strong class="digest-title">${esc(item.title)}</strong>
        ${item.excerpt ? `<span class="digest-excerpt">${esc(item.excerpt)}</span>` : ''}
      </span>
    </a>
  `;
}

function formatWeekRange(week) {
  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
    return `${formatter.format(new Date(`${week.start}T00:00:00Z`))} — ${formatter.format(new Date(`${week.end}T00:00:00Z`))}`;
  } catch {
    return week.key;
  }
}

/* ── События ──────────────────────────────────────────────────────────── */

function bindEvents() {
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => {
      if (tab.dataset.category === state.category) return;
      setCategory(tab.dataset.category);
      tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }

  els.tabsToggle?.addEventListener('click', () => {
    applyTabsState(!state.tabsExpanded);
  });

  els.layoutBtn?.addEventListener('click', () => {
    applyLayout(state.layout === 'compact' ? 'large' : 'compact');
  });

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value.trim();
      state.visible = PAGE_SIZE;
      render();
    }, 140);
  });

  els.sourceSelect.addEventListener('change', () => {
    state.source = els.sourceSelect.value;
    state.visible = PAGE_SIZE;
    render();
  });

  els.translationSelect.addEventListener('change', () => {
    state.translation = els.translationSelect.value === 'ru' ? 'ru' : 'original';

    try {
      localStorage.setItem(STORAGE.translation, state.translation);
    } catch {
      // Настройка просто не запомнится.
    }

    if (state.translation === 'ru') {
      loadTranslations({ force: state.translationsLoaded });
    } else {
      render();
    }
  });

  els.resetBtn.addEventListener('click', () => resetFilters());
  els.emptyActionBtn.addEventListener('click', () => {
    if (els.emptyActionBtn.dataset.action === 'sources') openSourcesDialog();
    else resetFilters({ includeCategory: true });
  });

  els.loadMoreBtn.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    render();
  });

  els.refreshBtn.addEventListener('click', () => loadData());

  els.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE.theme, next);
    } catch {
      // Приватный режим — тема просто не запомнится.
    }
  });

  els.grid.addEventListener('click', (event) => {
    if (event.target.closest('[data-retry]')) {
      loadData();
      return;
    }

    const bookmark = event.target.closest('[data-bookmark]');
    if (bookmark) {
      event.preventDefault();
      toggleBookmark(bookmark.dataset.bookmark);
      return;
    }

    const read = event.target.closest('[data-read]');
    if (read && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      openReader(read.dataset.read);
    }
  });

  els.sourcesBtn.addEventListener('click', openSourcesDialog);
  els.sourcesCloseBtn.addEventListener('click', closeSourcesDialog);
  els.sourcesDoneBtn.addEventListener('click', closeSourcesDialog);

  els.readerCloseBtn.addEventListener('click', closeReader);
  els.readerCopyBtn.addEventListener('click', copyReaderLink);
  els.readerImage.addEventListener('error', () => {
    els.readerImage.hidden = true;
  });
  els.readerDialog.addEventListener('click', (event) => {
    if (event.target === els.readerDialog) closeReader();
  });
  els.readerDialog.addEventListener('close', () => {
    state.readerItem = null;
  });

  els.digestBtn.addEventListener('click', openDigestDialog);
  els.digestCloseBtn.addEventListener('click', () => els.digestDialog.close());
  els.digestDoneBtn.addEventListener('click', () => els.digestDialog.close());
  els.digestDialog.addEventListener('click', (event) => {
    if (event.target === els.digestDialog) els.digestDialog.close();
  });

  els.digestWeeks.addEventListener('click', (event) => {
    const week = event.target.closest('[data-week]');
    if (week && !state.digestWeekLoading) loadDigestWeek(week.dataset.week);
  });

  els.digestCategory.addEventListener('change', () => {
    state.digestCategory = els.digestCategory.value;
    renderDigestList();
  });

  const visitorBadge = document.getElementById('visitorBadge');
  const visitorImage = visitorBadge?.querySelector('img');
  visitorImage?.addEventListener(
    'error',
    () => {
      if (visitorBadge) visitorBadge.hidden = true;
    },
    { once: true },
  );

  els.sourcesDialog.addEventListener('click', (event) => {
    if (event.target === els.sourcesDialog) closeSourcesDialog();
  });

  els.sourceSearch.addEventListener('input', () => {
    state.sourceQuery = els.sourceSearch.value;
    renderSourceList();
  });

  els.sourceList.addEventListener('change', (event) => {
    const input = event.target.closest('[data-source-toggle]');
    if (input) toggleSource(input.dataset.sourceToggle, input.checked);
  });

  els.showAllSourcesBtn.addEventListener('click', () => {
    if (state.hiddenSources.size === 0) return;
    state.hiddenSources.clear();
    persistHiddenSources();
    render();
    renderSourceList();
    toast('Все источники включены');
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
    els.installBtn.hidden = false;
  });

  els.installBtn.addEventListener('click', async () => {
    if (!state.deferredPrompt) return;

    state.deferredPrompt.prompt();
    const choice = await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    els.installBtn.hidden = true;

    if (choice.outcome === 'accepted') toast('Приложение установлено');
  });

  window.addEventListener('appinstalled', () => {
    els.installBtn.hidden = true;
    toast('Приложение установлено');
  });

  window.addEventListener('online', () => {
    toast('Соединение восстановлено');
    if (state.lastAttempt) loadData({ silent: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.lastAttempt && Date.now() - state.lastAttempt > AUTO_REFRESH_MS) {
      loadData({ silent: true });
    }
  });

  window.setInterval(() => {
    if (!document.hidden && state.lastAttempt && Date.now() - state.lastAttempt > AUTO_REFRESH_MS) {
      loadData({ silent: true });
    }
  }, 60_000);

  document.addEventListener('keydown', (event) => {
    const activeTag = document.activeElement?.tagName;
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(activeTag)) {
      event.preventDefault();
      els.search.focus();
    }
  });
}

/* ── Тема, PWA, утилиты ───────────────────────────────────────────────── */

function loadStoredTranslation() {
  try {
    return localStorage.getItem(STORAGE.translation) === 'ru' ? 'ru' : 'original';
  } catch {
    return 'original';
  }
}

function getStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE.theme);
    return stored === 'light' || stored === 'dark' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f4f6fb' : '#090b10';

  els.themeBtn?.setAttribute(
    'aria-label',
    theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему',
  );
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.location.protocol.startsWith('http')) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('Service worker не зарегистрирован:', error);
    });
  });
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatNextTime(date) {
  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();

  return new Intl.DateTimeFormat('ru-RU', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatCardTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'без даты';

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function timeAgo(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'без даты';

  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'только что';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} мин назад`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;

  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
}

function plural(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function cleanArticleText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article|tr|table)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeUrl(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}
