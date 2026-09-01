// AdBreaks.js — decides WHEN a midgame interstitial is allowed.
//
// The platform enforces its own cooldown and returns an `adCooldown` error when you ask too soon,
// but leaning on that is wrong twice over: it wastes a request, and it would still let a player
// speedrunning three 40-second levels hit an ad prompt every couple of minutes. This gate sits in
// front of every request so the pacing is a deliberate choice rather than a side effect.
//
// Deliberately in-memory and NOT persisted. A gate that survived a reload would let anyone dodge
// every ad by refreshing, and storing it in the platform data module would spend the save budget
// on something that only matters for the current session.
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';

const MIN_GAP_MS = 180000;  // platform guidance: at most one midgame ad every 3 minutes
const MIN_LEVELS = 3;       // ...and never more often than every 3 level advances
const GRACE_LEVELS = 3;     // no ad at all during the first few clears, so onboarding stays clean

let lastAdAt = 0;
let levelsSinceAd = 0;
let completions = 0;

export const AdBreaks = {
  /**
   * Call once per level advance. It counts the advance whether or not an ad runs, which is what
   * makes "every 3rd level at the earliest" mean what it says.
   */
  shouldShowMidgame() {
    completions += 1;
    levelsSinceAd += 1;
    if (!CrazyGamesSDK.available || CrazyGamesSDK.adblock) return false;
    if (completions <= GRACE_LEVELS) return false;
    if (levelsSinceAd < MIN_LEVELS) return false;
    return Date.now() - lastAdAt >= MIN_GAP_MS;
  },

  markShown() {
    lastAdAt = Date.now();
    levelsSinceAd = 0;
  },
};
