// AdProvider.js — the ONLY place that knows the CrazyGames ad and banner APIs exist.
//
// It is isolated for one reason: a Basic Launch submission may not contain ads, and the platform
// rejects a build where the ad surface is merely PRESENT, not just where an ad is shown. The build
// swaps this file for AdProvider.basic.js, so the shipped bundle then contains no requestAd, no
// hasAdblock, no banner call, and not even the "midgame"/"rewarded" type strings.
//
// That is why the promise wrapper lives here rather than in CrazyGamesSDK: leaving it upstream
// left `adStarted`/`adFinished`/`adError` and the type strings in the bundle even after the raw
// calls were swapped out. Everything an ad needs is behind this one import.
//
// Build without ads (Basic Launch):  npm run package:crazygames        <- the default
// Build with ads (Full Launch):      GB_LAUNCH=full npm run package:crazygames

const sdk = () => (typeof window !== 'undefined' ? window.CrazyGames?.SDK : undefined);

export const ADS_AVAILABLE = true;

let inFlight = false;

/** Resolves true when an ad blocker is present. Never throws. */
export async function hasAdblock() {
  try {
    return Boolean(await sdk().ad.hasAdblock());
  } catch {
    return false;
  }
}

/**
 * Request an ad and resolve with what actually happened.
 *
 * The platform API is callbacks-only, so wrapping it in a promise that ALWAYS resolves is the
 * point: the caller pauses the game and unpauses off the resolution, and a request that throws
 * synchronously or never calls back would otherwise freeze the game with no way out.
 *
 * @returns {Promise<{shown: boolean, error: ?{code: string, message?: string}}>}
 */
function request(type, { onStart, onStop } = {}) {
  return new Promise((resolve) => {
    if (inFlight) {
      resolve({ shown: false, error: { code: 'unavailable' } });
      return;
    }
    inFlight = true;
    let started = false;
    let settled = false;

    const done = (shown, error = null) => {
      if (settled) return;
      settled = true;
      inFlight = false;
      clearTimeout(timer);
      if (started) { try { onStop?.(); } catch { /* a caller hook must not strand the game */ } }
      resolve({ shown, error });
    };

    // Watchdog: some blockers swallow the callbacks entirely. Never strand the player.
    const timer = setTimeout(() => done(false, { code: 'timeout', message: 'no ad callback' }), 60000);

    try {
      sdk().ad.requestAd(type, {
        adStarted: () => { started = true; try { onStart?.(); } catch { /* ignore */ } },
        adFinished: () => done(true),
        adError: (error) => done(false, error ?? { code: 'other' }),
      });
    } catch (err) {
      done(false, { code: 'other', message: String(err?.message ?? err) });
    }
  });
}

/** Interstitial. Only ever at a natural break — never mid-level, never after a death. */
export function midgameAd(hooks) { return request('midgame', hooks); }

/** Rewarded. Grant the reward ONLY when the resolved `shown` is true. */
export function rewardedAd(hooks) { return request('rewarded', hooks); }

/** Fill a container with a responsive banner. */
export async function showBanner(containerId) {
  await sdk().banner.requestResponsiveBanner(containerId);
}

/** Remove every banner currently on the page. */
export function clearBanners() {
  try { sdk()?.banner?.clearAllBanners(); } catch { /* nothing to clear */ }
}
