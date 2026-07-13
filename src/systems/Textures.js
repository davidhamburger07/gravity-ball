// Textures.js — generates the placeholder shape textures shared by the game and the editor,
// so an element looks the same wherever it is drawn.
import { PHYSICS } from '../config/GameConfig.js';

export function generatePlaceholderTextures(scene) {
  const g = scene.add.graphics();

  // Ball — bright cyan circle with a highlight.
  const r = PHYSICS.BALL_RADIUS;
  g.fillStyle(0x38e1ff, 1).fillCircle(r, r, r);
  g.fillStyle(0xffffff, 0.6).fillCircle(r * 0.65, r * 0.65, r * 0.28);
  g.generateTexture('ball', r * 2, r * 2);
  g.clear();

  // Wall tile — cool slate.
  g.fillStyle(0x3a3f5c, 1).fillRect(0, 0, 32, 32);
  g.lineStyle(2, 0x4c5378, 1).strokeRect(1, 1, 30, 30);
  g.generateTexture('wall', 32, 32);
  g.clear();

  // Goal — green ring.
  g.lineStyle(5, 0x2bd67b, 1).strokeCircle(20, 20, 16);
  g.fillStyle(0x2bd67b, 0.25).fillCircle(20, 20, 16);
  g.generateTexture('goal', 40, 40);
  g.clear();

  // Spike hazard — red triangle (points up; rotated per-instance).
  g.fillStyle(0xff4d5e, 1).fillTriangle(0, 32, 16, 0, 32, 32);
  g.generateTexture('spike', 32, 32);
  g.clear();

  // Spark — small white dot for particle bursts (tinted per effect).
  g.fillStyle(0xffffff, 1).fillCircle(6, 6, 6);
  g.generateTexture('spark', 12, 12);
  g.clear();

  // Key — white silhouette (tinted per color at runtime).
  g.lineStyle(3, 0xffffff, 1);
  g.strokeCircle(8, 6, 5);
  g.lineBetween(8, 11, 8, 23);
  g.lineBetween(8, 23, 13, 23);
  g.lineBetween(8, 18, 12, 18);
  g.generateTexture('key', 16, 26);
  g.clear();

  g.destroy();
}
