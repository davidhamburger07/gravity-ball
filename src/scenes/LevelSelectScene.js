// LevelSelectScene.js — chapter tabs + a grid of level tiles showing lock state and star
// ratings pulled from SaveManager. Chapters with no built levels show "Coming soon".
import Button from '../ui/Button.js';

const COLS = 5;
const TILE = 90;
const GAP = 18;

export default class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelectScene');
  }

  init(data = {}) {
    this.currentChapterId = data.chapterId ?? this.currentChapterId ?? 1;
  }

  create() {
    this.save = this.registry.get('save');
    this.levelsData = this.registry.get('levels');
    const { width } = this.scale;

    this.add
      .text(width / 2, 40, 'SELECT LEVEL', {
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

    this._tabs = this.add.container(0, 92);
    this._grid = this.add.container(0, 0);
    this._buildTabs();
    this._buildGrid();
  }

  _buildTabs() {
    this._tabs.removeAll(true);
    const { width } = this.scale;
    const chapters = this.levelsData.chapters;
    const tabW = 66;
    const gap = 6;
    const totalW = chapters.length * (tabW + gap) - gap;
    let x = (width - totalW) / 2 + tabW / 2;

    chapters.forEach((c) => {
      const selected = c.id === this.currentChapterId;
      const playable = this.save.isChapterUnlocked(c.id);
      const fill = selected ? 0x38e1ff : playable ? 0x2a2f45 : 0x1a1e30;
      const tab = this.add
        .rectangle(x, 0, tabW, 40, fill)
        .setStrokeStyle(2, selected ? 0xffffff : 0x3a3f5c, 0.6)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(x, 0, `${c.id}`, {
          fontFamily: 'monospace', fontSize: '18px',
          color: selected ? '#0b1020' : playable ? '#ffffff' : '#5a6089',
        })
        .setOrigin(0.5);

      // Browsing is always allowed; playability is enforced at the level tiles.
      tab.on('pointerdown', () => {
        this.currentChapterId = c.id;
        this._buildTabs();
        this._buildGrid();
      });

      this._tabs.add([tab, label]);
      x += tabW + gap;
    });
  }

  _buildGrid() {
    this.tweens.killAll(); // clear any in-flight tile pop-ins before rebuilding
    this._grid.removeAll(true);
    const { width } = this.scale;
    const chapter = this.levelsData.chapters.find((c) => c.id === this.currentChapterId);

    this._grid.add(
      this.add
        .text(width / 2, 150, `Chapter ${chapter.id} · ${chapter.name}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: '20px', color: '#38e1ff',
        })
        .setOrigin(0.5)
    );
    this._grid.add(
      this.add
        .text(width / 2, 176, chapter.mechanic, {
          fontFamily: 'monospace', fontSize: '13px', color: '#5a6089',
        })
        .setOrigin(0.5)
    );

    const levels = chapter.levels ?? [];
    if (levels.length === 0) {
      this._grid.add(
        this.add
          .text(width / 2, 330, 'Coming soon', {
            fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#5a6089',
          })
          .setOrigin(0.5)
      );
      return;
    }

    const gridW = COLS * TILE + (COLS - 1) * GAP;
    const startX = (width - gridW) / 2 + TILE / 2;
    const startY = 250;
    levels.forEach((lvl, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const tx = startX + col * (TILE + GAP);
      const ty = startY + row * (TILE + GAP);
      this._grid.add(this._levelTile(lvl, tx, ty, i));
    });
  }

  _levelTile(lvl, x, y, index) {
    const tile = this.add.container(x, y);
    const unlocked = this.save.isLevelUnlocked(lvl.id);
    const stars = this.save.stars(lvl.id);
    const num = lvl.id.split('-')[1];

    const bg = this.add
      .rectangle(0, 0, TILE, TILE, unlocked ? 0x2a2f45 : 0x1a1e30)
      .setStrokeStyle(2, unlocked ? 0x38e1ff : 0x3a3f5c, 0.6);
    tile.add(bg);

    if (unlocked) {
      tile.add(
        this.add
          .text(0, -12, num, {
            fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: 'bold',
          })
          .setOrigin(0.5)
      );
      let starStr = '';
      for (let s = 0; s < 3; s++) starStr += s < stars ? '★' : '☆';
      tile.add(
        this.add
          .text(0, 26, starStr, { fontSize: '16px', color: stars > 0 ? '#ffd23f' : '#3a3f5c' })
          .setOrigin(0.5)
      );

      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () =>
        this.tweens.add({ targets: tile, scale: 1.08, duration: 120, ease: 'Back.easeOut' })
      );
      bg.on('pointerout', () =>
        this.tweens.add({ targets: tile, scale: 1, duration: 120, ease: 'Back.easeOut' })
      );
      bg.on('pointerdown', () =>
        this.scene.start('GameScene', { levelId: lvl.id, chapterId: this.currentChapterId })
      );
    } else {
      tile.add(this.add.text(0, 0, '🔒', { fontSize: '28px' }).setOrigin(0.5)); // 🔒
    }

    tile.setScale(0);
    this.tweens.add({ targets: tile, scale: 1, ease: 'Back.easeOut', duration: 300, delay: 80 + index * 45 });
    return tile;
  }
}
