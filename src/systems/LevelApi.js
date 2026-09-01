// LevelApi.js — the game's client for the published-level service.
//
// Every call is wrapped so a network failure surfaces as { ok: false, error } rather than an
// exception: the level browser is a place players wander into, and a dropped connection should
// show a message, never a black screen.

import { identityPayload } from './PlayerIdentity.js';

/**
 * Where the API lives.
 *
 * Leave this empty while the game is served from the same origin as the API (local dev, and the
 * Vercel deployment itself). Set it to your Vercel origin before uploading to CrazyGames, because
 * there the game is served from crazygames.com and a same-origin request would never reach Vercel.
 *
 *   e.g. const PROD_API_ORIGIN = 'https://gravity-ball.vercel.app';
 */
const PROD_API_ORIGIN = 'https://gravity-ball-azure.vercel.app';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function apiBase() {
  const host = globalThis.location?.hostname ?? '';
  if (!PROD_API_ORIGIN || LOCAL_HOSTS.has(host)) return '/api/levels';
  return `${PROD_API_ORIGIN.replace(/\/+$/, '')}/api/levels`;
}

/** True once the API can be reached from wherever the game is running. */
export function isConfigured() {
  const host = globalThis.location?.hostname ?? '';
  return Boolean(PROD_API_ORIGIN) || LOCAL_HOSTS.has(host) || host.endsWith('.vercel.app');
}

async function request(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`${apiBase()}/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error || `Request failed (${res.status}).`, status: res.status };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: 'Could not reach the level service. Check your connection.' };
  }
}

// --- Reads -------------------------------------------------------------------------------------

export const browse = (sort = 'new', cursor = 0, limit = 24) =>
  request(`browse?sort=${encodeURIComponent(sort)}&cursor=${cursor}&limit=${limit}`);

export const fetchLevel = (id) => request(`level?id=${encodeURIComponent(id)}`);

export const fetchMeta = (id) => request(`meta?id=${encodeURIComponent(id)}`);

/**
 * The whole searchable catalogue in one response.
 *
 * Rows are [id, name, author, par, plays, likes] — display data only, no level geometry, which is
 * why the payload stays tiny enough to ship wholesale and search instantly on the client.
 */
export const fetchSearchIndex = () => request('search-index');

// --- Writes ------------------------------------------------------------------------------------

/** Fire-and-forget: a lost play count is not worth interrupting the player for. */
export function recordPlay(id) {
  return request('play', { method: 'POST', body: { id } }).catch(() => ({ ok: false }));
}

export async function publish({ level, name, solve }) {
  return request('publish', { method: 'POST', body: { ...(await identityPayload()), level, name, solve } });
}

export async function vote(id, dir) {
  return request('vote', { method: 'POST', body: { ...(await identityPayload()), id, dir } });
}

export async function report(id) {
  return request('report', { method: 'POST', body: { ...(await identityPayload()), id } });
}

// --- Client-side search ------------------------------------------------------------------------

/**
 * Rank index rows against a query.
 *
 * Deliberately simple: a case-insensitive substring match on name and author, ordered so that
 * name-prefix hits float above mid-word hits and author hits. Nobody browsing a level list needs
 * fuzzy matching, and this stays instant at tens of thousands of rows.
 */
export function searchRows(rows, query, limit = 60) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const scored = [];
  for (const row of rows) {
    const name = String(row[1] ?? '').toLowerCase();
    const author = String(row[2] ?? '').toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (author.startsWith(q)) score = 2;
    else if (author.includes(q)) score = 3;
    if (score >= 0) scored.push({ row, score, plays: Number(row[4]) || 0 });
  }
  // Ties break on popularity, so the best-known matching level leads.
  scored.sort((a, b) => a.score - b.score || b.plays - a.plays);
  return scored.slice(0, limit).map((s) => rowToMeta(s.row));
}

/** Index rows are positional to keep the payload small; the UI wants named fields. */
export const rowToMeta = (row) => ({
  id: row[0], name: row[1], author: row[2], par: row[3], plays: row[4], likes: row[5],
});
