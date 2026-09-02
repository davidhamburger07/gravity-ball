// package-crazygames.mjs — produce the folder that gets uploaded to CrazyGames.
//
// `npm run build` writes dist/, which is also what Vercel deploys (see vercel.json's
// outputDirectory). This script keeps that untouched and stages a separate, clearly named copy
// under builds/crazygames/ — so "the thing I upload" is a real folder on disk rather than a
// dist/ that the next Vercel build might have overwritten with something else.
//
// The gates run first on purpose. Packaging a build whose physics lock or campaign invariants are
// broken is exactly the mistake this repo is set up to prevent.
//
// Usage:  npm run package:crazygames
import { rm, mkdir, cp, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDir } from './zip-dir.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = resolve(ROOT, 'dist');
const OUT = resolve(ROOT, 'builds/crazygames');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

// dist/ must already exist — package.json runs the build ahead of this.
try {
  await stat(resolve(DIST, 'index.html'));
} catch {
  console.error('\n  dist/index.html is missing — run `npm run build` first.\n');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(DIST, OUT, { recursive: true });

const files = await walk(OUT);
const bytes = (await Promise.all(files.map(async (f) => (await stat(f)).size))).reduce((a, b) => a + b, 0);
const mb = bytes / (1024 * 1024);

// The platform's published ceilings, checked here so an oversized build is caught before upload.
const LIMITS = { totalMB: 250, initialMB: 50, mobileHomepageMB: 20, files: 1500 };
const problems = [];
if (mb > LIMITS.totalMB) problems.push(`total size ${mb.toFixed(1)} MB exceeds ${LIMITS.totalMB} MB`);
if (mb > LIMITS.initialMB) problems.push(`initial download ${mb.toFixed(1)} MB exceeds ${LIMITS.initialMB} MB`);
if (files.length > LIMITS.files) problems.push(`${files.length} files exceeds ${LIMITS.files}`);

console.log(`\n  builds/crazygames/ ready`);
for (const f of files.sort()) {
  const size = (await stat(f)).size;
  console.log(`    ${String((size / 1024).toFixed(1)).padStart(9)} KB  ${relative(OUT, f).replace(/\\/g, '/')}`);
}
console.log(`\n    ${files.length} files, ${mb.toFixed(2)} MB`);
console.log(`    limits: ${LIMITS.totalMB} MB total / ${LIMITS.initialMB} MB initial / ${LIMITS.files} files`);
if (mb <= LIMITS.mobileHomepageMB) {
  console.log(`    under ${LIMITS.mobileHomepageMB} MB, so it also qualifies for the mobile homepage.`);
}

if (problems.length) {
  console.error('\n  TOO BIG TO SUBMIT');
  for (const p of problems) console.error(`    - ${p}`);
  console.error('');
  process.exit(1);
}

// Produce the archive itself, so what gets uploaded is not left to a hand-made zip that might
// nest the folder one level too deep — index.html has to sit at the zip root.
const ZIP = resolve(ROOT, 'builds/gravity-ball-crazygames.zip');
const { files: zipped, bytes: zipBytes } = await zipDir(OUT, ZIP);
if (!zipped.includes('index.html')) {
  console.error('  index.html is not at the root of the archive - do not upload this.');
  process.exit(1);
}
console.log(`  builds/gravity-ball-crazygames.zip - ${zipped.length} entries, ${(zipBytes / 1024).toFixed(0)} KB`);
console.log('  index.html is at the zip root. Upload this file.');
console.log('');
