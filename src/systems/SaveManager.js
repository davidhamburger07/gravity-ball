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

// Chapter 1 is a strict chain; every later chapter unlocks on stars.
//
// A gate is a fraction of the stars AVAILABLE from everything before it, not a flat count. That
// distinction is the whole design: a flat count based on level index was cleared outright by
// three-starring chapter 1, which opened the entire game at once. As a fraction it scales with
// the pool, so the gate keeps meaning as the campaign grows.
//
// GATE_RATE is therefore also the average star rating a player must sustain to stay ahead of
// the gates: at 0.67 that is 2 of 3 per level, so competent play flows straight through and
// only sloppy play has to go back and improve. Raising it toward 0.87 turns the campaign
// into a mastery gate — a straight two-star player is then blocked at the end of chapter 1.
const FIRST_CHAPTER = 1;
const GATE_RATE = 0.67;
const STARS_PER_LEVEL = 3;
// A fixed cushion on top of the rate, worth a little more than one level. Without it a player
// earning exactly GATE_RATE has zero surplus, so skipping a single level puts them permanently
// behind the next gate — which is the one thing this whole scheme exists to prevent.
const GATE_SLACK = 4;

export default class SaveManager {
  /** @param {object} levels  Parsed levels.json (used to compute level order + unlocks). */
  constructor(levels) {
    this.levels = levels;
    this.data = { levels: {} }; // { "1-1": { completed, stars, shifts } }
    this._order = this._flattenOrder(levels);
    this._chapterOf = this._mapChapters(levels);
  }

  /** id -> chapter id, so the unlock rule can treat chapter 1 differently from the rest. */
  _mapChapters(levels) {
    const map = new Map();
    levels.chapters.forEach((c) => (c.levels ?? []).forEach((l) => map.set(l.id, c.id)));
    return map;
  }

  _flattenOrder(levels) {
    const ids = [];
    levels.chapters.forEach((c) => (c.levels ?? []).forEach((l) => ids.push(l.id)));
    return ids;
  }

  /**
   * Read progress from the local mirror. SYNCHRONOUS and deliberately so.
   *
   * This used to await the platform SDK, which meant the whole game waited on it: measured at
   * SEVEN SECONDS on a non-CrazyGames host, where the SDK spends that long failing a handshake
   * before reporting environment "disabled". Every asset was in memory after 755ms and the
   * player still watched a spinner until 7.8s.
   *
   * Every write goes to localStorage as well as the cloud (see _persist), so the local copy is
   * always as fresh as the last write ON THIS DEVICE. That is enough to start playing instantly;
   * syncFromCloud() reconciles afterwards for the cross-device case.
   */
  load() {
    try {
      let raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
      if (raw) this.data = JSON.parse(raw);
      if (!this.data.levels) this.data.levels = {};
    } catch {
      this.data = { levels: {} };
    }
    return this;
  }

  /**
   * Reconcile with the cloud copy once the SDK is actually up. Runs in the background, after the
   * menu is already on screen.
   *
   * Adopts the cloud save only when it has strictly MORE cleared levels than what is held here.
   * A stale cloud copy must never roll back progress this device just made; the only case worth
   * importing is a player arriving on a new device with real progress behind them.
   */
  async syncFromCloud() {
    try {
      let raw = await CrazyGamesSDK.getItem(STORAGE_KEY);
      if (!raw) raw = await this._migrateLegacy();
      if (!raw) return false;
      const cloud = JSON.parse(raw);
      if (!cloud || typeof cloud !== 'object') return false;
      const cleared = (d) => Object.values(d?.levels ?? {}).filter((l) => l?.completed).length;
      if (cleared(cloud) <= cleared(this.data)) return false;
      this.data = cloud;
      if (!this.data.levels) this.data.levels = {};
      CrazyGamesSDK.mirror(STORAGE_KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false; // a failed sync must never cost the player the save they already have
    }
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
   * How many stars are needed to open a level, or 0 when it is gated some other way.
   *
   * Chapter 1 stays a strict chain: its levels are short enough to clear in a row, and the chain
   * is what teaches the verb before anything else is offered.
   *
   * Everything after it opens on total stars instead, so being stuck on one level never walls off
   * the rest of the game. The requirement rises by exactly one star per level while a cleared
   * level is worth one to three, so a player who only ever scrapes a single star still gains on
   * it — and SLACK is the number of levels they may simply skip and come back to.
   */
  starsRequired(id) {
    const idx = this._order.indexOf(id);
    if (idx < 0) return 0;
    if (this._chapterOf.get(id) === FIRST_CHAPTER) return 0; // sequential, not star-gated
    // Everything before this level is the pool; the gate asks for GATE_RATE of it.
    return Math.max(0, Math.round(idx * STARS_PER_LEVEL * GATE_RATE) - GATE_SLACK);
  }

  /**
   * Chapter 1 opens level by level. From chapter 2 on, a level opens once the player has earned
   * enough stars campaign-wide, so a level they cannot beat is a detour rather than a dead end.
   * Test mode opens everything.
   */
  isLevelUnlocked(id) {
    if (this.testMode) return true;
    const idx = this._order.indexOf(id);
    // An id outside the campaign is not "unlocked" — it does not exist. Conflating the two used to
    // report every stale id from the old campaign as playable.
    if (idx < 0) return false;
    if (idx === 0) return true; // the first level is always open

    if (this._chapterOf.get(id) === FIRST_CHAPTER) return this.isCompleted(this._order[idx - 1]);
    return this.totalStars() >= this.starsRequired(id);
  }

  /** Stars still needed to open a level; 0 when it is already open. */
  starsToUnlock(id) {
    if (this.isLevelUnlocked(id)) return 0;
    return Math.max(0, this.starsRequired(id) - this.totalStars());
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
