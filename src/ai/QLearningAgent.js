// QLearningAgent.js — tabular Q-learning. No dependencies, no engine knowledge: it takes a
// state key (a string), returns an action index, and learns from (s, a, r, s') transitions.
// Everything game-specific lives in AIPlaytester.js.
//
// Tabular (rather than a neural net) is the right call here: the state is deliberately
// discretised into a few thousand reachable buckets per level, a Map lookup is ~free at the
// tens of thousands of steps per second the turbo loop runs at, and the table can be dumped
// to JSON for inspection.

export default class QLearningAgent {
  /**
   * @param {object} [cfg]
   * @param {number} [cfg.nActions=2]
   * @param {number} [cfg.alpha=0.15]         Learning rate.
   * @param {number} [cfg.gamma=0.985]        Discount. High, because the goal reward is far away.
   * @param {number} [cfg.epsilon=1]          Starting exploration rate.
   * @param {number} [cfg.epsilonMin=0.05]
   * @param {number} [cfg.epsilonDecay=0.93]  Applied once per episode, after the warmup.
   * @param {number} [cfg.explorationWarmup=0]  Episodes of pure random play before the Q-table
   *                                            is consulted at all.
   * @param {number} [cfg.optimism=0]         Initial Q value; >0 encourages visiting new states.
   */
  constructor(cfg = {}) {
    this.nActions = cfg.nActions ?? 2;
    this.alpha = cfg.alpha ?? 0.15;
    this.gamma = cfg.gamma ?? 0.985;
    this.epsilon = cfg.epsilon ?? 1;
    this.epsilon0 = this.epsilon;
    this.epsilonMin = cfg.epsilonMin ?? 0.05;
    this.epsilonDecay = cfg.epsilonDecay ?? 0.93;
    this.explorationWarmup = cfg.explorationWarmup ?? 0;
    this.episodesSeen = 0;
    this.optimism = cfg.optimism ?? 0;
    this.rand = cfg.rand ?? Math.random;
    this.q = new Map();
    this.updates = 0;
  }

  /**
   * The exploration rate actually in force. During warmup it is pinned at 1: the agent acts
   * entirely at random and the table only accumulates. Trusting a Q-table seeded by a handful
   * of episodes is what parks the agent in a safe corner — it finds one trajectory that avoids
   * spikes, and greedily repeats it forever without ever discovering the goal.
   */
  get effectiveEpsilon() {
    return this.episodesSeen < this.explorationWarmup ? 1 : this.epsilon;
  }

  get exploring() {
    return this.episodesSeen < this.explorationWarmup;
  }

  /** Q values for a state, created lazily so the table only holds states actually visited. */
  _row(key) {
    let row = this.q.get(key);
    if (!row) {
      row = new Float64Array(this.nActions);
      if (this.optimism) row.fill(this.optimism);
      this.q.set(key, row);
    }
    return row;
  }

  /**
   * epsilon-greedy action.
   * @param {string}  key
   * @param {boolean} [greedy]  Force exploitation (used for evaluation runs).
   * @param {number[]|null} [legal]  Restrict the choice to these action indices; null = all.
   *                                 Callers use this to mask actions the environment will not
   *                                 accept right now, so the recorded transition matches what
   *                                 actually happened.
   */
  act(key, greedy = false, legal = null) {
    const pool = legal ?? null;
    if (pool && pool.length === 1) return pool[0];

    const n = pool ? pool.length : this.nActions;
    const at = (i) => (pool ? pool[i] : i);

    if (!greedy && this.rand() < this.effectiveEpsilon) return at(Math.floor(this.rand() * n));

    const row = this._row(key);
    let best = 0;
    for (let i = 1; i < n; i++) if (row[at(i)] > row[at(best)]) best = i;
    // Break ties randomly, or the agent locks onto action 0 in every unvisited state and the
    // early episodes degenerate into "do nothing".
    let ties = 0;
    for (let i = 0; i < n; i++) if (row[at(i)] === row[at(best)]) ties++;
    if (ties > 1) {
      let nth = Math.floor(this.rand() * ties);
      for (let i = 0; i < n; i++) {
        if (row[at(i)] === row[at(best)] && nth-- === 0) return at(i);
      }
    }
    return at(best);
  }

  /** Standard Q-learning update. On a terminal transition there is no bootstrap term. */
  learn(key, action, reward, nextKey, done) {
    const row = this._row(key);
    let target = reward;
    if (!done) {
      const next = this._row(nextKey);
      let max = next[0];
      for (let a = 1; a < this.nActions; a++) if (next[a] > max) max = next[a];
      target += this.gamma * max;
    }
    row[action] += this.alpha * (target - row[action]);
    this.updates++;
  }

  /** Call once per finished episode. Epsilon only starts falling once the warmup is over. */
  decayEpsilon() {
    this.episodesSeen += 1;
    if (this.episodesSeen < this.explorationWarmup) return;
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  /** Wipe everything, including exploration schedule — a fresh brain for a fresh level. */
  reset() {
    this.q.clear();
    this.epsilon = this.epsilon0;
    this.episodesSeen = 0;
    this.updates = 0;
  }

  get size() {
    return this.q.size;
  }

  /** Serializable snapshot (states are usually in the thousands, so this stays small). */
  toJSON() {
    const table = {};
    for (const [k, row] of this.q) table[k] = Array.from(row, (v) => Math.round(v * 1000) / 1000);
    return { nActions: this.nActions, epsilon: this.epsilon, updates: this.updates, table };
  }

  static fromJSON(data, cfg = {}) {
    const agent = new QLearningAgent({ ...cfg, nActions: data.nActions });
    agent.epsilon = data.epsilon ?? agent.epsilon;
    for (const [k, row] of Object.entries(data.table ?? {})) agent.q.set(k, Float64Array.from(row));
    return agent;
  }
}
