// serve.mjs — zero-dependency static dev server for local playtesting.
// Usage: node serve.mjs   →   http://localhost:3000
// Serving over HTTP (not file://) is required so ES modules, fetch(), and the
// Canvas/WebGL context all work without CORS errors.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvLocal, hasRedisCredentials } from './scripts/load-env.mjs';

// The level-finder endpoints need Upstash credentials. Vercel injects these in production; locally
// they come from .env.local. Loaded before the server starts so the first request already has them.
await loadEnvLocal();

// Serve the project root by default, or a subfolder (e.g. the production build) via SERVE_DIR.
const ROOT = process.env.SERVE_DIR
  ? resolve(process.cwd(), process.env.SERVE_DIR)
  : fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

// --- Authoring API ------------------------------------------------------------------------
// The AI studio (ai.html) needs to write levels to disk so the whole generate → playtest →
// keep loop can run without a terminal. This is a local dev-only server, but it still refuses
// to write anywhere except the two paths it owns, and it backs levels.json up before touching
// it — an automated tool appending to hand-authored campaign data should never be the only
// copy standing between you and a bad batch.
const LEVELS_PATH = resolve(ROOT, 'src/data/levels.json');
const GENERATED_DIR = resolve(ROOT, 'generated');

function readJsonBody(req) {
  return new Promise((ok, fail) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 8e6) { fail(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => { try { ok(JSON.parse(raw || '{}')); } catch (e) { fail(e); } });
    req.on('error', fail);
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

/** Append a generated level to a chapter in levels.json, or replace one with the same id. */
async function addLevelToChapter({ level, chapterId }) {
  if (!level?.spawn || !level?.goal) throw new Error('not a level (missing spawn/goal)');
  const data = JSON.parse(await readFile(LEVELS_PATH, 'utf8'));
  const chapter = data.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`chapter ${chapterId} not found`);

  // `meta` is generator bookkeeping, not level data — keep it out of the shipped campaign.
  const { meta, ...clean } = level;
  chapter.levels = chapter.levels ?? [];
  const at = chapter.levels.findIndex((l) => l.id === clean.id);
  if (at >= 0) chapter.levels[at] = clean;
  else chapter.levels.push(clean);

  await copyFile(LEVELS_PATH, `${LEVELS_PATH}.bak`);
  await writeFile(LEVELS_PATH, `${JSON.stringify(data, null, 2)}\n`);
  return { id: clean.id, chapterId, total: chapter.levels.length, replaced: at >= 0 };
}

async function saveGeneratedLevel({ level }) {
  if (!level?.spawn || !level?.goal) throw new Error('not a level (missing spawn/goal)');
  const name = `${String(level.id ?? 'level').replace(/[^a-z0-9._-]/gi, '_')}.json`;
  const path = resolve(GENERATED_DIR, name);
  if (dirname(path) !== GENERATED_DIR) throw new Error('bad filename');
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(path, `${JSON.stringify(level, null, 2)}\n`);
  return { path: `generated/${name}` };
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    if (urlPath === '/') urlPath = '/index.html';

    // Level finder. Handled before the block below because these endpoints include GETs, and
    // because they share their implementation with the deployed Vercel function.
    if (urlPath.startsWith('/api/levels/')) {
      const { route } = await import('./api/_lib/router.js');
      const result = await route({
        method: req.method,
        route: urlPath.slice('/api/levels/'.length),
        query: new URL(req.url, `http://${req.headers.host}`).searchParams,
        req,
      });
      res.writeHead(result.status, result.headers);
      return res.end(result.body);
    }

    if (urlPath.startsWith('/api/')) {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      try {
        const body = await readJsonBody(req);
        if (urlPath === '/api/add-to-chapter') return send(res, 200, await addLevelToChapter(body));
        if (urlPath === '/api/save-level') return send(res, 200, await saveGeneratedLevel(body));
        return send(res, 404, { error: 'unknown endpoint' });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }

    // Prevent path traversal outside the project root.
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(normalize(ROOT))) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  Gravity Ball dev server → http://localhost:${PORT}\n`);
  if (!hasRedisCredentials()) {
    console.log('  Note: no Upstash credentials, so /api/levels/* will fail.');
    console.log('        Copy .env.example to .env.local and fill it in, then `npm run redis:check`.\n');
  }
});
