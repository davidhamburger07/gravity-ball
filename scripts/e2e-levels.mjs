// e2e-levels.mjs — exercise every level-finder endpoint against the real database.
//
//   node scripts/e2e-levels.mjs [port]
//
// Publishes a throwaway level, walks it through browse / search / vote / feature, checks that the
// publish gate and the admin key actually refuse what they should, then deletes everything it
// created. Safe to run repeatedly; it cleans up after itself.

import { loadEnvLocal } from './load-env.mjs';
import { hashLevel } from '../src/systems/SolveProof.js';

await loadEnvLocal();

const PORT = process.argv[2] || 3457;
const BASE = `http://localhost:${PORT}/api/levels`;

let passed = 0;
let failed = 0;
const created = [];

function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  <- ' + detail : ''}`); }
}

async function get(path) {
  const res = await fetch(`${BASE}/${path}`);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

async function post(path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

// A plausible player-made level.
const level = {
  id: 'whatever-the-client-says',
  par: 1, // deliberately a lie — the server must overwrite this with the solve
  gravity: 'down',
  spawn: { x: 40, y: 40 },
  goal: { x: 760, y: 560 },
  hazards: [{ x: 300, y: 400, w: 80, h: 20 }],
};

const identity = { localId: 'e2etestuser01', localName: 'E2E Tester' };
const solve = { shifts: 6, hash: hashLevel(level) };

console.log('\n--- publish gate ---');

const noSolve = await post('publish', { ...identity, level, name: 'No Solve' });
check('refuses publish with no solve', noSolve.status === 403, `got ${noSolve.status}`);

const staleSolve = await post('publish', {
  ...identity, level, name: 'Stale', solve: { shifts: 6, hash: 'notthehash' },
});
check('refuses a solve from a different level', staleSolve.status === 403, `got ${staleSolve.status}`);

const tooBig = await post('publish', {
  ...identity, name: 'Huge', solve, level: { ...level, junk: 'x'.repeat(70000) },
});
check('refuses an oversized level', tooBig.status === 400, `got ${tooBig.status}`);

const noIdentity = await post('publish', { level, name: 'Anon', solve });
check('refuses publish with no identity', noIdentity.status === 401, `got ${noIdentity.status}`);

console.log('\n--- publish ---');

const pub = await post('publish', { ...identity, level, name: '  Spooky   Spikes  ', solve });
check('publishes a solved level', pub.status === 200, JSON.stringify(pub.body));
const id = pub.body?.id;
if (id) created.push(id);

check('par comes from the solve, not the client', pub.body?.meta?.par === 6, `par=${pub.body?.meta?.par}`);
check('name is trimmed and collapsed', pub.body?.meta?.name === 'Spooky Spikes', `name=${JSON.stringify(pub.body?.meta?.name)}`);
check('author name recorded', pub.body?.meta?.author === 'E2E Tester');
check('local identity marked untrusted', pub.body?.meta?.trusted === false);

console.log('\n--- read back ---');

const lvl = await get(`level?id=${id}`);
check('level body fetches', lvl.status === 200);
check('server overwrote the client id', lvl.body?.level?.id === id, `id=${lvl.body?.level?.id}`);
check('server overwrote the client par', lvl.body?.level?.par === 6, `par=${lvl.body?.level?.par}`);
check('geometry survived the round trip', lvl.body?.level?.hazards?.[0]?.x === 300);
check('level body is immutably cached', /immutable/.test(lvl.headers.get('cache-control') || ''), lvl.headers.get('cache-control'));

const browse = await get('browse?sort=new');
check('appears in Newest', browse.body?.items?.some((m) => m.id === id));
check('browse is edge-cached', /s-maxage=300/.test(browse.headers.get('cache-control') || ''), browse.headers.get('cache-control'));

const badSort = await get('browse?sort=banana');
check('rejects an unknown sort', badSort.status === 400);

const index = await get('search-index');
const row = index.body?.rows?.find((r) => r[0] === id);
check('appears in the search index', Boolean(row));
check('index row carries name and par', row?.[1] === 'Spooky Spikes' && row?.[3] === 6, JSON.stringify(row));

console.log('\n--- votes ---');

const up = await post('vote', { ...identity, id, dir: 1 });
check('accepts an upvote', up.status === 200 && up.body?.likes === 1, JSON.stringify(up.body));

const again = await post('vote', { ...identity, id, dir: 1 });
check('same vote twice does not double-count', again.body?.likes === 1 && again.body?.changed === false, JSON.stringify(again.body));

const flip = await post('vote', { ...identity, id, dir: -1 });
check('switching sides moves the vote', flip.body?.likes === 0 && flip.body?.dislikes === 1, JSON.stringify(flip.body));

const badDir = await post('vote', { ...identity, id, dir: 5 });
check('rejects a nonsense vote direction', badDir.status === 400);

console.log('\n--- plays ---');

const play1 = await post('play', { id });
const play2 = await post('play', { id });
check('play count increments', play1.body?.plays === 1 && play2.body?.plays === 2, `${play1.body?.plays}/${play2.body?.plays}`);

// Regression: plays live only in the sorted set, so browse and the search index have to read them
// back from there. They previously reported 0 for every level however many times it was played.
const afterPlays = await get('browse?sort=new');
const card = afterPlays.body?.items?.find((m) => m.id === id);
check('browse reports the real play count', card?.plays === 2, `card.plays=${card?.plays}`);

const idxAfterPlays = await get('search-index');
const idxRow = idxAfterPlays.body?.rows?.find((r) => r[0] === id);
check('search index reports the real play count', idxRow?.[4] === 2, `row=${JSON.stringify(idxRow)}`);

console.log('\n--- admin ---');

const badKey = await post('admin', { op: 'feature', id, adminKey: 'wrong' });
check('rejects a bad admin key', badKey.status === 401, `got ${badKey.status}`);

const feature = await post('admin', { op: 'feature', id, adminKey: process.env.GB_ADMIN_KEY });
check('features with the right key', feature.status === 200, JSON.stringify(feature.body));

const featured = await get('browse?sort=featured');
check('appears in Featured', featured.body?.items?.some((m) => m.id === id));

const hide = await post('admin', { op: 'hide', id, adminKey: process.env.GB_ADMIN_KEY });
check('hides a level', hide.status === 200);

const afterHide = await get('browse?sort=new');
check('hidden level drops out of Newest', !afterHide.body?.items?.some((m) => m.id === id));

console.log('\n--- misc ---');

const missing = await get('level?id=doesnotexist');
check('unknown level 404s', missing.status === 404);

const unknown = await get('nonsense');
check('unknown endpoint 404s', unknown.status === 404);

// --- cleanup ---------------------------------------------------------------------------------
console.log('\n--- cleanup ---');
const { redis, pipeline } = await import('../api/_lib/redis.js');
const cmds = [];
for (const levelId of created) {
  cmds.push(['DEL', `gb:lvl:${levelId}`], ['DEL', `gb:meta:${levelId}`], ['DEL', `gb:reports:${levelId}`]);
  for (const idx of ['new', 'plays', 'rating', 'featured', 'likes', 'dislikes']) {
    cmds.push(['ZREM', `gb:idx:${idx}`, levelId]);
  }
}
cmds.push(['DEL', `gb:user:local:${identity.localId}:levels`]);
cmds.push(['DEL', `gb:voted:local:${identity.localId}`]);
cmds.push(['SREM', 'gb:hidden', ...created]);
if (cmds.length) await pipeline(cmds);

// Rate-limit counters expire on their own, but clear them so repeat runs start fresh.
const stale = await redis('KEYS', 'gb:rl:*e2etestuser01*');
if (stale?.length) await pipeline(stale.map((k) => ['DEL', k]));

const left = await redis('KEYS', 'gb:*');
console.log(`  removed ${created.length} test level(s); ${left?.length ?? 0} gb:* key(s) remain (gb:seq is expected)`);

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
