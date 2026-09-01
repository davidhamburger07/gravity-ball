// http.js — request/response plumbing shared by the Vercel function and the local dev server.
//
// CORS is wide open on purpose. On CrazyGames the game is served from their domain, not from
// Vercel, so every call to this API is cross-origin; and the same build also runs on localhost and
// anywhere else the game is embedded. An origin allowlist would be a maintenance trap that buys
// nothing, because the browser sends the Origin header — it is not a secret and not a credential.
// Write access is gated by the signed CrazyGames token and the admin key, which is where the
// security boundary actually belongs.

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/**
 * Cache-Control for responses the CDN may serve to everyone.
 *
 * This is the single most important lever on the Upstash free tier: an edge hit costs zero Redis
 * commands. `swr` lets the CDN serve a slightly stale page instantly while it refreshes behind the
 * scenes, so players never wait on a cache miss.
 */
export const publicCache = (seconds, swr = seconds * 4) =>
  ({ 'cache-control': `public, s-maxage=${seconds}, stale-while-revalidate=${swr}` });

/** Level bodies never change once published, so they can be cached essentially forever. */
export const immutableCache = { 'cache-control': 'public, max-age=31536000, immutable' };

/** Never cache: anything user-specific or mutating. */
export const noCache = { 'cache-control': 'no-store' };

export const json = (status, body, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers },
  body: JSON.stringify(body),
});

export const ok = (body, headers) => json(200, body, headers);
export const badRequest = (error) => json(400, { error }, noCache);
export const unauthorized = (error = 'Not signed in.') => json(401, { error }, noCache);
export const forbidden = (error) => json(403, { error }, noCache);
export const notFound = (error = 'Not found.') => json(404, { error }, noCache);
export const tooMany = (error) => json(429, { error }, noCache);
export const serverError = (error) => json(500, { error }, noCache);

/** Read and size-limit a JSON body. Rejects early so a huge upload never reaches Redis. */
export async function readJson(req, maxBytes = 256 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel pre-parses
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!total) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
