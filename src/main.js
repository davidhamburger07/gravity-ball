// main.js — Phaser bootstrap. Assembles engine config and starts the scene pipeline:
// BootScene → PreloadScene → GameScene.
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import LevelSelectScene from './scenes/LevelSelectScene.js';
import GameScene from './scenes/GameScene.js';
import { VIEW, PHYSICS } from './config/GameConfig.js';

const config = {
  type: Phaser.AUTO, // WebGL with Canvas fallback
  parent: 'game-root',
  transparent: true, // let the page's full-screen background show behind the centered playfield
  scale: {
    mode: Phaser.Scale.FIT, // responsive: scales to fit any screen (portrait or landscape), keeps aspect ratio
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
  scene: [BootScene, PreloadScene, MenuScene, LevelSelectScene, GameScene],
};

// Expose the game instance for scripted testing (screenshot.mjs jumps to scenes/levels
// via `window.game`). Harmless in production.
window.game = new Phaser.Game(config);
