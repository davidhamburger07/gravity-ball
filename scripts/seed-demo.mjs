// seed-demo.mjs — publish a handful of demo levels so the browser UI has something to show.
//
//   node scripts/seed-demo.mjs [port]           publish demo levels
//   node scripts/seed-demo.mjs [port] --clean   remove them again
//
// Everything it creates is authored by the ids listed in AUTHORS, so --clean can find and remove
// exactly its own levels and nothing a real player published.

import { loadEnvLocal } from './load-env.mjs';
import { hashLevel } from '../src/systems/SolveProof.js';

await loadEnvLocal();

const PORT = process.argv.find((a) => /^\d+$/.test(a)) || 3457;
const CLEAN = process.argv.includes('--clean');
const BASE = `http://localhost:${PORT}/api/levels`;

const AUTHORS = [
  { localId: 'demoauthor0001', localName: 'Mira' },
  { localId: 'demoauthor0002', localName: 'Toby' },
  { localId: 'demoauthor0003', localName: 'Kestrel' },
];

const DEMOS = [
  { name: 'First Flight', shifts: 2, hazards: 2 },
  { name: 'Spike Alley', shifts: 5, hazards: 12 },
  { name: 'The Long Way Down', shifts: 3, hazards: 6 },
  { name: 'Patience', shifts: 9, hazards: 20 },
  { name: 'Cornered', shifts: 4, hazards: 8 },
  { name: 'Featherweight', shifts: 1, hazards: 1 },
  { name: 'Gauntlet', shifts: 12, hazards: 28 },
];

const makeLevel = (hazardCount, seed) => ({
  gravity: 'down',
  spawn: { x: 40, y: 40 },
  goal: { x: 760, y: 560 },
  hazards: Array.from({ length: hazardCount }, (_, i) => ({
    x: 80 + ((i * 97 + seed * 31) % 640),
    y: 120 + ((i * 61 + seed * 17) % 380),
    w: 40,
    h: 20,
  })),
});

async function post(path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

if (CLEAN) {
  const { redis, pipeline } = await import('../api/_lib/redis.js');
  const ids = [];
  for (const author of AUTHORS) {
    const key = `gb:user:local:${author.localId}:levels`;
    const mine = (await redis('ZRANGE', key, '0', '-1')) || [];
    ids.push(...mine);
    await redis('DEL', key);
    await redis('DEL', `gb:voted:local:${author.localId}`);
  }
  if (ids.length) {
    const cmds = [];
    for (const id of ids) {
      cmds.push(['DEL', `gb:lvl:${id}`], ['DEL', `gb:meta:${id}`], ['DEL', `gb:reports:${id}`]);
      for (const idx of ['new', 'plays', 'rating', 'featured', 'likes', 'dislikes']) {
        cmds.push(['ZREM', `gb:idx:${idx}`, id]);
      }
    }
    await pipeline(cmds);
  }
  const stale = (await redis('KEYS', 'gb:rl:*demoauthor*')) || [];
  if (stale.length) await pipeline(stale.map((k) => ['DEL', k]));
  console.log(`\n  Removed ${ids.length} demo level(s).\n`);
  process.exit(0);
}

console.log('');
const published = [];
for (const [i, demo] of DEMOS.entries()) {
  const author = AUTHORS[i % AUTHORS.length];
  const level = makeLevel(demo.hazards, i);
  const res = await post('publish', {
    ...author,
    level,
    name: demo.name,
    solve: { shifts: demo.shifts, hash: hashLevel(level) },
  });
  if (res.status === 200) {
    published.push(res.body.id);
    console.log(`  published ${res.body.id.padEnd(4)} ${demo.name}  (par ${res.body.meta.par}, by ${res.body.meta.author})`);
  } else {
    console.log(`  FAILED ${demo.name}: ${res.body?.error}`);
  }
}

// Spread some votes and plays so Top has a meaningful order.
for (const [i, id] of published.entries()) {
  const voters = AUTHORS.filter((_, v) => (i + v) % 3 !== 0);
  for (const voter of voters) await post('vote', { ...voter, id, dir: i % 4 === 3 ? -1 : 1 });
  for (let p = 0; p < (i * 7) % 23; p++) await post('play', { id });
}

// Feature a couple so that tab is not empty.
for (const id of published.slice(1, 3)) {
  await post('admin', { op: 'feature', id, adminKey: process.env.GB_ADMIN_KEY });
}

console.log(`\n  ${published.length} demo levels published, voted and featured.`);
console.log('  Remove them with:  node scripts/seed-demo.mjs --clean\n');
