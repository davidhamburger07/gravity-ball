// auth.js — establish who is publishing a level.
//
// On CrazyGames the SDK hands the game a short-lived JWT (window.CrazyGames.SDK.user.getUserToken()).
// Verifying its signature here is what makes an author name trustworthy: without this step a client
// could claim any username, and bans would be meaningless because identity would be self-asserted.
//
// Off-platform (localhost, itch, a direct link) there is no signer, so we fall back to an id the
// client generates and stores locally. That identity is NOT trustworthy — it is trivially reset or
// forged — so it is marked `trusted: false` and callers apply the stricter limits to it.

import { createVerify } from 'node:crypto';

const PUBLIC_KEY_URL = 'https://sdk.crazygames.com/publicKey.json';

// Cached across invocations on a warm function. CrazyGames rotates this rarely, and a cold fetch
// on every publish would add ~100ms to the slowest path in the app.
let keyCache = { pem: null, fetchedAt: 0 };
const KEY_TTL_MS = 60 * 60 * 1000;

async function publicKey() {
  const now = Date.now();
  if (keyCache.pem && now - keyCache.fetchedAt < KEY_TTL_MS) return keyCache.pem;
  const res = await fetch(PUBLIC_KEY_URL);
  if (!res.ok) throw new Error(`Could not fetch CrazyGames public key: ${res.status}`);
  const { publicKey: pem } = await res.json();
  if (!pem) throw new Error('CrazyGames public key response had no publicKey field.');
  keyCache = { pem, fetchedAt: now };
  return pem;
}

const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verify a CrazyGames user token.
 * @returns {Promise<{userId:string, username:string, profilePictureUrl?:string}|null>} null if unusable.
 */
export async function verifyCrazyGamesToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(b64urlToBuf(parts[0]).toString('utf8'));
    // Pin the algorithm. Accepting whatever the token names is the classic JWT footgun — a client
    // could send alg:"none" and skip the signature entirely.
    if (header.alg !== 'RS256') return null;

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    if (!verifier.verify(await publicKey(), b64urlToBuf(parts[2]))) return null;

    const payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
    if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) return null;
    if (!payload.userId) return null;

    return {
      userId: String(payload.userId),
      username: String(payload.username || 'Player'),
      profilePictureUrl: payload.profilePictureUrl || undefined,
    };
  } catch {
    return null;
  }
}

/** A local id is only accepted in this shape, so it cannot collide with a CrazyGames userId. */
const LOCAL_ID = /^[a-z0-9]{8,32}$/;

/**
 * Resolve the caller's identity from a request body.
 * Prefers the signed token; falls back to the client-supplied local id.
 * @returns {Promise<{id:string, name:string, trusted:boolean}|null>}
 */
export async function identify({ token, localId, localName } = {}) {
  const verified = await verifyCrazyGamesToken(token);
  if (verified) return { id: `cg:${verified.userId}`, name: verified.username, trusted: true };

  if (typeof localId === 'string' && LOCAL_ID.test(localId)) {
    return { id: `local:${localId}`, name: cleanName(localName), trusted: false };
  }
  return null;
}

/** Author names are displayed to other players, so keep them short and free of layout-breaking characters. */
export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return s.slice(0, 20) || 'Anonymous';
}
