// GameScene.js — assembles a level from data and wires the three decoupled systems:
//   InputManager (raw input) → 'gravity:request' → GravityController (mechanic)
//   GravityController → 'gravity:changed' → juice (camera lead, screen shake)
import Ball from '../objects/Ball.js';
import GravityController, { GravityDirection } from '../systems/GravityController.js';
import InputManager from '../systems/InputManager.js';
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import { VIEW, PHYSICS, FEEL } from '../config/GameConfig.js';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    this.chapterId = data.chapterId ?? 1;
    this.levelId = data.levelId ?? '1-1';
    this._solved = false;
  }

  create() {
    const level = this._resolveLevel(this.chapterId, this.levelId);
    const bounds = level.bounds ?? { w: VIEW.WIDTH, h: VIEW.HEIGHT };

    this.matter.world.setBounds(0, 0, bounds.w, bounds.h);
    this.cameras.main.setBounds(0, 0, bounds.w, bounds.h);
    this.cameras.main.setBackgroundColor(VIEW.BACKGROUND);

    this._buildStatic(level);
    this.ball = new Ball(this, level.spawn.x, level.spawn.y);

    // Camera: smooth follow with lerp — never rigidly locked (game-feel guardrail).
    this.cameras.main.startFollow(this.ball, true, FEEL.CAMERA_LERP, FEEL.CAMERA_LERP);

    // --- Systems ---------------------------------------------------------
    this.gravity = new GravityController(this, {
      initial: level.gravity ?? GravityDirection.DOWN,
      strength: PHYSICS.GRAVITY_STRENGTH,
      cooldown: FEEL.GRAVITY_COOLDOWN_MS,
    });
    this.input.keyboard && (this.inputManager = new InputManager(this));

    // Input → mechanic.
    this.events.on('gravity:request', (dir) => this.gravity.request(dir));
    // Mechanic → juice.
    this.events.on('gravity:changed', ({ vector }) => this._onGravityShift(vector));

    // Collision resolution for goal (win) and hazards (death).
    this.matter.world.on('collisionstart', (event) => this._onCollision(event));

    this._buildHud(level);
    CrazyGamesSDK.gameplayStart();
  }

  // --- Level construction --------------------------------------------------
  _resolveLevel(chapterId, levelId) {
    const data = this.registry.get('levels');
    const chapter = data.chapters.find((c) => c.id === chapterId);
    return chapter.levels.find((l) => l.id === levelId);
  }

  _buildStatic(level) {
    // Walls: static Matter bodies + matching visuals (colliders must match sprites exactly).
    (level.walls ?? []).forEach((w) => {
      this.matter.add.rectangle(w.x, w.y, w.w, w.h, { isStatic: true, label: 'wall' });
      this.add.rectangle(w.x, w.y, w.w, w.h, 0x3a3f5c).setStrokeStyle(2, 0x4c5378);
    });

    // Hazards: sensor bodies that kill the ball on contact.
    (level.hazards ?? []).forEach((h) => {
      this.matter.add.rectangle(h.x, h.y, h.w ?? 32, h.h ?? 32, {
        isStatic: true, isSensor: true, label: 'hazard',
      });
      this.add.image(h.x, h.y, 'spike').setDisplaySize(h.w ?? 32, h.h ?? 32);
    });

    // Goal: sensor. Reaching it wins the level.
    const goal = level.goal;
    this.matter.add.rectangle(goal.x, goal.y, 40, 40, {
      isStatic: true, isSensor: true, label: 'goal',
    });
    this.add.image(goal.x, goal.y, 'goal').setDepth(5);
  }

  _buildHud(level) {
    this.add.text(12, 10, `Chapter ${this.chapterId} · Level ${level.id}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#9aa0c3',
    }).setScrollFactor(0).setDepth(100);
  }

  // --- Feedback / juice ----------------------------------------------------
  _onGravityShift(vector) {
    this.cameras.main.shake(120, FEEL.SHIFT_SHAKE);
    // Lead the camera in the new "down" direction so the shift reads clearly.
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

  _win() {
    if (this._solved) return;
    this._solved = true;
    CrazyGamesSDK.happytime();
    CrazyGamesSDK.gameplayStop();
    this.cameras.main.flash(200, 43, 214, 123);
    this.add.text(VIEW.WIDTH / 2, 40, 'GOAL!', {
      fontFamily: 'monospace', fontSize: '32px', color: '#2bd67b',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
    // TODO: level-complete panel (spring ease), star rating, next-level flow + midgame ad.
    this.time.delayedCall(900, () => this.scene.restart());
  }

  _die() {
    this.cameras.main.shake(200, 0.01);
    this.cameras.main.flash(150, 255, 77, 94);
    this.ball.respawn();
  }
}
