// PreloadScene.js — loads external level data, boots the save system, then hands off to
// the main menu. Real art/audio loads will also live here once assets exist in /assets.
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import SaveManager from '../systems/SaveManager.js';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    CrazyGamesSDK.loadingStart();
    // Level definitions are data, arrayed by chapter -> level (see src/data/levels.json).
    this.load.json('levels', 'src/data/levels.json');
  }

  async create() {
    CrazyGamesSDK.loadingStop();
    const levels = this.cache.json.get('levels');
    this.registry.set('levels', levels);

    // Load saved progress (cloud on-platform, localStorage locally) before the menu paints.
    const save = await new SaveManager(levels).load();
    this.registry.set('save', save);

    this.scene.start('MenuScene');
  }
}
