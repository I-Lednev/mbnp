# MBNP — документация

My Best NEWSpaper — статический новостной агрегатор на GitHub Pages.

- Сайт: https://i-lednev.github.io/mbnp/
- Репозиторий: https://github.com/I-Lednev/mbnp
- MAX-бот: `@se14946657_bot`
- Вход: логин `i.lednev`, пароль задан владельцем

## Архитектура

- **GitHub Pages** — HTML, CSS, JS, JSON. Сервера и базы нет.
- **GitHub Actions** — сборка RSS, тексты, переводы, коммит данных.
- **Данные** — `data/news.json`, `data/translations.json`, `data/articles.json`, `data/digest/`.
- **Вход** — PBKDF2-хэш в `auth-config.js`, сессия в `localStorage`.
- **Приглашения** — версия в `access/config.json`, отзыв меняет версию.
- **MAX-бот** — локальный Node.js-процесс, long polling MAX Bot API.

## Как обновляются новости

1. `update-news.yml` запускается по расписанию, вручную или после изменения скриптов.
2. `fetch-news.mjs` собирает RSS в `news.json`.
3. `enrich-articles.mjs` достаёт полные тексты в `articles.json`.
4. `translate-news.mjs` переводит новые материалы в `translations.json`.
5. Workflow коммитит данные, Pages пересобирает сайт.

Ручной запуск:

```bash
gh workflow run update-news.yml -R I-Lednev/mbnp --ref main
```

Расписание GitHub не строгое: запуски задерживаются и иногда пропускаются.

## Структура

```
index.html                 разметка, экран входа, диалоги
styles.css                 темы, карточки, адаптив
app.js                     логика сайта, авторизация, кабинет
auth-config.js             логин, соль и хэш пароля, версия приглашений
access/config.json         версия приглашений
sw.js                      service worker
icons/fallback/*.svg       заглушки категорий
data/news.json             новости за 7 дней
data/translations.json     переводы
data/articles.json         полные тексты
data/digest/*.json         недельный архив
scripts/fetch-news.mjs     RSS → news.json
scripts/enrich-articles.mjs страницы → articles.json
scripts/translate-news.mjs переводы
scripts/generate-fallbacks.mjs заглушки
scripts/make-password-hash.mjs хэш пароля
scripts/serve.mjs          локальный сервер
```

## Деплой

Git не установлен, файлы заливаются через GitHub Contents API.

```js
const api = 'https://api.github.com';
const headers = {
  authorization: `Bearer ${process.env.GH_TOKEN}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'MBNP-Deploy',
  'content-type': 'application/json',
};

const file = 'index.html';
const bytes = await readFile(file);
const current = await (await fetch(`${api}/repos/I-Lednev/mbnp/contents/${file}`, { headers })).json();
await fetch(`${api}/repos/I-Lednev/mbnp/contents/${file}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    message: `deploy: ${file}`,
    content: bytes.toString('base64'),
    sha: current.sha,
    branch: 'main',
  }),
});
```

После изменения `app.js` или `styles.css` поднимайте `?v=N` в `index.html` и `CACHE_NAME` в `sw.js`.

## Вход и приглашения

- Пароль хранится только как PBKDF2-хэш в `auth-config.js`.
- Сессия — 30 дней в `localStorage`.
- Приглашение — ссылка `#invite=vN.код`, версия сверяется с `access/config.json`.
- «Аннулировать все» увеличивает версию в `access/config.json`.
- Для отзыва нужен GitHub fine-grained token с `Contents: Read and write`.

Сменить пароль:

```bash
node scripts/make-password-hash.mjs "новый пароль"
```

`salt` и `hash` вставить в `auth-config.js`.

## MAX-бот

Конфиг: `C:\Users\rolf9\.local\share\opencode\max-bot.json`
Скрипт: `max-bot.mjs`
Лог: `max-bot.log`

Команды:

- `/widgets` — баланс DeepSeek, дешёвое время, 100 ₽ в долларах, курс ЦБ
- `/status` — бот и OpenCode
- `/balance` — остаток DeepSeek
- `/spent` — расход сессии и за сегодня
- `/context` — общий контекст
- `/note текст` — добавить заметку

Любое сообщение без `/` — задача для OpenCode (до 15 минут, потом отчёт).

## Источники

Массив `FEEDS` в `scripts/fetch-news.mjs`.

```js
{ id: 'example', category: 'games', name: 'Example', lang: 'en', url: 'https://example.com/feed' }
```

- `keywords` — фильтр для общих лент.
- `type: 'github'` — GitHub.
- `type: 'substack'` — Substack API.
- `type: 'reddit'` — Reddit OAuth (нужны ключи).

Категории: ИИ, Игры, Анонсы, Мобильные, Релизы, Слухи, Софт, Наука, Развлечения, Порты, ПК, Консоли, Железо, Индустрия, Обновления, ИИ-моды, ИИ-софт, Авто, Война.

## Переводы

Google Translate по умолчанию, до 300 материалов за запуск. DeepL — по ключу. Ollama — локально. Для рассылок текст до 12 000 символов, разбивается на части.

## Ограничения

- GitHub Pages не делает сайт приватным: JSON доступны по прямым ссылкам.
- Репозиторий публичный.
- Полные тексты и переводы — риск по авторским правам.
- Reddit блокирует датацентры, Substack — 403.
- GitHub Actions может пропускать расписание.

## Если сломалось

1. Проверить Actions.
2. Запустить workflow вручную.
3. Проверить `generatedAt` в `data/news.json`.
4. Проверить сборку Pages и версии `?v=`.
5. Проверить `auth-config.js` и `access/config.json`.
6. Проверить процесс `max-bot.mjs` и лог.
