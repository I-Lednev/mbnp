#!/usr/bin/env node
/**
 * Генерирует тематические SVG-заглушки для карточек без картинки.
 * Результат: icons/fallback/<category>.svg
 *
 * Запуск: node scripts/generate-fallbacks.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'icons', 'fallback');

const ICONS = {
  ai: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  games:
    '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4M8 10v4"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/>',
  announces:
    '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/><path d="M8 14v5"/>',
  mobile: '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M11 18h2"/>',
  releases:
    '<path d="m7.5 4.3 9 5.1"/><path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  rumors:
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  software:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20M6 4v4M10 4v4"/>',
  science:
    '<path d="M10 2v7.5L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V2"/><path d="M8.5 2h7M7 16h10"/>',
  entertainment:
    '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9M12.4 3.4l3.1 4M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  ports:
    '<path d="m16 3 4 4-4 4M20 7H4"/><path d="m8 21-4-4 4-4M4 17h16"/>',
  pc: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  consoles:
    '<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M7 12h3M8.5 10.5v3"/><circle cx="16" cy="11" r="1"/><circle cx="18" cy="13" r="1"/>',
  hardware:
    '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/><path d="M6 16h.01M10 16h.01"/>',
  industry:
    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  updates:
    '<path d="M21 12a9 9 0 0 0-9-9 9.8 9.8 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.8 9.8 0 0 0 6.7-2.7L21 16"/><path d="M16 16h5v5"/>',
  aimods:
    '<path d="M4 4h6v3a2 2 0 1 0 4 0V4h6v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4V4Z"/>',
  aisoft:
    '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  cars:
    '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  war:
    '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/>',
};

const COLORS = {
  ai: ['#4c1d95', '#7c3aed'],
  games: ['#881337', '#e11d48'],
  announces: ['#831843', '#db2777'],
  mobile: ['#134e4a', '#0d9488'],
  releases: ['#78350f', '#d97706'],
  rumors: ['#4a044e', '#a21caf'],
  software: ['#0c4a6e', '#0284c7'],
  science: ['#14532d', '#16a34a'],
  entertainment: ['#9f1239', '#f43f5e'],
  ports: ['#312e81', '#4f46e5'],
  pc: ['#365314', '#65a30d'],
  consoles: ['#7c2d12', '#ea580c'],
  hardware: ['#334155', '#64748b'],
  industry: ['#1e3a8a', '#2563eb'],
  updates: ['#164e63', '#0891b2'],
  aimods: ['#701a75', '#c026d3'],
  aisoft: ['#064e3b', '#059669'],
  cars: ['#0c4a6e', '#0ea5e9'],
  war: ['#431407', '#c2410c'],
};

function svg(category) {
  const [from, to] = COLORS[category];
  const icon = ICONS[category];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
      <stop stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="r" cx="0" cy="0" r="1" gradientTransform="translate(390 30) rotate(135) scale(280)" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff" stop-opacity=".2"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="480" height="270" fill="url(#g)"/>
  <rect width="480" height="270" fill="url(#r)"/>
  <circle cx="30" cy="250" r="105" fill="#fff" fill-opacity=".045"/>
  <circle cx="455" cy="20" r="70" fill="#fff" fill-opacity=".06"/>
  <path d="M0 210 480 60" stroke="#fff" stroke-opacity=".06" stroke-width="2"/>
  <path d="M0 245 480 95" stroke="#fff" stroke-opacity=".04" stroke-width="2"/>
  <g transform="translate(180 75) scale(5)" stroke="#fff" stroke-opacity=".93" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
    ${icon}
  </g>
</svg>
`;
}

await mkdir(OUT_DIR, { recursive: true });

for (const category of Object.keys(ICONS)) {
  await writeFile(join(OUT_DIR, `${category}.svg`), svg(category), 'utf8');
  console.log(`✓ ${category}.svg`);
}

console.log(`\nГотово: ${Object.keys(ICONS).length} заглушек в ${OUT_DIR}`);
