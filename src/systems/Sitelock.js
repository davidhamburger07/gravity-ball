// Sitelock.js — refuse to run if the build has been lifted onto someone else's site.
//
// This is a deterrent, not security: anyone determined can edit the bundle. The point is to make
// casually re-hosting the stolen files not work.
//
// The host check is CrazyGames' own published function, used verbatim rather than reinvented — it
// accepts every regional domain (crazygames.fr, crazygames.com.br, de.crazygames.com, ...) and the
// mobile app origins, and getting that list subtly wrong is the one way sitelock can do real
// damage: a false negative would show a block screen to real players and fail QA.
//
// Everything here fails OPEN. If the hostname cannot be read, or anything throws, the game runs.
// A broken lock that lets a thief through is a small loss; one that blocks paying players is not.

/** CrazyGames' published check: "crazygames" appears within the last three labels of the host. */
function isCrazyGames(hostname) {
  const parts = hostname.split('.');
  const idx = parts.indexOf('crazygames');
  return idx !== -1 && idx >= parts.length - 3;
}

/** Local development, and the Vercel deployment that also hosts the level API. */
function isOwnHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === ''            // file:// and some embedded webviews
    || hostname.endsWith('.vercel.app');
}

export function isAllowedHost(hostname = globalThis.location?.hostname) {
  try {
    // Anything that is not a readable hostname means we cannot judge — so we do not judge.
    // location.hostname is always a string in a browser; this only guards odd embeddings.
    if (typeof hostname !== 'string') return true;
    const host = hostname.toLowerCase();
    return isCrazyGames(host) || isOwnHost(host);
  } catch {
    return true; // fail open — never block on an error in the lock itself
  }
}

/**
 * Show a block screen instead of the game. Returns true when the host is allowed and the caller
 * should carry on booting.
 */
export function enforceSitelock() {
  if (isAllowedHost()) return true;

  try {
    document.getElementById('loading')?.remove();
    const root = document.getElementById('game-root') ?? document.body;
    root.innerHTML = '<div style="position:fixed;inset:0;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:14px;font-family:system-ui,sans-serif;'
      + 'color:#9aa0c3;text-align:center;padding:24px">'
      + '<div style="font-size:26px;font-weight:700;color:#38e1ff">Gravity Ball</div>'
      + '<div style="font-size:15px">This copy is hosted somewhere it should not be.</div>'
      + '<a href="https://www.crazygames.com" style="font-size:15px;color:#ffd23f">'
      + 'Play the real thing on CrazyGames</a></div>';
  } catch { /* nothing we can do; the game simply will not start */ }

  return false;
}
