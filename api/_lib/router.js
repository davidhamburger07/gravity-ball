// router.js — every level-finder endpoint, in one dispatcher.
//
// Both entry points delegate here: the Vercel function (api/levels/[...route].js) in production,
// and serve.mjs during local development. Sharing the logic is what stops "works on localhost"
// from becoming a category of bug — there is only one implementation to get right.
//
// Handlers return the plain {status, headers, body} shape from http.js; neither entry point needs
// to know anything about Redis.

import { identify } from './auth.js';
import { hashLevel } from '../../src/systems/SolveProof.js';
import {
  validateLevel, nextLevelId, publishLevel, getLevel, getMetas, browse, recordPlay,
  vote, report, setHidden, setFeatured, setBanned, rateLimit, buildSearchIndex,
  isBanned, authorLevelCount, MAX_LEVELS_PER_AUTHOR, SORTS,
} from './store.js';
import {
  ok, badRequest, unauthorized, forbidden, notFound, tooMany, serverError,
  readJson, publicCache, immutableCache, noCache, CORS,
} from './http.js';

const MAX_NAME = 32;

// An author may publish 5 levels an hour and 20 a day. Generous for a person iterating on ideas,
// ruinous for a script trying to fill the database.
const PUBLISH_LIMITS = [
  { action: 'pub-h', limit: 5, window: 3600, msg: 'You can publish 5 levels an hour. Try again shortly.' },
  { action: 'pub-d', limit: 20, window: 86400, msg: 'You can publish 20 levels a day. Try again tomorrow.' },
];

const isAdmin = (body) =>
  Boolean(process.env.GB_ADMIN_KEY) && body?.adminKey === process.env.GB_ADMIN_KEY;

const methodNotAllowed = () => ({
  status: 405,
  headers: { ...CORS, ...noCache, 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ error: 'Method not allowed.' }),
});

/**
 * Dispatch one request.
 * @param {{method:string, route:string, query:URLSearchParams, req:object}} ctx
 */
export async function route({ method, route: path, query, req }) {
  if (method === 'OPTIONS') return { status: 204, headers: CORS, body: '' };

  try {
    if (method === 'GET') {
      if (path === 'browse') return await handleBrowse(query);
      if (path === 'level') return await handleLevel(query);
      if (path === 'meta') return await handleMeta(query);
      if (path === 'search-index') return await handleSearchIndex();
      return notFound('Unknown endpoint: ' + path);
    }

    if (method === 'POST') {
      const body = await readJson(req);
      if (path === 'publish') return await handlePublish(body);
      if (path === 'play') return await handlePlay(body);
      if (path === 'vote') return await handleVote(body);
      if (path === 'report') return await handleReport(body);
      if (path === 'admin') return await handleAdmin(body);
      return notFound('Unknown endpoint: ' + path);
    }

    return methodNotAllowed();
  } catch (err) {
    // Upstash quota and auth failures land here. Log the detail, return something a player can read.
    console.error('[level-api]', path, err);
    return serverError('The level service is unavailable right now.');
  }
}

// --- Reads -------------------------------------------------------------------------------------

async function handleBrowse(query) {
  const sort = query.get('sort') || 'new';
  if (!SORTS.includes(sort)) return badRequest('sort must be one of: ' + SORTS.join(', '));

  const { items, nextCursor } = await browse({
    sort,
    cursor: Number(query.get('cursor')) || 0,
    limit: Number(query.get('limit')) || 24,
  });
  // Five minutes of edge caching turns "one Redis read per player" into "one per five minutes".
  return ok({ items, nextCursor, sort }, publicCache(300));
}

async function handleLevel(query) {
  const id = query.get('id');
  if (!id) return badRequest('Missing id.');
  const level = await getLevel(id);
  if (!level) return notFound('That level no longer exists.');
  // Level bodies are never rewritten, so this can sit in the CDN indefinitely.
  return ok({ level }, immutableCache);
}

async function handleMeta(query) {
  const id = query.get('id');
  if (!id) return badRequest('Missing id.');
  const [meta] = await getMetas([id]);
  if (!meta || meta.hidden) return notFound('That level no longer exists.');
  return ok({ meta }, publicCache(60));
}

async function handleSearchIndex() {
  return ok(await buildSearchIndex(), publicCache(300));
}

// --- Writes ------------------------------------------------------------------------------------

async function handlePublish(body) {
  const who = await identify(body);
  if (!who) return unauthorized('Could not establish who you are.');
  if (await isBanned(who.id)) return forbidden('This account can no longer publish levels.');

  for (const limit of PUBLISH_LIMITS) {
    const rl = await rateLimit(who.id, limit.action, limit.limit, limit.window);
    if (!rl.allowed) return tooMany(limit.msg);
  }

  if ((await authorLevelCount(who.id)) >= MAX_LEVELS_PER_AUTHOR) {
    return forbidden('You have reached the limit of ' + MAX_LEVELS_PER_AUTHOR + ' published levels.');
  }

  const valid = validateLevel(body.level);
  if (!valid.ok) return badRequest(valid.error);

  // The publish gate: par is the author's own best playtest, never a number they typed.
  const shifts = Number(body?.solve?.shifts);
  if (!Number.isInteger(shifts) || shifts < 0 || shifts > 9999) {
    return forbidden('Beat your level in Playtest before publishing it.');
  }
  // Confirms the solve belongs to the level being submitted rather than to an earlier draft.
  if (body?.solve?.hash && body.solve.hash !== hashLevel(body.level)) {
    return forbidden('This level changed since you last beat it. Play it again to publish.');
  }

  const id = await nextLevelId();
  const now = Date.now();

  // The server decides id and par. Whatever the client put in those fields is discarded.
  const level = { ...body.level, id, par: shifts };

  const meta = {
    id,
    name: cleanLevelName(body.name),
    par: shifts,
    author: who.name,
    authorId: who.id,
    trusted: who.trusted,
    created: now,
    plays: 0,
    likes: 0,
    dislikes: 0,
    hidden: false,
  };

  await publishLevel({ id, levelJson: JSON.stringify(level), meta, authorId: who.id });
  return ok({ id, meta }, noCache);
}

async function handlePlay(body) {
  const id = String(body?.id || '');
  if (!id) return badRequest('Missing id.');
  return ok({ id, plays: await recordPlay(id) }, noCache);
}

async function handleVote(body) {
  const who = await identify(body);
  if (!who) return unauthorized('Could not establish who you are.');

  const id = String(body?.id || '');
  const dir = Number(body?.dir);
  if (!id) return badRequest('Missing id.');
  if (dir !== 1 && dir !== -1) return badRequest('dir must be 1 or -1.');

  const rl = await rateLimit(who.id, 'vote', 120, 3600);
  if (!rl.allowed) return tooMany('Too many votes. Slow down a moment.');

  return ok(await vote(id, who.id, dir), noCache);
}

async function handleReport(body) {
  const who = await identify(body);
  if (!who) return unauthorized('Could not establish who you are.');

  const id = String(body?.id || '');
  if (!id) return badRequest('Missing id.');

  const rl = await rateLimit(who.id, 'report', 20, 86400);
  if (!rl.allowed) return tooMany('Too many reports today.');

  await report(id, who.id);
  // Deliberately vague: telling a reporter the running total invites brigading.
  return ok({ reported: true }, noCache);
}

async function handleAdmin(body) {
  if (!isAdmin(body)) return unauthorized('Bad admin key.');

  const id = String(body?.id || '');
  const on = body?.on ?? true;

  if (body?.op === 'feature') {
    return (await setFeatured(id, on)) ? ok({ id, featured: on }, noCache) : notFound();
  }
  if (body?.op === 'hide') {
    return (await setHidden(id, on)) ? ok({ id, hidden: on }, noCache) : notFound();
  }
  if (body?.op === 'ban') {
    await setBanned(id, on);
    return ok({ id, banned: on }, noCache);
  }
  return badRequest('op must be feature, hide or ban.');
}

/**
 * Level names sit next to other players' work, so keep them short and single-line.
 *
 * Written as a codepoint scan rather than a regex on purpose: the character classes involved are
 * exactly the ones that get mangled when this file passes through a shell, and a silently broken
 * escape here would corrupt every name it touched.
 */
function cleanLevelName(raw) {
  let out = '';
  for (const ch of String(raw ?? '')) {
    const code = ch.codePointAt(0);
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    out += isControl ? ' ' : ch;
  }
  return out.split(' ').filter(Boolean).join(' ').slice(0, MAX_NAME) || 'Untitled';
}
