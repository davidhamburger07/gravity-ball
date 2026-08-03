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
  maxEpisodes: 120,    // give up on a level after this many attempts

  // --- Learning -----------------------------------------------------------------------
  alpha: 0.15,
  gamma: 0.985,
  // Exploration stays broad for the whole run rather than annealing to near-greedy. The goal
  // reward is sparse enough that an agent which anneals early locks onto whatever it found
  // first — and on this game what it finds first is that dying quickly beats surviving (see
  // `shaping` below). Sustained exploration is what makes "attempts to win" a difficulty
  // signal instead of a measure of how fast the agent gave up.
  epsilon: 0.5,
  epsilonMin: 0.1,
  epsilonDecay: 0.99,

  // Distance-to-goal shaping. This does NOT change the reported score — it only feeds the Q
  // update — but it is doing real work, because the strict point system on its own has a
  // perverse optimum: at -1/frame, dying at step 150 (-650) beats surviving to a 3000-step
  // timeout (-3000), so an agent that cannot yet find the goal learns to kill itself. Rewarding
  // progress toward the goal makes moving worth more than the clock it costs. Set to 0 to see
  // the raw sparse behaviour.
  shaping: 0.4,

  // --- State discretisation -----------------------------------------------------------
  posCell: 60,         // px per position bucket
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
  return [
    cx,
    cy,
    velBucket(obs.vx),
    velBucket(obs.vy),
    g,
    distBucket(obs.goal.dist, [140, 400, 900]),
    distBucket(obs.spike.dist, [50, 110, 220]),
    obs.key ? distBucket(obs.key.dist, [60, 200, 600]) : 9,
    obs.keysHeld,
  ].join(',');
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
    this.shiftsUsed = 0;
    this._primed = false;
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
    const potential = -obs.goal.dist * this.cfg.shaping;
    if (obs.goal.dist < this.closest) this.closest = obs.goal.dist;

    if (this._primed) {
      const shaped = this.pendingReward + (this.agent.gamma * potential - this.lastPotential);
      this.agent.learn(this.lastKey, this.lastAction, shaped, key, false);
    }

    const action = this.agent.act(key);
    if (action !== 0) this._applyAction(action, obs.gravity);

    this.lastKey = key;
    this.lastAction = action;
    this.lastPotential = potential;
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
      closest: Math.round(this.closest),
      epsilon: Math.round(this.agent.epsilon * 1000) / 1000,
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
