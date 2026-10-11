// Static checks of the built site: every page, link, asset and the Ko-fi link. Runs without a browser.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import config from '../site.config.js';
import { PAGES, NOT_FOUND, outputFile } from '../src/site.js';
import { renderPage } from '../src/layout.js';
import { build } from '../scripts/build.js';

const VERIFIED_KOFI_URL = 'https://ko-fi.com/zaflalo'; // vortex-extension/extension/shared/links.js

let out;
const html = {};

before(() => {
  out = mkdtempSync(join(tmpdir(), 'eddy-site-test-'));
  build(out);
  for (const p of [...PAGES, NOT_FOUND]) html[p.id] = readFileSync(join(out, outputFile(p)), 'utf8');
});

after(() => rmSync(out, { recursive: true, force: true }));

const attrs = (src, tag, attr) => [...src.matchAll(new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]*)"`, 'g'))].map((m) => m[1]);

test('every page is built, plus 404.html', () => {
  for (const p of [...PAGES, NOT_FOUND]) assert.ok(existsSync(join(out, outputFile(p))), outputFile(p));
});

test('no unresolved template placeholders', () => {
  for (const [id, src] of Object.entries(html)) assert.doesNotMatch(src, /\{\{|\}\}/, id);
});

test('internal links and assets resolve to built files', () => {
  for (const p of PAGES) {
    const base = dirname(join(out, outputFile(p)));
    const refs = [...attrs(html[p.id], 'a', 'href'), ...attrs(html[p.id], 'link', 'href'), ...attrs(html[p.id], 'script', 'src')];
    for (const ref of refs) {
      if (/^(https?:|mailto:|#)/.test(ref)) continue;
      assert.ok(!ref.startsWith('/'), `${p.path}: root-absolute link ${ref} breaks sub-path hosting`);
      const [path, fragment] = ref.split('#');
      let target = resolve(base, path);
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
      assert.ok(existsSync(target), `${p.path}: ${ref} → missing ${target}`);
      if (fragment) assert.match(readFileSync(target, 'utf8'), new RegExp(`id="${fragment}"`), `${p.path}: ${ref} → no #${fragment}`);
    }
  }
});

test('in-page fragment links point at existing ids', () => {
  for (const p of PAGES) {
    for (const ref of attrs(html[p.id], 'a', 'href').filter((h) => h.startsWith('#'))) {
      assert.match(html[p.id], new RegExp(`id="${ref.slice(1)}"`), `${p.path}: ${ref}`);
    }
  }
});

test('the 404 page uses root-absolute links (hosts serve it at any depth)', () => {
  for (const ref of [...attrs(html['404'], 'link', 'href'), ...attrs(html['404'], 'script', 'src')]) assert.ok(ref.startsWith('/'), ref);
});

test('the 404 page follows basePath, so it works from a sub-path such as /Eddy-site/', () => {
  const saved = config.basePath;
  try {
    config.basePath = '/Eddy-site/';
    const src = renderPage(NOT_FOUND);
    const refs = [...attrs(src, 'a', 'href'), ...attrs(src, 'link', 'href'), ...attrs(src, 'script', 'src')].filter((r) => !/^(https?:|#)/.test(r));
    assert.ok(refs.length > 10, 'expected the shell, nav and asset links');
    for (const ref of refs) {
      assert.ok(ref.startsWith('/Eddy-site/'), ref);
      let target = join(out, ref.slice('/Eddy-site/'.length));
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
      assert.ok(existsSync(target), `${ref} → missing ${target}`);
    }
    for (const bad of ['Eddy-site/', '/Eddy-site', '']) {
      config.basePath = bad;
      assert.throws(() => renderPage(NOT_FOUND), /basePath/, bad);
    }
  } finally {
    config.basePath = saved;
  }
});

test('no third-party scripts, stylesheets, fonts or frames', () => {
  for (const [id, src] of Object.entries(html)) {
    for (const ref of [...attrs(src, 'script', 'src'), ...attrs(src, 'link', 'href')]) assert.ok(!/^https?:/.test(ref), `${id}: ${ref}`);
    assert.doesNotMatch(src, /<iframe|<img[^>]+src="https?:/, id);
  }
  const css = readFileSync(join(out, 'assets/styles/tokens.css'), 'utf8') + readFileSync(join(out, 'assets/styles/site.css'), 'utf8');
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/);
  assert.doesNotMatch(css, /@import/);
});

test('each page marks exactly itself as current, once per navigation', () => {
  for (const p of PAGES) {
    const current = [...html[p.id].matchAll(/<a\b[^>]*href="([^"]*)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    assert.equal(current.length, 2, `${p.path}: sidebar + tab bar`);
    const base = dirname(join(out, outputFile(p)));
    for (const ref of current) assert.equal(resolve(base, ref), resolve(base, '.'), `${p.path}: ${ref}`);
  }
});

test('both navigations list every page in the same order', () => {
  for (const p of PAGES) {
    const side = html[p.id].match(/<nav id="site-nav"[\s\S]*?<\/nav>/)[0];
    const tabs = html[p.id].match(/<nav class="tab-bar"[\s\S]*?<\/nav>/)[0];
    const labels = (s, cls) => [...s.matchAll(new RegExp(`<span class="${cls}">([^<]+)<`, 'g'))].map((m) => m[1]);
    assert.deepEqual(labels(side, 'nav-label'), PAGES.map((x) => x.label));
    assert.deepEqual(labels(tabs, 'tab-label'), PAGES.map((x) => x.label));
  }
});

test('ids are unique within each page; one h1 per page', () => {
  for (const [id, src] of Object.entries(html)) {
    const ids = [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${id}: duplicate id`);
    assert.equal((src.match(/<h1\b/g) ?? []).length, 1, `${id}: h1 count`);
  }
});

test('titles and descriptions are unique', () => {
  const titles = PAGES.map((p) => p.title);
  assert.equal(new Set(titles).size, titles.length);
  const descriptions = PAGES.map((p) => p.description);
  assert.equal(new Set(descriptions).size, descriptions.length);
});

test('icon-only controls have accessible names', () => {
  for (const [id, src] of Object.entries(html)) {
    for (const m of src.matchAll(/<button\b([^>]*)>/g)) {
      const a = m[1];
      if (/class="icon-btn/.test(a)) assert.match(a, /aria-label="[^"]+"/, `${id}: ${a}`);
    }
  }
});

test('Ko-fi: the verified destination, once per page, in the footer, new tab, no referrer or opener', () => {
  assert.equal(config.kofiUrl, VERIFIED_KOFI_URL);
  for (const p of PAGES) {
    const links = [...html[p.id].matchAll(/<a\b[^>]*href="([^"]*ko-fi[^"]*)"[^>]*>/g)];
    assert.equal(links.length, 1, `${p.path}: ${links.length} Ko-fi links`);
    const tag = links[0][0];
    assert.equal(links[0][1], VERIFIED_KOFI_URL);
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
    const footer = html[p.id].match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
    assert.ok(footer.includes(VERIFIED_KOFI_URL), `${p.path}: link is not in the footer`);
    assert.match(footer, /Support Eddy on Ko-fi/);
    assert.match(footer, /opens ko-fi\.com in a new tab/);
  }
});

test('Ko-fi: an empty kofiUrl hides the link instead of rendering a broken one', () => {
  const saved = config.kofiUrl;
  try {
    config.kofiUrl = '';
    const src = renderPage(PAGES[0]);
    assert.doesNotMatch(src, /ko-fi\.com|kofi-link/);
  } finally {
    config.kofiUrl = saved;
  }
});

test('nothing on the site loads from or reports to Ko-fi or any analytics service', () => {
  for (const [id, src] of Object.entries(html)) {
    assert.doesNotMatch(src, /gtag|google-analytics|googletagmanager|plausible|umami|matomo|segment\.|ko-fi\.com\/widgets|storage\.ko-fi/i, id);
  }
  for (const file of jsFiles()) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|document\.cookie|import\(\s*['"]https?:/, file);
  }
});

function jsFiles(dir = join(out, 'assets/js')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? jsFiles(join(dir, d.name)) : d.name.endsWith('.js') ? [join(dir, d.name)] : []));
}

test('JavaScript: one module entry per page; every import resolves; no inline handlers', () => {
  for (const [id, src] of Object.entries(html)) {
    const modules = [...src.matchAll(/<script type="module" src="([^"]+)"/g)];
    assert.equal(modules.length, 1, `${id}: module entry count`);
    assert.match(modules[0][1], /assets\/js\/main\.js$/);
    assert.doesNotMatch(src, /\son[a-z]+="/, `${id}: inline event handler`);
  }
  for (const file of jsFiles()) {
    for (const m of readFileSync(file, 'utf8').matchAll(/^import [^'"]*['"]([^'"]+)['"]/gm)) {
      assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${file}: bare import ${m[1]}`);
      assert.ok(existsSync(resolve(dirname(file), m[1])), `${file}: ${m[1]} does not exist`);
    }
  }
});

test('the toggles are hidden without JavaScript and the theme-color follows the theme', () => {
  const css = readFileSync(join(out, 'assets/styles/site.css'), 'utf8');
  assert.match(css, /html:not\(\.js\) \.nav-toggle,\s*html:not\(\.js\) \.theme-toggle\s*\{\s*display: none;/);
  assert.match(html.home, /<meta name="theme-color" content="#120b1b" data-dark="#120b1b" data-light="#[0-9a-f]{6}">/);
});

test('the self-hosted font and its licence ship with the site', () => {
  assert.ok(statSync(join(out, 'assets/fonts/figtree-latin-wght.woff2')).size > 10000);
  assert.match(readFileSync(join(out, 'assets/fonts/Figtree-OFL.txt'), 'utf8'), /SIL Open Font License/);
});
