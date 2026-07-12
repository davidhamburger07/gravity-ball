// Effects.js — one-shot particle bursts for game-feel. Each call spawns a short-lived emitter
// on the 'spark' texture and self-destructs after the particles fade. Additive blending makes
// the sparks pop against the dark playfield.
export const Effects = {
  // Radial burst (death, goal, small bounce puffs).
  burst(scene, x, y, { color = 0xffffff, count = 14, speed = 200, lifespan = 500, scale = 0.7 } = {}) {
    const em = scene.add.particles(x, y, 'spark', {
      speed: { min: speed * 0.35, max: speed },
      lifespan,
      scale: { start: scale, end: 0 },
      alpha: { start: 0.95, end: 0 },
      tint: color,
      blendMode: 'ADD',
      emitting: false,
    });
    em.setDepth(20);
    em.explode(count);
    scene.time.delayedCall(lifespan + 80, () => em.destroy());
  },

  // Directional streak biased along a unit vector (gravity shift).
  directional(scene, x, y, vector, { color = 0x38e1ff, count = 16, speed = 280, lifespan = 420, scale = 0.7, spreadDeg = 42 } = {}) {
    const base = Phaser.Math.RadToDeg(Math.atan2(vector.y, vector.x));
    const em = scene.add.particles(x, y, 'spark', {
      speed: { min: speed * 0.5, max: speed },
      angle: { min: base - spreadDeg, max: base + spreadDeg },
      lifespan,
      scale: { start: scale, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: color,
      blendMode: 'ADD',
      emitting: false,
    });
    em.setDepth(20);
    em.explode(count);
    scene.time.delayedCall(lifespan + 80, () => em.destroy());
  },
};
