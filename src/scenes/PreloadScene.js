// PreloadScene.js — loads external level data (never hardcoded) and hands off to gameplay.
// Real art/audio loads will also live here once assets exist in /assets.
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    CrazyGamesSDK.loadingStart();
    // Level definitions are data, arrayed by chapter → level (see src/data/levels.json).
    this.load.json('levels', 'src/data/levels.json');
  }

  create() {
    CrazyGamesSDK.loadingStop();
    this.registry.set('levels', this.cache.json.get('levels'));
    // Start on the very first level. A MenuScene / LevelSelectScene will drive this later.
    this.scene.start('GameScene', { chapterId: 1, levelId: '1-1' });
  }
}
