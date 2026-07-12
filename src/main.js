// main.js — Phaser bootstrap. Assembles engine config and starts the scene pipeline:
// BootScene → PreloadScene → GameScene.
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import GameScene from './scenes/GameScene.js';
import { VIEW, PHYSICS } from './config/GameConfig.js';

const config = {
  type: Phaser.AUTO, // WebGL with Canvas fallback
  parent: 'game-root',
  backgroundColor: VIEW.BACKGROUND,
  scale: {
    mode: Phaser.Scale.FIT, // responsive: scales to fit any screen, keeps aspect ratio
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEW.WIDTH,
    height: VIEW.HEIGHT,
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: PHYSICS.GRAVITY_STRENGTH }, // starts "down"; GravityController owns it after boot
      debug: false, // flip to true to inspect colliders vs sprites
    },
  },
  scene: [BootScene, PreloadScene, GameScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
