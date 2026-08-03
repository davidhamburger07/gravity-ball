// studio/main.js — bootstraps the AI Level Studio page (ai.html).
//
// Same scene pipeline as the game, parented into the studio's stage so you can watch the AI
// play, plus the control panel and results table. Everything the terminal driver does is
// available here; nothing here needs the terminal.
import BootScene from '../../scenes/BootScene.js';
import PreloadScene from '../../scenes/PreloadScene.js';
import MenuScene from '../../scenes/MenuScene.js';
import LevelSelectScene from '../../scenes/LevelSelectScene.js';
import GameScene from '../../scenes/GameScene.js';
import { VIEW, PHYSICS } from '../../config/GameConfig.js';
import { installAI } from '../bootstrap.js';
import { initStudio } from './panel.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'ai-game',
  transparent: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEW.WIDTH,
    height: VIEW.HEIGHT,
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: PHYSICS.GRAVITY_STRENGTH },
      debug: false,
      autoUpdate: false, // GameScene drives the world (fixed timestep, or the AI's turbo loop)
    },
  },
  scene: [BootScene, PreloadScene, MenuScene, LevelSelectScene, GameScene],
});

window.game = game;
installAI(game);

initStudio({
  game,
  panel: document.getElementById('ai-panel'),
  results: document.getElementById('ai-results'),
});
