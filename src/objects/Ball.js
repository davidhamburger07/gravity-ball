// Ball.js — the player-controlled sphere. It has NO self-locomotion; it only responds
// to world gravity (the core design rule). A Matter circle body gives real rolling + momentum.
import { PHYSICS } from '../config/GameConfig.js';

export default class Ball extends Phaser.Physics.Matter.Sprite {
  constructor(scene, x, y) {
    super(scene.matter.world, x, y, 'ball');
    scene.add.existing(this);

    this.setCircle(PHYSICS.BALL_RADIUS);
    this.setFriction(PHYSICS.BALL_FRICTION, PHYSICS.BALL_FRICTION_AIR);
    this.setBounce(PHYSICS.BALL_BOUNCE);
    this.body.label = 'ball'; // Matter body label (used for collision routing); no setLabel() on sprites
    this.setDepth(10);

    this.spawn = { x, y };
  }

  /** Reset to spawn with zero velocity (used on death/respawn). */
  respawn() {
    this.setPosition(this.spawn.x, this.spawn.y);
    this.setVelocity(0, 0);
    this.setAngularVelocity(0);
  }
}
