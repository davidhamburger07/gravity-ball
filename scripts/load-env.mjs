// load-env.mjs — read .env.local into process.env for local development.
//
// Only needed on this machine: in production Vercel injects the same variables itself. Node 18 has
// no built-in .env support and the project has no runtime dependencies, so this parses the handful
// of KEY=VALUE lines directly rather than pulling in dotenv.

import { readFile } from 'node:fs/promises';

/**
 * @param {URL|string} path  Defaults to .env.local beside the project root.
 * @returns {Promise<boolean>} true if a file was found and applied.
 */
export async function loadEnvLocal(path = new URL('../.env.local', import.meta.url)) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return false; // No .env.local is fine — the caller reports it if the vars are actually needed.
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    // Never clobber a variable that is already set — a real environment beats a dev file.
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

/** True once real-looking Upstash credentials are present. */
export const hasRedisCredentials = () => {
  const url = process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return Boolean(url && token) && !url.includes('your-database-name') && !token.includes('paste_the');
};
