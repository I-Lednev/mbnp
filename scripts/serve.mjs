#!/usr/bin/env node
/**
 * Мини-сервер для локального просмотра. Без зависимостей.
 * Запуск: node scripts/serve.mjs  →  http://localhost:5173
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = resolve(join(ROOT, normalize(pathname)));

    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${sep}`)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const extension = extname(filePath).toLowerCase();
    response.writeHead(200, {
      'content-type': MIME[extension] || 'application/octet-stream',
      'cache-control': extension === '.json' ? 'no-store' : 'no-cache',
    });

    createReadStream(filePath).pipe(response);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`My Best NEWSPaper: http://localhost:${PORT}`);
  console.log('Остановить: Ctrl+C');
});
