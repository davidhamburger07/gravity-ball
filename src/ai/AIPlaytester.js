// AIPlaytester.js — drives one level with a Q-learning agent.
//
// It plugs into GameScene's fixed-timestep loop: GameScene calls `tick()` immediately before
// every physics step, so the agent sees the world at simulation resolution rather than at
// render resolution. Actions go out on the SAME 'gravity:request' event a human's arrow key
// produces, so the AI is subject to every rule a player is (shift cooldown, shift budgets,
// sticky-pad release) — there is no privileged path into the physics.
import QLearningAgent from './QLearningAgent.js';
import { GravityDirection } from '../systems/GravityController.js';

// The strict point system, exactly as specified. These are the numbers the pipeline reports.
export const REWARDS = Object.freeze({
  GOAL: 1000,
  DEATH: -500,
  KEY: 200,
  PER_FRAME: -1,
});

// Gravity cycles in this order when the agent presses its one button.
const CYCLE = [GravityDirection.DOWN, GravityDirection.LEFT, GravityDirection.UP, GravityDirection.RIGHT];
const OPPOSITE = {
  [GravityDirection.DOWN]: GravityDirection.UP,
  [GravityDirection.UP]: GravityDirection.DOWN,
  [GravityDirection.LEFT]: GravityDirection.RIGHT,
  [GravityDirection.RIGHT]: GravityDirection.LEFT,
};

export const DEFAULTS = Object.freeze({
  // --- Action space -------------------------------------------------------------------
  // 'quad'   : 5 actions — do nothing, or set gravity directly to one of four directions.
  //            Matches what a human with arrow keys actually has.
  // 'cycle'  : 2 actions — do nothing, or press FLIP (gravity advances down→left→up→right).
  //            One button, and every direction is still reachable.
  // 'binary' : 2 actions — do nothing, or flip 180 degrees on the current axis.
  //            The literal reading of "flip gravity"; only reaches two of four directions.
  //
  // Default is 'quad' rather than a single button, because this agent is being used as a
  // difficulty oracle and the player it stands in for has four arrow keys. A handicapped
  // agent measures the handicap, not the level. Measured on identical seeds: on 2-room levels
  // 'cycle' keeps 5/16 against quad's 15/16, and on 3-4 room levels 'cycle' keeps 0/16
  // against quad's 7/16 — i.e. with one button nearly every level reads as "impossible",
  // which tells you nothing about the level. Set 'cycle' for the literal one-button brief.
  actionSet: 'quad',

  // --- Episode shape ------------------------------------------------------------------
  decisionSteps: 20,   // physics steps between decisions (~139ms — just past the 120ms cooldown)
  maxSteps: 3000,      // hard episode cap (~21 real-equivalent seconds) before a timeout
  // Raised from 120 to give `explorationWarmup` room: at 120 the warmup ate a fifth of the
  // budget and cost ~5 solves out of 24; at 200 it pays for itself.
  maxEpisodes: 200,

  // --- Flip gating --------------------------------------------------------------------
  // A gravity flip is only offered when the ball is touching a surface, or when this long has
  // passed since the last one. Without the gate the agent flips on nearly every decision while
  // airborne, which reads as vibrating in place: each flip cancels the momentum the last one
  // built, so the ball hovers instead of travelling. Grounded flips are always free, because
  // pushing off a surface is the actual mechanic.
  //
  // 250ms, not 500. Measured over 24 chapter-2 levels on one seed, solved counts were:
  // ungated 11, 150ms 14, 250ms 14, 500ms 10. Half a second is long enough to remove air
  // control altogether — it withheld 66% of all decisions — and in a game where the ball
  // spends most of its time in flight, redirecting mid-air is not vibration, it is the skill.
  flipCooldownMs: 250,

  // --- Learning -----------------------------------------------------------------------
  alpha: 0.15,
  gamma: 0.985,
  // Exploration is deliberately slow to anneal. Spikes make this game's reward landscape full
  // of local minima — sitting still in a safe corner beats moving and dying — and an agent that
  // goes greedy early parks in one forever. The first `explorationWarmup` episodes ignore the
  // Q-table entirely and act at random, so it is seeded with real trajectories before it is
  // ever trusted; only then does epsilon decay, and slowly, to a floor that never stops
  // exploring outright.
  //
  // The warmup only pays off with episodes to spare — it competes for the same budget as
  // learning, so it needs maxEpisodes raised alongside it. Set it to 0 to anneal from the
  // first episode.
  explorationWarmup: 25,
  epsilon: 0.6,
  epsilonMin: 0.15,
  epsilonDecay: 0.995,

  // Dense distance shaping, worth `shapingStep` points per grid cell of progress toward the
  // current target. Feeds the Q update ONLY — reported scores stay on the specified scale.
  //
  // It is doing real work: the strict point system alone has a perverse optimum, because at
  // -1/frame dying at step 150 (-650) beats surviving to a 3000-step timeout (-3000), so an
  // agent that cannot yet reach the goal learns to kill itself. Paying for progress makes
  // moving worth more than the clock it costs. Set to 0 to see the raw sparse behaviour.
  shapingStep: 10,

  // --- State discretisation -----------------------------------------------------------
  // Position is bucketed into a coarse grid rather than tracked as raw pixel floats, so the
  // agent can actually memorise a map: a 2400x1200 level is ~2.9M distinct pixel positions but
  // only ~2800 grid cells, and every visit to a cell reinforces the same Q row.
  //
  // 32 matches the ball's 32px diameter, so one cell is one ball-width — the finest grid where
  // "the ball is in this cell" still means something physical. Coarser buckets generalise
  // faster but blur distinct ledges together; see docs/PROCGEN-AI.md for the measured
  // comparison against 60.
  posCell: 32,
});

/**
 * Discretise a raw observation into a Q-table key.
 *
 * Every field the brief asked for is in here: ball X/Y, current speed (as signed per-axis
 * buckets, which carries direction as well as magnitude), gravity state, and the distances
 * to the goal, the nearest spike, and the nearest key.
 */
export function encodeState(obs, cfg = DEFAULTS) {
  const cx = Math.floor(obs.x / cfg.posCell);
  const cy = Math.floor(obs.y / cfg.posCell);
  const g = CYCLE.indexOf(obs.gravity);
  const target = currentTarget(obs);
  return [
    cx,
    cy,
    velBucket(obs.vx),
    velBucket(obs.vy),
    g,
    obs.grounded ? 1 : 0, // whether a flip is even available — see flipCooldownMs
    distBucket(target.dist, [140, 400, 900]),
    distBucket(obs.spike.dist, [50, 110, 220]),
    obs.keysHeld,
  ].join(',');
}

/**
 * What the agent should currently be heading for.
 *
 * A locked level is two problems in sequence, and rewarding goal-proximity throughout makes the
 * agent hug a goal it cannot open while the key sits behind it. So the target snaps to the
 * nearest uncollected key first and only becomes the goal once every key is taken.
 */
export function currentTarget(obs) {
  if (obs.key) return { kind: 'key', dist: obs.key.dist };
  return { kind: 'goal', dist: obs.goal.dist };
}

// Signed speed buckets. The thresholds sit either side of "barely moving" so the agent can
// tell a resting ball from a slow drift — that distinction is what makes a stuck ball learnable.
function velBucket(v) {
  if (v < -6) return 0;
  if (v < -1.5) return 1;
  if (v <= 1.5) return 2;
  if (v <= 6) return 3;
  return 4;
}

function distBucket(d, edges) {
  for (let i = 0; i < edges.length; i++) if (d < edges[i]) return i;
  return edges.length;
}

export default class AIPlaytester {
  /**
   * @param {Phaser.Scene} scene  A GameScene running in agent mode.
   * @param {object} [cfg]        Overrides for DEFAULTS.
   * @param {QLearningAgent} [agent]  Reuse a brain across levels; omit for a fresh one.
   */
  constructor(scene, cfg = {}, agent = null) {
    this.scene = scene;
    this.cfg = { ...DEFAULTS, ...cfg };
    this.nActions = this.cfg.actionSet === 'quad' ? 5 : 2;
    this.agent = agent ?? new QLearningAgent({ ...this.cfg, nActions: this.nActions });

    this.episode = 0;
    this.attemptsToWin = null;  // episodes taken to first reach the goal; null = never did
    this.episodes = [];         // one record per attempt
    this.finished = false;
    this._startEpisode();
  }

  // --- Episode lifecycle ----------------------------------------------------------------
  _startEpisode() {
    this.episode += 1;
    this.steps = 0;
    this.score = 0;            // strict spec reward, reported
    this.pendingReward = 0;    // spec reward accrued since the last decision
    // Closest the ball got to the goal this episode. When a level is never solved, the score
    // is worthless as a difficulty signal (every episode is a death, so the "best" score is
    // just the fastest suicide) — how far the agent actually got is the number that means
    // something: it separates "impossible layout" from "nearly had it".
    this.closest = Infinity;
    this.keysSeen = 0;
    this.lastKey = null;
    this.lastAction = 0;
    this.lastPotential = 0;
    this.lastTargetKind = null; // 'key' | 'goal' — see _decide for why the switch matters
    this.shiftsUsed = 0;
    this.blockedFlips = 0;      // decisions where the flip gate withheld the action
    this.lastFlipAt = -Infinity;
    this._primed = false;
  }

  /**
   * Which actions the agent may pick right now. A flip is offered when the ball is touching a
   * surface, or when flipCooldownMs has elapsed since the last one; otherwise only "do nothing"
   * is legal. Masking at selection (rather than letting the agent pick a flip and silently
   * dropping it) keeps the recorded transition honest — the agent learns the value of the
   * action that was actually taken.
   */
  _legalActions() {
    const elapsed = this.scene.now() - this.lastFlipAt;
    const mayFlip = this.scene.isGrounded() || elapsed >= this.cfg.flipCooldownMs;
    if (mayFlip) return null; // null = no restriction
    return [0];
  }

  /**
   * Called by GameScene before each physics step. Returns 'run' to keep stepping, or 'done'
   * when this level's playtest is over (win recorded, or maxEpisodes exhausted).
   */
  tick() {
    if (this.finished) return 'done';
    const s = this.scene;
    if (!s.ball) return 'run';

    // Terminal checks first: _solved and _dying are set from inside the physics step that
    // just ran, so this is the earliest we can see them.
    if (s._solved) return this._endEpisode('win', REWARDS.GOAL);
    if (s._dying) return this._endEpisode('death', REWARDS.DEATH);
    if (this.steps >= this.cfg.maxSteps) return this._endEpisode('timeout', 0);

    // Keys are collected inside the step too — credit them the moment they land.
    const held = s.countCollectedKeys();
    if (held > this.keysSeen) {
      const gained = (held - this.keysSeen) * REWARDS.KEY;
      this.keysSeen = held;
      this.pendingReward += gained;
      this.score += gained;
    }

    if (this.steps % this.cfg.decisionSteps === 0) this._decide();

    this.pendingReward += REWARDS.PER_FRAME;
    this.score += REWARDS.PER_FRAME;
    this.steps += 1;
    return 'run';
  }

  /** Observe, learn from the previous decision, then choose and apply the next action. */
  _decide() {
    const obs = this.scene.getAgentObservation();
    const key = encodeState(obs, this.cfg);
    const target = currentTarget(obs);
    // Points per grid cell of progress, expressed as a per-pixel coefficient.
    const scale = this.cfg.shapingStep / this.cfg.posCell;
    const potential = -target.dist * scale;
    if (obs.goal.dist < this.closest) this.closest = obs.goal.dist;

    if (this._primed) {
      // Taking the last key retargets from key to goal, and the two potentials are measured
      // against different points. Booking that difference as reward would pay (or fine) the
      // agent for a bookkeeping change it did not cause, so the switch is absorbed: rebase
      // onto the new target and let this interval's shaping be zero.
      const rebased = target.kind === this.lastTargetKind ? this.lastPotential : potential;
      const shaped = this.pendingReward + (this.agent.gamma * potential - rebased);
      this.agent.learn(this.lastKey, this.lastAction, shaped, key, false);
    }

    const legal = this._legalActions();
    const action = this.agent.act(key, false, legal);
    if (legal && action === 0) this.blockedFlips += 1;
    if (action !== 0) {
      this._applyAction(action, obs.gravity);
      this.lastFlipAt = this.scene.now();
    }

    this.lastKey = key;
    this.lastAction = action;
    this.lastPotential = potential;
    this.lastTargetKind = target.kind;
    this.pendingReward = 0;
    this._primed = true;
  }

  /** Emit the same event the InputManager emits — no back door into the physics. */
  _applyAction(action, current) {
    let dir;
    if (this.cfg.actionSet === 'quad') dir = CYCLE[action - 1];
    else if (this.cfg.actionSet === 'binary') dir = OPPOSITE[current];
    else dir = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    this.shiftsUsed += 1;
    this.scene.events.emit('gravity:request', dir);
  }

  /** Book the terminal reward, record the attempt, and either reset or stop. */
  _endEpisode(outcome, terminalReward) {
    this.pendingReward += terminalReward;
    this.score += terminalReward;

    // A timeout is a truncation, not a real ending — the state still has value, so teaching
    // the agent it is worth exactly 0 would poison every state near the cap. Drop the dangling
    // transition instead.
    if (this._primed && outcome !== 'timeout') {
      // No shaping term on a terminal transition. The textbook form subtracts the potential
      // of the final state, which here means handing out `+distance * shaping` for dying far
      // from the goal — precisely the wrong lesson. The raw reward is what should land.
      this.agent.learn(this.lastKey, this.lastAction, this.pendingReward, null, true);
    }
    this.agent.decayEpsilon();

    this.episodes.push({
      episode: this.episode,
      outcome,
      score: this.score,
      steps: this.steps,
      keys: this.keysSeen,
      shifts: this.shiftsUsed,
      blockedFlips: this.blockedFlips,
      closest: Math.round(this.closest),
      epsilon: Math.round(this.agent.effectiveEpsilon * 1000) / 1000,
    });

    if (outcome === 'win' && this.attemptsToWin === null) this.attemptsToWin = this.episode;

    // Stop at the first win: "how many attempts did it take" is the number we're after, and
    // continuing past it would only burn simulation time.
    if (outcome === 'win' || this.episode >= this.cfg.maxEpisodes) {
      this.finished = true;
      return 'done';
    }

    this.scene.resetForAgent();
    this._startEpisode();
    return 'reset';
  }

  /** Summary for the pipeline / report. */
  get result() {
    const wins = this.episodes.filter((e) => e.outcome === 'win');
    return {
      solved: this.attemptsToWin !== null,
      attempts: this.attemptsToWin ?? this.episode,
      episodes: this.episodes.length,
      bestScore: this.episodes.reduce((m, e) => Math.max(m, e.score), -Infinity),
      closestApproach: Math.round(this.episodes.reduce((m, e) => Math.min(m, e.closest), Infinity)),
      winShifts: wins.length ? wins[0].shifts : null,
      deaths: this.episodes.filter((e) => e.outcome === 'death').length,
      timeouts: this.episodes.filter((e) => e.outcome === 'timeout').length,
      qStates: this.agent.size,
      log: this.episodes,
    };
  }
}
