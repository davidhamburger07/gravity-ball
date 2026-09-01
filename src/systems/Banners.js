// Banners.js — display banner ads on the menu screens only.
//
// The playfield is a 800x696 canvas that Phaser FITs and centres, so on almost any window there is
// letterbox left over below it. The #cg-banner container lives in that letterbox, which is what
// keeps this compliant: the platform forbids a banner that covers game UI at any screen size, and
// here the canvas and the banner never share a pixel.
//
// Caller rules that this module cannot enforce for you:
//   - never show a banner over gameplay (GameScene calls clear() on create and on shutdown);
//   - never refresh a banner while a video ad is playing — clear() before requesting an ad.
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';

const CONTAINER_ID = 'cg-banner';
const MIN_REFRESH_MS = 30000; // platform minimum between refreshes of the same banner

let lastRefresh = 0;

const container = () => (typeof document !== 'undefined' ? document.getElementById(CONTAINER_ID) : null);

export const Banners = {
  /**
   * Show (or refresh) the menu banner. A no-op off-platform: the local SDK environment has no
   * banner inventory, and rendering an empty container would just push the layout around.
   */
  async show() {
    if (!CrazyGamesSDK.onPlatform || CrazyGamesSDK.adblock) return;
    const el = container();
    if (!el) return;
    if (Date.now() - lastRefresh < MIN_REFRESH_MS) {
      el.style.display = 'block'; // already fresh — just make sure it is visible
      return;
    }
    lastRefresh = Date.now();
    el.style.display = 'block';
    try {
      await window.CrazyGames.SDK.banner.requestResponsiveBanner(CONTAINER_ID);
    } catch {
      // Unfilled or blocked — hide the empty box rather than leaving a gap on the page.
      el.style.display = 'none';
    }
  },

  clear() {
    try { window.CrazyGames?.SDK?.banner?.clearAllBanners(); } catch { /* nothing to clear */ }
    const el = container();
    if (el) el.style.display = 'none';
  },
};
