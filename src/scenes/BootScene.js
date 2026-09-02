// BootScene.js — first scene. Initializes the platform SDK and generates the placeholder
// textures so the game is fully runnable before any real art exists (per the project brief:
// use generic shapes when final assets are missing).
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import { generatePlaceholderTextures } from '../systems/Textures.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    // Kick the SDK off but deliberately do NOT await it here. The level data PreloadScene
    // fetches has nothing to do with the platform, and awaiting first meant levels.json was
    // not even REQUESTED until the SDK had finished — the two now overlap. PreloadScene waits
    // on this promise before it touches saved progress, which is the only part that needs it.
    const sdkReady = CrazyGamesSDK.init().then(() => CrazyGamesSDK.loadingStart());
    this.registry.set('sdkReady', sdkReady);

    generatePlaceholderTextures(this);
    this.scene.start('PreloadScene');
  }
}
