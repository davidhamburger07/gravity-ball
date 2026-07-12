// GameConfig.js — central tuning constants. Keep gameplay "feel" values here so
// designers can iterate without touching engine code.
export const VIEW = Object.freeze({
  WIDTH: 800,
  HEIGHT: 600,
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
