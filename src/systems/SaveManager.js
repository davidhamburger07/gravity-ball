// SaveManager.js — owns all persistent progress: which levels are complete, best star
// rating, and best (fewest) shift count per level. Backed by the CrazyGames data module
// on-platform and localStorage locally (see CrazyGamesSDK wrapper).
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';

const STORAGE_KEY = 'gravityball:progress:v1';

export default class SaveManager {
  /** @param {object} levels  Parsed levels.json (used to compute level order + unlocks). */
  constructor(levels) {
    this.levels = levels;
    this.data = { levels: {} }; // { "1-1": { completed, stars, shifts } }
    this._order = this._flattenOrder(levels);
  }

  _flattenOrder(levels) {
    const ids = [];
    levels.chapters.forEach((c) => (c.levels ?? []).forEach((l) => ids.push(l.id)));
    return ids;
  }

  async load() {
    try {
      const raw = await CrazyGamesSDK.getItem(STORAGE_KEY);
      if (raw) this.data = JSON.parse(raw);
      if (!this.data.levels) this.data.levels = {};
    } catch {
      this.data = { levels: {} };
    }
    return this;
  }

  _persist() {
    CrazyGamesSDK.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  // --- Reads ---------------------------------------------------------------
  getLevel(id) { return this.data.levels[id] ?? null; }
  isCompleted(id) { return !!this.data.levels[id]?.completed; }
  stars(id) { return this.data.levels[id]?.stars ?? 0; }

  /** A level opens once the previous level in global order is complete. First level is always open. */
  isLevelUnlocked(id) {
    const idx = this._order.indexOf(id);
    if (idx <= 0) return true;
    return this.isCompleted(this._order[idx - 1]);
  }

  /** A chapter is playable if it has levels and its first level is unlocked. */
  isChapterUnlocked(chapterId) {
    const chapter = this.levels.chapters.find((c) => c.id === chapterId);
    if (!chapter || !(chapter.levels?.length)) return false;
    return this.isLevelUnlocked(chapter.levels[0].id);
  }

  /** The next level id in global order, or null if this is the last built level. */
  nextLevelId(id) {
    const idx = this._order.indexOf(id);
    return idx >= 0 && idx < this._order.length - 1 ? this._order[idx + 1] : null;
  }

  totalStars() {
    return Object.values(this.data.levels).reduce((sum, l) => sum + (l.stars || 0), 0);
  }

  // --- Writes --------------------------------------------------------------
  /** Record a clear, keeping the player's best result (most stars / fewest shifts). */
  recordResult(id, { stars, shifts }) {
    const prev = this.data.levels[id] ?? { completed: false, stars: 0, shifts: Infinity };
    this.data.levels[id] = {
      completed: true,
      stars: Math.max(prev.stars || 0, stars),
      shifts: Math.min(prev.shifts ?? Infinity, shifts),
    };
    this._persist();
  }
}
