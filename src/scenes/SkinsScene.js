// SkinsScene.js — browse and equip ball skins. Locked entries show what they need and how far
// along you are, so the screen doubles as a list of goals rather than a wall of question marks.
import Button from '../ui/Button.js';
import { SKINS, skinTextureKey, isSkinUnlocked, describeRequirement, requirementProgress } from '../systems/Skins.js';
import { AudioManager } from '../systems/AudioManager.js';

const COLS = 5;
const TILE = 104;
const GAP = 16;

export default class SkinsScene extends Phaser.Scene {
  constructor() {
    super('SkinsScene');
  }

  create() {
    this.save = this.registry.get('save');
    this.levelsData = this.registry.get('levels');
    const { width } = this.scale;

    this.add
      .text(width / 2, 40, 'BALL SKINS', {
        fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5);

    new Button(this, 56, 40, '‹', () => this.scene.start('MenuScene'), {
      width: 48, height: 44, fontSize: '22px', color: 0x2a2f45, textColor: '#ffffff',
    });

    this.add
      .text(width - 16, 40, `★ ${this.save.totalStars()}`, {
        fontFamily: 'monospace', fontSize: '18px', color: '#ffd23f',
      })
      .setOrigin(1, 0.5);

    this._detail = this.add
      .text(width / 2, 92, '', { fontFamily: 'monospace', fontSize: '13px', color: '#8990b8' })
      .setOrigin(0.5);

    this._grid = this.add.container(0, 0);
    this._build();
  }

  _build() {
    this._grid.removeAll(true);
    const { width } = this.scale;
    const gridW = COLS * TILE + (COLS - 1) * GAP;
    const startX = (width - gridW) / 2 + TILE / 2;
    const startY = 190;

    SKINS.forEach((skin, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this._grid.add(this._tile(skin, startX + col * (TILE + GAP), startY + row * (TILE + GAP), i));
    });
  }

  _tile(skin, x, y, index) {
    const tile = this.add.container(x, y);
    const unlocked = isSkinUnlocked(skin, this.save, this.levelsData);
    const equipped = this.save.equippedSkin === skin.id && unlocked;

    const bg = this.add
      .rectangle(0, 0, TILE, TILE, unlocked ? 0x2a2f45 : 0x1a1e30)
      .setStrokeStyle(equipped ? 3 : 2, equipped ? 0x2bd67b : unlocked ? 0x38e1ff : 0x3a3f5c, equipped ? 1 : 0.6);
    tile.add(bg);

    const ball = this.add.image(0, -14, skinTextureKey(skin.id)).setScale(1.5);
    if (!unlocked) ball.setAlpha(0.25);
    tile.add(ball);

    tile.add(
      this.add
        .text(0, 26, skin.name, {
          fontFamily: 'system-ui, sans-serif', fontSize: '12px',
          color: unlocked ? '#dfe3f5' : '#5a6089',
        })
        .setOrigin(0.5)
    );

    if (equipped) {
      tile.add(this.add.text(0, 42, 'EQUIPPED', { fontFamily: 'monospace', fontSize: '10px', color: '#2bd67b' }).setOrigin(0.5));
    } else if (!unlocked) {
      const prog = requirementProgress(skin, this.save, this.levelsData);
      tile.add(this.add.text(0, 42, prog ?? '🔒', { fontFamily: 'monospace', fontSize: '10px', color: '#7a80a8' }).setOrigin(0.5));
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
