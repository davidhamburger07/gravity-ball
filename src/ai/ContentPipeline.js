// ContentPipeline.js — the automation loop that ties the two halves together.
//
//   generate a level  →  AI playtests it at accelerated speed  →  count attempts to win
//     →  won first try?  discard it (too easy)
//     →  took several tries?  KEEP it
//     →  never won?  park it as 'unsolved' (probably impossible, worth a human look)
//
// The pipeline outlives GameScene restarts by living in the game registry, so it can hand the
// scene a fresh level and pick straight back up when the scene rebuilds.
import AIPlaytester from './AIPlaytester.js';
import QLearningAgent from './QLearningAgent.js';
import { generateLevel } from '../procgen/LevelGenerator.js';
import { mulberry32, randomSeed } from '../procgen/rng.js';

export const PIPELINE_DEFAULTS = Object.freeze({
  levels: 10,        // how many levels to generate and test in this run
  seed: null,        // master seed; each level's seed is derived from it. null = random
  keepMin: 3,        // attempts needed before a level is worth keeping
  chapter: null,     // campaign chapter to build for; null = unrestricted (any mechanic)
  // A 3x2 slot grid capped at 4 rooms. The cap matters twice over: the agent's reach runs out
  // past ~4 rooms (it never leaves the opening rooms within maxEpisodes, so every level comes
  // back 'unsolved' and the run stops discriminating), and the wider grid leaves room for the
  // straight left-right segments most featured chapter rooms need. Raise these together with
  // maxEpisodes if you want sprawling levels.
  cols: 3,
  rows: 2,
  minRooms: 3,
  maxRooms: 4,
  difficultyBias: 1.4,
  sharedBrain: false, // false = fresh Q-table per level, so "attempts" measures THAT level
  hud: true,          // draw a progress overlay when running in a visible browser
  ai: {},             // overrides forwarded to AIPlaytester
});

export default class ContentPipeline {
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = { ...PIPELINE_DEFAULTS, ...opts };
    this.opts.ai = { ...PIPELINE_DEFAULTS.ai, ...(opts.ai ?? {}) };
    this.masterSeed = this.opts.seed ?? randomSeed();
    this._rand = mulberry32(this.masterSeed);

    this.index = -1;          // index of the level currently under test
    this.results = [];
    this.kept = [];
    this.done = false;
    this.stopped = false;
    this.startedAt = Date.now();
    this.currentLevel = null;
    this.playtester = null;
    this.brain = this.opts.sharedBrain ? new QLearningAgent(this.opts.ai) : null;

    this._hud = this.opts.hud ? createHud() : null;
  }

  /** Kick off a run: build the first level, then jump the game into agent mode. */
  static start(game, opts = {}) {
    const pipeline = new ContentPipeline(game, opts);
    game.registry.set('aiPipeline', pipeline);
    pipeline._advance();
    return pipeline;
  }

  /** Generate the next level and (re)start GameScene on it. */
  _advance() {
    this.index += 1;
    if (this.index >= this.opts.levels) return this._finish();

    const seed = Math.floor(this._rand() * 4294967296) >>> 0;
    this.currentLevel = generateLevel({
      seed,
      cols: this.opts.cols,
      rows: this.opts.rows,
      minRooms: this.opts.minRooms,
      maxRooms: this.opts.maxRooms,
      difficultyBias: this.opts.difficultyBias,
      chapter: this.opts.chapter ?? undefined,
      includeGrid: true,
      id: `gen-${seed}`,
    });
    this.playtester = null;

    this.game.registry.set('generatedLevel', this.currentLevel);
    ['MenuScene', 'LevelSelectScene'].forEach((k) => this.game.scene.isActive(k) && this.game.scene.stop(k));
    this.game.scene.start('GameScene', { agent: true });
  }

  /** GameScene calls this from create() once the level's bodies exist. */
  attach(scene) {
    this.scene = scene;
    this.playtester = new AIPlaytester(scene, this.opts.ai, this.brain);
    if (this.brain) this.brain.reset(); // shared brain: keep the object, drop stale Q values
    this._paint();
  }

  /**
   * Called by GameScene before every physics step. Returns 'run' to keep stepping this frame,
   * anything else to yield (level finished, or the whole run is over).
   */
  tick() {
    if (this.done) return 'halt';
    if (!this.playtester) return 'halt';
    const status = this.playtester.tick();
    if (status === 'done') {
      this._recordLevel();
      this._advance();
      return 'halt'; // the scene is restarting — stop stepping the old world
    }
    if (status === 'reset') this._paint();
    return 'run';
  }

  /** Classify the finished level and stash it if it's a keeper. */
  _recordLevel() {
    const r = this.playtester.result;
    const verdict = !r.solved ? 'unsolved' : r.attempts === 1 ? 'discard' : r.attempts >= this.opts.keepMin ? 'keep' : 'borderline';

    const record = {
      id: this.currentLevel.id,
      seed: this.currentLevel.meta.seed,
      verdict,
      attempts: r.attempts,
      solved: r.solved,
      deaths: r.deaths,
      timeouts: r.timeouts,
      bestScore: r.bestScore,
      closestApproach: r.closestApproach,
      winShifts: r.winShifts,
      qStates: r.qStates,
      rooms: this.currentLevel.meta.rooms.map((x) => x.chunk),
      difficultyHint: this.currentLevel.meta.difficultyHint,
      chapter: this.currentLevel.meta.chapter ?? null,
      featuredMissing: !!this.currentLevel.meta.featuredMissing,
      log: r.log,
    };
    this.results.push(record);
    // Retain everything except first-try wins. 'discard' means the AI walked it — there is no
    // reason to hold onto those, but a borderline or unsolved layout is still something the
    // author may want to look at or salvage.
    if (verdict !== 'discard') {
      this.kept.push({ verdict, level: this.currentLevel, result: record });
    }
    this._paint();
  }

  /** Stop early, keeping every level already tested. Used by the studio's Stop button. */
  stop() {
    if (!this.done) {
      this.stopped = true;
      this._finish();
    }
  }

  _finish() {
    this.done = true;
    this.finishedAt = Date.now();
    this._paint();
    // Announced on the window so a headless driver can poll one flag instead of guessing.
    if (typeof window !== 'undefined') window.__gbAIDone = true;
  }

  /** JSON-safe summary — what playtest-ai.mjs pulls out of the page and writes to disk. */
  get report() {
    const by = (v) => this.results.filter((r) => r.verdict === v).length;
    return {
      masterSeed: this.masterSeed,
      options: { ...this.opts, ai: { ...this.opts.ai } },
      elapsedMs: (this.finishedAt ?? Date.now()) - this.startedAt,
      tested: this.results.length,
      summary: { keep: by('keep'), discard: by('discard'), borderline: by('borderline'), unsolved: by('unsolved') },
      results: this.results,
      kept: this.kept.map((k) => ({ verdict: k.verdict, level: k.level })),
    };
  }

  // --- Progress overlay -------------------------------------------------------------------
  _paint() {
    if (!this._hud) return;
    const p = this.playtester;
    const kept = this.results.filter((r) => r.verdict === 'keep').length;
    this._hud.textContent = [
      `level ${Math.min(this.index + 1, this.opts.levels)}/${this.opts.levels}` +
        (this.currentLevel ? `  seed ${this.currentLevel.meta.seed}` : ''),
      p ? `attempt ${p.episode}  step ${p.steps}/${p.cfg.maxSteps}  score ${Math.round(p.score)}` : 'building…',
      p ? `epsilon ${p.agent.epsilon.toFixed(2)}  states ${p.agent.size}` : '',
      `kept ${kept}  ·  discarded ${this.results.filter((r) => r.verdict === 'discard').length}` +
        `  ·  unsolved ${this.results.filter((r) => r.verdict === 'unsolved').length}`,
      this.done ? '— run complete —' : '',
    ].filter(Boolean).join('\n');
  }
}

function createHud() {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('pre');
  el.id = 'ai-hud';
  el.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:100', 'margin:0',
    'padding:10px 14px', 'border-radius:8px', 'background:rgba(12,16,28,.86)',
    'border:1px solid #2a3050', 'color:#9aa0c3', 'font:12px/1.6 monospace',
    'white-space:pre', 'pointer-events:none',
  ].join(';');
  document.body.appendChild(el);
  return el;
}
