// LevelSelectScene.js — chapter tabs + a grid of level tiles showing lock state and star
// ratings pulled from SaveManager. Chapters with no levels yet show a "coming soon" card
// describing what they will teach, so the campaign reads as unfinished rather than broken.
import Button from '../ui/Button.js';
import { AudioManager } from '../systems/AudioManager.js';
import { Banners } from '../systems/Banners.js';
import { Layout } from '../config/Layout.js';
import { Modal } from '../ui/Modal.js';

// Landscape keeps the shipped grid. Portrait drops to 4 columns so each tile can be far larger:
// a 90-unit tile renders about 44 CSS px on a phone, right at the edge of a comfortable tap
// target, and once the canvas matches the device there is width to spare.
const METRICS = {
  landscape: { cols: 5, tile: 90, gap: 18, gridTop: 250, tabW: 144, tabH: 52, tabGap: 12, tabRowY: 98 },
  portrait: { cols: 3, tile: 236, gap: 26, gridTop: 470, tabW: 142, tabH: 96, tabGap: 12, tabRowY: 170 },
};

/**
 * Presentation copy for each chapter. levels.json is the source of truth — this is the fallback
 * that keeps the screen readable if the campaign data is ever rebuilt without these fields.
 */
const CHAPTER_META = {
  1: { short: 'Spikes', mechanic: '4-way gravity shift + spikes' },
  2: { short: 'Bounce', mechanic: 'Sticky pads + trampolines' },
  3: { short: 'Keys', mechanic: 'Keys & doors' },
  4: { short: 'Fragile', mechanic: 'Breakable blocks + weight zones' },
  5: { short: 'Portals', mechanic: 'Momentum-preserving portals' },
};

const shortName = (c) => c.short ?? CHAPTER_META[c.id]?.short ?? `Ch ${c.id}`;
const mechanicOf = (c) => c.mechanic ?? CHAPTER_META[c.id]?.mechanic ?? '';
const blurbOf = (c) => c.blurb ?? 'A new object to learn, and a new way to fall.';

export default class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelectScene');
  }

  init(data = {}) {
    // Clamp to a chapter that actually exists. GameScene hands back chapterId 0 for generated and
    // playtest levels, and any id left over from an older campaign is now out of range — either
    // would have thrown a TypeError in _buildGrid and left a dead canvas.
    const wanted = data.chapterId ?? this.currentChapterId ?? 1;
    const chapters = this.registry.get('levels')?.chapters ?? [];
    this.currentChapterId = chapters.some((c) => c.id === wanted) ? wanted : (chapters[0]?.id ?? 1);
  }

  create() {
    const L = Layout;
    this.save = this.registry.get('save');
    this.levelsData = this.registry.get('levels');
    // Grid and tab geometry differ by orientation; pick once, before anything lays out.
    this.m = Layout.isPortrait ? METRICS.portrait : METRICS.landscape;
    const { width, height } = this.scale;
    Banners.show();

    this.add
      .text(width / 2, L.s(40), 'SELECT LEVEL', {
        fontFamily: 'system-ui, sans-serif', fontSize: L.font(30), color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Labelled rather than a bare chevron: the glyph-only version was easy to miss even when it
    // was rendering, and for a while it was not rendering at all (see _buildGrid).
    new Button(this, L.s(78), L.s(40), '‹ MENU', () => this.scene.start('MenuScene'), {
      width: L.s(108), height: L.s(44), fontSize: L.font(18), color: 0x2a2f45, textColor: '#ffffff',
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));

    this.add
      .text(width - L.s(16), L.s(40), `★ ${this.save.totalStars()}/${this.save.maxStars()}`, {
        fontFamily: 'monospace', fontSize: L.font(18), color: '#ffd23f',
      })
      .setOrigin(1, 0.5);

    this.add
      .text(L.s(16), height - L.s(26), 'Esc — back to menu', {
        fontFamily: 'monospace', fontSize: L.font(11), color: '#3a3f5c',
      })
      .setOrigin(0, 0.5);

    // Unlock-everything switch so progression can be tested without replaying the campaign.
    // Parked in the bottom corner: at the top it was drawn straight through the tab row.
    const testLabel = () => (this.save.testMode ? 'TEST MODE: ON' : 'test mode: off');
    const testBtn = this.add
      .text(width - L.s(16), height - L.s(26), testLabel(), {
        fontFamily: 'monospace', fontSize: L.font(11),
        color: this.save.testMode ? '#ffd23f' : '#5a6089',
      })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    testBtn.on('pointerdown', () => {
      this.save.setTestMode(!this.save.testMode);
      testBtn.setText(testLabel()).setColor(this.save.testMode ? '#ffd23f' : '#5a6089');
      this._buildTabs();
      this._buildGrid();
    });

    this._tabs = this.add.container(0, this.m.tabRowY);
    this._grid = this.add.container(0, 0);
    this._buildTabs();
    this._buildGrid();
  }

  _selectChapter(id) {
    if (id === this.currentChapterId) return;
    AudioManager.ui();
    this.currentChapterId = id;
    this._buildTabs();
    this._buildGrid();
  }

  _buildTabs() {
    const L = Layout;
    this.tweens.killTweensOf(this._tabs.list);
    this._tabs.removeAll(true);
    const { width } = this.scale;
    const chapters = this.levelsData.chapters;
    const totalW = chapters.length * (this.m.tabW + this.m.tabGap) - this.m.tabGap;
    let x = (width - totalW) / 2 + this.m.tabW / 2;

    chapters.forEach((c) => {
      const selected = c.id === this.currentChapterId;
      const built = (c.levels?.length ?? 0) > 0;
      const playable = this.save.isChapterUnlocked(c.id);

      // Four states: selected, playable, built-but-locked, and not built yet.
      let fill = 0x171b2b;      // coming soon
      let stroke = 0x2a2f45;
      let strokeAlpha = 0.9;
      let kicker = 'SOON';
      let kickerColor = '#ffd23f';
      let nameColor = '#5a6089';
      if (selected) {
        fill = 0x38e1ff; stroke = 0xffffff; strokeAlpha = 0.9;
        kicker = built ? `CH ${c.id}` : 'SOON'; kickerColor = '#0b1020'; nameColor = '#0b1020';
      } else if (built && playable) {
        fill = 0x2a2f45; stroke = 0x3a3f5c; strokeAlpha = 0.6;
        kicker = `CH ${c.id}`; kickerColor = '#8990b8'; nameColor = '#ffffff';
      } else if (built) {
        fill = 0x22273c; stroke = 0x3a3f5c; strokeAlpha = 0.45;
        kicker = `CH ${c.id}`; kickerColor = '#5a6089'; nameColor = '#7a80a8';
      }

      const tab = this.add.container(x, 0);
      const bg = this.add
        .rectangle(0, 0, this.m.tabW, this.m.tabH, fill)
        .setStrokeStyle(2, stroke, strokeAlpha)
        .setInteractive({ useHandCursor: true });
      tab.add([
        bg,
        this.add.text(0, -L.s(12), kicker, {
          fontFamily: 'monospace', fontSize: L.font(10), color: kickerColor,
        }).setOrigin(0.5).setAlpha(selected ? 0.7 : 1),
        this.add.text(0, L.s(9), shortName(c), {
          fontFamily: 'system-ui, sans-serif', fontSize: L.font(15), fontStyle: 'bold', color: nameColor,
          align: 'center', wordWrap: { width: this.m.tabW - L.s(16) },
        }).setOrigin(0.5),
      ]);
      if (built && !playable && !selected) {
        tab.add(this.add.text(this.m.tabW / 2 - L.s(14), -L.s(14), '🔒', { fontSize: L.font(11) }).setOrigin(0.5).setAlpha(0.75));
      }

      // Every tab is browsable, including the unbuilt ones — the coming-soon card is the point.
      bg.on('pointerdown', () => this._selectChapter(c.id));
      if (!selected) {
        bg.on('pointerover', () => this.tweens.add({ targets: tab, scale: 1.04, duration: 110, ease: 'Back.easeOut' }));
        bg.on('pointerout', () => this.tweens.add({ targets: tab, scale: 1, duration: 110, ease: 'Back.easeOut' }));
      }

      this._tabs.add(tab);
      x += this.m.tabW + this.m.tabGap;
    });
  }

  _buildGrid() {
    const L = Layout;
    // Kill only the tweens belonging to the objects about to be destroyed. This used to be
    // tweens.killAll(), which also destroyed the header button's spring pop-in — create() builds
    // the grid in the same frame the button is constructed, so it froze at scale 0 and the only
    // way back to the menu was invisible (though still clickable).
    this.tweens.killTweensOf(this._grid.list);
    this._grid.removeAll(true);

    const { width } = this.scale;
    const chapter = this.levelsData.chapters.find((c) => c.id === this.currentChapterId);
    if (!chapter) return;

    this._grid.add(
      this.add
        .text(width / 2, this.m.tabRowY + this.m.tabH / 2 + L.s(28), `Chapter ${chapter.id} · ${chapter.name}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: L.font(20), color: '#38e1ff',
        })
        .setOrigin(0.5)
    );

    const levels = chapter.levels ?? [];
    if (levels.length === 0) { this._comingSoonCard(chapter); return; }

    this._grid.add(
      this.add
        .text(width / 2, this.m.tabRowY + this.m.tabH / 2 + L.s(56), mechanicOf(chapter), {
          fontFamily: 'monospace', fontSize: L.font(13), color: '#5a6089',
        })
        .setOrigin(0.5)
    );

    const rows = Math.ceil(levels.length / this.m.cols);
    // Portrait has far more height than the grid needs, so centre the block in what is left
    // between the chapter header and the footer instead of hanging it from a fixed y.
    const blockH = rows * this.m.tile + (rows - 1) * this.m.gap;
    const areaTop = this.m.tabRowY + this.m.tabH / 2 + L.s(80);
    const areaBottom = this.scale.height - L.s(120);
    const gridTop = Layout.isPortrait
      ? areaTop + Math.max(0, (areaBottom - areaTop - blockH - L.s(70))) / 2 + this.m.tile / 2
      : this.m.gridTop;
    levels.forEach((lvl, i) => {
      const row = Math.floor(i / this.m.cols);
      const col = i % this.m.cols;
      // Centre each row on its own, so a final short row sits under the middle of the one above
      // instead of hugging the left edge.
      const inRow = Math.min(this.m.cols, levels.length - row * this.m.cols);
      const rowW = inRow * this.m.tile + (inRow - 1) * this.m.gap;
      const tx = (width - rowW) / 2 + this.m.tile / 2 + col * (this.m.tile + this.m.gap);
      this._grid.add(this._levelTile(lvl, tx, gridTop + row * (this.m.tile + this.m.gap), i));
    });

    this._chapterProgress(chapter, levels, gridTop + (rows - 1) * (this.m.tile + this.m.gap) + this.m.tile / 2);
  }

  /** A per-chapter progress bar under the grid — it gives the star-gated skins a visible target. */
  _chapterProgress(chapter, levels, gridBottom) {
    const L = Layout;
    const { width } = this.scale;
    const cleared = levels.filter((l) => this.save.isCompleted(l.id)).length;
    const stars = levels.reduce((n, l) => n + this.save.stars(l.id), 0);
    const barY = gridBottom + L.s(48);

    this._grid.add(this.add.rectangle(width / 2, barY, L.s(360), L.s(8), 0x1a1e30).setStrokeStyle(1, 0x3a3f5c, 0.6));
    if (cleared > 0) {
      this._grid.add(
        this.add
          .rectangle(width / 2 - L.s(180), barY, L.s(360) * (cleared / levels.length), L.s(8), 0x38e1ff)
          .setOrigin(0, 0.5)
      );
    }
    this._grid.add(
      this.add
        .text(width / 2, barY + L.s(22), `${cleared}/${levels.length} cleared   ·   ★ ${stars}/${levels.length * 3}`, {
          fontFamily: 'monospace', fontSize: L.font(12), color: '#8990b8',
        })
        .setOrigin(0.5)
    );
  }

  /** Shown for a chapter that is declared but has no levels yet. */
  _comingSoonCard(chapter) {
    const L = Layout;
    const { width } = this.scale;
    const cx = width / 2;
    const top = this.m.tabRowY + this.m.tabH / 2 + L.s(90);

    const card = this.add.rectangle(cx, top + L.s(100), L.s(522), L.s(200), 0x171b2b).setStrokeStyle(2, 0x3a3f5c, 0.45);
    const lock = this.add.text(cx, 242, '🔒', { fontSize: L.font(30) }).setOrigin(0.5).setAlpha(0.5);
    const head = this.add
      .text(cx, top + L.s(84), mechanicOf(chapter), {
        fontFamily: 'system-ui, sans-serif', fontSize: L.font(20), fontStyle: 'bold', color: '#38e1ff',
        align: 'center', wordWrap: { width: L.s(460) },
      })
      .setOrigin(0.5).setAlpha(0.85);
    const blurb = this.add
      .text(cx, top + L.s(124), blurbOf(chapter), {
        fontFamily: 'system-ui, sans-serif', fontSize: L.font(14), color: '#8990b8',
        align: 'center', wordWrap: { width: L.s(440) }, lineSpacing: 4,
      })
      .setOrigin(0.5);
    const badgeBg = this.add.rectangle(cx, top + L.s(172), L.s(156), L.s(28), 0x2a2f45).setStrokeStyle(1, 0x3a3f5c, 0.8);
    const badge = this.add
      .text(cx, top + L.s(172), 'COMING SOON', { fontFamily: 'monospace', fontSize: L.font(11), color: '#ffd23f' })
      .setOrigin(0.5);

    this.tweens.add({
      targets: lock, alpha: { from: 0.35, to: 0.6 },
      duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    this._grid.add([card, lock, head, blurb, badgeBg, badge]);
  }

  _levelTile(lvl, x, y, index) {
    const L = Layout;
    const tile = this.add.container(x, y);
    const unlocked = this.save.isLevelUnlocked(lvl.id);
    const stars = this.save.stars(lvl.id);
    const num = lvl.id.split('-')[1];

    const bg = this.add
      .rectangle(0, 0, this.m.tile, this.m.tile, unlocked ? 0x2a2f45 : 0x1a1e30)
      .setStrokeStyle(2, unlocked ? 0x38e1ff : 0x3a3f5c, 0.6);
    tile.add(bg);

    if (unlocked) {
      tile.add(
        this.add
          .text(0, -this.m.tile * 0.13, num, {
            fontFamily: 'system-ui, sans-serif', fontSize: L.font(30), color: '#ffffff', fontStyle: 'bold',
          })
          .setOrigin(0.5)
      );
      let starStr = '';
      for (let s = 0; s < 3; s++) starStr += s < stars ? '★' : '☆';
      tile.add(
        this.add
          .text(0, this.m.tile * 0.29, starStr, { fontSize: `${Math.round(this.m.tile * 0.18)}px`, color: stars > 0 ? '#ffd23f' : '#3a3f5c' })
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
      // A star-gated level says what it wants. A padlock alone is only honest for chapter 1, where
      // the answer really is "finish the one before"; everywhere else the player can act on a
      // number, and the whole point of the star gate is that being stuck is never a dead end.
      const needed = this.save.starsToUnlock(lvl.id);
      if (needed > 0) {
        tile.add(this.add
          .text(0, -this.m.tile * 0.06, '🔒', { fontSize: `${Math.round(this.m.tile * 0.20)}px` })
          .setOrigin(0.5).setAlpha(0.6));
        tile.add(this.add
          .text(0, this.m.tile * 0.24, `★ ${needed}`, {
            fontFamily: 'monospace', fontSize: `${Math.round(this.m.tile * 0.15)}px`, color: '#ffd23f',
          })
          .setOrigin(0.5).setAlpha(0.85));
      } else {
        tile.add(this.add.text(0, 0, '🔒', { fontSize: `${Math.round(this.m.tile * 0.31)}px` }).setOrigin(0.5));
      }

      // Say no out loud, the same way SkinsScene does, rather than ignoring the tap.
      bg.setInteractive();
      bg.on('pointerdown', () => {
        AudioManager.deny();
        this.cameras.main.shake(90, 0.003);
        if (needed > 0) {
          Modal.notice(this, `Earn ${needed} more star${needed === 1 ? '' : 's'} to open this level.\n\n`
            + 'Stars come from any level — replay one you have already beaten for a better rating, '
            + 'or go back and clear one you skipped.', { title: 'Locked', titleColor: '#ffd23f' });
        }
      });
    }

    tile.setScale(0);
    this.tweens.add({ targets: tile, scale: 1, ease: 'Back.easeOut', duration: 300, delay: 80 + index * 45 });
    return tile;
  }
}
