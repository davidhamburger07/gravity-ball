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
/**
 * The ladder is sized to the shipping campaign: 25 levels across 3 built chapters (10 + 7 + 8), so
 * 75 stars is the ceiling and chapters 1-3 are the only ones that can be cleared. Cumulative
 * chapter maxima are 30 / 51 / 75, which is what the star tiers below are spaced against. Two
 * rules keep it honest,
 * both enforced by scripts/check-campaign.mjs:
 *
 *   - no star tier may exceed the campaign total (an earlier table asked for 160 of 84);
 *   - no skin may be gated on a chapter with no levels, because an empty chapter can never be
 *     cleared — which is why nothing here gates on chapters 4 or 5.
 *
 * Star and chapter goals alternate so the ladder never stalls on one kind of objective. Ids are
 * preserved across the rebalance: dropping one would silently reset the skin of anyone wearing it
 * (skinById falls back to SKINS[0]).
 */
export const SKINS = [
  { id: 'classic', name: 'Classic', color: 0x38e1ff, accent: 0xffffff, req: { type: 'free' } },
  { id: 'ember', name: 'Ember', color: 0xff7043, accent: 0xffd7c2, req: { type: 'stars', n: 6 } },
  { id: 'spike', name: 'Hazard', color: 0xe0574f, accent: 0xffc9c5, req: { type: 'chapter', id: 1 } },
  { id: 'mint', name: 'Mint', color: 0x2bd67b, accent: 0xd7ffe9, req: { type: 'stars', n: 18 } },
  { id: 'wormhole', name: 'Bounce', color: 0x2bd6c0, accent: 0xd4fff8, req: { type: 'chapter', id: 2 } },
  { id: 'violet', name: 'Violet', color: 0x9b6dff, accent: 0xe8dcff, req: { type: 'stars', n: 32 } },
  { id: 'rose', name: 'Rose', color: 0xff5c8a, accent: 0xffd9e4, req: { type: 'stars', n: 46 } },
  { id: 'void', name: 'Keymaster', color: 0x2a1a4a, accent: 0xc79aff, req: { type: 'chapter', id: 3 } },
  { id: 'gold', name: 'Gold', color: 0xffd23f, accent: 0xfff4c2, req: { type: 'stars', n: 60 } },
  { id: 'horizon', name: 'Event Horizon', color: 0x11141f, accent: 0x38e1ff, req: { type: 'stars', n: 71 } },
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
      if (!ch) return `Chapter ${req.id}`;
      // A declared-but-unbuilt chapter reads as a promise rather than as an unexplained padlock.
      if (!ch.levels?.length) return `Ch.${req.id} — ${ch.name} (coming soon)`;
      return `Clear Ch.${req.id} — ${ch.name}`;
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
    // Show why an unbuilt chapter is locked instead of a bare padlock with no explanation.
    if (!ch?.levels?.length) return ch ? 'soon' : null;
    const done = ch.levels.filter((l) => save.isCompleted(l.id)).length;
    return `${done}/${ch.levels.length}`;
  }
  return null;
}
