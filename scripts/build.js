// Production build: renders every page with the shared layout and copies the static assets.
//   node scripts/build.js              → dist/
//   node scripts/build.js --out=DIR    → DIR (used by the tests)
// The output is plain static files; any static host can serve it.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../site.config.js';
import { PAGES, NOT_FOUND, outputFile } from '../src/site.js';
import { renderPage } from '../src/layout.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function build(outDir = join(ROOT, 'dist')) {
  const out = resolve(outDir);
  // Only ever clears the build output folder inside this project (or a test's temporary folder).
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const files = [];
  for (const page of [...PAGES, NOT_FOUND]) {
    const file = join(out, outputFile(page));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderPage(page));
    files.push(outputFile(page));
  }
  cpSync(join(ROOT, 'src/assets'), join(out, 'assets'), { recursive: true });
  return { out, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv.find((a) => a.startsWith('--out='));
  const { out, files } = build(arg ? arg.slice(6) : undefined);
  if (!config.kofiUrl) console.warn('Warning: site.config.js kofiUrl is empty, so the Ko-fi link is hidden.');
  console.log(`Built ${files.length} pages → ${out}`);
  for (const f of files) console.log(`  ${f}`);
}
