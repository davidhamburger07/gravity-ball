// ShareCode.js — turn a level into a portable string and back.
//
// Codes are URL-safe base64 of the level JSON, prefixed with a version tag so a future format
// change can be detected rather than silently mis-parsed. No server involved: players copy a code
// out of the editor and paste it into the game.

const PREFIX = 'GB1-';

/** UTF-8 safe base64 (btoa alone throws on non-Latin1 characters such as level hints). */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const urlSafe = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const urlUnsafe = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return t + '='.repeat((4 - (t.length % 4)) % 4);
};

/** Encode a level object into a shareable code. */
export function encodeLevel(level) {
  return PREFIX + urlSafe(toBase64(JSON.stringify(level)));
}

/**
 * Decode a share code back into a level object.
 * Accepts a bare code or a full URL containing ?code=…, and tolerates surrounding whitespace.
 * @returns {object|null} the level, or null if the code is unusable.
 */
export function decodeLevel(code) {
  if (!code) return null;
  let raw = String(code).trim();

  // Allow pasting a whole share URL.
  const m = raw.match(/[?&]code=([^&\s]+)/);
  if (m) raw = m[1];

  raw = raw.replace(/\s+/g, '');
  if (!raw.startsWith(PREFIX)) return null;

  try {
    const level = JSON.parse(fromBase64(urlUnsafe(raw.slice(PREFIX.length))));
    // Minimum viable level: somewhere to start and somewhere to finish.
    if (!level || typeof level !== 'object' || !level.spawn || !level.goal) return null;
    return level;
  } catch {
    return null;
  }
}

/** A link that opens the game straight into this level. Carries the full prefixed code. */
export function shareUrl(level, origin = window.location.origin + window.location.pathname) {
  return `${origin}?code=${encodeLevel(level)}`;
}

export { PREFIX as SHARE_PREFIX };
