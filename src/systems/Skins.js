// Skins.js — cosmetic ball variants and the rules that unlock them.
//
// A skin only ever changes the ball's normal-state texture. The heavy-state ball (Ch.5) keeps its
// amber look no matter what, because that colour is gameplay information rather than decoration.

/**
 * Unlock rules:
 *   { type: 'free' }                 always available
 *   { type: 'stars', n }             total stars earned across the campaign
 *   { type: 'level', id }            a specific level cleared
 *   { type: 'chapter', id }          every built level in a chapter cleared
 */
export const SKINS = [
  { id: 'classic', name: 'Classic', color: 0x38e1ff, accent: 0xffffff, req: { type: 'free' } },
  { id: 'ember', name: 'Ember', color: 0xff7043, accent: 0xffd7c2, req: { type: 'stars', n: 10 } },
  { id: 'mint', name: 'Mint', color: 0x2bd67b, accent: 0xd7ffe9, req: { type: 'stars', n: 30 } },
  { id: 'violet', name: 'Violet', color: 0x9b6dff, accent: 0xe8dcff, req: { type: 'stars', n: 60 } },
  { id: 'rose', name: 'Rose', color: 0xff5c8a, accent: 0xffd9e4, req: { type: 'stars', n: 100 } },
  { id: 'gold', name: 'Gold', color: 0xffd23f, accent: 0xfff4c2, req: { type: 'stars', n: 160 } },
  { id: 'spike', name: 'Hazard', color: 0xe0574f, accent: 0xffc9c5, req: { type: 'chapter', id: 2 } },
  { id: 'wormhole', name: 'Wormhole', color: 0x2bd6c0, accent: 0xd4fff8, req: { type: 'chapter', id: 6 } },
  { id: 'void', name: 'Singularity', color: 0x2a1a4a, accent: 0xc79aff, req: { type: 'chapter', id: 9 } },
  { id: 'horizon', name: 'Event Horizon', color: 0x11141f, accent: 0x38e1ff, req: { type: 'chapter', id: 10 } },
];

export const skinById = (id) => SKINS.find((s) => s.id === id) ?? SKINS[0];

/** Texture key for a skin's ball art (generated in Textures.js). */
export const skinTextureKey = (id) => `ball-${id}`;

/** Human-readable unlock requirement, e.g. "30 stars" or "Clear Chapter 6". */
export function describeRequirement(req, levels) {
  switch (req.type) {
    case 'free': return 'Unlocked';
    case 'stars': return `${req.n} stars`;
    case 'level': return `Clear level ${req.id}`;
    case 'chapter': {
      const ch = levels?.chapters?.find((c) => c.id === req.id);
      return `Clear ${ch ? `Ch.${req.id} — ${ch.name}` : `Chapter ${req.id}`}`;
    }
    default: return '';
  }
}

/** Has the player met this skin's requirement? */
export function isSkinUnlocked(skin, save, levels) {
  const req = skin.req;
  switch (req.type) {
    case 'free': return true;
    case 'stars': return save.totalStars() >= req.n;
    case 'level': return save.isCompleted(req.id);
    case 'chapter': {
      const ch = levels?.chapters?.find((c) => c.id === req.id);
      if (!ch || !(ch.levels?.length)) return false;
      return ch.levels.every((l) => save.isCompleted(l.id));
    }
    default: return false;
  }
}

/** Progress toward a locked skin, as a "3/30"-style string (null when not countable). */
export function requirementProgress(skin, save, levels) {
  const req = skin.req;
  if (req.type === 'stars') return `${save.totalStars()}/${req.n}`;
  if (req.type === 'chapter') {
    const ch = levels?.chapters?.find((c) => c.id === req.id);
    if (!ch?.levels?.length) return null;
    const done = ch.levels.filter((l) => save.isCompleted(l.id)).length;
    return `${done}/${ch.levels.length}`;
  }
  return null;
}
