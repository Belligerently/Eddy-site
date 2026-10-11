// Real-browser test of the built site (headless Chromium over CDP; no dependencies).
//   npm run test:browser          builds dist/, serves it on 127.0.0.1 and runs every check
//   BROWSER=/path/to/chrome npm run test:browser
// Screenshots of every page at every viewport (dark and light) go to .smoke/ (git-ignored) for visual review.
//
// Covers: every route at five viewports (no overflow, console errors, failed or third-party requests, layout
// shift; the right navigation and current page); navigation by sidebar, tab bar, cards and keyboard; focus never
// hidden behind the sticky top bar or the mobile tab bar; the sidebar toggle and its animation; the tooltip
// (mouse, keyboard, touch, Escape); the theme toggle and theme-color; rounded corners and clipping; the section
// reveal, page transitions and reduced motion; controls responding during animations; the site without
// JavaScript; preferences after the back/forward cache; the Ko-fi link; the 404 page.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../site.config.js';
import { PAGES } from '../src/site.js';
import { build } from './build.js';
import { startServer } from './serve.js';
import { findBrowser, launch, openPage } from './lib/cdp.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, '.smoke');

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1100', width: 1100, height: 800 },
  { name: 'tablet-800', width: 800, height: 1024, mobile: true },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
  { name: 'mobile-320', width: 320, height: 640, mobile: true },
];
const DESKTOP = VIEWPORTS[0];
const PHONE = VIEWPORTS[3];
const REDUCED = [{ name: 'prefers-reduced-motion', value: 'reduce' }];

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotName = (prefix, path) => `${prefix}${path === '/' ? '-home' : path.replace(/\//g, '-').replace(/-$/, '')}.png`;

const binary = findBrowser();
if (!binary) {
  console.error('No Chromium browser found. Set BROWSER=/path/to/chrome (or install Chrome for Testing via Playwright).');
  process.exit(1);
}

build();
const server = await startServer({ dist: true, port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const { browser, close } = await launch(binary);
rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
console.log(`Browser: ${binary}\nSite: ${origin}\n`);

try {
  const page = await openPage(browser);
  const view = (vp) => page.viewport(vp.width, vp.height, vp.mobile);
  const tooltip = () =>
    page.eval(`(() => { const t = document.querySelector('.tooltip'); if (!t || t.hidden) return null; const r = t.getBoundingClientRect(); return { text: t.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, cy: r.top + r.height / 2, radius: getComputedStyle(t).borderRadius, pe: getComputedStyle(t).pointerEvents }; })()`);

  // Instrumentation in every document: layout shifts, page-transition use, back/forward-cache restores.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__shifts = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ value: e.value, input: e.hadRecentInput }); }).observe({ type: 'layout-shift', buffered: true }); } catch {}
      window.__indicatorSlid = false;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const anim = animate.apply(this, args);
        if (this.matches('.nav-indicator, .tab-indicator')) {
          window.__indicatorSlid = true;
          const pauseAt = sessionStorage.getItem('test:pauseIndicatorAt');
          if (pauseAt !== null) { anim.pause(); anim.currentTime = Number(pauseAt); }
        }
        return anim;
      };
      try { new PerformanceObserver((l) => { if (l.getEntries().length && window.__pendingAtFirstPaint === undefined) { const i = document.querySelector('.nav-indicator, .tab-indicator'); window.__pendingAtFirstPaint = document.documentElement.classList.contains('indicator-pending') && !!i && getComputedStyle(i).visibility === 'hidden'; } }).observe({ type: 'paint', buffered: true }); } catch {}
      addEventListener('pageshow', (e) => { window.__persisted = e.persisted; });
    `,
  });

  // Problems collected per navigation.
  let log = [];
  page.events((m) => {
    if (m.method === 'Runtime.exceptionThrown') log.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) log.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') log.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) log.push(`request failed: ${m.params.errorText}`);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) log.push(`HTTP ${m.params.response.status}: ${m.params.response.url}`);
    if (m.method === 'Network.requestWillBeSent' && !m.params.request.url.startsWith(origin) && !m.params.request.url.startsWith('data:')) log.push(`third-party request: ${m.params.request.url}`);
  });

  // ---------------------------------------------------------------------------------------------------
  console.log('Routes × viewports (dark)');
  for (const vp of VIEWPORTS) {
    await view(vp);
    for (const p of PAGES) {
      await check(`${vp.name} ${p.path}`, async () => {
        log = [];
        await page.goto(origin + p.path);
        await page.settle();
        const r = await page.eval(`(() => {
          const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
          const rail = document.querySelector('.side-nav');
          const tabs = document.querySelector('.tab-bar');
          const nav = visible(rail) ? rail : visible(tabs) ? tabs : null;
          const current = nav ? [...nav.querySelectorAll('[aria-current="page"]')] : [];
          // body has overflow-x: clip, so measure elements rather than the document's scroll width.
          const offenders = [...document.querySelectorAll('body *')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 0.5 || b.left < -0.5) && !el.closest('.sr-only, .skip-link, .tooltip'); }).slice(0, 3).map((el) => el.tagName + '.' + el.className);
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth,
            offenders,
            railVisible: visible(rail),
            tabsVisible: visible(tabs),
            current: current.map((a) => new URL(a.href).pathname),
            indicator: nav ? nav.querySelectorAll('.nav-indicator, .tab-indicator').length : 0,
            font: [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Figtree' && f.status === 'loaded'),
            h1: document.querySelectorAll('h1').length,
            title: document.title,
            shifts: window.__shifts.filter((s) => !s.input).reduce((a, s) => a + s.value, 0),
            ready: document.documentElement.classList.contains('js-ready'),
          };
        })()`);
        assert(r.scrollWidth <= r.innerWidth && r.offenders.length === 0, `horizontal overflow (${r.scrollWidth}/${r.innerWidth}): ${r.offenders.join(', ')}`);
        assert(vp.width > 800 ? r.railVisible && !r.tabsVisible : r.tabsVisible && !r.railVisible, `wrong navigation visible (rail ${r.railVisible}, tabs ${r.tabsVisible})`);
        assert(r.current.length === 1 && r.current[0] === p.path && r.indicator === 1, `current page marker: ${JSON.stringify(r.current)}, indicators ${r.indicator}`);
        assert(r.font, 'Figtree did not load');
        assert(r.h1 === 1, `expected one h1, found ${r.h1}`);
        assert(r.title === p.title, `title "${r.title}"`);
        assert(r.shifts === 0, `layout shift ${r.shifts.toFixed(4)} on load`);
        assert(r.ready, 'main.js did not finish initialising');
        assert(log.length === 0, log.join('; '));
        writeFileSync(join(SHOTS, shotName(vp.name, p.path)), await page.screenshot());
      });
    }
  }

  // ---------------------------------------------------------------------------------------------------
  console.log('\nRounded corners');
  await view(DESKTOP);
  await check('desktop: Vortex radii on panel, cards, rows, tables, controls, nav, pills, banners, code', async () => {
    const expect = { '.panel': '12px', '.card': '16px', '.rows': '16px', '.btn': '8px', '.icon-btn': '8px', '.nav-link': '8px', '.nav-indicator': '8px', '.pill': '999px', '.banner': '12px', '.footer-link': '8px', '.skip-link': '8px', 'code': '4px', '.brand': '8px' };
    await page.goto(origin + '/');
    const got = await page.eval(`(${JSON.stringify(Object.keys(expect))}).reduce((o, s) => { const el = document.querySelector(s); o[s] = el && getComputedStyle(el).borderTopLeftRadius; return o; }, {})`);
    for (const [s, v] of Object.entries(expect)) assert(got[s] === v, `${s}: ${got[s]}, expected ${v}`);
    await page.goto(origin + '/features/');
    const table = await page.eval(`getComputedStyle(document.querySelector('.table-wrap')).borderTopLeftRadius`);
    assert(table === '16px', `.table-wrap ${table}`);
    await page.goto(origin + '/get-eddy/');
    const empty = await page.eval(`[getComputedStyle(document.querySelector('.empty')).borderRadius, getComputedStyle(document.querySelector('.empty-icon')).borderRadius]`);
    assert(empty[0] === '16px' && empty[1] === '12px', `empty ${empty}`);
  });
  await check('rounded containers clip their content; no text overflows a control', async () => {
    for (const p of PAGES) {
      await page.goto(origin + p.path);
      const bad = await page.eval(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('.card, .rows, .table-wrap, .banner, .btn, .pill, .nav-link, .footer-link, .empty')) {
          const s = getComputedStyle(el);
          if (['.card', '.rows', '.table-wrap'].some((c) => el.matches(c)) && !['hidden', 'auto', 'clip'].includes(s.overflowX)) out.push('no clip: ' + el.className);
          if (el.scrollWidth > el.clientWidth + 1 && !el.matches('.table-wrap')) out.push('overflow: ' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth);
        }
        return out;
      })()`);
      assert(bad.length === 0, `${p.path}: ${bad.join('; ')}`);
    }
  });
  await view(PHONE);
  await check('mobile: pill tab bar with concentric item radius; the panel dissolves (no radius, border)', async () => {
    await page.goto(origin + '/');
    const r = await page.eval(`(() => {
      const bar = document.querySelector('.tab-bar'), link = document.querySelector('.tab-link'), panel = document.querySelector('.panel');
      const b = getComputedStyle(bar), l = getComputedStyle(link), p = getComputedStyle(panel);
      return { barH: bar.getBoundingClientRect().height, barR: parseFloat(b.borderTopLeftRadius), linkR: parseFloat(l.borderTopLeftRadius), pad: parseFloat(b.paddingTop), border: parseFloat(b.borderTopWidth), panelR: p.borderTopLeftRadius, panelB: p.borderTopWidth };
    })()`);
    assert(Math.abs(r.barR - r.barH / 2) < 0.5, `bar radius ${r.barR} vs height ${r.barH}`);
    assert(Math.abs(r.linkR - (r.barR - r.pad - r.border)) < 0.5, `item radius ${r.linkR} not concentric`);
    assert(r.panelR === '0px' && r.panelB === '0px', `panel ${r.panelR} ${r.panelB}`);
  });

  // ---------------------------------------------------------------------------------------------------
  console.log('\nNavigation');
  await view(DESKTOP);
  await page.goto(origin + '/');
  for (const p of PAGES.slice(1)) {
    await check(`sidebar link "${p.label}" opens ${p.path}; the current-page fill slides over`, async () => {
      await page.waitForLoad(() => page.click(`.side-nav a[href$="${p.path.slice(1)}"]`));
      const r = await page.eval(`({ path: location.pathname, slid: window.__indicatorSlid })`);
      assert(r.path === p.path, `landed on ${r.path}`);
      assert(r.slid === true, 'the indicator did not animate');
    });
  }
  await check('brand link returns home', async () => {
    await page.waitForLoad(() => page.click('.brand'));
    assert((await page.eval('location.pathname')) === '/', 'not home');
  });
  await check('the new page responds at once, while the indicator is still sliding', async () => {
    await page.goto(origin + '/');
    await page.waitForLoad(() => page.click('.side-nav a[href$="values/"]'));
    await page.waitForLoad(() => page.click('.side-nav a[href$="privacy/"]')); // immediately, mid-transition
    assert((await page.eval('location.pathname')) === '/privacy/', 'second navigation lost');
  });
  await check('home cards link to their feature, which is highlighted below the sticky top bar', async () => {
    await page.goto(origin + '/');
    await page.settle();
    await page.hover('.card-link');
    await page.settle();
    const hover = await page.eval(`getComputedStyle(document.querySelector('.card-link')).borderTopColor`);
    const strong = await page.eval(`getComputedStyle(document.querySelector('.rows') || document.body).getPropertyValue('--color-border-strong')`);
    assert(hover === 'rgb(51, 51, 74)', `card hover border ${hover} (${strong})`);
    await page.waitForLoad(() => page.click('.card-link'));
    await page.settle();
    const r = await page.eval(`(() => { const row = document.querySelector(':target'); return { url: location.pathname + location.hash, id: row?.id, top: row?.getBoundingClientRect().top, anim: row && getComputedStyle(row, '::before').animationName, bar: document.querySelector('.topbar').getBoundingClientRect().bottom }; })()`);
    assert(r.url === '/features/#catalog-worth' && r.id === 'catalog-worth', JSON.stringify(r));
    assert(r.top >= r.bar, `target row under the sticky top bar: ${r.top} < ${r.bar}`);
    assert(r.anim === 'highlight-fade', `highlight ${r.anim}`);
  });
  await check('the top bar stays in view while scrolling (sticky, like Vortex)', async () => {
    await page.goto(origin + '/features/');
    await page.eval('window.scrollTo(0, 600)');
    const top = await page.eval(`document.querySelector('.topbar').getBoundingClientRect().top`);
    assert(top === 0, `top bar at ${top}`);
  });

  await view(PHONE);
  await page.goto(origin + '/');
  await check('mobile tab bar: every page, ≥44px targets, inside the viewport', async () => {
    const r = await page.eval(`(() => {
      const bar = document.querySelector('.tab-bar').getBoundingClientRect();
      const links = [...document.querySelectorAll('.tab-link')].map((a) => { const b = a.getBoundingClientRect(); return { w: b.width, h: b.height }; });
      return { bar: { left: bar.left, right: bar.right, bottom: bar.bottom }, links, innerWidth, innerHeight };
    })()`);
    assert(r.links.length === PAGES.length, `${r.links.length} tab links`);
    assert(r.links.every((l) => l.h >= 44 && l.w >= 44), `small target: ${JSON.stringify(r.links)}`);
    assert(r.bar.left >= 0 && r.bar.right <= r.innerWidth && r.bar.bottom <= r.innerHeight, `bar outside viewport: ${JSON.stringify(r.bar)}`);
  });
  await check('mobile tab bar navigates by touch; the fill slides across the bar', async () => {
    await page.waitForLoad(() => page.tap('.tab-link[href$="privacy/"]'));
    const r = await page.eval(`({ path: location.pathname, slid: window.__indicatorSlid })`);
    assert(r.path === '/privacy/' && r.slid === true, JSON.stringify(r));
  });
  await check('mobile: footer and last content stay clear of the tab bar', async () => {
    await page.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
    const r = await page.eval(`({ metaBottom: document.querySelector('.footer-meta').getBoundingClientRect().bottom, barTop: document.querySelector('.tab-bar').getBoundingClientRect().top })`);
    assert(r.metaBottom <= r.barTop, `footer hidden behind the tab bar: ${JSON.stringify(r)}`);
  });

  // ---------------------------------------------------------------------------------------------------
  console.log('\nKeyboard and focus');
  const tabThrough = async (key, until, limit = 60) => {
    const seen = [];
    for (let i = 0; i < limit; i++) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: key === 'back' ? 8 : 0 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: key === 'back' ? 8 : 0 });
      const f = await page.eval(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const bar = document.querySelector('.tab-bar'), top = document.querySelector('.topbar');
        const barR = getComputedStyle(bar).display === 'none' ? null : bar.getBoundingClientRect();
        const topR = getComputedStyle(top).position === 'sticky' ? top.getBoundingClientRect() : null;
        return {
          name: (el.className || el.tagName) + ' ' + (el.textContent || '').trim().slice(0, 24),
          inChrome: !!el.closest('.tab-bar, .topbar, .side-nav, .skip-link'),
          inBar: !!el.closest('.tab-bar'),
          underBar: !!barR && r.bottom > barR.top + 1 && r.top < barR.bottom,
          underTop: !!topR && r.top < topR.bottom - 1 && r.bottom > topR.top,
        };
      })()`);
      if (!f) continue;
      seen.push(f);
      if (until(f)) break;
    }
    return seen;
  };
  for (const vp of [PHONE, VIEWPORTS[4]]) {
    await view(vp);
    await check(`${vp.name}: no focused element is hidden behind the tab bar (WCAG 2.4.11)`, async () => {
      for (const p of PAGES) {
        await page.goto(origin + p.path);
        await page.settle();
        const seen = await tabThrough('forward', (f) => f.inBar);
        const hidden = seen.filter((f) => !f.inChrome && f.underBar);
        assert(hidden.length === 0, `${p.path}: ${hidden.map((f) => f.name).join(', ')}`);
      }
    });
  }
  await view(DESKTOP);
  await check('desktop: tabbing backwards never leaves focus under the sticky top bar', async () => {
    for (const p of PAGES) {
      await page.goto(origin + p.path);
      await page.settle();
      await page.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
      await page.eval(`document.querySelector('.kofi-link').focus()`);
      const seen = await tabThrough('back', (f) => f.inChrome);
      const hidden = seen.filter((f) => !f.inChrome && f.underTop);
      assert(hidden.length === 0, `${p.path}: ${hidden.map((f) => f.name).join(', ')}`);
    }
  });
  await page.goto(origin + '/values/');
  await check('first Tab reveals the skip link; Enter moves focus to the content', async () => {
    await page.key('Tab', 'Tab', 9);
    await page.settle();
    const r = await page.eval(`(() => { const el = document.activeElement; const b = el.getBoundingClientRect(); return { cls: el.className, top: b.top, opacity: getComputedStyle(el).opacity }; })()`);
    assert(r.cls === 'skip-link' && r.top >= 0 && r.opacity === '1', JSON.stringify(r));
    await page.key('Enter', 'Enter', 13);
    assert((await page.eval('document.activeElement.id')) === 'content', 'focus did not move to #content');
  });
  await check('Tab order: skip link, toggle, brand, theme, then every sidebar link', async () => {
    await page.goto(origin + '/values/');
    const order = [];
    for (let i = 0; i < 4 + PAGES.length; i++) {
      await page.key('Tab', 'Tab', 9);
      order.push(await page.eval(`(() => { const el = document.activeElement; return el.closest('.side-nav') ? 'nav:' + new URL(el.href).pathname : el.className.split(' ').pop(); })()`));
    }
    const expected = ['skip-link', 'nav-toggle', 'brand', 'theme-toggle', ...PAGES.map((p) => `nav:${p.path}`)];
    assert(JSON.stringify(order) === JSON.stringify(expected), `order ${JSON.stringify(order)}`);
  });
  await check('focused sidebar link shows the focus ring', async () => {
    const style = await page.eval(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; })()`);
    assert(style === 'solid 2px', style);
  });
  await check('a focused card shows one ring around the whole card', async () => {
    await page.goto(origin + '/');
    await page.eval(`document.querySelector('.card-cover').focus({ focusVisible: true })`);
    const r = await page.eval(`({ card: getComputedStyle(document.querySelector('.card-link')).outlineStyle, link: getComputedStyle(document.querySelector('.card-cover')).outlineStyle })`);
    assert(r.card === 'solid' && r.link === 'none', JSON.stringify(r));
  });

  // ---------------------------------------------------------------------------------------------------
  console.log('\nSidebar and tooltips');
  await page.goto(origin + '/features/');
  await check('collapse animates the rail (300ms) to 40px; labels fade but stay named', async () => {
    await page.click('.nav-toggle');
    await sleep(90);
    const mid = await page.eval(`document.querySelector('.rail').getBoundingClientRect().width`);
    await page.settle();
    const r = await page.eval(`(() => {
      const t = document.querySelector('.nav-toggle');
      const link = document.querySelector('.side-nav a[href$="privacy/"]');
      return { collapsed: document.documentElement.classList.contains('nav-collapsed'), expanded: t.getAttribute('aria-expanded'), name: t.getAttribute('aria-label'), rail: document.querySelector('.rail').getBoundingClientRect().width, labelOpacity: getComputedStyle(link.querySelector('.nav-label')).opacity, labelDisplay: getComputedStyle(link.querySelector('.nav-label')).display, linkName: link.textContent.trim() };
    })()`);
    assert(mid > 40 && mid < 200, `no width animation (mid-way width ${mid})`);
    assert(r.collapsed && r.expanded === 'false' && r.name === 'Expand navigation', JSON.stringify(r));
    assert(r.rail === 40, `rail width ${r.rail}`);
    assert(r.labelOpacity === '0' && r.labelDisplay !== 'none' && r.linkName === 'Privacy', JSON.stringify(r));
  });
  await check('collapsed: hovering a link shows its tooltip beside the rail; leaving hides it', async () => {
    await page.hover('.side-nav a[href$="privacy/"]');
    await page.settle();
    const t = await tooltip();
    const link = await page.eval(`(() => { const r = document.querySelector('.side-nav a[href$="privacy/"]').getBoundingClientRect(); return { right: r.right, cy: r.top + r.height / 2 }; })()`);
    assert(t && t.text === 'Privacy', `tooltip ${JSON.stringify(t)}`);
    assert(t.left > link.right && Math.abs(t.cy - link.cy) <= 1, `position ${JSON.stringify({ t, link })}`);
    assert(t.radius === '6px' && t.pe === 'none', `style ${t.radius} ${t.pe}`);
    writeFileSync(join(SHOTS, 'desktop-1440-features-collapsed-tooltip.png'), await page.screenshot());
    await page.mouseTo(900, 500);
    await page.settle();
    assert((await tooltip()) === null, 'tooltip stayed after the pointer left');
  });
  await check('collapsed: keyboard focus shows the tooltip; Escape dismisses it', async () => {
    await page.eval(`document.querySelector('.side-nav a[href$="values/"]').focus({ focusVisible: true })`);
    let t = await tooltip();
    if (!t) {
      // Some Chromium builds ignore focusVisible for programmatic focus; reach it with the keyboard instead.
      await page.eval(`document.querySelector('.side-nav a[href$="features/"]').focus()`);
      await page.key('Tab', 'Tab', 9);
      t = await tooltip();
    }
    assert(t && t.text === 'Values', `tooltip ${JSON.stringify(t)}`);
    await page.key('Escape', 'Escape', 27);
    await page.settle();
    assert((await tooltip()) === null, 'Escape did not dismiss the tooltip');
  });
  await check('a link stays clickable while the rail animates', async () => {
    await page.click('.nav-toggle'); // expanding (300ms)
    await page.waitForLoad(() => page.click('.side-nav a[href$="get-eddy/"]'));
    assert((await page.eval('location.pathname')) === '/get-eddy/', 'click during the animation was lost');
  });
  await check('expanded: no tooltip on sidebar links; icon buttons get one below, inside the viewport', async () => {
    await page.settle();
    await page.hover('.side-nav a[href$="values/"]');
    await page.settle();
    assert((await tooltip()) === null, 'tooltip shown on an expanded link');
    await page.hover('.theme-toggle');
    await page.settle();
    const t = await tooltip();
    const btn = await page.eval(`document.querySelector('.theme-toggle').getBoundingClientRect().bottom`);
    assert(t && t.text === 'Light theme' && t.top > btn && t.right <= 1440 - 8 + 0.5, `tooltip ${JSON.stringify(t)}`);
  });
  await check('rapid double toggle ends consistent (state, name, width)', async () => {
    await page.goto(origin + '/');
    await page.click('.nav-toggle');
    await page.click('.nav-toggle');
    await page.settle();
    const r = await page.eval(`({ c: document.documentElement.classList.contains('nav-collapsed'), e: document.querySelector('.nav-toggle').getAttribute('aria-expanded'), w: document.querySelector('.rail').getBoundingClientRect().width })`);
    assert(!r.c && r.e === 'true' && r.w === 200, JSON.stringify(r));
  });
  await check('collapsed state persists across pages; no rail animation on page load', async () => {
    await page.click('.nav-toggle');
    await page.settle();
    await page.goto(origin + '/values/');
    const r = await page.eval(`({ c: document.documentElement.classList.contains('nav-collapsed'), w: document.querySelector('.rail').getBoundingClientRect().width, running: document.getAnimations().filter((a) => a.transitionProperty === 'grid-template-columns').length })`);
    assert(r.c && r.w === 40 && r.running === 0, JSON.stringify(r));
    await page.click('.nav-toggle');
    await page.settle();
  });

  // ---------------------------------------------------------------------------------------------------
  console.log('\nTheme');
  await check('theme toggle switches to light at once, updates theme-color, persists, and switches back', async () => {
    await page.goto(origin + '/');
    const before = await page.eval(`getComputedStyle(document.body).backgroundColor`);
    await page.click('.theme-toggle');
    await page.settle();
    const r = await page.eval(`({ theme: document.documentElement.dataset.theme, pressed: document.querySelector('.theme-toggle').getAttribute('aria-pressed'), bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name=theme-color]').content })`);
    assert(before === 'rgb(18, 11, 27)', `dark shell ${before}`);
    assert(r.theme === 'light' && r.pressed === 'true' && r.bg === 'rgb(239, 234, 245)' && r.meta === '#efeaf5', JSON.stringify(r));
    await page.goto(origin + '/features/');
    const again = await page.eval(`({ theme: document.documentElement.dataset.theme, meta: document.querySelector('meta[name=theme-color]').content })`);
    assert(again.theme === 'light' && again.meta === '#efeaf5', `not remembered: ${JSON.stringify(again)}`);
    for (const vp of [DESKTOP, PHONE]) {
      await view(vp);
      for (const p of PAGES) {
        await page.goto(origin + p.path);
        await page.settle();
        writeFileSync(join(SHOTS, shotName(`light-${vp.name}`, p.path)), await page.screenshot());
      }
    }
    await view(DESKTOP);
    await page.click('.theme-toggle');
    await page.settle();
    const back = await page.eval(`({ theme: document.documentElement.dataset.theme, meta: document.querySelector('meta[name=theme-color]').content })`);
    assert(back.theme === 'dark' && back.meta === '#120b1b', JSON.stringify(back));
  });
  await check('mobile: tapping the theme button switches theme and shows no tooltip', async () => {
    await view(PHONE);
    await page.goto(origin + '/');
    await page.tap('.theme-toggle');
    await page.settle();
    const r = await page.eval(`document.documentElement.dataset.theme`);
    assert(r === 'light', r);
    assert((await tooltip()) === null, 'touch opened a tooltip');
    await page.tap('.theme-toggle');
    await page.settle();
    await view(DESKTOP);
  });

  // ---------------------------------------------------------------------------------------------------
  console.log('\nMotion');
  await check('sections reveal (500ms fade-up, staggered); only opacity/translate animate', async () => {
    await page.goto(origin + '/features/');
    const r = await page.eval(`[...document.querySelectorAll('.page > *')].map((el) => { const s = getComputedStyle(el); return [s.animationName, s.animationDuration, s.animationDelay]; })`);
    assert(r.length > 1 && r.every(([n, d]) => n === 'reveal' && d === '0.5s'), JSON.stringify(r));
    assert(r[0][2] === '0s' && r[1][2] === '0.018s', `stagger ${JSON.stringify(r.map((x) => x[2]))}`);
  });
  await check('reduced motion: no reveal, no indicator slide, rail and theme change instantly', async () => {
    await page.media(REDUCED);
    await page.goto(origin + '/');
    const r = await page.eval(`({ anims: document.getAnimations().length, reveal: getComputedStyle(document.querySelector('.page > *')).animationName, shell: getComputedStyle(document.querySelector('.shell')).transitionDuration })`);
    assert(r.anims === 0 && r.reveal === 'none' && r.shell === '0s', JSON.stringify(r));
    await page.click('.nav-toggle');
    const w = await page.eval(`document.querySelector('.rail').getBoundingClientRect().width`);
    assert(w === 40, `rail animated under reduced motion (${w})`);
    await page.click('.nav-toggle');
    await page.waitForLoad(() => page.click('.side-nav a[href$="values/"]'));
    assert((await page.eval('window.__indicatorSlid')) === false, 'indicator animated under reduced motion');
    await page.click('.theme-toggle');
    const t = await page.eval(`({ theme: document.documentElement.dataset.theme, anims: document.getAnimations().length })`);
    assert(t.theme === 'light' && t.anims === 0, `theme ${JSON.stringify(t)}`);
    await page.click('.theme-toggle');
    await page.media([]);
  });
  await check('controls respond during animations: a click right after another always lands', async () => {
    await page.goto(origin + '/');
    await page.click('.theme-toggle');
    await page.click('.nav-toggle'); // while the toggle icons and the rail are animating
    const r = await page.eval(`({ theme: document.documentElement.dataset.theme, c: document.documentElement.classList.contains('nav-collapsed') })`);
    assert(r.theme === 'light' && r.c, `second click lost: ${JSON.stringify(r)}`);
    await page.click('.theme-toggle');
    await page.click('.nav-toggle');
    await page.settle();
  });
  await check('no layout shift when the theme changes', async () => {
    await page.goto(origin + '/privacy/');
    await page.settle();
    await page.click('.theme-toggle');
    await page.settle();
    await page.click('.theme-toggle');
    await page.settle();
    const shifts = await page.eval(`window.__shifts.filter((s) => !s.input).reduce((a, s) => a + s.value, 0)`);
    assert(shifts === 0, `unexpected layout shift ${shifts}`);
  });

  // ---------------------------------------------------------------------------------------------------

  // ---------------------------------------------------------------------------------------------------
  console.log('\nAnimation audit (regressions)');
  const transitions = (except = null) => page.eval(`document.getAnimations().filter((a) => a.constructor.name === 'CSSTransition' && !(${JSON.stringify(except)} && a.effect.target.matches(${JSON.stringify(except ?? '*')}))).map((a) => (a.effect.target.className?.baseVal ?? a.effect.target.className) + ':' + a.transitionProperty)`);
  const leftovers = () => page.eval(`({ arriving: document.querySelectorAll('.is-arriving').length, pending: document.documentElement.classList.contains('indicator-pending'), guard: ['no-transitions', 'theme-switching'].some((c) => document.documentElement.classList.contains(c)) })`);
  const sampleTop = async (x, y) => {
    await page.send('DOM.enable');
    const { backendNodeId } = await page.send('DOM.getNodeForLocation', { x, y, ignorePointerEventsNone: true });
    const { node } = await page.send('DOM.describeNode', { backendNodeId });
    const cls = node.attributes?.[node.attributes.indexOf('class') + 1] ?? '';
    return `${node.nodeName.toLowerCase()}.${cls}`;
  };
  // Each audit check starts from a known state, so one failure cannot leave another passing vacuously.
  const reset = async (vp = DESKTOP) => {
    await page.media([]);
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.send('Network.setBlockedURLs', { urls: [] });
    await view(DESKTOP);
    await page.goto(origin + '/');
    await page.eval(`localStorage.clear(); sessionStorage.clear()`);
    await view(vp);
    await page.goto(origin + '/');
    await page.mouseTo(700, 600);
    await page.settle();
  };
  const auditCheck = (name, fn, vp) => check(name, async () => { await reset(vp); await fn(); });

  await auditCheck('theme switch changes every colour in one frame (only the button icons animate)', async () => {
    await page.goto(origin + '/');
    await page.settle();
    await page.click('.theme-toggle');
    const others = await transitions('.theme-toggle > .icon');
    const icons = await page.eval(`document.querySelector('.theme-toggle .theme-icon-moon').getAnimations().length`);
    assert(others.length === 0, `${others.length} elements fade separately: ${[...new Set(others)].slice(0, 5).join(', ')}`);
    assert(icons > 0, 'the button icon cross-fade was lost');
    await page.settle();
    await page.click('.theme-toggle');
    await page.settle();
    const left = await leftovers();
    assert(!left.guard, 'no-transitions guard left on');
  });
  await auditCheck('rapid theme toggling (7×) ends consistent with no stray transitions', async () => {
    await page.goto(origin + '/');
    for (let i = 0; i < 7; i++) await page.click('.theme-toggle');
    await page.settle();
    const r = await page.eval(`({ theme: document.documentElement.dataset.theme, pressed: document.querySelector('.theme-toggle').getAttribute('aria-pressed'), meta: document.querySelector('meta[name=theme-color]').content, sun: getComputedStyle(document.querySelector('.theme-icon-sun')).opacity, moon: getComputedStyle(document.querySelector('.theme-icon-moon')).opacity })`);
    assert(r.theme === 'light' && r.pressed === 'true' && r.meta === '#efeaf5' && r.sun === '0' && r.moon === '1', JSON.stringify(r));
    await page.click('.theme-toggle');
    await page.settle();
  });
  await auditCheck('rapid sidebar toggling (5×, then 4×) and mid-flight reversal end in clean states', async () => {
    await page.goto(origin + '/');
    const state = () => page.eval(`(() => { const l = getComputedStyle(document.querySelector('.nav-label')); return { c: document.documentElement.classList.contains('nav-collapsed'), e: document.querySelector('.nav-toggle').getAttribute('aria-expanded'), w: document.querySelector('.rail').getBoundingClientRect().width, label: l.opacity, shift: l.transform, line: getComputedStyle(document.querySelector('.nav-group-tools'), '::before').width }; })()`);
    for (let i = 0; i < 5; i++) await page.click('.nav-toggle');
    await page.settle();
    let r = await state();
    assert(r.c && r.e === 'false' && r.w === 40 && r.label === '0' && r.line === '24px', `after 5: ${JSON.stringify(r)}`);
    for (let i = 0; i < 4; i++) await page.click('.nav-toggle');
    await page.settle();
    r = await state();
    assert(r.c && r.w === 40, `after 9: ${JSON.stringify(r)}`);
    await page.click('.nav-toggle'); // expand…
    await sleep(100);
    await page.click('.nav-toggle'); // …and reverse mid-way
    await sleep(60);
    await page.click('.nav-toggle'); // …and again
    await page.settle();
    r = await state();
    assert(!r.c && r.e === 'true' && r.w === 200 && r.label === '1' && r.shift === 'none' && r.line === '184px', `after reversal: ${JSON.stringify(r)}`);
  });
  await auditCheck('resizing mid-animation snaps the rail to its end state (no stuck width)', async () => {
    await page.goto(origin + '/');
    await page.click('.nav-toggle');
    await sleep(60);
    await page.viewport(1300, 900);
    await page.settle();
    await sleep(200); // the resize guard clears 150ms after the last resize event
    const r = await page.eval(`({ w: document.querySelector('.rail').getBoundingClientRect().width, resizing: document.documentElement.classList.contains('is-resizing'), anims: document.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').length })`);
    assert(r.w === 40 && !r.resizing && r.anims === 0, JSON.stringify(r));
    await view(DESKTOP);
    await page.click('.nav-toggle');
    await page.settle();
  });
  await auditCheck('a rail tooltip requested mid-collapse appears beside the link once the rail settles', async () => {
    await page.goto(origin + '/');
    await page.click('.nav-toggle');
    const target = await page.eval(`(() => { const r = document.querySelector('.side-nav a[href$="privacy/"]').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
    await page.mouseTo(target.x, target.y); // the rail is still collapsing
    const early = await tooltip();
    await page.settle();
    const t = await tooltip();
    const link = await page.eval(`(() => { const r = document.querySelector('.side-nav a[href$="privacy/"]').getBoundingClientRect(); return { right: r.right, cy: r.top + r.height / 2 }; })()`);
    assert(early?.text !== 'Privacy', `link tooltip shown before the rail settled: ${JSON.stringify(early)}`);
    assert(t && t.text === 'Privacy' && Math.abs(t.left - (link.right + 12)) <= 1 && Math.abs(t.cy - link.cy) <= 1, `tooltip ${JSON.stringify(t)} vs link ${JSON.stringify(link)}`);
    await page.mouseTo(900, 500);
    await page.click('.nav-toggle');
    await page.settle();
  });
  await auditCheck('a keyboard-opened tooltip follows its control on resize, and closes when the control disappears', async () => {
    // Keyboard focus, not hover: with a mouse, the control moving away from the pointer already closes it.
    const focusByTab = async (selector) => {
      for (let i = 0; i < 12 && !(await page.eval(`document.activeElement.matches(${JSON.stringify(selector)})`)); i++) await page.key('Tab', 'Tab', 9);
      await page.settle();
    };
    await focusByTab('.theme-toggle');
    assert((await tooltip())?.text === 'Light theme', 'keyboard focus did not open the tooltip');
    await page.viewport(1100, 900);
    await sleep(100);
    const t = await tooltip();
    const b = await page.eval(`(() => { const r = document.querySelector('.theme-toggle').getBoundingClientRect(); return { cx: r.left + r.width / 2, bottom: r.bottom }; })()`);
    assert(t && Math.abs((t.left + t.right) / 2 - b.cx) <= 2 && t.top > b.bottom, `tooltip ${JSON.stringify(t)} left behind by button ${JSON.stringify(b)}`);
    await view(DESKTOP);
    await page.mouseTo(700, 600);
    await page.click('.nav-toggle'); // collapse, then focus a rail link and cross into the mobile layout
    await page.settle();
    await focusByTab('.side-nav a[href$="values/"]');
    assert((await tooltip())?.text === 'Values', 'rail tooltip did not open on focus');
    await page.viewport(600, 900, true);
    await sleep(300);
    assert((await tooltip()) === null, 'tooltip stayed after its link was hidden');
  });
  await auditCheck('a tooltip whose exit animation is cancelled (reduced motion switched on) still closes', async () => {
    await page.goto(origin + '/');
    await page.hover('.theme-toggle');
    await page.settle();
    await page.mouseTo(700, 500); // starts the 120ms exit
    await page.media(REDUCED); // removes the animation mid-way, without an animationend
    await sleep(300);
    const t = await page.eval(`(() => { const t = document.querySelector('.tooltip'); return { hidden: t.hidden, state: t.dataset.motionState }; })()`);
    await page.media([]);
    assert(t.hidden, `tooltip stuck visible: ${JSON.stringify(t)}`);
  });
  for (const [from, to, label] of [['/', 'privacy/', 'down'], ['/privacy/', null, 'up']]) {
    await auditCheck(`the sliding fill passes under the labels it crosses (moving ${label})`, async () => {
      await page.goto(origin + from);
      await page.eval(`sessionStorage.setItem('test:pauseIndicatorAt', '40')`);
      await page.waitForLoad(() => page.click(to ? `.side-nav a[href$="${to}"]` : '.side-nav li:first-child a'));
      const paused = await page.eval(`document.querySelector('.nav-indicator').getAnimations().map((a) => a.playState + '@' + a.currentTime).join()`);
      assert(paused === 'paused@40', `slide not paused mid-flight (${paused}), so this check would prove nothing`);
      const geo = await page.eval(`(() => { const i = document.querySelector('.nav-indicator').getBoundingClientRect(); const l = document.querySelector('.side-nav a[href$="values/"] .nav-label').getBoundingClientRect(); const top = Math.max(i.top, l.top), bottom = Math.min(i.bottom, l.bottom); return { x: Math.round(l.left + 6), y: Math.round((top + bottom) / 2), overlap: bottom - top }; })()`);
      await page.eval(`sessionStorage.removeItem('test:pauseIndicatorAt')`);
      assert(geo.overlap > 2, `the paused fill does not cross the Values label (${JSON.stringify(geo)})`);
      const topmost = await sampleTop(geo.x, geo.y);
      assert(topmost.startsWith('span.nav-label'), `${topmost} is painted over the Values label`);
    });
  }
  await auditCheck('slow network: the fill stays hidden until its slide starts (no jump), then lands', async () => {
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await page.goto(origin + '/');
      await page.waitForLoad(() => page.click('.side-nav a[href$="privacy/"]'));
      await sleep(400);
      const r = await page.eval(`({ hiddenAtFirstPaint: window.__pendingAtFirstPaint, slid: window.__indicatorSlid })`);
      assert(r.hiddenAtFirstPaint === true, `the fill was painted at its destination before the slide: ${JSON.stringify(r)}`);
      assert(r.slid === true, 'no slide');
    } finally {
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    await page.settle();
    const left = await leftovers();
    const vis = await page.eval(`getComputedStyle(document.querySelector('.nav-indicator')).visibility`);
    assert(!left.pending && left.arriving === 0 && vis === 'visible', JSON.stringify({ left, vis }));
  });
  await auditCheck('if the scripts never load, the hidden fill still appears (fallback)', async () => {
    await page.goto(origin + '/');
    await page.send('Network.setBlockedURLs', { urls: ['*/assets/js/*'] });
    try {
      log = [];
      await page.waitForLoad(() => page.click('.side-nav a[href$="values/"]'));
      await sleep(1700);
      const r = await page.eval(`({ pending: document.documentElement.classList.contains('indicator-pending'), vis: getComputedStyle(document.querySelector('.nav-indicator')).visibility })`);
      assert(!r.pending && r.vis === 'visible', JSON.stringify(r));
    } finally {
      await page.send('Network.setBlockedURLs', { urls: [] });
      log = [];
    }
  });
  await auditCheck('after any navigation, no element is left invisible, offset, or mid-state', async () => {
    for (const p of PAGES) {
      await page.goto(origin + '/');
      await page.waitForLoad(() => page.click(p.path === '/' ? '.brand' : `.side-nav a[href$="${p.path.slice(1)}"]`));
      await page.settle();
      const r = await page.eval(`(() => {
        const stuck = [...document.querySelectorAll('.page > *')].filter((el) => { const s = getComputedStyle(el); return s.opacity !== '1' || s.translate !== 'none'; }).map((el) => el.className || el.tagName);
        return { stuck, arriving: document.querySelectorAll('.is-arriving').length, pending: document.documentElement.classList.contains('indicator-pending'), running: document.getAnimations().filter((a) => a.playState === 'running').length };
      })()`);
      assert(r.stuck.length === 0 && r.arriving === 0 && !r.pending && r.running === 0, `${p.path}: ${JSON.stringify(r)}`);
    }
  });
  await auditCheck('touch: tapping leaves no sticky hover state (theme button, tab links)', async () => {
    await page.goto(origin + '/');
    await page.tap('.theme-toggle');
    await page.settle();
    const bg = await page.eval(`getComputedStyle(document.querySelector('.theme-toggle')).backgroundColor`);
    assert(bg === 'rgba(0, 0, 0, 0)', `theme button keeps a hover background after the tap: ${bg}`);
    await page.tap('.theme-toggle');
    await page.settle();
  }, PHONE);
  await auditCheck('mobile: the tab-bar fill slides under the labels and leaves nothing mid-state', async () => {
    await page.goto(origin + '/');
    await page.waitForLoad(() => page.tap('.tab-link[href$="get-eddy/"]'));
    await page.settle();
    const r = await page.eval(`({ slid: window.__indicatorSlid, z: [getComputedStyle(document.querySelector('.tab-indicator')).zIndex, getComputedStyle(document.querySelector('.tab-label')).zIndex], arriving: document.querySelectorAll('.is-arriving').length })`);
    assert(r.slid && r.z[0] === '0' && r.z[1] === '1' && r.arriving === 0, JSON.stringify(r));
  }, PHONE);
  await view(DESKTOP);

  console.log('\nResilience');
  await check('without JavaScript: content, navigation and links work; the toggles are hidden', async () => {
    // With scripts disabled the page's own JS never runs; the harness re-enables evaluation only to inspect.
    const loadWithoutJs = async (action) => {
      await page.send('Emulation.setScriptExecutionDisabled', { value: true });
      try {
        await page.waitForLoad(action);
      } finally {
        await page.send('Emulation.setScriptExecutionDisabled', { value: false });
      }
      await sleep(700); // CSS reveal (no JS involved) finishes
    };
    await loadWithoutJs(() => page.send('Page.navigate', { url: origin + '/' }));
    const r = await page.eval(`({ toggles: [...document.querySelectorAll('.nav-toggle, .theme-toggle')].map((b) => getComputedStyle(b).display), opacity: getComputedStyle(document.querySelector('.page > *')).opacity, cls: document.documentElement.className, ready: document.documentElement.classList.contains('js-ready') })`);
    assert(!r.ready && !r.cls.includes('js'), `scripts ran: ${JSON.stringify(r)}`);
    assert(r.toggles.every((d) => d === 'none') && r.opacity === '1', JSON.stringify(r));
    await loadWithoutJs(() => page.click('.side-nav a[href$="features/"]'));
    assert((await page.eval('location.pathname')) === '/features/', 'navigation failed without JS');
  });
  await check('back/forward cache: a restored page picks up the theme and sidebar changed meanwhile', async () => {
    await page.goto(origin + '/');
    await page.waitForLoad(() => page.click('.side-nav a[href$="values/"]'));
    await page.click('.theme-toggle');
    await page.click('.nav-toggle');
    await page.settle();
    const shown = browser.waitFor((m) => m.method === 'Page.frameNavigated' || m.method === 'Page.loadEventFired', 5000).catch(() => null);
    await page.eval('history.back()');
    await shown;
    // The link clicked before leaving was hovered then and is not now: its hover-out fade is real pointer
    // feedback, not the resync, so it is the one transition allowed here.
    const moving = await page.eval(`document.getAnimations().filter((a) => a.constructor.name === 'CSSTransition' && !(a.effect.target.matches('.side-nav a[href$="values/"]:not(:hover)') && a.transitionProperty === 'background-color')).map((a) => (a.effect.target.className?.baseVal ?? a.effect.target.className) + ':' + a.transitionProperty)`);
    assert(moving.length === 0, `the restored page animated from its stale state: ${moving.join(', ')}`);
    await sleep(300);
    const r = await page.eval(`({ path: location.pathname, persisted: window.__persisted, theme: document.documentElement.dataset.theme, pressed: document.querySelector('.theme-toggle').getAttribute('aria-pressed'), collapsed: document.documentElement.classList.contains('nav-collapsed'), expanded: document.querySelector('.nav-toggle').getAttribute('aria-expanded'), meta: document.querySelector('meta[name=theme-color]').content })`);
    assert(r.path === '/', `on ${r.path}`);
    assert(r.persisted === true, 'page was not restored from the back/forward cache, so this test proved nothing');
    assert(r.theme === 'light' && r.pressed === 'true' && r.meta === '#efeaf5', `theme stale: ${JSON.stringify(r)}`);
    assert(r.collapsed && r.expanded === 'false', `sidebar stale: ${JSON.stringify(r)}`);
    await page.click('.theme-toggle');
    await page.click('.nav-toggle');
    await page.settle();
  });
  await check('storage blocked: toggles still work for the page, without errors', async () => {
    log = [];
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.search === '?nostorage') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });` });
    await page.goto(origin + '/?nostorage');
    await page.click('.theme-toggle');
    await page.click('.nav-toggle');
    await page.settle();
    const r = await page.eval(`({ theme: document.documentElement.dataset.theme, c: document.documentElement.classList.contains('nav-collapsed') })`);
    assert(r.theme === 'light' && r.c, JSON.stringify(r));
    assert(log.length === 0, log.join('; '));
  });

  // ---------------------------------------------------------------------------------------------------
  console.log('\nKo-fi');
  await check('one footer link per page with the verified destination, new tab, no referrer or opener', async () => {
    for (const p of PAGES) {
      await page.goto(origin + p.path);
      const r = await page.eval(`(() => {
        const all = [...document.querySelectorAll('a[href*="ko-fi"]')];
        const a = all[0];
        return { count: all.length, href: a?.getAttribute('href'), target: a?.target, rel: a?.rel, inFooter: !!a?.closest('footer.site-footer'), text: a?.textContent.replace(/\\s+/g, ' ').trim() };
      })()`);
      assert(r.count === 1 && r.inFooter, `${p.path}: ${r.count} links, in footer ${r.inFooter}`);
      assert(r.href === config.kofiUrl && r.target === '_blank' && r.rel === 'noopener noreferrer', `${p.path}: ${JSON.stringify(r)}`);
      assert(r.text.startsWith('Support Eddy on Ko-fi'), `${p.path}: text "${r.text}"`);
    }
  });
  await check('clicking it opens ko-fi.com in a new tab; the site page stays put', async () => {
    await page.goto(origin + '/');
    await browser.send('Target.setDiscoverTargets', { discover: true });
    const created = browser.waitFor((m) => m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page' && m.params.targetInfo.targetId !== page.targetId, 10000);
    await page.click('.kofi-link');
    const { params } = await created;
    let url = params.targetInfo.url;
    for (let i = 0; i < 30 && !url.startsWith('https://ko-fi.com'); i++) {
      await sleep(100);
      const { targetInfos } = await browser.send('Target.getTargets');
      url = targetInfos.find((t) => t.targetId === params.targetInfo.targetId)?.url ?? url;
    }
    await browser.send('Target.closeTarget', { targetId: params.targetInfo.targetId });
    await browser.send('Target.setDiscoverTargets', { discover: false });
    assert(url.startsWith(config.kofiUrl), `new tab opened ${url}`);
    assert((await page.eval('location.pathname')) === '/', 'the site page navigated away');
  });

  console.log('\n404');
  await check('unknown path serves the 404 page with working links', async () => {
    log = [];
    await page.goto(origin + '/does/not/exist');
    const r = await page.eval(`({ h1: document.querySelector('h1')?.textContent, css: getComputedStyle(document.body).fontFamily, home: document.querySelector('.empty .btn')?.getAttribute('href'), ready: document.documentElement.classList.contains('js-ready') })`);
    assert(r.h1 === 'Page not found' && r.css.includes('Figtree') && r.home === '/' && r.ready, JSON.stringify(r));
    const other = log.filter((l) => !l.includes('/does/not/exist'));
    assert(other.length === 0, other.join('; '));
  });

  await page.close();
} finally {
  await close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: .smoke/`);
process.exit(failures.length ? 1 : 0);
