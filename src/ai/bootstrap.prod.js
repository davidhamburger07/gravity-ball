// bootstrap.prod.js — production stand-in for the AI / procgen dev tooling.
//
// build.mjs resolves `ai/bootstrap.js` to this file when bundling the shipped game. That keeps the
// level generator, the Q-learning playtester and the room-chunk library out of dist/ — a third of
// the bundle — and, more importantly, removes the `?ai=1` entry point, which in a shipped build
// would let anyone replace the campaign with generated levels and start an agent run.
//
// The two exports below are the entire surface main.js and PreloadScene use.
export function installAI() { /* dev-only console; nothing to install in production */ }

/** Always false: no URL can hand the shipped game over to the generator. */
export function autoStartFromUrl() { return false; }
