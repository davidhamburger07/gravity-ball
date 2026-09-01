// [...route].js — the production entry point for the level finder.
//
// A single catch-all function serves every /api/levels/* endpoint. One function rather than eight
// keeps the deployment well inside Vercel's per-deployment function limit, and means there is only
// one cold start to warm rather than one per endpoint.
//
// All the logic lives in ../_lib/router.js, which serve.mjs also calls — so local development and
// production run the same code.

import { route } from '../_lib/router.js';

const PREFIX = '/api/levels/';

/**
 * Work out which endpoint was asked for.
 *
 * Reads the URL path first and only falls back to the catch-all `route` param. That order matters:
 * in this project's deployment the dynamic segment was NOT being populated, so every request
 * dispatched with an empty name and came back "Unknown endpoint:" with nothing after the colon.
 * The pathname is always present, which makes this independent of how the platform chooses to
 * expose dynamic segments.
 */
export function endpointFromRequest(req) {
  const pathname = new URL(req?.url ?? '', 'http://localhost').pathname;
  let name = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : '';

  // If the path still carries the literal filename pattern, the platform did not substitute the
  // segment — treat that as "no name" so the param fallback below gets its turn.
  if (name.includes('[')) name = '';

  if (!name) {
    const segments = req?.query?.route;
    name = Array.isArray(segments) ? segments.join('/') : String(segments ?? '');
  }

  // Tolerate a leading or trailing slash from either source.
  return name.replace(/^\/+/, '').replace(/\/+$/, '');
}

export default async function handler(req, res) {
  const name = endpointFromRequest(req);
  const query = new URL(req.url, 'http://localhost').searchParams;

  const result = await route({ method: req.method, route: name, query, req });

  res.writeHead(result.status, result.headers);
  res.end(result.body);
}
