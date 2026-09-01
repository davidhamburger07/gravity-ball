// redis.js — a tiny Upstash REST client.
//
// Upstash speaks plain HTTP, so there is nothing to pool and no dependency to add: a command is
// a JSON array POSTed to the database URL. That matters in a serverless function, where a TCP
// Redis client would open a connection per cold start and exhaust the connection limit under load.
//
// Credentials come from the environment and never from the bundle — this module is server-only.
// Importing it from anything under src/ would leak the write token into the game's JavaScript.

const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/** Thrown for transport/auth failures so callers can distinguish them from a nil reply. */
export class RedisError extends Error {}

function assertConfigured() {
  if (!URL_ || !TOKEN) {
    throw new RedisError(
      'Upstash is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN ' +
      'in .env.local for dev, and in the Vercel project settings for production.'
    );
  }
}

async function post(path, body) {
  assertConfigured();
  const res = await fetch(`${URL_}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Surface Upstash's own message (quota exceeded, max record size, bad auth) rather than a bare status.
    const detail = await res.text().catch(() => '');
    throw new RedisError(`Upstash ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Run one command: redis('SET', 'key', 'value').
 * @returns the reply, or null for a nil reply.
 */
export async function redis(...command) {
  const out = await post('', command.map(String));
  if (out?.error) throw new RedisError(out.error);
  return out?.result ?? null;
}

/**
 * Run several commands in one round trip.
 *
 * Upstash bills per command, not per request, so this saves latency rather than quota — the
 * quota win comes from preferring multi-key commands (MGET over N GETs) and from caching at the
 * edge so most reads never reach Redis at all.
 *
 * @param {string[][]} commands
 * @returns {Promise<any[]>} replies in order.
 */
export async function pipeline(commands) {
  if (!commands.length) return [];
  const out = await post('/pipeline', commands.map((c) => c.map(String)));
  return out.map((entry) => {
    if (entry?.error) throw new RedisError(entry.error);
    return entry?.result ?? null;
  });
}

/** True when credentials are present — lets endpoints fail politely instead of throwing on boot. */
export const isConfigured = () => Boolean(URL_ && TOKEN);
