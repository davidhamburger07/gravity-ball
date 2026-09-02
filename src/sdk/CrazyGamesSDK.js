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

// Every ad and banner call goes through AdProvider, which the build swaps for a no-op version
// in a Basic Launch build. Do not call window.CrazyGames.SDK.ad or .banner from anywhere else.
import * as Ads from './AdProvider.js';

export const CrazyGamesSDK = {
  available: false,        // true when SDK calls are legal ('local' or 'crazygames')
  environment: 'disabled', // 'local' | 'crazygames' | 'disabled'
  onPlatform: false,       // true only for 'crazygames' — gates banners and invite links
  adblock: false,
  /** True when the platform itself has muted the game (its chrome, not our button). */
  audioMuted: false,

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
      this.adblock = await Ads.hasAdblock();
      // The platform can mute the game from its own UI. Requirement: this outranks any in-game
      // toggle, so it is wired straight into AudioManager rather than offered as a suggestion.
      this._watchAudioSetting(sdk);
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
  // Delegated wholesale to AdProvider, which the build swaps for a no-op in a Basic Launch
  // build. Nothing about an ad — not the promise wrapper, not the callback shape, not the type
  // strings — lives in this file, because all of it has to disappear from a no-ad bundle.

  /** Interstitial. Resolves {shown, error} and never rejects. */
  midgameAd(hooks) { return Ads.midgameAd(hooks); },

  /** Rewarded. Grant the reward ONLY when the resolved `shown` is true. */
  rewardedAd(hooks) { return Ads.rewardedAd(hooks); },

  /** False in a build with no ads at all, so callers can skip offering one. */
  get adsAvailable() { return Ads.ADS_AVAILABLE; },

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

  /** Mirror the platform mute setting into AudioManager, now and whenever it changes. */
  _watchAudioSetting(sdk) {
    const apply = (settings) => {
      this.audioMuted = Boolean(settings?.muteAudio);
      this.onAudioMuteChange?.(this.audioMuted);
    };
    try {
      apply(sdk.game.settings);
      sdk.game.addSettingsChangeListener?.(apply);
    } catch (err) {
      console.warn('[CrazyGames] audio settings unavailable', err);
    }
  },

  _safe(fn) {
    if (!this.available) return;
    try { fn(); } catch (err) { console.warn('[CrazyGames] call failed', err); }
  },
};
