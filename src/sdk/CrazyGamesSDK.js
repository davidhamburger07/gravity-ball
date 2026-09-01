// CrazyGamesSDK.js — thin, defensive wrapper around the CrazyGames SDK v3.
// Every call is guarded so the game runs identically on localhost (mock mode) and on
// the CrazyGames platform. Initialize this EARLY in the boot sequence.
//
// Docs: https://docs.crazygames.com/sdk/html5/
//
// Two v3 details this wrapper exists to absorb:
//   - `SDK.environment` is a STRING PROPERTY ('local' | 'crazygames' | 'disabled'). v2's
//     getEnvironment(callback) does not exist in v3.
//   - `SDK.data` is SYNCHRONOUS — the same shape as window.localStorage, not a promise API.

const raw = () => (typeof window !== 'undefined' ? window.CrazyGames?.SDK : undefined);

export const CrazyGamesSDK = {
  available: false,        // true when SDK calls are legal ('local' or 'crazygames')
  environment: 'disabled', // 'local' | 'crazygames' | 'disabled'
  onPlatform: false,       // true only for 'crazygames' — gates banners and invite links
  adblock: false,

  async init() {
    const sdk = raw();
    if (!sdk) {
      console.info('[CrazyGames] SDK script absent — running in local mock mode.');
      return;
    }
    try {
      await sdk.init();
      this.environment = sdk.environment ?? 'disabled';
      // 'local' counts as available: the SDK ships a local handler for every module, so dev and
      // production exercise the same code path instead of diverging at every call site.
      this.available = this.environment === 'local' || this.environment === 'crazygames';
      this.onPlatform = this.environment === 'crazygames';
      if (!this.available) {
        console.info(`[CrazyGames] environment="${this.environment}" — SDK calls disabled.`);
        return;
      }
      this.adblock = await sdk.ad.hasAdblock().catch(() => false);
      console.info(`[CrazyGames] ready (env=${this.environment}, adblock=${this.adblock}).`);
    } catch (err) {
      this.available = false;
      console.warn('[CrazyGames] init failed; continuing in mock mode.', err);
    }
  },

  // --- Loading lifecycle (call around the initial asset load) --------------
  loadingStart() { this._safe(() => raw().game.loadingStart()); },
  loadingStop() { this._safe(() => raw().game.loadingStop()); },

  // --- Gameplay lifecycle (REQUIRED: wrap every playable level) ------------
  // These must strictly alternate. GameScene owns the pairing through _gameplayOn/_gameplayOff —
  // nothing else should call them directly.
  gameplayStart() { this._safe(() => raw().game.gameplayStart()); },
  gameplayStop() { this._safe(() => raw().game.gameplayStop()); },

  // Signals a "moment of joy" (level win) — improves ad timing on the platform.
  happytime() { this._safe(() => raw().game.happytime()); },

  /** Campaign progress, 0-100. The platform uses it for retention reporting. */
  reportProgress(pct) {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    this._safe(() => raw().game.reportGameCompletedPercentage(clamped));
  },

  // --- Ads ----------------------------------------------------------------
  _adInFlight: false,

  /**
   * Request an ad and resolve with what actually happened.
   *
   * The platform API is callbacks-only: `requestAd(type, { adStarted, adFinished, adError })`.
   * Wrapping it in a promise that ALWAYS resolves is the whole point of this method — the caller
   * pauses the game and unpauses off the resolution, so a request that throws synchronously or
   * never calls back would otherwise leave the game frozen with no way out. The previous version
   * swallowed a synchronous throw and never fired its finish callback, which was a real soft-lock.
   *
   * @returns {Promise<{shown: boolean, error: ?{code: string, message?: string}}>}
   */
  _requestAd(type, { onStart, onStop } = {}) {
    return new Promise((resolve) => {
      if (!this.available || this._adInFlight) {
        resolve({ shown: false, error: { code: 'unavailable' } });
        return;
      }
      this._adInFlight = true;
      let started = false;
      let settled = false;

      const done = (shown, error = null) => {
        if (settled) return;
        settled = true;
        this._adInFlight = false;
        clearTimeout(timer);
        if (started) { try { onStop?.(); } catch { /* a caller hook must not strand the game */ } }
        resolve({ shown, error });
      };

      // Watchdog: some blockers swallow the callbacks entirely. Never strand the player.
      const timer = setTimeout(() => done(false, { code: 'timeout', message: 'no ad callback' }), 60000);

      try {
        raw().ad.requestAd(type, {
          adStarted: () => { started = true; try { onStart?.(); } catch { /* ignore */ } },
          adFinished: () => done(true),
          adError: (error) => done(false, error ?? { code: 'other' }),
        });
      } catch (err) {
        done(false, { code: 'other', message: String(err?.message ?? err) });
      }
    });
  },

  /** Interstitial. Only ever at a natural break — never mid-level, never after a death. */
  midgameAd(hooks) { return this._requestAd('midgame', hooks); },

  /** Rewarded. Grant the reward ONLY when the resolved `shown` is true. */
  rewardedAd(hooks) { return this._requestAd('rewarded', hooks); },

  // --- User account (level finder) -----------------------------------------
  // Off-platform these return null and PlayerIdentity falls back to a local id.

  /**
   * A short-lived signed JWT proving who the player is. The level API verifies it server-side,
   * which is what makes a published author name trustworthy.
   * Not cached: the SDK refreshes it internally and the token only lives an hour.
   */
  async getUserToken() {
    if (!this.available) return null;
    try {
      return (await raw().user.getUserToken()) ?? null;
    } catch {
      return null; // Not signed in, or the player dismissed the prompt.
    }
  },

  /** The player's CrazyGames profile, or null when not signed in. */
  async getUser() {
    if (!this.available) return null;
    try {
      return (await raw().user.getUser()) ?? null;
    } catch {
      return null;
    }
  },

  /** Invite the player to sign in. Resolves to the user, or null if they declined. */
  async promptSignIn() {
    if (!this.available) return null;
    try {
      return (await raw().user.showAuthPrompt()) ?? null;
    } catch {
      return null;
    }
  },

  // --- Cloud/local save (falls back to localStorage off-platform) ---------
  // Synchronous, matching the v3 data module. Existing call sites still `await` these; awaiting a
  // non-promise is harmless, which is what kept the change non-breaking.
  setItem(key, value) {
    try {
      if (this.available) raw().data.setItem(key, String(value));
      else localStorage.setItem(key, String(value));
    } catch (err) { console.warn('[CrazyGames] setItem failed', err); }
  },

  getItem(key) {
    try {
      return this.available ? raw().data.getItem(key) : localStorage.getItem(key);
    } catch (err) { console.warn('[CrazyGames] getItem failed', err); return null; }
  },

  removeItem(key) {
    try {
      if (this.available) raw().data.removeItem(key);
      else localStorage.removeItem(key);
    } catch (err) { console.warn('[CrazyGames] removeItem failed', err); }
  },

  /**
   * Keep a durable local copy alongside the cloud one. The data module debounces its writes for
   * about a second, and the game hard-navigates to editor.html from two places — a write that
   * lands inside that window is simply lost. localStorage is synchronous and survives it.
   */
  mirror(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* private mode, or quota */ }
  },

  _safe(fn) {
    if (!this.available) return;
    try { fn(); } catch (err) { console.warn('[CrazyGames] call failed', err); }
  },
};
