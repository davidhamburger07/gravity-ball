// PreloadScene.js — loads external level data, boots the save system, then hands off to
// the main menu. Real art/audio loads will also live here once assets exist in /assets.
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import SaveManager from '../systems/SaveManager.js';
import { decodeLevel } from '../systems/ShareCode.js';
import { autoStartFromUrl } from '../ai/bootstrap.js';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    // Level definitions are data, arrayed by chapter -> level (see src/data/levels.json).
    this.load.json('levels', 'src/data/levels.json');
  }

  create() {
    const levels = this.cache.json.get('levels');
    this.registry.set('levels', levels);

    // Local-first, and nothing here awaits the platform. Blocking the first paint on the SDK cost
    // seven seconds on a non-CrazyGames host, where init() spends that long failing a handshake
    // before reporting "disabled" — the whole game was loaded and idle after 755ms.
    const save = new SaveManager(levels).load();
    this.registry.set('save', save);

    // Reconcile with the cloud copy whenever the SDK turns up, long after the menu is playable.
    // Only matters for a player arriving on a second device; see SaveManager.syncFromCloud.
    const sdkReady = this.registry.get('sdkReady');
    Promise.resolve(sdkReady)
      .then(() => save.syncFromCloud())
      .catch(() => false)
      .then(() => CrazyGamesSDK.loadingStop());

    // Everything is ready — dismiss the HTML loading overlay.
    if (typeof document !== 'undefined') document.getElementById('loading')?.remove();

    const handOff = (scene, data) => this.scene.start(scene, data);

    // Automated content run (./?ai=1) — generate levels and let the AI playtest them.
    if (autoStartFromUrl(this.game)) return;

    const params = new URLSearchParams(location.search);

    // Editor playlist run: ?playlist=1&i=N plays the designer's own levels in order.
    if (params.has('playlist')) {
      try {
        const list = JSON.parse(localStorage.getItem('gravityball:playlist'));
        if (Array.isArray(list) && list.length) {
          this.registry.set('playlist', list);
          const i = Math.min(Math.max(parseInt(params.get('i'), 10) || 0, 0), list.length - 1);
          handOff('GameScene', { playlist: true, playlistIndex: i });
          return;
        }
      } catch { /* fall through to the menu */ }
    }

    // Shared-map link: ?code=… plays someone else's level straight from the URL.
    const codeParam = params.get('code');
    if (codeParam) {
      const shared = decodeLevel(codeParam);
      if (shared) {
        this.registry.set('playtestLevel', shared);
        handOff('GameScene', { playtest: true });
        return;
      }
    }

    // Playtest hand-off from the level editor (editor.html → ./?playtest=1).
    if (params.has('playtest')) {
      try {
        const lvl = JSON.parse(localStorage.getItem('gravityball:playtest'));
        if (lvl && lvl.spawn && lvl.goal) {
          this.registry.set('playtestLevel', lvl);
          handOff('GameScene', { playtest: true });
          return;
        }
      } catch { /* fall through to the menu */ }
    }

    handOff('MenuScene');
  }
}
