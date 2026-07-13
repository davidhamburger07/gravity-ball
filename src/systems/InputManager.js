// InputManager.js — translates raw input into abstract gravity *requests*.
// Deliberately knows nothing about physics: it only emits 'gravity:request' on the
// scene event bus. This keeps input, mechanic, and feedback fully decoupled.
import { GravityDirection } from './GravityController.js';
import { FEEL } from '../config/GameConfig.js';

export default class InputManager {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} [opts]
   * @param {number} [opts.swipeThreshold]  Min px drag to register a swipe on touch.
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.swipeThreshold = opts.swipeThreshold ?? FEEL.SWIPE_THRESHOLD_PX;
    this._registerKeyboard();
    this._registerTouch();
  }

  _emit(direction) {
    this.scene.events.emit('gravity:request', direction);
  }

  // --- Desktop: Arrow keys + WASD -----------------------------------------
  _registerKeyboard() {
    const kb = this.scene.input.keyboard;
    if (!kb) return; // no keyboard on some mobile contexts
    const bindings = {
      UP: GravityDirection.UP,
      W: GravityDirection.UP,
      DOWN: GravityDirection.DOWN,
      S: GravityDirection.DOWN,
      LEFT: GravityDirection.LEFT,
      A: GravityDirection.LEFT,
      RIGHT: GravityDirection.RIGHT,
      D: GravityDirection.RIGHT,
    };
    for (const [key, dir] of Object.entries(bindings)) {
      kb.on(`keydown-${key}`, () => this._emit(dir));
    }
  }

  // --- Mobile / touch: swipe anywhere on the screen -----------------------
  // Listens on `window` (not the Phaser canvas) so a swipe works across the whole viewport,
  // including any letterbox area around a portrait-fit playfield. Cleaned up on scene shutdown.
  _registerTouch() {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e) => {
      const t = e.changedTouches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };
    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < this.swipeThreshold && Math.abs(dy) < this.swipeThreshold) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        this._emit(dx > 0 ? GravityDirection.RIGHT : GravityDirection.LEFT);
      } else {
        this._emit(dy > 0 ? GravityDirection.DOWN : GravityDirection.UP);
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    this.scene.events.once('shutdown', () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    });
  }
}
