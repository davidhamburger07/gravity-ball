// GameConfig.js — central tuning constants. Keep gameplay "feel" values here so
// designers can iterate without touching engine code.
//
// FROZEN: the shipped campaign is hand-tuned against the physics values below, and no level has a
// recorded `solution`, so nothing in this repo can tell you when a change has made one impossible.
// scripts/check-physics.mjs locks them deliberately. If you mean to retune, change the lock in the
// same commit and replay every level that depends on the value you moved.
// The canvas is taller than the playfield on purpose. Levels are authored against an 800x600 box,
// and the HUD used to be drawn on top of it — so every level that put a spike row at y=40 or y=560
// (which is most of them) had gameplay sitting under a translucent band with text through it.
// Reserving HUD_TOP and HUD_BOTTOM outside the play box means the world camera gets its own
// viewport at zoom 1: the playfield still renders 1:1, and nothing can overlap it.
const PLAY_H = 600;
const HUD_TOP = 64;    // level readout, mute/back controls, and the death-rule row
const HUD_BOTTOM = 32; // hint strip

export const VIEW = Object.freeze({
  WIDTH: 800,
  PLAY_H,                                // the world box every level is authored against
  HUD_TOP,
  HUD_BOTTOM,
  HEIGHT: PLAY_H + HUD_TOP + HUD_BOTTOM, // 696 — the canvas
  BACKGROUND: '#10131f',
});

export const PHYSICS = Object.freeze({
  // Matter gravity vector magnitude. Higher = snappier falls. Momentum carries over on shift.
  GRAVITY_STRENGTH: 1,
  BALL_RADIUS: 16,
  BALL_FRICTION: 0.01,     // rolling friction — low so the ball keeps momentum
  BALL_FRICTION_AIR: 0.005,
  BALL_BOUNCE: 0.15,       // restitution; trampolines override this locally (Ch.3)
});

export const FEEL = Object.freeze({
  GRAVITY_COOLDOWN_MS: 120, // debounce between gravity shifts (prevents accidental double taps)
  SWIPE_THRESHOLD_PX: 40,   // min drag distance to register a mobile swipe
  CAMERA_LERP: 0.12,        // camera follow smoothing (never rigidly locked — see the game-feel guardrails)
  CAMERA_LEAD_PX: 70,       // how far the camera leads in the new gravity direction
  SHIFT_SHAKE: 0.004,       // screen-shake intensity on a gravity shift
});
