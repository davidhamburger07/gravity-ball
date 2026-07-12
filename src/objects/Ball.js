// Ball.js — the player-controlled sphere. It has NO self-locomotion; it only responds
// to world gravity (the core design rule). A Matter circle body gives real rolling + momentum.
//
// The physics body is kept invisible and always at scale 1 so collisions stay exact. A separate
// `visual` sprite tracks the body each frame and is what gets squashed/stretched — this keeps
// game-feel animation from ever altering the collision shape.
import { PHYSICS } from '../config/GameConfig.js';

export default class Ball extends Phaser.Physics.Matter.Sprite {
  constructor(scene, x, y) {
    super(scene.matter.world, x, y, 'ball');
    scene.add.existing(this);

    this.setCircle(PHYSICS.BALL_RADIUS);
    this.setFriction(PHYSICS.BALL_FRICTION, PHYSICS.BALL_FRICTION_AIR);
    this.setBounce(PHYSICS.BALL_BOUNCE);
    this.body.label = 'ball'; // Matter body label (collision routing); no setLabel() on sprites
    this.setVisible(false); // physics body is invisible; the visual proxy renders instead

    this.visual = scene.add.image(x, y, 'ball').setDepth(10);
    this.spawn = { x, y };
  }

  /** Keep the visual proxy locked to the physics body (called from GameScene.update). */
  sync() {
    this.visual.setPosition(this.x, this.y).setRotation(this.rotation);
  }

  /** Reset to spawn with zero velocity (used on death/respawn). */
  respawn() {
    this.setPosition(this.spawn.x, this.spawn.y);
    this.setVelocity(0, 0);
    this.setAngularVelocity(0);
    this.visual.setPosition(this.spawn.x, this.spawn.y).setScale(1).setRotation(0);
  }
}
