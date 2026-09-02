// SkinsScene.js — browse and equip ball skins. Locked entries show what they need and how far
// along you are, so the screen doubles as a list of goals rather than a wall of question marks.
import Button from '../ui/Button.js';
import { SKINS, skinTextureKey, isSkinUnlocked, describeRequirement, requirementProgress } from '../systems/Skins.js';
import { AudioManager } from '../systems/AudioManager.js';
import { Banners } from '../systems/Banners.js';
import { Layout } from '../config/Layout.js';

// Portrait trades columns for size: a 104-unit tile is about 51 CSS px on a phone, and there is
// width to spare once the canvas matches the device.
const METRICS = {
  landscape: { cols: 5, tile: 104, gap: 16, top: 190 },
  portrait: { cols: 3, tile: 216, gap: 26, top: 400 },
};

export default class SkinsScene extends Phaser.Scene {
  constructor() {
    super('SkinsScene');
  }

  create() {
    const L = Layout;
    const m = Layout.isPortrait ? METRICS.portrait : METRICS.landscape;
    this.save = this.registry.get('save');
    this.levelsData = this.registry.get('levels');
    const { width } = this.scale;
    Banners.show();

    this.add
      .text(width / 2, L.s(40), 'BALL SKINS', {
        fontFamily: 'system-ui, sans-serif', fontSize: L.font(30), color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5);

    new Button(this, L.s(78), L.s(40), '‹ MENU', () => this.scene.start('MenuScene'), {
      width: L.s(108), height: L.s(44), fontSize: L.font(18), color: 0x2a2f45, textColor: '#ffffff',
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));

    // Against the ceiling, not bare: "42/84" makes the size of the campaign legible, and would
    // have made the old 420-stars-in-an-84-star-campaign bug obvious at a glance.
    this.add
      .text(width - L.s(16), L.s(40), `★ ${this.save.totalStars()}/${this.save.maxStars()}`, {
        fontFamily: 'monospace', fontSize: L.font(18), color: '#ffd23f',
      })
      .setOrigin(1, 0.5);

    this._detail = this.add
      .text(width / 2, L.s(92), '', { fontFamily: 'monospace', fontSize: L.font(13), color: '#8990b8' })
      .setOrigin(0.5);

    this._grid = this.add.container(0, 0);
    this._build();
  }

  _build() {
    const L = Layout;
    const m = Layout.isPortrait ? METRICS.portrait : METRICS.landscape;
    this._grid.removeAll(true);
    const { width } = this.scale;
    const gridW = m.cols * m.tile + (m.cols - 1) * m.gap;
    const startX = (width - gridW) / 2 + m.tile / 2;
    // Centre the block vertically in portrait: with 10 skins the last row is short, and hanging
    // the grid from a fixed top left a large void under it.
    const rows = Math.ceil(SKINS.length / m.cols);
    const blockH = rows * m.tile + (rows - 1) * m.gap;
    const startY = Layout.isPortrait
      ? Math.max(m.top, (this.scale.height - blockH) / 2) + m.tile / 2
      : m.top;

    SKINS.forEach((skin, i) => {
      const col = i % m.cols;
      const row = Math.floor(i / m.cols);
      this._grid.add(this._tile(skin, startX + col * (m.tile + m.gap), startY + row * (m.tile + m.gap), i));
    });
  }

  _tile(skin, x, y, index) {
    const L = Layout;
    const m = Layout.isPortrait ? METRICS.portrait : METRICS.landscape;
    const tile = this.add.container(x, y);
    const unlocked = isSkinUnlocked(skin, this.save, this.levelsData);
    const equipped = this.save.equippedSkin === skin.id && unlocked;

    const bg = this.add
      .rectangle(0, 0, m.tile, m.tile, unlocked ? 0x2a2f45 : 0x1a1e30)
      .setStrokeStyle(equipped ? 3 : 2, equipped ? 0x2bd67b : unlocked ? 0x38e1ff : 0x3a3f5c, equipped ? 1 : 0.6);
    tile.add(bg);

    const ball = this.add.image(0, -m.tile * 0.14, skinTextureKey(skin.id)).setScale(m.tile / 104 * 1.5);
    if (!unlocked) ball.setAlpha(0.25);
    tile.add(ball);

    tile.add(
      this.add
        .text(0, m.tile * 0.25, skin.name, {
          fontFamily: 'system-ui, sans-serif', fontSize: L.font(12),
          color: unlocked ? '#dfe3f5' : '#5a6089',
        })
        .setOrigin(0.5)
    );

    if (equipped) {
      tile.add(this.add.text(0, m.tile * 0.40, 'EQUIPPED', { fontFamily: 'monospace', fontSize: L.font(10), color: '#2bd67b' }).setOrigin(0.5));
    } else if (!unlocked) {
      const prog = requirementProgress(skin, this.save, this.levelsData);
      tile.add(this.add.text(0, m.tile * 0.40, prog ?? '🔒', { fontFamily: 'monospace', fontSize: L.font(10), color: '#7a80a8' }).setOrigin(0.5));
    }

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      this._detail.setText(
        unlocked ? `${skin.name} — click to equip` : `${skin.name} — ${describeRequirement(skin.req, this.levelsData)}`
      );
      this.tweens.add({ targets: tile, scale: 1.06, duration: 120, ease: 'Back.easeOut' });
    });
    bg.on('pointerout', () => {
      this._detail.setText('');
      this.tweens.add({ targets: tile, scale: 1, duration: 120, ease: 'Back.easeOut' });
    });
    bg.on('pointerdown', () => {
      if (!unlocked) {
        AudioManager.deny();
        this.cameras.main.shake(90, 0.003);
        return;
      }
      AudioManager.ui();
      this.save.equipSkin(skin.id);
      this._build();
    });

    tile.setScale(0);
    this.tweens.add({ targets: tile, scale: 1, ease: 'Back.easeOut', duration: 300, delay: 60 + index * 40 });
    return tile;
  }
}
