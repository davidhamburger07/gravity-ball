// GameScene.js — assembles a level from data and wires the three decoupled systems:
//   InputManager (raw input) → 'gravity:request' → GravityController (mechanic)
//   GravityController → 'gravity:changed' → juice (camera lead, screen shake)
// Tracks shift count, computes a star rating on win, and persists it via SaveManager.
import Ball from '../objects/Ball.js';
import GravityController, { GravityDirection } from '../systems/GravityController.js';
import InputManager from '../systems/InputManager.js';
import Button from '../ui/Button.js';
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import { VIEW, PHYSICS, FEEL } from '../config/GameConfig.js';

const BORDER = 24; // auto border-wall thickness

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data = {}) {
    this.levelId = data.levelId ?? this.levelId ?? '1-1';
    this.chapterId = data.chapterId ?? this.chapterId ?? 1;
    this._solved = false;
    this.shiftCount = 0;
  }

  create() {
    this.save = this.registry.get('save');
    this.levelsData = this.registry.get('levels');
    const level = this._resolveLevel(this.levelId);
    this.level = level;
    const bounds = level.bounds ?? { w: VIEW.WIDTH, h: VIEW.HEIGHT };

    this.matter.world.setBounds(0, 0, bounds.w, bounds.h);
    this.cameras.main.setBounds(0, 0, bounds.w, bounds.h);
    this.cameras.main.setBackgroundColor(VIEW.BACKGROUND);

    this._buildStatic(level, bounds);
    this.ball = new Ball(this, level.spawn.x, level.spawn.y);
    this.cameras.main.startFollow(this.ball, true, FEEL.CAMERA_LERP, FEEL.CAMERA_LERP);

    // --- Systems ---------------------------------------------------------
    this.gravity = new GravityController(this, {
      initial: level.gravity ?? GravityDirection.DOWN,
      strength: PHYSICS.GRAVITY_STRENGTH,
      cooldown: FEEL.GRAVITY_COOLDOWN_MS,
    });
    this.inputManager = new InputManager(this);

    // Guard against duplicate handlers across scene.restart() (scene.events persists).
    this.events.off('gravity:request');
    this.events.off('gravity:changed');
    this.events.on('gravity:request', (dir) => { if (!this._solved) this.gravity.request(dir); });
    this.events.on('gravity:changed', ({ vector }) => this._onGravityShift(vector));

    this.matter.world.on('collisionstart', (event) => this._onCollision(event));

    this._buildHud(level);
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
    this.input.keyboard.on('keydown-ESC', () => this._toLevelSelect());

    CrazyGamesSDK.gameplayStart();
  }

  // --- Level construction --------------------------------------------------
  _resolveLevel(levelId) {
    for (const c of this.levelsData.chapters) {
      const found = (c.levels ?? []).find((l) => l.id === levelId);
      if (found) { this.chapterId = c.id; return found; }
    }
    throw new Error(`Level "${levelId}" not found in levels.json`);
  }

  _buildStatic(level, bounds) {
    // Auto border walls from bounds (unless the level opts out).
    if (level.border !== false) {
      const t = BORDER;
      const { w, h } = bounds;
      [
        { x: w / 2, y: h - t / 2, w, h: t }, // floor
        { x: w / 2, y: t / 2, w, h: t },     // ceiling
        { x: t / 2, y: h / 2, w: t, h },     // left
        { x: w - t / 2, y: h / 2, w: t, h }, // right
      ].forEach((b) => this._wall(b.x, b.y, b.w, b.h));
    }

    (level.walls ?? []).forEach((wl) => this._wall(wl.x, wl.y, wl.w, wl.h));

    (level.hazards ?? []).forEach((hz) => {
      this.matter.add.rectangle(hz.x, hz.y, hz.w ?? 32, hz.h ?? 32, {
        isStatic: true, isSensor: true, label: 'hazard',
      });
      this.add.image(hz.x, hz.y, 'spike').setDisplaySize(hz.w ?? 32, hz.h ?? 32);
    });

    // Goal sensor + a gently pulsing icon.
    const g = level.goal;
    this.matter.add.rectangle(g.x, g.y, 40, 40, { isStatic: true, isSensor: true, label: 'goal' });
    const icon = this.add.image(g.x, g.y, 'goal').setDepth(5);
    this.tweens.add({ targets: icon, scale: 1.15, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  _wall(x, y, w, h) {
    this.matter.add.rectangle(x, y, w, h, { isStatic: true, label: 'wall' });
    this.add.rectangle(x, y, w, h, 0x3a3f5c).setStrokeStyle(2, 0x4c5378);
  }

  _buildHud(level) {
    this.hud = this.add
      .text(12, 10, '', { fontFamily: 'monospace', fontSize: '16px', color: '#9aa0c3' })
      .setScrollFactor(0)
      .setDepth(100);
    this._updateHud();

    new Button(this, VIEW.WIDTH - 40, 26, '‹', () => this._toLevelSelect(), {
      width: 44, height: 36, fontSize: '22px', color: 0x2a2f45, textColor: '#ffffff',
    }).setScrollFactor(0).setDepth(100);

    if (level.hint) {
      this.add
        .text(VIEW.WIDTH / 2, VIEW.HEIGHT - 24, level.hint, {
          fontFamily: 'monospace', fontSize: '13px', color: '#5a6089',
        })
        .setOrigin(0.5).setScrollFactor(0).setDepth(100);
    }
  }

  _updateHud() {
    this.hud.setText(`Level ${this.level.id}    Shifts: ${this.shiftCount}    Par: ${this.level.par ?? '-'}`);
  }

  // --- Feedback / juice ----------------------------------------------------
  _onGravityShift(vector) {
    this.shiftCount += 1;
    this._updateHud();
    this.cameras.main.shake(120, FEEL.SHIFT_SHAKE);
    this.cameras.main.setFollowOffset(-vector.x * FEEL.CAMERA_LEAD_PX, -vector.y * FEEL.CAMERA_LEAD_PX);
    // TODO: gravity-shift SFX + directional particle burst once audio/particles land.
  }

  // --- Win / lose ----------------------------------------------------------
  _onCollision(event) {
    for (const { bodyA, bodyB } of event.pairs) {
      const labels = [bodyA.label, bodyB.label];
      if (!labels.includes('ball')) continue;
      if (labels.includes('goal')) return this._win();
      if (labels.includes('hazard')) return this._die();
    }
  }

  _computeStars() {
    const par = this.level.par ?? 3;
    if (this.shiftCount <= par) return 3;
    if (this.shiftCount <= par + 2) return 2;
    return 1;
  }

  _win() {
    if (this._solved) return;
    this._solved = true;
    const stars = this._computeStars();
    this.save.recordResult(this.level.id, { stars, shifts: this.shiftCount });
    CrazyGamesSDK.happytime();
    CrazyGamesSDK.gameplayStop();
    this.cameras.main.flash(200, 43, 214, 123);
    this._showCompletePanel(stars);
  }

  _die() {
    if (this._solved) return;
    this.cameras.main.shake(200, 0.012);
    this.cameras.main.flash(150, 255, 77, 94);
    this.ball.respawn();
  }

  _showCompletePanel(stars) {
    const panel = this.add
      .container(VIEW.WIDTH / 2, VIEW.HEIGHT / 2)
      .setScrollFactor(0)
      .setDepth(200);

    const bg = this.add.rectangle(0, 0, 380, 300, 0x1a1e30, 0.98).setStrokeStyle(3, 0x38e1ff, 0.5);
    const title = this.add
      .text(0, -110, 'LEVEL COMPLETE', {
        fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#2bd67b', fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const info = this.add
      .text(0, 22, `Shifts: ${this.shiftCount}    Par: ${this.level.par ?? '-'}`, {
        fontFamily: 'monospace', fontSize: '15px', color: '#9aa0c3',
      })
      .setOrigin(0.5);
    panel.add([bg, title, info]);

    // Star row with a staggered pop.
    for (let i = 0; i < 3; i++) {
      const star = this.add
        .text(-70 + i * 70, -40, '★', { fontSize: '52px', color: i < stars ? '#ffd23f' : '#3a3f5c' })
        .setOrigin(0.5)
        .setScale(0);
      this.tweens.add({ targets: star, scale: 1, ease: 'Back.easeOut', duration: 350, delay: 250 + i * 130 });
      panel.add(star);
    }

    // Retry / Levels / (Next if another level exists).
    const nextId = this.save.nextLevelId(this.level.id);
    const actions = [
      ['Retry', () => this.scene.restart(), 0x2a2f45, '#ffffff'],
      ['Levels', () => this._toLevelSelect(), 0x2a2f45, '#ffffff'],
    ];
    if (nextId) actions.push(['Next', () => this.scene.restart({ levelId: nextId }), 0x38e1ff, '#0b1020']);

    const spacing = 116;
    const startX = -((actions.length - 1) * spacing) / 2;
    actions.forEach(([label, cb, color, textColor], i) => {
      const b = new Button(this, startX + i * spacing, 100, label, cb, {
        width: 106, height: 46, fontSize: '18px', color, textColor,
      });
      panel.add(b);
    });

    panel.setScale(0.7).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, ease: 'Back.easeOut', duration: 380 });
  }

  _toLevelSelect() {
    CrazyGamesSDK.gameplayStop();
    this.scene.start('LevelSelectScene', { chapterId: this.chapterId });
  }
}
