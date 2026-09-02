// AdProvider.basic.js — the no-ad build.
//
// build.mjs resolves AdProvider.js to this file unless GB_LAUNCH=full, because a Basic Launch
// submission may not contain ads and is rejected if the ad surface is merely present. Nothing
// here names the platform's ad or banner modules, so a scan of the shipped build finds no
// requestAd, no hasAdblock, no banner call and none of the ad type strings.
//
// The exports match AdProvider.js exactly. Callers already treat "no ad was shown" as an ordinary
// outcome — an unfilled request, an ad blocker and a disabled launch mode look identical to them —
// so nothing upstream needs to know which of the two files it was given.

export const ADS_AVAILABLE = false;

/** Nothing to block. */
export async function hasAdblock() { return false; }

const noAd = () => Promise.resolve({ shown: false, error: { code: 'adsDisabled' } });

export function midgameAd() { return noAd(); }

export function rewardedAd() { return noAd(); }

export async function showBanner() { /* this build has no banners */ }

export function clearBanners() { /* nothing was ever shown */ }
