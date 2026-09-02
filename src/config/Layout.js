// Layout.js — how big the canvas is, and how the space inside it is divided.
//
// The playfield is always 800x600 world units. That is frozen: every level is hand-tuned against
// it and scripts/check-physics.mjs locks it. What changes is the canvas AROUND the playfield.
//
// With a fixed 800x696 canvas, Phaser's FIT scaling throws away whichever axis the device has
// spare. Measured: a phone held upright letterboxed ~510px BELOW the game; the same phone on its
// side letterboxed ~200px at EACH edge. Sizing the canvas to the device's own aspect means FIT has
// nothing to discard — the playfield still renders at the same on-screen size, and the reclaimed
// space becomes a bigger HUD and real touch controls.
//
// UI is measured in world units, so a bigger canvas does NOT make text bigger on screen — the
// world-to-screen ratio is unchanged. `ui` is the multiplier that actually does that.

const PLAY_W = 800;
const PLAY_H = 600;

// Landscape keeps exactly the geometry the game shipped with.
const LANDSCAPE = { hudTop: 64, hudBottom: 32, minH: PLAY_H + 64 + 32 };

// A canvas taller than this stops being useful and just spreads the controls too far apart.
const MAX_CANVAS_H = 2000;

// A side pad needs three buttons across plus breathing room. Below MIN_SIDE the buttons fall under
// a comfortable tap size, so the canvas is widened past the device aspect to reach it — trading a
// little letterbox for controls that can actually be hit. MAX_SIDE stops a very wide screen from
// shrinking the playfield to buy margin it does not need.
const MIN_SIDE = 280;
const MAX_SIDE = 420;

/** Touch capability, not screen size: a desktop in a short window still wants its keyboard. */
function hasTouch() {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (globalThis.navigator?.maxTouchPoints ?? 0) > 0;
}

export const Layout = {
  isPortrait: false,
  touch: false,
  width: PLAY_W,
  height: LANDSCAPE.minH,
  hudTop: LANDSCAPE.hudTop,
  hudBottom: LANDSCAPE.hudBottom,
  ui: 1,
  /** Left edge of the playfield within the canvas. Non-zero when side pads take the margins. */
  playX: 0,
  /** Free space UNDER the playfield (portrait), or null. */
  controls: null,
  /** Side pad areas (landscape on touch), or null. Each is { x, y, width, height }. */
  padLeft: null,
  padRight: null,

  /** Work out the canvas for a viewport. Only writes to this object, so it is safe to re-run. */
  measure(viewportW, viewportH) {
    const aspect = viewportH / Math.max(viewportW, 1);
    // 1.1 rather than 1.0: a near-square window has no spare axis worth restructuring for.
    this.isPortrait = aspect > 1.1;
    this.touch = hasTouch();
    this.controls = null;
    this.padLeft = null;
    this.padRight = null;

    return this.isPortrait
      ? this._portrait(aspect)
      : this._landscape(viewportW / Math.max(viewportH, 1));
  },

  _portrait(aspect) {
    this.width = PLAY_W;
    this.height = Math.min(Math.round(PLAY_W * aspect), MAX_CANVAS_H);
    this.hudTop = 116; // room for a readout at 1.6x plus the death-rule row
    this.hudBottom = 44;
    this.ui = 1.6;
    this.playX = 0;

    const top = this.hudTop + PLAY_H;
    const free = this.height - top - this.hudBottom;
    // Under ~260 units there is no honest room for a pad; fall back to swipe alone.
    this.controls = free >= 260 ? { y: top, height: free } : null;
    return this;
  },

  _landscape(wideAspect) {
    this.height = LANDSCAPE.minH;
    this.hudTop = LANDSCAPE.hudTop;
    this.hudBottom = LANDSCAPE.hudBottom;

    // On a touch device the wasted side margins become thumb pads, one per hand. On a desktop
    // there is a keyboard, so the canvas stays byte-for-byte what shipped and no pads are drawn.
    const room = (this.height * wideAspect - PLAY_W) / 2;
    const side = this.touch ? Math.round(Math.min(Math.max(room, MIN_SIDE), MAX_SIDE)) : 0;

    this.width = PLAY_W + side * 2;
    this.playX = side;
    // A modest bump only: the HUD band is 64 units tall and a 44-unit button must still fit in it.
    this.ui = this.touch ? 1.15 : 1;

    if (side > 0) {
      this.padLeft = { x: 0, y: this.hudTop, width: side, height: PLAY_H };
      this.padRight = { x: side + PLAY_W, y: this.hudTop, width: side, height: PLAY_H };
    }
    return this;
  },

  /** Centre y of the playfield's own viewport. */
  get playCenterY() { return this.hudTop + PLAY_H / 2; },

  /** Centre x of the playfield's own viewport. */
  get playCenterX() { return this.playX + PLAY_W / 2; },

  /** Scale a world-unit size by the UI multiplier, rounded to whole pixels. */
  s(n) { return Math.round(n * this.ui); },

  /** Scale a font size and return it in the "12px" form Phaser expects. */
  font(px) { return `${Math.round(px * this.ui)}px`; },
};

export const PLAYFIELD = Object.freeze({ WIDTH: PLAY_W, HEIGHT: PLAY_H });
