// Local server.
//   node scripts/serve.js          dev: renders pages from src/ on every request. Page fragments and assets
//                                  update on reload; restart after editing a .js module or site.config.js.
//   node scripts/serve.js --dist   serves the built dist/ folder as a static host would
// Options: --port=4600 (or PORT). Listens on 127.0.0.1 only.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, NOT_FOUND } from '../src/site.js';
import { renderPage } from '../src/layout.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

/** Resolve a URL path inside `base`, refusing anything that escapes it. */
function safeJoin(base, urlPath) {
  const p = normalize(join(base, urlPath));
  return p === base || p.startsWith(base.endsWith(sep) ? base : base + sep) ? p : null;
}

export async function startServer({ dist = false, port = 4600 } = {}) {
  const render = (urlPath) => {
    const page = PAGES.find((p) => p.path === urlPath);
    return page ? { status: 200, body: renderPage(page) } : { status: 404, body: renderPage(NOT_FOUND) };
  };

  const distDir = join(ROOT, 'dist');
  if (dist && !existsSync(distDir)) throw new Error('dist/ not found. Run `npm run build` first.');

  const server = createServer(async (req, res) => {
    try {
      let urlPath;
      try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      } catch {
        res.writeHead(400, { 'Content-Type': TYPES['.txt'] });
        return res.end('Bad request: malformed URL');
      }
      // Pages use relative links, so a directory must be requested with its trailing slash (as static hosts do).
      const redirect = (to) => {
        res.writeHead(301, { Location: to });
        res.end();
      };
      const send = (status, body, type) => {
        // Dev never caches. --dist behaves like a typical static host (revalidate, but allow the
        // back/forward cache, which `no-store` would disable), so browser tests see real-world behaviour.
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': dist ? 'no-cache' : 'no-store' });
        res.end(body);
      };

      // Static files: assets in dev, everything in --dist.
      const base = dist ? distDir : join(ROOT, 'src');
      if (dist || urlPath.startsWith('/assets/')) {
        let file = safeJoin(base, urlPath);
        if (file && existsSync(file) && statSync(file).isDirectory()) {
          if (!urlPath.endsWith('/')) return redirect(encodeURI(`${urlPath}/`));
          file = join(file, 'index.html');
        }
        if (file && existsSync(file)) return send(200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
        if (dist) return send(404, readFileSync(join(distDir, '404.html')), TYPES['.html']);
        return send(404, 'Not found', TYPES['.txt']);
      }

      if (!urlPath.endsWith('/') && PAGES.some((p) => p.path === `${urlPath}/`)) return redirect(encodeURI(`${urlPath}/`));
      const { status, body } = render(urlPath);
      send(status, body, TYPES['.html']);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': TYPES['.txt'] });
      res.end(`Server error: ${err.message}`);
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv.includes('--dist');
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const port = Number(portArg?.slice(7) ?? process.env.PORT ?? 4600);
  const server = await startServer({ dist, port });
  console.log(`Eddy site (${dist ? 'dist' : 'dev'}) → http://127.0.0.1:${server.address().port}/`);
}
