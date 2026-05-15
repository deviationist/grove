#!/usr/bin/env node
// Generates docs/screenshot.svg — the colored terminal example used in README.md.
// Run: node scripts/generate-screenshot.mjs

import { writeFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

// ── Catppuccin Mocha palette ──────────────────────────────────────────────────
const C = {
  bg:     '#1e1e2e',
  bar:    '#181825',
  dot1:   '#f38ba8',   // red   — close
  dot2:   '#f9e2af',   // yellow — minimise
  dot3:   '#a6e3a1',   // green  — maximise
  text:   '#cdd6f4',
  green:  '#a6e3a1',
  gray:   '#9399b2',
  blue:   '#89b4fa',
  yellow: '#f9e2af',
  dim:    '#6c7086',
  tree:   '#45475a',
  white:  '#ffffff',
};

// ── SVG helpers ───────────────────────────────────────────────────────────────
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Coloured text segment — renders as a <tspan> */
function t(text, color, bold = false) {
  const w = bold ? ' font-weight="bold"' : '';
  return `<tspan fill="${color}"${w}>${esc(text)}</tspan>`;
}

/** Clickable PR link wrapping a tspan */
function prLink(text, color, url) {
  return `<a href="${url}" target="_blank"><tspan fill="${color}" text-decoration="underline">${esc(text)}</tspan></a>`;
}

/** Repeated spaces (dim, effectively invisible) */
const sp = n => t(' '.repeat(n), C.dim);

// ── Column layout ─────────────────────────────────────────────────────────────
// maxLeft = 36  (│   └── PLAT-12-settings-panel-tests)
// PR col starts at 38  (maxLeft + 2)
// Badge col starts at 45  (38 + maxPr=5 + 2)
//
// namePad = 38 - leftRawLen
// prPad   = 2  (all PR numbers here are 5 chars; maxPr - 5 + 2 = 2)
// noPrPad = 7  (maxPr + 2, fills the PR column for branches without a PR)

// ── Example lines ─────────────────────────────────────────────────────────────
const LINES = [
  // Header
  t('grove', C.white, true) + t('  ·  ', C.dim) + t('acme/frontend', C.white, true) + t('  @alice', C.dim),

  // Separator
  t('─'.repeat(54), C.dim),

  // Trunk
  t('main', C.white, true),

  // ├── PLAT-12-auth-service-extract   len=32  pad=6
  t('├── ', C.tree) + t('PLAT-12-auth-service-extract', C.green) +
    sp(6) + prLink('#1021', C.dim, 'https://github.com/acme/frontend/pull/1021') + sp(2) + t('✅ merged', C.green),

  // ├── PLAT-12-auth-token-refresh     len=30  pad=8
  t('├── ', C.tree) + t('PLAT-12-auth-token-refresh', C.green) +
    sp(8) + prLink('#1022', C.dim, 'https://github.com/acme/frontend/pull/1022') + sp(2) + t('✅ merged', C.green),

  // ├── PLAT-12-user-profile-api       len=28  pad=10
  t('├── ', C.tree) + t('PLAT-12-user-profile-api', C.gray) +
    sp(10) + prLink('#1023', C.dim, 'https://github.com/acme/frontend/pull/1023') + sp(2) + t('◐ draft', C.gray) +
    t('  ← request review', C.white, true),

  // │   └── PLAT-12-user-profile-ui   len=31  pad=7
  t('│   ', C.tree) + t('└── ', C.tree) + t('PLAT-12-user-profile-ui', C.gray) +
    sp(7) + prLink('#1024', C.dim, 'https://github.com/acme/frontend/pull/1024') + sp(2) + t('◐ draft', C.gray) +
    t('  blocked', C.dim),

  // ├── PLAT-12-settings-panel ◀       len=28  pad=10
  t('├── ', C.tree) + t('PLAT-12-settings-panel', C.gray, true) + t(' ◀', C.dim) +
    sp(10) + prLink('#1031', C.dim, 'https://github.com/acme/frontend/pull/1031') + sp(2) + t('◐ draft', C.gray) +
    t('  ← request review', C.white, true),

  // │   └── PLAT-12-settings-panel-tests  len=36  pad=2
  t('│   ', C.tree) + t('└── ', C.tree) + t('PLAT-12-settings-panel-tests', C.gray) +
    sp(2) + prLink('#1032', C.dim, 'https://github.com/acme/frontend/pull/1032') + sp(2) + t('◐ draft', C.gray) +
    t('  blocked', C.dim) + t('  ⚠ needs rebase', C.yellow),

  // └── chore/update-deps              len=21  pad=17+7=24 (no PR)
  t('└── ', C.tree) + t('chore/update-deps', C.dim) +
    sp(24) + t('○ local', C.dim) +
    t('  ← open PR', C.white, true) + t('  ⚠ needs rebase', C.yellow),

  // Separator
  t('─'.repeat(54), C.dim),

  // Summary
  t('2 ready for review', C.white, true) + t('  ·  ', C.dim) +
  t('2 needs rebase', C.yellow)          + t('  ·  ', C.dim) +
  t('2 blocked', C.dim)                  + t('  ·  ', C.dim) +
  t('2 merged', C.green),
];

// ── Layout constants ──────────────────────────────────────────────────────────
const FONT = "'Cascadia Code','Fira Code',Consolas,'Courier New',monospace";
const FS   = 13;   // font-size px
const LH   = 20;   // line height px
const TH   = 28;   // title bar height px
const PX   = 20;   // horizontal padding px
const PY   = 14;   // vertical padding px
const W    = 720;
const H    = TH + PY + LINES.length * LH + PY;

// ── Render ────────────────────────────────────────────────────────────────────
const textLines = LINES.map((content, i) => {
  const y = TH + PY + i * LH + FS;
  return `  <text x="${PX}" y="${y}" font-family=${JSON.stringify(FONT)} font-size="${FS}" xml:space="preserve">${content}</text>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="grove example output">
  <!-- terminal window background -->
  <rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
  <!-- title bar -->
  <rect width="${W}" height="${TH}" rx="10" fill="${C.bar}"/>
  <rect y="${TH - 6}" width="${W}" height="6" fill="${C.bar}"/>
  <!-- window control dots -->
  <circle cx="18" cy="${Math.round(TH / 2)}" r="5.5" fill="${C.dot1}"/>
  <circle cx="36" cy="${Math.round(TH / 2)}" r="5.5" fill="${C.dot2}"/>
  <circle cx="54" cy="${Math.round(TH / 2)}" r="5.5" fill="${C.dot3}"/>
${textLines}
</svg>
`;

const docsDir = resolve(ROOT, 'docs');
mkdirSync(docsDir, { recursive: true });

// Remove old screenshots before writing the new one
for (const f of readdirSync(docsDir)) {
  if (/^screenshot-v.+\.svg$/.test(f)) unlinkSync(resolve(docsDir, f));
}

const hash = randomBytes(3).toString('hex');
const filename = `screenshot-v${version}-${hash}.svg`;
const out = resolve(docsDir, filename);
writeFileSync(out, svg, 'utf8');

// Keep README in sync
const readmePath = resolve(ROOT, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
writeFileSync(readmePath, readme.replace(/screenshot-v[^)]+\.svg/, filename), 'utf8');

console.log(`✓  docs/${filename}  (${W}×${H}px)`);
