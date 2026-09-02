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
import { Layout } from './config/Layout.js';

// Size the canvas to the device before Phaser reads the config. On a phone held upright this
// makes the canvas match the screen aspect, so FIT has nothing to letterbox and the ~510px of
// dead space below the game becomes room for the touch controls.
Layout.measure(window.innerWidth, window.innerHeight);

const config = {
  type: Phaser.AUTO, // WebGL with Canvas fallback
  parent: 'game-root',
  transparent: true, // let the page's full-screen background show behind the centered playfield
  scale: {
    mode: Phaser.Scale.FIT, // responsive: scales to fit any screen (portrait or landscape), keeps aspect ratio
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: Layout.width,
    height: Layout.height,
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

  // Rotating the device changes which layout applies. Resizing the canvas is enough for a small
  // change, but crossing between portrait and landscape moves every element, so the live scenes
  // are rebuilt. Restarting mid-level costs the current attempt, which is a fair trade against
  // leaving the player with a layout built for the other orientation.
  const relayout = () => {
    const wasPortrait = Layout.isPortrait;
    Layout.measure(window.innerWidth, window.innerHeight);
    window.game.scale.setGameSize(Layout.width, Layout.height);
    if (wasPortrait === Layout.isPortrait) return;
    window.game.scene.getScenes(true).forEach((s) => s.scene.restart());
  };
  let relayoutTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(relayout, 150); // settle: iOS fires several during a rotation
  });
}
