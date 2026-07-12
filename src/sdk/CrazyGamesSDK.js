// CrazyGamesSDK.js — thin, defensive wrapper around the CrazyGames SDK v3.
// Every call is guarded so the game runs identically on localhost (mock mode) and on
// the CrazyGames platform. Initialize this EARLY in the boot sequence.
//
// Docs: https://docs.crazygames.com/sdk/html5/

const raw = () => (typeof window !== 'undefined' ? window.CrazyGames?.SDK : undefined);

export const CrazyGamesSDK = {
  available: false,

  async init() {
    try {
      if (raw()) {
        await raw().init();
        this.available = true;
        console.info('[CrazyGames] SDK initialized.');
      } else {
        console.info('[CrazyGames] SDK not present — running in local mock mode.');
      }
    } catch (err) {
      console.warn('[CrazyGames] init failed; continuing in mock mode.', err);
    }
  },

  // --- Loading lifecycle (call around the initial asset load) --------------
  loadingStart() { this._safe(() => raw().game.loadingStart()); },
  loadingStop() { this._safe(() => raw().game.loadingStop()); },

  // --- Gameplay lifecycle (REQUIRED: wrap every playable level) ------------
  gameplayStart() { this._safe(() => raw().game.gameplayStart()); },
  gameplayStop() { this._safe(() => raw().game.gameplayStop()); },

  // Signals a "moment of joy" (level win) — improves ad timing on the platform.
  happytime() { this._safe(() => raw().game.happytime()); },

  // --- Ads ----------------------------------------------------------------
  // Interstitial between levels/chapters. Pause audio/gameplay in the callbacks.
  midgameAd({ onStart, onFinish } = {}) {
    if (!this.available) { onFinish?.(); return; }
    this._safe(() =>
      raw().ad.requestAd('midgame', {
        adStarted: () => onStart?.(),
        adFinished: () => onFinish?.(),
        adError: () => onFinish?.(),
      })
    );
  },

  // Rewarded ad for hints / skip-level / extra-undo. Grant the reward ONLY in adFinished.
  rewardedAd({ onReward, onFinish } = {}) {
    if (!this.available) { onReward?.(); onFinish?.(); return; } // reward locally in dev
    this._safe(() =>
      raw().ad.requestAd('rewarded', {
        adFinished: () => { onReward?.(); onFinish?.(); },
        adError: () => onFinish?.(),
      })
    );
  },

  // --- Cloud/local save (falls back to localStorage off-platform) ---------
  async setItem(key, value) {
    try {
      if (this.available) raw().data.setItem(key, value);
      else localStorage.setItem(key, value);
    } catch (err) { console.warn('[CrazyGames] setItem failed', err); }
  },

  async getItem(key) {
    try {
      return this.available ? raw().data.getItem(key) : localStorage.getItem(key);
    } catch (err) { console.warn('[CrazyGames] getItem failed', err); return null; }
  },

  _safe(fn) {
    if (!this.available) return;
    try { fn(); } catch (err) { console.warn('[CrazyGames] call failed', err); }
  },
};
