// bootstrap.js — the public entry point for the content pipeline.
//
// Installs `window.GravityBallAI`, which is how both the headless harness (playtest-ai.mjs)
// and a human at the devtools console drive the generator and the AI:
//
//   GravityBallAI.run({ levels: 10 })      // generate + playtest, watch it in the browser
//   GravityBallAI.report                   // results once .done is true
//   GravityBallAI.playSeed(123456)         // play a generated level yourself
//   GravityBallAI.preview(123456)          // ASCII dump of a layout, no physics involved
import ContentPipeline from './ContentPipeline.js';
import { generateLevel } from '../procgen/LevelGenerator.js';

export function installAI(game) {
  const api = {
    generateLevel,

    /** Start (or restart) an automated run. Returns the ContentPipeline. */
    run(opts = {}) {
      window.__gbAIDone = false;
      return ContentPipeline.start(game, opts);
    },

    /** Load one generated level and hand control back to the keyboard. */
    playSeed(seed, opts = {}) {
      const level = generateLevel({ ...opts, seed });
      game.registry.set('generatedLevel', level);
      ['MenuScene', 'LevelSelectScene'].forEach((k) => game.scene.isActive(k) && game.scene.stop(k));
      game.scene.start('GameScene', { generated: true });
      return level;
    },

    /** The stitched room grid as text — the quickest way to judge a layout. */
    preview(seed, opts = {}) {
      const level = generateLevel({ ...opts, seed, includeGrid: true });
      console.log(level.meta.rooms.map((r) => r.chunk).join('  >  '));
      console.log(level.meta.grid.join('\n'));
      return level;
    },

    get pipeline() { return game.registry.get('aiPipeline') ?? null; },
    get done() { return !!game.registry.get('aiPipeline')?.done; },
    get report() { return game.registry.get('aiPipeline')?.report ?? null; },
  };

  window.GravityBallAI = api;
  return api;
}

/**
 * `?ai=1` on the URL starts a run as soon as the game boots. Extra params map onto the
 * pipeline options, so a headless driver can configure a whole run from the address bar:
 *   ?ai=1&levels=20&seed=7&keepMin=4&cols=4&rows=2
 */
export function autoStartFromUrl(game) {
  const q = new URLSearchParams(location.search);
  if (!q.has('ai')) return false;

  const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
  const opts = clean({
    levels: num('levels'),
    seed: num('seed'),
    keepMin: num('keepMin'),
    cols: num('cols'),
    rows: num('rows'),
    minRooms: num('minRooms'),
    difficultyBias: num('difficultyBias'),
    hud: q.get('hud') !== '0',
    ai: clean({
      actionSet: q.get('actionSet') ?? undefined,
      maxEpisodes: num('maxEpisodes'),
      maxSteps: num('maxSteps'),
      shaping: num('shaping'),
    }),
  });

  window.GravityBallAI.run(opts);
  return true;
}

/** Drop undefined/NaN so URL params never overwrite a default with garbage. */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || (typeof v === 'number' && Number.isNaN(v))) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}
