// chapters.js — the campaign's teaching structure, as data.
//
// Gravity Ball's chapters are cumulative: each one introduces exactly one new object and keeps
// everything taught before it. This table mirrors src/data/levels.json (verified against what
// each shipped chapter actually places), and it is what lets the generator build a level that
// is legal for a given chapter — it can only use mechanics the player has already met.

/** Every mechanic a chunk can declare in its `uses` list. Terrain is implicit and always legal. */
export const MECHANICS = Object.freeze([
  'spike', 'sticky', 'bouncer', 'key', 'weight', 'breakable',
  'portal', 'cblock', 'laser', 'slowzone', 'gravzone', 'blackhole',
]);

export const CHAPTERS = Object.freeze([
  { id: 1, name: 'Ground Zero', introduces: [] },                          // walls and ramps only
  { id: 2, name: 'Spike Fields', introduces: ['spike'] },
  { id: 3, name: 'Bounce House', introduces: ['bouncer', 'sticky'] },
  { id: 4, name: 'Locksmith', introduces: ['key'] },                       // keys + their doors
  { id: 5, name: 'Fragile Ground', introduces: ['weight', 'breakable'] },
  { id: 6, name: 'Wormholes', introduces: ['portal'] },
  { id: 7, name: 'Chromatic', introduces: ['cblock'] },                    // color blocks + switches
  { id: 8, name: 'Time Warp', introduces: ['laser', 'slowzone'] },
  { id: 9, name: 'Singularity', introduces: ['gravzone', 'blackhole'] },
  { id: 10, name: 'Event Horizon', introduces: [] },                       // everything, under a shift budget
]);

/** Everything a player has been taught by the end of `chapterId`. */
export function allowedMechanics(chapterId) {
  const allowed = new Set();
  for (const ch of CHAPTERS) {
    if (ch.id > chapterId) break;
    ch.introduces.forEach((m) => allowed.add(m));
  }
  // The finale is a mixer: it reprises every object rather than adding one.
  if (chapterId >= 10) MECHANICS.forEach((m) => allowed.add(m));
  return allowed;
}

/**
 * The mechanic a chapter is *about*. The generator biases toward rooms featuring it so a
 * generated chapter-6 level actually teaches wormholes instead of being a spike level that
 * merely happens to be legal for chapter 6.
 */
export function featuredMechanics(chapterId) {
  return CHAPTERS.find((c) => c.id === chapterId)?.introduces ?? [];
}

export function chapterById(id) {
  return CHAPTERS.find((c) => c.id === id) ?? null;
}

/** Next free level id in a chapter, e.g. "6-17", given the existing levels.json. */
export function nextLevelId(levelsData, chapterId) {
  const ch = levelsData?.chapters?.find((c) => c.id === chapterId);
  const used = new Set((ch?.levels ?? []).map((l) => l.id));
  for (let n = 1; n < 999; n++) {
    const id = `${chapterId}-${n}`;
    if (!used.has(id)) return id;
  }
  return `${chapterId}-new`;
}
