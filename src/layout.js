// Renders a full page: the shared shell (top bar, sidebar, mobile tab bar, footer) around a page fragment.
// Used by both the build (scripts/build.js) and the dev server (scripts/serve.js), so they always match.
//
// Links are relative to each page, so the built site works from a domain root or a sub-path. The 404 page is the
// exception: a host serves it at any depth, so its links are root-absolute.

import { readFileSync } from 'node:fs';
import config from '../site.config.js';
import { PAGES, outputFile } from './site.js';
import { icon, mark } from './icons.js';

const PAGES_DIR = new URL('./pages/', import.meta.url);

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Prefix that leads from a page back to the site root. */
function rootPrefix(page) {
  if (page.id === '404') return '/';
  const depth = outputFile(page).split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

function href(prefix, path) {
  const rel = path.replace(/^\//, '');
  if (prefix === '/') return `/${rel}`;
  return rel === '' ? prefix : `${prefix}${rel}`;
}

/**
 * Placeholders allowed in page fragments:
 *   {{icon:name}}  an inline icon     {{mark}}  the Eddy mark
 *   {{link:id}}    the relative href of a page by id
 *   {{version}}    the extension version from site.config.js
 */
function fill(html, prefix) {
  return html
    .replace(/\{\{icon:([a-z]+)\}\}/g, (_, n) => icon(n))
    .replace(/\{\{mark\}\}/g, () => mark())
    .replace(/\{\{version\}\}/g, () => escape(config.extensionVersion))
    .replace(/\{\{link:([a-z0-9]+)\}\}/g, (_, id) => {
      const target = PAGES.find((p) => p.id === id);
      if (!target) throw new Error(`Unknown page link: ${id}`);
      return href(prefix, target.path);
    });
}

function sideNav(current, prefix) {
  const item = (p) => `
        <li>
          <a class="nav-link" href="${href(prefix, p.path)}" data-tooltip="${escape(p.label)}" data-tooltip-when="nav-collapsed"${p.id === current.id ? ' aria-current="page"' : ''}>
            ${p.id === current.id ? '<span class="nav-indicator" aria-hidden="true"></span>' : ''}${icon(p.icon, 'icon nav-icon')}<span class="nav-label">${escape(p.label)}</span>
          </a>
        </li>`;
  const group = (name) => PAGES.filter((p) => p.group === name).map(item).join('');
  return `
    <nav id="site-nav" class="side-nav" aria-label="Main">
      <ul class="nav-group" role="list">${group('main')}
      </ul>
      <ul class="nav-group nav-group-tools" role="list">${group('tools')}
      </ul>
    </nav>`;
}

function mobileNav(current, prefix) {
  const items = PAGES.map(
    (p) => `
      <a class="tab-link" href="${href(prefix, p.path)}"${p.id === current.id ? ' aria-current="page"' : ''}>
        ${p.id === current.id ? '<span class="tab-indicator" aria-hidden="true"></span>' : ''}${icon(p.icon, 'icon tab-icon')}<span class="tab-label">${escape(p.label)}</span>
      </a>`,
  ).join('');
  return `
  <nav class="tab-bar" aria-label="Main">${items}
  </nav>`;
}

function footer() {
  const kofi = config.kofiUrl
    ? `
        <a class="footer-link kofi-link" href="${escape(config.kofiUrl)}" target="_blank" rel="noopener noreferrer">
          ${icon('cup')}<span>Support Eddy on Ko-fi</span>${icon('external', 'icon icon-sm')}<span class="sr-only"> (opens ko-fi.com in a new tab)</span>
        </a>`
    : '';
  return `
      <footer class="site-footer">
        <div class="footer-row">
          <p class="footer-note">Eddy is an independent fan project and isn’t affiliated with or endorsed by Vortex or Voltimons.</p>${kofi}
        </div>
        <p class="footer-meta">Extension version ${escape(config.extensionVersion)} · not released · Optional donations change nothing in Eddy.</p>
      </footer>`;
}

export function renderPage(page) {
  const prefix = rootPrefix(page);
  const body = fill(readFileSync(new URL(page.file, PAGES_DIR), 'utf8'), prefix);
  const asset = (p) => href(prefix, `/assets/${p}`);
  const home = PAGES.find((p) => p.id === 'home');

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escape(page.title)}</title>
  <meta name="description" content="${escape(page.description)}">
  <meta name="color-scheme" content="dark light">
  <meta name="theme-color" content="#120b1b" data-dark="#120b1b" data-light="#efeaf5">
  <meta name="referrer" content="no-referrer">
  <link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
  <link rel="preload" href="${asset('fonts/figtree-latin-wght.woff2')}" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${asset('styles/tokens.css')}">
  <link rel="stylesheet" href="${asset('styles/site.css')}">
  <script>
    // Before first paint: mark JS as available and apply the saved theme and sidebar state, so nothing flashes.
    // Kept in step with assets/js/lib/preferences.js, which re-applies them when a page returns from the
    // back/forward cache.
    (function (root) {
      root.classList.add('js');
      try {
        var t = localStorage.getItem('eddy-site.theme');
        if (t === 'light' || t === 'dark') root.dataset.theme = t;
        if (localStorage.getItem('eddy-site.nav') === 'collapsed') root.classList.add('nav-collapsed');
      } catch (e) {}
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta && root.dataset.theme === 'light') meta.content = meta.dataset.light;
    })(document.documentElement);
  </script>
  <script type="module" src="${asset('js/main.js')}"></script>
</head>
<body class="page-${page.id}">
  <a class="skip-link" href="#content">Skip to content</a>

  <header class="topbar">
    <div class="topbar-start">
      <button class="icon-btn nav-toggle" type="button" aria-controls="site-nav" aria-expanded="true" aria-label="Collapse navigation" data-tooltip>
        ${icon('menu', 'icon nav-toggle-collapsed')}${icon('close', 'icon nav-toggle-expanded')}
      </button>
      <a class="brand" href="${href(prefix, home.path)}" aria-label="${escape(config.name)} home">
        ${mark('mark brand-mark')}<span class="brand-name">${escape(config.name)}</span>
      </a>
    </div>
    <div class="topbar-end">
      <span class="pill pill-warning" title="Eddy has not been published to any extension store">Not released</span>
      <button class="icon-btn theme-toggle" type="button" aria-pressed="false" aria-label="Light theme" data-tooltip>
        ${icon('sun', 'icon theme-icon-sun')}${icon('moon', 'icon theme-icon-moon')}
      </button>
    </div>
  </header>

  <div class="shell">
    <aside class="rail">${sideNav(page, prefix)}
    </aside>

    <div class="panel">
      <main id="content" class="page" tabindex="-1">
${body}
      </main>
${footer()}
    </div>
  </div>
${mobileNav(page, prefix)}
</body>
</html>
`;
}
