// store.js — the level-finder data model, expressed as Redis keys.
//
// KEY SCHEMA (every key is prefixed `gb:` so this database can be shared with another game
// without collisions, and so a stray KEYS/SCAN during debugging stays scoped):
//
//   gb:seq                  STRING  INCR-ed to mint level ids.
//   gb:lvl:<id>             STRING  The level JSON. IMMUTABLE once written — that is what lets the
//                                   read endpoint set a far-future Cache-Control and never re-read.
//   gb:meta:<id>            STRING  Mutable display data: name, author, counters, timestamps.
//                                   Split from the level precisely because it changes; keeping them
//                                   together would force a short TTL on the big immutable payload.
//   gb:idx:new              ZSET    score = published-at ms.
//   gb:idx:plays            ZSET    score = play count.
//   gb:idx:rating           ZSET    score = Wilson lower bound (see ratingScore).
//   gb:idx:featured         ZSET    score = featured-at ms. Written only with the admin key.
//   gb:user:<uid>:levels    ZSET    score = published-at ms. Powers "my levels" and the upload cap.
//   gb:voted:<uid>          HASH    levelId -> 1|-1. Keyed by voter, not by level, so the key size
//                                   is bounded by how much one player votes rather than by how
//                                   popular a level gets.
//   gb:hidden               SET     Level ids removed from every list (moderation).
//   gb:banned               SET     Author ids barred from publishing.
//   gb:reports:<id>         STRING  Report count, for triage.
//
// Note on quota: reads here favour MGET over N GETs. Upstash bills per command, so fetching a
// 20-row page costs 2 commands (one ZRANGE + one MGET), not 21.

import { redis, pipeline } from './redis.js';

const K = {
  seq: 'gb:seq',
  level: (id) => `gb:lvl:${id}`,
  meta: (id) => `gb:meta:${id}`,
  idx: (sort) => `gb:idx:${sort}`,
  userLevels: (uid) => `gb:user:${uid}:levels`,
  voted: (uid) => `gb:voted:${uid}`,
  hidden: 'gb:hidden',
  banned: 'gb:banned',
  reports: (id) => `gb:reports:${id}`,
};

export const SORTS = ['new', 'plays', 'rating', 'featured'];
const SORT_KEY = { new: 'new', plays: 'plays', rating: 'rating', featured: 'featured' };

// Generous next to the 5.5KB of the largest hand-made campaign level, but small enough that a
// malicious client cannot spend the 256MB storage budget in a few hundred uploads.
export const MAX_LEVEL_BYTES = 64 * 1024;
export const MAX_LEVELS_PER_AUTHOR = 100;

/**
 * Reject anything that is not a plausible level before it reaches storage.
 * @returns {{ok:true, json:string}|{ok:false, error:string}}
 */
export function validateLevel(level) {
  if (!level || typeof level !== 'object' || Array.isArray(level)) {
    return { ok: false, error: 'Level must be an object.' };
  }
  // Mirrors the minimum ShareCode.decodeLevel accepts: somewhere to start, somewhere to finish.
  if (!level.spawn || !level.goal) return { ok: false, error: 'Level needs a spawn and a goal.' };

  const json = JSON.stringify(level);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_LEVEL_BYTES) {
    return { ok: false, error: `Level is ${(bytes / 1024).toFixed(0)}KB; the limit is ${MAX_LEVEL_BYTES / 1024}KB.` };
  }
  return { ok: true, json };
}

/**
 * Wilson lower bound at 95% confidence.
 *
 * Ranking by (likes - dislikes) lets one level with 400 likes and 390 dislikes outrank a flawless
 * level with 30 likes; ranking by ratio lets a single 1-of-1 like top the chart. This does neither:
 * it asks how good the level is at worst, given how few votes it has.
 */
export function ratingScore(likes, dislikes) {
  const n = likes + dislikes;
  if (n === 0) return 0;
  const z = 1.96;
  const p = likes / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

/** Mint a short, collision-free id. base36 keeps it compact in share links. */
export async function nextLevelId() {
  const n = await redis('INCR', K.seq);
  return Number(n).toString(36);
}

export const isBanned = async (authorId) => (await redis('SISMEMBER', K.banned, authorId)) === 1;

export const authorLevelCount = async (authorId) => Number(await redis('ZCARD', K.userLevels(authorId))) || 0;

/**
 * Write a new level and register it in every index, in one round trip.
 * The level body and its metadata are written together so a level can never appear in a list
 * without content behind it.
 */
export async function publishLevel({ id, levelJson, meta, authorId }) {
  const now = meta.created;
  await pipeline([
    ['SET', K.level(id), levelJson],
    ['SET', K.meta(id), JSON.stringify(meta)],
    ['ZADD', K.idx('new'), String(now), id],
    ['ZADD', K.idx('plays'), '0', id],
    ['ZADD', K.idx('rating'), '0', id],
    ['ZADD', K.userLevels(authorId), String(now), id],
  ]);
}

/** The immutable level body. */
export async function getLevel(id) {
  const raw = await redis('GET', K.level(id));
  return raw ? JSON.parse(raw) : null;
}

/** Metadata for many ids in a single command. Missing/!hidden entries come back as null. */
export async function getMetas(ids) {
  if (!ids.length) return [];
  const raw = await redis('MGET', ...ids.map(K.meta));
  return (raw || []).map((r) => {
    if (!r) return null;
    try { return JSON.parse(r); } catch { return null; }
  });
}

/**
 * One page of a browse list. Two commands regardless of page size.
 * @returns {Promise<{items:object[], nextCursor:number|null}>}
 */
export async function browse({ sort = 'new', cursor = 0, limit = 24 } = {}) {
  const key = K.idx(SORT_KEY[sort] ?? 'new');
  const start = Math.max(0, Number(cursor) || 0);
  const stop = start + Math.min(Math.max(1, Number(limit) || 24), 50) - 1;

  const ids = (await redis('ZRANGE', key, String(start), String(stop), 'REV')) || [];
  if (!ids.length) return { items: [], nextCursor: null };

  const metas = await getMetas(ids);
  const items = metas.filter(Boolean).filter((m) => !m.hidden);

  // Play counts live only in the sorted set. Unlike votes, a play is the most frequent write in
  // the whole system, so copying it into the metadata blob on every play would double the cost of
  // the hottest path. One ZMSCORE here reads them all back at once instead, and because browse
  // responses are edge-cached this costs a single extra command per cache period.
  if (items.length) {
    const scores = await redis('ZMSCORE', K.idx('plays'), ...items.map((m) => m.id));
    items.forEach((m, i) => { m.plays = Number(scores?.[i]) || 0; });
  }

  return { items, nextCursor: ids.length > stop - start ? stop + 1 : null };
}

/** Bump the play counter. One command — this is the most frequent write in the system. */
export async function recordPlay(id) {
  return Number(await redis('ZINCRBY', K.idx('plays'), '1', id)) || 0;
}


// --- Voting ----------------------------------------------------------------------------------
//
// Counts live in sorted sets (ZINCRBY is atomic, so simultaneous votes can't lose each other) and
// are ALSO copied into the metadata blob. That duplication is deliberate: browse pages are the hot
// path and read metadata with a single MGET, so denormalising here keeps a page at 2 commands
// instead of 5. The copy can lag by one vote; nobody can tell from a level card.

/** @param {1|-1} dir  @returns {Promise<{likes:number, dislikes:number, changed:boolean}>} */
export async function vote(levelId, userId, dir) {
  const prior = Number(await redis('HGET', K.voted(userId), levelId)) || 0;
  if (prior === dir) return { ...(await voteCounts(levelId)), changed: false };

  const cmds = [['HSET', K.voted(userId), levelId, String(dir)]];
  // Switching sides removes the old vote as well as adding the new one.
  if (prior === 1) cmds.push(['ZINCRBY', K.idx('likes'), '-1', levelId]);
  if (prior === -1) cmds.push(['ZINCRBY', K.idx('dislikes'), '-1', levelId]);
  cmds.push(['ZINCRBY', K.idx(dir === 1 ? 'likes' : 'dislikes'), '1', levelId]);
  await pipeline(cmds);

  const counts = await voteCounts(levelId);
  const score = ratingScore(counts.likes, counts.dislikes);

  const metaRaw = await redis('GET', K.meta(levelId));
  const writes = [['ZADD', K.idx('rating'), String(score), levelId]];
  if (metaRaw) {
    const meta = JSON.parse(metaRaw);
    meta.likes = counts.likes;
    meta.dislikes = counts.dislikes;
    writes.push(['SET', K.meta(levelId), JSON.stringify(meta)]);
  }
  await pipeline(writes);
  return { ...counts, changed: true };
}

async function voteCounts(levelId) {
  const [likes, dislikes] = await pipeline([
    ['ZSCORE', K.idx('likes'), levelId],
    ['ZSCORE', K.idx('dislikes'), levelId],
  ]);
  return { likes: Number(likes) || 0, dislikes: Number(dislikes) || 0 };
}

/** How this player already voted on these levels, so the UI can show it pressed. */
export async function myVotes(userId, ids) {
  if (!ids.length) return {};
  const raw = await redis('HMGET', K.voted(userId), ...ids);
  const out = {};
  ids.forEach((id, i) => { if (raw?.[i]) out[id] = Number(raw[i]); });
  return out;
}

// --- Moderation ------------------------------------------------------------------------------

/** Reports are advisory: they raise a level for review, they never hide it automatically. */
export async function report(levelId, userId) {
  const [count] = await pipeline([
    ['HSET', K.voted(userId), `report:${levelId}`, '1'],
    ['INCR', K.reports(levelId)],
  ]);
  return Number(count) || 0;
}

/** Hiding removes a level from every list without destroying it, so a mistake is reversible. */
export async function setHidden(levelId, hidden) {
  const metaRaw = await redis('GET', K.meta(levelId));
  if (!metaRaw) return false;
  const meta = JSON.parse(metaRaw);
  meta.hidden = Boolean(hidden);
  await pipeline([
    ['SET', K.meta(levelId), JSON.stringify(meta)],
    [hidden ? 'SADD' : 'SREM', K.hidden, levelId],
  ]);
  return true;
}

export async function setFeatured(levelId, featured) {
  const exists = await redis('EXISTS', K.meta(levelId));
  if (!exists) return false;
  await redis(...(featured
    ? ['ZADD', K.idx('featured'), String(Date.now()), levelId]
    : ['ZREM', K.idx('featured'), levelId]));
  return true;
}

export const setBanned = (authorId, banned) => redis(banned ? 'SADD' : 'SREM', K.banned, authorId);

// --- Rate limiting ---------------------------------------------------------------------------

/**
 * Fixed-window limiter. Approximate at window edges, but it costs 2 commands and needs no Lua —
 * the point is to stop a script publishing a thousand levels, not to meter precisely.
 */
export async function rateLimit(id, action, limit, windowSec) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `gb:rl:${action}:${id}:${bucket}`;
  const [count] = await pipeline([['INCR', key], ['EXPIRE', key, String(windowSec)]]);
  return { allowed: Number(count) <= limit, count: Number(count), limit };
}

// --- Search index ----------------------------------------------------------------------------

/**
 * A compact array of [id, name, author, par, plays, likes] rows for client-side search.
 *
 * Two commands, whatever the level count. This is served through the CDN, so the cost is a handful
 * of commands per cache period rather than per player — which is why shipping the whole index is
 * affordable where a query-per-keystroke endpoint would not be.
 */
export async function buildSearchIndex(limit = 5000) {
  const ids = (await redis('ZRANGE', K.idx('new'), '0', String(limit - 1), 'REV')) || [];
  if (!ids.length) return { rows: [], builtAt: Date.now() };
  const metas = await getMetas(ids);
  const visible = metas.filter((m) => m && !m.hidden);
  if (!visible.length) return { rows: [], builtAt: Date.now() };

  // Same reason as browse: play counts are only authoritative in the sorted set.
  const scores = await redis('ZMSCORE', K.idx('plays'), ...visible.map((m) => m.id));
  const rows = visible.map((m, i) =>
    [m.id, m.name, m.author, m.par ?? 0, Number(scores?.[i]) || 0, m.likes ?? 0]);

  return { rows, builtAt: Date.now() };
}

export { K as KEYS };
