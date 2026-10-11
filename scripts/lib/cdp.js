// Minimal Chrome DevTools Protocol client for the browser test. Dependency-free: Node's built-in WebSocket.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** A Chromium binary: $BROWSER, else Playwright's Chrome for Testing, else installed Chrome/Brave/Chromium. */
export function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER;
  const cache = process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright') : join(homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const rel of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux64/chrome',
        'chrome-linux/chrome',
      ]) {
        if (existsSync(join(cache, dir, rel))) return join(cache, dir, rel);
      }
    }
  }
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Session(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  waitFor(predicate, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Timed out waiting for a browser event'));
      }, timeout);
      const off = this.on((msg) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          off();
          resolve(msg);
        }
      });
    });
  }

  close() {
    this.ws.close();
  }
}

/** Launch a headless browser with a throwaway profile. Returns { browser: Session, close() }. */
export async function launch(binary) {
  const profile = mkdtempSync(join(tmpdir(), 'eddy-site-browser-'));
  const proc = spawn(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) {
    proc.kill();
    throw new Error('Browser did not start');
  }
  await sleep(100);
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const browser = await Session.connect(`ws://127.0.0.1:${port}${path}`);

  return {
    browser,
    async close() {
      try {
        await browser.send('Browser.close');
      } catch {
        proc.kill();
      }
      browser.close();
      await sleep(300);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** A page target attached in flat mode, with helpers. */
export async function openPage(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const events = (fn) => browser.on((msg) => msg.sessionId === sessionId && fn(msg));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable');

  return {
    targetId,
    send,
    events,
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`Evaluation failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    async goto(url) {
      const loaded = browser.waitFor((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired', 15000);
      await send('Page.navigate', { url });
      await loaded;
      await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    },
    async waitForLoad(action) {
      const loaded = browser.waitFor((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired', 15000);
      await action();
      await loaded;
    },
    async viewport(width, height, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    },
    async key(key, code = key, keyCode = 0) {
      const base = { key, code, windowsVirtualKeyCode: keyCode };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    /** Centre of an element in viewport coordinates (scrolled into view first). */
    async point(selector) {
      const box = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`No element for ${selector}`);
      return box;
    },
    async hover(selector) {
      const { x, y } = await this.point(selector);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    },
    async mouseTo(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    },
    async tap(selector) {
      const { x, y } = await this.point(selector);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    /** Emulate media features, e.g. [{ name: 'prefers-reduced-motion', value: 'reduce' }]; [] resets. */
    async media(features) {
      await send('Emulation.setEmulatedMedia', { features });
    },
    /** Wait until every running CSS animation/transition and view transition on the page has finished. */
    async settle(timeout = 3000) {
      await this.eval(`Promise.race([
        (async () => { for (let i = 0; i < 5; i++) { await Promise.allSettled(document.getAnimations().map((a) => a.finished)); await new Promise((r) => requestAnimationFrame(() => r())); } })(),
        new Promise((r) => setTimeout(r, ${timeout})),
      ])`);
    },
    async click(selector) {
      const box = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`No element for ${selector}`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      }
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },
    close: () => browser.send('Target.closeTarget', { targetId }),
  };
}
