// Layout.js — how big the canvas is, and how the space inside it is divided.
//
// The playfield is always 800x600 world units. That is frozen: every level is hand-tuned against
// it and scripts/check-physics.mjs locks it. What changes is the canvas AROUND the playfield.
//
// With a fixed 800x696 canvas, Phaser's FIT scaling is width-constrained on a phone held upright,
// so the game occupied about 40% of the screen and left ~510px of dead black — measured on an
// iPhone 14 Pro. Sizing the canvas to the device's own aspect instead means FIT has nothing to
// letterbox: the playfield renders at exactly the same on-screen size it did before (its width
// still maps 800 units to the full screen width), and the space that was wasted becomes room for
// a bigger HUD and real touch controls.
//
// UI is measured in world units, so a taller canvas does NOT make text bigger on screen — the
// scale factor is unchanged. `ui` is the multiplier that actually does that, applied to font
// sizes and control sizes on a phone.

const PLAY_W = 800;
const PLAY_H = 600;

// Landscape keeps exactly the geometry the game shipped with.
const LANDSCAPE = { hudTop: 64, hudBottom: 32, minH: PLAY_H + 64 + 32 };

// A canvas taller than this stops being useful and just spreads the controls too far apart.
const MAX_CANVAS_H = 2000;

export const Layout = {
  isPortrait: false,
  width: PLAY_W,
  height: LANDSCAPE.minH,
  hudTop: LANDSCAPE.hudTop,
  hudBottom: LANDSCAPE.hudBottom,
  ui: 1,
  /** Free space under the playfield, for the touch pad. Null when there is not enough of it. */
  controls: null,

  /**
   * Work out the canvas for a viewport. Pure apart from writing to this object, so the tests and
   * the boot path can both call it.
   */
  measure(viewportW, viewportH) {
    const aspect = viewportH / Math.max(viewportW, 1);
    // 1.1 rather than 1.0: a near-square window has no spare height worth restructuring for.
    this.isPortrait = aspect > 1.1;

    if (!this.isPortrait) {
      this.width = PLAY_W;
      this.height = LANDSCAPE.minH;
      this.hudTop = LANDSCAPE.hudTop;
      this.hudBottom = LANDSCAPE.hudBottom;
      this.ui = 1;
      this.controls = null;
      return this;
    }

    this.width = PLAY_W;
    this.height = Math.min(Math.round(PLAY_W * aspect), MAX_CANVAS_H);
    this.hudTop = 116;     // room for a readout at 1.6x and a second row
    this.hudBottom = 44;
    this.ui = 1.6;

    const top = this.hudTop + PLAY_H;
    const free = this.height - top - this.hudBottom;
    // Under ~260 units there is no honest room for a D-pad; fall back to swipe only.
    this.controls = free >= 260 ? { y: top, height: free } : null;
    return this;
  },

  /** Centre y of the playfield's own viewport. */
  get playCenterY() { return this.hudTop + PLAY_H / 2; },

  /** Scale a world-unit size by the UI multiplier, rounded to whole pixels. */
  s(n) { return Math.round(n * this.ui); },

  /** Scale a font size and return it in the "12px" form Phaser expects. */
  font(px) { return `${Math.round(px * this.ui)}px`; },
};

export const PLAYFIELD = Object.freeze({ WIDTH: PLAY_W, HEIGHT: PLAY_H });
