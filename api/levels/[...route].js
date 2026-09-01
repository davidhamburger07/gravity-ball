// [...route].js — the production entry point for the level finder.
//
// A single catch-all function serves every /api/levels/* endpoint. One function rather than eight
// keeps the deployment well inside Vercel's per-deployment function limit, and means there is only
// one cold start to warm rather than one per endpoint.
//
// All the logic lives in ../_lib/router.js, which serve.mjs also calls — so local development and
// production run the same code.

import { route } from '../_lib/router.js';

export default async function handler(req, res) {
  // req.query.route is the path after /api/levels — ['browse'] for /api/levels/browse.
  const segments = req.query?.route;
  const name = Array.isArray(segments) ? segments.join('/') : String(segments || '');

  const query = new URL(req.url, 'http://localhost').searchParams;

  const result = await route({ method: req.method, route: name, query, req });

  res.writeHead(result.status, result.headers);
  res.end(result.body);
}
