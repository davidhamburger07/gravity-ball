// BootScene.js — first scene. Initializes the platform SDK and generates the placeholder
// textures so the game is fully runnable before any real art exists (per the project brief:
// use generic shapes when final assets are missing).
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import { generatePlaceholderTextures } from '../systems/Textures.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  async create() {
    await CrazyGamesSDK.init();
    generatePlaceholderTextures(this);
    this.scene.start('PreloadScene');
  }
}
