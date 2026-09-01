// main.js — Phaser bootstrap. Assembles engine config and starts the scene pipeline:
// BootScene → PreloadScene → GameScene.
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import LevelSelectScene from './scenes/LevelSelectScene.js';
import LevelBrowserScene from './scenes/LevelBrowserScene.js';
import GameScene from './scenes/GameScene.js';
import SkinsScene from './scenes/SkinsScene.js';
import { installAI } from './ai/bootstrap.js';
import { enforceSitelock } from './systems/Sitelock.js';
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
      // Phaser's auto-update advances physics once per rendered frame, which makes the ball's
      // real-world speed depend on frame rate (a 144Hz monitor ran the game ~2.4x faster than
      // 60Hz, and a heavy canvas crawled). GameScene drives the world on a fixed timestep instead.
      autoUpdate: false,
    },
  },
  scene: [BootScene, PreloadScene, MenuScene, LevelSelectScene, LevelBrowserScene, GameScene, SkinsScene],
};

// Refuse to boot on a host that is not CrazyGames, this project's own deployment, or localhost.
// Deliberately fails open, so it can never be the reason a real player sees a blank screen.
if (enforceSitelock()) {
  // Expose the game instance for scripted testing (screenshot.mjs jumps to scenes/levels
  // via `window.game`). Harmless in production.
  window.game = new Phaser.Game(config);

  // Procedural generator + AI playtester console (window.GravityBallAI). Installing it is inert
  // — nothing runs until you call it or load the page with ?ai=1.
  installAI(window.game);
}
