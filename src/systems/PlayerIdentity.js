// PlayerIdentity.js — who the player is when they publish, vote or report.
//
// Two tiers, in order of preference:
//
//   1. On CrazyGames, the SDK issues a signed token. The server verifies it against CrazyGames'
//      public key, so the username attached to a level is real and a ban actually sticks.
//   2. Everywhere else (localhost, itch, a direct link) there is nobody to vouch for the player,
//      so we mint a random id, keep it in cloud/local save, and let them pick a display name.
//      The server marks anything published this way as untrusted.
//
// The game never decides which tier applies — it sends whatever it has and the server decides.

import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';

const ID_KEY = 'gravityball:playerId';
const NAME_KEY = 'gravityball:playerName';

let cachedId = null;
let cachedName = null;

/** 16 lowercase alphanumerics — matches the shape the server accepts for a local id. */
function mintId() {
  const bytes = new Uint8Array(12);
  (globalThis.crypto ?? {}).getRandomValues?.(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(36).padStart(2, '0');
  return out.slice(0, 16);
}

/** The stable local id for this player, created on first use. */
export async function localId() {
  if (cachedId) return cachedId;
  let id = await CrazyGamesSDK.getItem(ID_KEY);
  if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
    id = mintId();
    await CrazyGamesSDK.setItem(ID_KEY, id);
  }
  cachedId = id;
  return id;
}

export async function localName() {
  if (cachedName !== null) return cachedName;
  cachedName = (await CrazyGamesSDK.getItem(NAME_KEY)) || '';
  return cachedName;
}

export async function setLocalName(name) {
  cachedName = String(name ?? '').trim().slice(0, 20);
  await CrazyGamesSDK.setItem(NAME_KEY, cachedName);
  return cachedName;
}

/**
 * The identity fields to attach to a write request.
 *
 * Always sends the local id as well as the token: tokens expire after an hour, and falling back
 * to the local id is better than failing the player's publish outright.
 */
export async function identityPayload() {
  const payload = { localId: await localId(), localName: await localName() };
  const token = await CrazyGamesSDK.getUserToken();
  if (token) payload.token = token;
  return payload;
}

/**
 * The name to show the player as their own, and whether it is verified.
 * @returns {Promise<{name:string, verified:boolean}>}
 */
export async function displayIdentity() {
  const user = await CrazyGamesSDK.getUser();
  if (user?.username) return { name: user.username, verified: true };
  return { name: (await localName()) || 'Anonymous', verified: false };
}
