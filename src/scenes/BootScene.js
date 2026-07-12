// BootScene.js — first scene. Initializes the platform SDK and generates the placeholder
// textures so the game is fully runnable before any real art exists (per the project brief:
// use generic shapes when final assets are missing).
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import { PHYSICS } from '../config/GameConfig.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  async create() {
    await CrazyGamesSDK.init();
    this._generatePlaceholderTextures();
    this.scene.start('PreloadScene');
  }

  _generatePlaceholderTextures() {
    const g = this.add.graphics();

    // Ball — bright cyan circle.
    const r = PHYSICS.BALL_RADIUS;
    g.fillStyle(0x38e1ff, 1).fillCircle(r, r, r);
    g.fillStyle(0xffffff, 0.6).fillCircle(r * 0.65, r * 0.65, r * 0.28); // highlight
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

    // Spike hazard — red triangle.
    g.fillStyle(0xff4d5e, 1).fillTriangle(0, 32, 16, 0, 32, 32);
    g.generateTexture('spike', 32, 32);
    g.clear();

    // Spark — small white dot for particle bursts (tinted per effect).
    g.fillStyle(0xffffff, 1).fillCircle(6, 6, 6);
    g.generateTexture('spark', 12, 12);
    g.clear();

    g.destroy();
  }
}
