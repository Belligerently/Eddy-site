// Design-token checks: colour contrast in both themes, and that components take colours only from tokens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TOKENS = readFileSync(new URL('../src/assets/styles/tokens.css', import.meta.url), 'utf8');
const SITE = readFileSync(new URL('../src/assets/styles/site.css', import.meta.url), 'utf8');

/** Custom properties declared in the first block matching `selector`. */
function block(selector) {
  const start = TOKENS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no ${selector} block`);
  const body = TOKENS.slice(start, TOKENS.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const dark = block(':root');
const light = { ...dark, ...block(":root[data-theme='light']") };

function resolveVar(vars, value, depth = 0) {
  const m = value.match(/^var\((--[\w-]+)\)$/);
  if (!m) return value;
  assert.ok(depth < 10 && vars[m[1]], `unresolved ${value}`);
  return resolveVar(vars, vars[m[1]], depth + 1);
}

function rgba(value) {
  let m = value.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = value.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return [r, g, b, a];
  }
  throw new Error(`Unsupported colour: ${value}`);
}

const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(vars, fg, bg) {
  const back = rgba(resolveVar(vars, vars[bg]));
  const front = over(rgba(resolveVar(vars, vars[fg])), back);
  const [a, b] = [luminance(front), luminance(back.slice(0, 3))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// [foreground, background, minimum]. Text needs 4.5:1; the focus ring (a UI component) needs 3:1.
const PAIRS = [
  ['--color-text', '--color-content', 4.5],
  ['--color-text', '--color-shell', 4.5],
  ['--color-text-subtle', '--color-content', 4.5],
  ['--color-muted', '--color-content', 4.5],
  ['--color-muted', '--color-surface', 4.5],
  ['--color-muted', '--color-shell', 4.5],
  ['--color-faint', '--color-surface', 4.5],
  ['--color-faint', '--color-content', 4.5],
  ['--color-text', '--color-surface', 4.5],
  ['--color-text', '--color-control', 4.5],
  ['--color-text', '--color-popup', 4.5],
  ['--color-on-primary', '--color-primary', 4.5],
  ['--color-on-primary', '--color-primary-hover', 4.5],
  ['--color-link', '--color-content', 4.5],
  ['--color-link', '--color-surface', 4.5],
  ['--color-warning-text', '--color-warning-surface', 4.5],
  ['--color-info-text', '--color-info-surface', 4.5],
  ['--color-success-text', '--color-success-surface', 4.5],
  ['--color-text-subtle', '--color-control', 4.5],
  ['--color-focus', '--color-content', 3],
  ['--color-focus', '--color-shell', 3],
  ['--color-primary-mark', '--color-shell', 3],
];

for (const [name, vars] of [['dark', dark], ['light', light]]) {
  test(`${name} theme: text and UI colour pairs meet WCAG AA`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(vars, fg, bg);
      assert.ok(ratio >= min, `${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
    }
  });
}

test('radii use the Vortex scale through semantic tokens', () => {
  const radii = Object.fromEntries(Object.entries(dark).filter(([k]) => k.startsWith('--radius-')).map(([k, v]) => [k, resolveVar(dark, v)]));
  assert.deepEqual(
    { sm: radii['--radius-sm'], md: radii['--radius-md'], lg: radii['--radius-lg'], xl: radii['--radius-xl'], '2xl': radii['--radius-2xl'] },
    { sm: '4px', md: '6px', lg: '8px', xl: '12px', '2xl': '16px' },
  );
  assert.equal(radii['--radius-control'], '8px'); // Vortex buttons, nav links, inputs
  assert.equal(radii['--radius-panel'], '12px'); // Vortex .site-main
  assert.equal(radii['--radius-card'], '16px'); // Vortex .ui-card, Voltimons cards
  const withoutComments = SITE.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of withoutComments.matchAll(/border-radius:\s*([^;]+);/g)) {
    assert.match(m[1], /^(var\(--[\w-]*radius[\w-]*\)|inherit|0|calc\(.*var\(--.*\))$/, `literal radius: ${m[1]}`);
  }
});

test('every motion duration is 0 under prefers-reduced-motion', () => {
  const start = TOKENS.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(start >= 0);
  const reduced = TOKENS.slice(start, TOKENS.indexOf('\n}', TOKENS.indexOf('\n  }', start)));
  for (const [k, v] of Object.entries(dark).filter(([k, v]) => k.startsWith('--motion-') && /ms$/.test(v))) {
    assert.match(reduced, new RegExp(`${k}: 0ms;`), `${k} (${v}) is not zeroed`);
  }
  // Regression guard: Chrome routes all input to <html> during a view transition, so clicks would be lost.
  const withoutComments = SITE.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(withoutComments, /@view-transition|view-transition-name|::view-transition/);
});

test('dark theme keeps the measured Vortex / Voltimons values', () => {
  const expect = {
    '--color-shell': '#120b1b',
    '--color-content': '#08050e',
    '--color-surface': '#15151f',
    '--color-control': '#26263a',
    '--color-border': '#24242f',
    '--color-border-strong': '#33334a',
    '--color-muted': '#9a9aab',
    '--color-link': '#a78bfa',
    '--color-focus': '#c084fc',
  };
  for (const [k, v] of Object.entries(expect)) assert.equal(resolveVar(dark, dark[k]).toLowerCase(), v, k);
});

test('site.css takes every colour from tokens (no hex, rgb or hsl literals)', () => {
  const withoutComments = SITE.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(withoutComments, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(withoutComments, /\b(rgb|rgba|hsl|hsla)\(/i);
});

test('every var() used in site.css is defined in tokens.css (or locally, or has a fallback)', () => {
  const defined = new Set([...TOKENS.matchAll(/(--[\w-]+):/g), ...SITE.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  // var(--x, fallback) may be set at runtime (e.g. --popup-origin by the tooltip script).
  const used = new Set([...SITE.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !defined.has(v));
  assert.deepEqual(missing, []);
});
