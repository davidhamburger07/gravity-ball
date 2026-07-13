// GravityController.js — THE CORE MECHANIC.
// Owns the single source of truth for which way "down" currently is, and applies it
// to the Matter physics world. Changing the gravity vector snaps the force instantly
// while leaving every body's velocity untouched, so the ball's momentum carries over
// dynamically (per the anti-generic game-feel guardrails).

export const GravityDirection = Object.freeze({
  DOWN: 'down',
  UP: 'up',
  LEFT: 'left',
  RIGHT: 'right',
});

// Unit vectors for each direction. Matter world gravity is (direction * strength).
const GRAVITY_VECTORS = Object.freeze({
  [GravityDirection.DOWN]: { x: 0, y: 1 },
  [GravityDirection.UP]: { x: 0, y: -1 },
  [GravityDirection.LEFT]: { x: -1, y: 0 },
  [GravityDirection.RIGHT]: { x: 1, y: 0 },
});

export default class GravityController {
  /**
   * @param {Phaser.Scene} scene  Active gameplay scene (must use Matter physics).
   * @param {object} [opts]
   * @param {string} [opts.initial='down']   Starting gravity direction.
   * @param {number} [opts.strength=1]        Gravity vector magnitude.
   * @param {number} [opts.cooldown=120]      ms lockout between shifts.
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.baseStrength = opts.strength ?? 1;
    this.strength = this.baseStrength;
    this.cooldown = opts.cooldown ?? 120;
    this.direction = opts.initial ?? GravityDirection.DOWN;
    this._lockedUntil = 0;

    // Apply the initial direction silently (no juice/events on level start).
    this.apply(this.direction, { silent: true });
  }

  /** Scale gravity strength (Ch.5 weight zones: a heavy ball falls faster). Re-applies silently. */
  setStrengthMultiplier(m) {
    this.strength = this.baseStrength * m;
    this.apply(this.direction, { silent: true });
  }

  /**
   * Request a gravity change from input. Honors the cooldown and ignores a re-selection
   * of the current direction. Returns true only if the shift actually happened.
   * @param {string} direction  A GravityDirection value.
   */
  request(direction, time = this.scene.time.now) {
    if (!GRAVITY_VECTORS[direction]) return false; // invalid input
    if (direction === this.direction) return false; // no-op
    if (time < this._lockedUntil) return false; // still cooling down
    this._lockedUntil = time + this.cooldown;
    this.apply(direction);
    return true;
  }

  /**
   * Immediately set world gravity. Velocity is intentionally preserved — only the force
   * vector changes — which is what makes momentum "carry" through a shift.
   */
  apply(direction, { silent = false } = {}) {
    const previous = this.direction;
    const v = GRAVITY_VECTORS[direction];
    this.direction = direction;
    this.scene.matter.world.setGravity(v.x * this.strength, v.y * this.strength);

    if (!silent) {
      // Decoupled feedback: scenes/juice listen for this instead of us knowing about them.
      this.scene.events.emit('gravity:changed', { direction, previous, vector: v });
    }
  }

  /** Current gravity as a unit vector, e.g. { x: 0, y: 1 }. */
  get vector() {
    return GRAVITY_VECTORS[this.direction];
  }
}
