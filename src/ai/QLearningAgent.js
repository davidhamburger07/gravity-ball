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
   * @param {number} [cfg.epsilonDecay=0.93]  Applied once per episode.
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
    this.optimism = cfg.optimism ?? 0;
    this.rand = cfg.rand ?? Math.random;
    this.q = new Map();
    this.updates = 0;
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

  /** epsilon-greedy action. `greedy` forces exploitation (used for evaluation runs). */
  act(key, greedy = false) {
    if (!greedy && this.rand() < this.epsilon) return Math.floor(this.rand() * this.nActions);
    const row = this._row(key);
    let best = 0;
    for (let a = 1; a < this.nActions; a++) if (row[a] > row[best]) best = a;
    // Break ties randomly, or the agent locks onto action 0 in every unvisited state and the
    // early episodes degenerate into "do nothing".
    let ties = 0;
    for (let a = 0; a < this.nActions; a++) if (row[a] === row[best]) ties++;
    if (ties > 1) {
      let nth = Math.floor(this.rand() * ties);
      for (let a = 0; a < this.nActions; a++) {
        if (row[a] === row[best] && nth-- === 0) return a;
      }
    }
    return best;
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

  /** Call once per finished episode. */
  decayEpsilon() {
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  /** Wipe everything, including exploration schedule — a fresh brain for a fresh level. */
  reset() {
    this.q.clear();
    this.epsilon = this.epsilon0;
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
