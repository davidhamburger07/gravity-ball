// SaveManager.js — owns all persistent progress: which levels are complete, best star
// rating, and best (fewest) shift count per level. Backed by the CrazyGames data module
// on-platform and localStorage locally (see CrazyGamesSDK wrapper).
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';

// v2 exists because the campaign was rebuilt from 140 generated levels to 28 hand-authored ones and
// THE NEW IDS REUSE THE OLD ONES — "3-4" names a different level now. Reading a v1 blob under v2
// marked 22 of the 28 new levels complete for a player who had never seen them, reported 420 stars
// against an 84-star campaign, and left chapter 2 locked between two open chapters.
const STORAGE_KEY = 'gravityball:progress:v2';
const LEGACY_KEY = 'gravityball:progress:v1';

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
      let raw = await CrazyGamesSDK.getItem(STORAGE_KEY);
      if (!raw) raw = await this._migrateLegacy();
      if (raw) this.data = JSON.parse(raw);
      if (!this.data.levels) this.data.levels = {};
    } catch {
      this.data = { levels: {} };
    }
    return this;
  }

  /**
   * Carry a v1 save forward. Only the cosmetic skin choice survives: the level records cannot,
   * because there is no honest mapping between a generated "3-4" and the hand-authored "3-4" that
   * replaced it, and keeping them handed players a campaign that was already three-quarters won.
   *
   * The v1 blob is deliberately left in place — it costs nothing and it is the only way back if the
   * campaign swap is ever reverted.
   */
  async _migrateLegacy() {
    const old = await CrazyGamesSDK.getItem(LEGACY_KEY);
    if (!old) return null;
    const fresh = { levels: {} };
    try {
      const skin = JSON.parse(old)?.skin;
      if (skin) fresh.skin = skin;
    } catch { /* unreadable — start clean rather than guess */ }
    const raw = JSON.stringify(fresh);
    CrazyGamesSDK.setItem(STORAGE_KEY, raw);
    CrazyGamesSDK.mirror(STORAGE_KEY, raw);
    return raw;
  }

  _persist() {
    const json = JSON.stringify(this.data);
    CrazyGamesSDK.setItem(STORAGE_KEY, json);
    // The platform's data module debounces writes for about a second, and both the menu and the
    // win panel can hard-navigate to editor.html inside that window. localStorage is the durable
    // local copy; the data module is the one that follows the player between devices.
    CrazyGamesSDK.mirror(STORAGE_KEY, json);
  }

  // --- Reads ---------------------------------------------------------------
  getLevel(id) { return this.data.levels[id] ?? null; }
  isCompleted(id) { return !!this.data.levels[id]?.completed; }
  stars(id) { return this.data.levels[id]?.stars ?? 0; }

  /**
   * A level opens once the previous level in global order is complete. First level is always open.
   * Test mode opens everything, so progression can be checked without replaying the campaign.
   */
  isLevelUnlocked(id) {
    if (this.testMode) return true;
    const idx = this._order.indexOf(id);
    // An id outside the campaign is not "unlocked" — it does not exist. Conflating the two used to
    // report every stale id from the old campaign as playable, which is exactly the failure this
    // function should surface.
    if (idx < 0) return false;
    if (idx === 0) return true; // the first level is always open
    return this.isCompleted(this._order[idx - 1]);
  }

  /** Unlock-everything switch for testing. Persisted so it survives a reload. */
  get testMode() { return !!this.data.testMode; }
  setTestMode(on) { this.data.testMode = !!on; this._persist(); }

  /** A chapter is playable if it has levels and its first level is unlocked. */
  isChapterUnlocked(chapterId) {
    const chapter = this.levels.chapters.find((c) => c.id === chapterId);
    if (!chapter || !(chapter.levels?.length)) return false;
    return this.isLevelUnlocked(chapter.levels[0].id);
  }

  // --- Skins ---------------------------------------------------------------
  /** Currently equipped skin id (always falls back to the free default). */
  get equippedSkin() { return this.data.skin ?? 'classic'; }
  equipSkin(id) { this.data.skin = id; this._persist(); }

  /** The next level id in global order, or null if this is the last built level. */
  nextLevelId(id) {
    const idx = this._order.indexOf(id);
    return idx >= 0 && idx < this._order.length - 1 ? this._order[idx + 1] : null;
  }

  /**
   * Stars earned across the CURRENT campaign. Summing the stored records instead would count ids
   * that are no longer built — a save carried over from the old level set reported 420 stars in an
   * 84-star campaign, which then handed out every star-gated skin.
   */
  totalStars() {
    return this._order.reduce((sum, id) => sum + this.stars(id), 0);
  }

  /** The ceiling `totalStars()` is measured against — 3 per built level. */
  maxStars() { return this._order.length * 3; }

  completedCount() {
    return this._order.reduce((n, id) => n + (this.isCompleted(id) ? 1 : 0), 0);
  }

  /** Campaign completion as a 0-100 percentage; reported to the platform on every clear. */
  completionPercent() {
    return this._order.length ? (this.completedCount() / this._order.length) * 100 : 0;
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
