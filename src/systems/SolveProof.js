// SolveProof.js — "you may only publish a level you have actually beaten."
//
// The editor's Playtest button already hands a level to the real GameScene. When that playtest is
// won, we record how many shifts it took, filed under a hash of the level's CONTENT. The editor
// then unlocks Publish only if a solve exists for exactly the level currently on the canvas, and
// the par it publishes is the best (lowest) shift count across every winning run.
//
// Hashing the content is the whole point. Filing the solve under the level id would let you beat
// an easy level, redraw it into something impossible, and publish that under the same id.
//
// Excluded from the hash: `id`, `par` and `hint`. None of them change whether the level can be
// beaten or in how many shifts, and including them would throw away a hard-won solve because the
// author fixed a typo in the hint.

const STORE_KEY = 'gravityball:solves';
const IGNORED = new Set(['id', 'par', 'hint']);

/** Deterministic JSON: object keys sorted at every depth, so key order can't change the hash. */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

/** cyrb53 — a fast, well-distributed 53-bit string hash. Sync, unlike SubtleCrypto. */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A stable fingerprint of everything about a level that affects how it plays. */
export function hashLevel(level) {
  if (!level || typeof level !== 'object') return null;
  const playable = {};
  for (const [k, v] of Object.entries(level)) if (!IGNORED.has(k)) playable[k] = v;
  return cyrb53(stable(playable));
}

function readAll() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

function writeAll(map) {
  // Keep only the 50 most recent fingerprints; an author iterating on a level generates a new
  // hash on every edit, so this would grow without bound and eventually blow the storage quota.
  const entries = Object.entries(map).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, 50);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* quota — nothing to do */ }
}

/**
 * Record a winning playtest. Keeps the LOWEST shift count ever achieved for this exact level,
 * which is what becomes the published par — so an author cannot set a par nobody can reach.
 * @returns {{shifts:number, runs:number}} the stored best after this run.
 */
export function recordSolve(level, shifts) {
  const hash = hashLevel(level);
  if (!hash || !Number.isFinite(shifts) || shifts < 0) return null;
  const all = readAll();
  const prev = all[hash];
  const best = prev ? Math.min(prev.shifts, shifts) : shifts;
  all[hash] = { shifts: best, runs: (prev?.runs ?? 0) + 1, at: Date.now() };
  writeAll(all);
  return { shifts: best, runs: all[hash].runs };
}

/**
 * The author's best solve for exactly this level, or null if they have never beaten it.
 * A null here is what keeps the Publish button disabled.
 */
export function bestSolve(level) {
  const hash = hashLevel(level);
  if (!hash) return null;
  return readAll()[hash] ?? null;
}

/** The par a publish would use: the author's own best run. */
export const parFromSolve = (level) => bestSolve(level)?.shifts ?? null;
