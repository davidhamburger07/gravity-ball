// LevelBrowserScene.js — browse, search and play levels made by other players.
//
// Four tabs over the same card list: Newest, Top, Featured and Search. The first three page
// through server-ranked lists; Search filters a catalogue snapshot downloaded once per visit,
// which is why typing feels instant and costs nothing per keystroke.
//
// Text entry uses window.prompt, the same choice MenuScene makes for share codes: it works
// identically on desktop and mobile without the game having to build a virtual keyboard.

import Button from '../ui/Button.js';
import { AudioManager } from '../systems/AudioManager.js';
import * as LevelApi from '../systems/LevelApi.js';
import { Layout } from '../config/Layout.js';

// Portrait gets taller cards (a 64-unit card is ~31 CSS px on a phone) and a list that runs the
// full height of the screen instead of stopping at a landscape-sized 566.
const METRICS = {
  landscape: { cardW: 660, cardH: 64, gap: 10, top: 150, bottom: 566, tabW: 130, tabH: 38, tabY: 96 },
  portrait: { cardW: 740, cardH: 132, gap: 16, top: 330, bottom: 0, tabW: 176, tabH: 74, tabY: 210 },
};

const TABS = [
  { key: 'new', label: 'Newest' },
  { key: 'rating', label: 'Top' },
  { key: 'featured', label: 'Featured' },
  { key: 'search', label: 'Search' },
];

export default class LevelBrowserScene extends Phaser.Scene {
  constructor() {
    super('LevelBrowserScene');
  }

  init(data = {}) {
    this.tab = data.tab ?? this.tab ?? 'new';
    this._items = [];
    this._cursor = 0;
    this._nextCursor = null;
    this._loading = false;
    this._query = data.query ?? '';
    this._scroll = 0;
  }

  create() {
    this.k = Layout.isPortrait ? METRICS.portrait : METRICS.landscape;
    this._listBottom = this.k.bottom || this.scale.height - Layout.s(40);
    const { width } = this.scale;

    this.add.text(width / 2, Layout.isPortrait ? Layout.s(96) : Layout.s(40), 'CUSTOM LEVELS', {
      fontFamily: 'system-ui, sans-serif', fontSize: Layout.font(30), color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);

    new Button(this, Layout.s(78), Layout.s(40), '‹ MENU', () => this.scene.start('MenuScene'), {
      width: Layout.s(108), height: Layout.s(44), fontSize: Layout.font(22), color: 0x2a2f45, textColor: '#ffffff',
    });

    this.add.text(width - Layout.s(20), Layout.isPortrait ? Layout.s(44) : Layout.s(40), 'Make your own\nin the Level Editor', {
      fontFamily: 'system-ui, sans-serif', fontSize: Layout.font(12), color: '#5a6089', align: 'right',
    }).setOrigin(1, 0.5);

    this._tabsRow = this.add.container(0, this.k.tabY);
    this._list = this.add.container(0, this.k.top);
    this._status = this.add.text(width / 2, this.scale.height / 2, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: Layout.font(17), color: '#7a80a8',
      align: 'center', wordWrap: { width: 520 },
    }).setOrigin(0.5);

    // Clip the list to the viewport so cards scroll under the tabs rather than over them.
    const maskShape = this.make.graphics({ add: false });
    maskShape.fillRect(0, this.k.top, width, this._listBottom - this.k.top);
    this._list.setMask(maskShape.createGeometryMask());

    this._buildTabs();
    this._wireScrolling();
    this._load();
  }

  // --- Chrome ----------------------------------------------------------------------------------

  _buildTabs() {
    this._tabsRow.removeAll(true);
    const { width } = this.scale;
    const tabW = this.k.tabW;
    const gap = Layout.s(8);
    const totalW = TABS.length * (tabW + gap) - gap;
    let x = (width - totalW) / 2 + tabW / 2;

    for (const { key, label } of TABS) {
      const selected = key === this.tab;
      const bg = this.add.rectangle(x, 0, tabW, this.k.tabH, selected ? 0x38e1ff : 0x2a2f45)
        .setStrokeStyle(2, selected ? 0xffffff : 0x3a3f5c, 0.6)
        .setInteractive({ useHandCursor: true });
      const text = this.add.text(x, 0, label, {
        fontFamily: 'system-ui, sans-serif', fontSize: Layout.font(15),
        color: selected ? '#0b1020' : '#ffffff', fontStyle: selected ? 'bold' : 'normal',
      }).setOrigin(0.5);

      bg.on('pointerdown', () => {
        AudioManager.ui();
        if (key === 'search') { this._openSearch(); return; }
        if (key === this.tab) return;
        this.tab = key;
        this._items = [];
        this._cursor = 0;
        this._nextCursor = null;
        this._scroll = 0;
        this._buildTabs();
        this._load();
      });

      this._tabsRow.add([bg, text]);
      x += tabW + gap;
    }
  }

  _setStatus(message) {
    this._status.setText(message).setVisible(Boolean(message));
  }

  // --- Loading ---------------------------------------------------------------------------------

  async _load() {
    if (this._loading) return;
    this._loading = true;

    if (!LevelApi.isConfigured()) {
      this._setStatus(
        'Custom levels are not available in this build.\n\n' +
        'Set PROD_API_ORIGIN in src/systems/LevelApi.js to your\nVercel URL, then rebuild.'
      );
      this._loading = false;
      return;
    }

    if (!this._items.length) this._setStatus('Loading levels…');

    const res = this.tab === 'search'
      ? await this._loadSearch()
      : await LevelApi.browse(this.tab, this._cursor);

    this._loading = false;

    if (!res.ok) {
      this._setStatus(res.error);
      return;
    }

    this._items = this._items.concat(res.items ?? []);
    this._nextCursor = res.nextCursor ?? null;

    if (!this._items.length) {
      this._setStatus(this._emptyMessage());
      this._list.removeAll(true);
      return;
    }

    this._setStatus('');
    this._renderList();
  }

  _emptyMessage() {
    if (this.tab === 'search') return `Nothing matches “${this._query}”.`;
    if (this.tab === 'featured') return 'No featured levels yet.';
    return 'No levels published yet.\n\nBe the first — build one in the Level Editor,\nbeat it, then hit Publish.';
  }

  /** Search runs against a catalogue snapshot fetched once and reused for the whole visit. */
  async _loadSearch() {
    if (!this._index) {
      const res = await LevelApi.fetchSearchIndex();
      if (!res.ok) return res;
      this._index = res.rows ?? [];
    }
    return { ok: true, items: LevelApi.searchRows(this._index, this._query), nextCursor: null };
  }

  _openSearch() {
    const input = window.prompt('Search levels by name or author:', this._query);
    if (input === null) return;
    this.tab = 'search';
    this._query = input.trim();
    this._items = [];
    this._cursor = 0;
    this._scroll = 0;
    this._buildTabs();
    this._load();
  }

  // --- List ------------------------------------------------------------------------------------

  _renderList() {
    this._list.removeAll(true);
    const { width } = this.scale;
    const left = (width - this.k.cardW) / 2;

    this._items.forEach((meta, i) => {
      const y = i * (this.k.cardH + this.k.gap);
      this._list.add(this._card(meta, left, y));
    });

    // A "load more" affordance rather than infinite scroll: paging on demand keeps the number of
    // browse requests (and therefore the Redis command count) proportional to real interest.
    if (this._nextCursor !== null) {
      const y = this._items.length * (this.k.cardH + this.k.gap);
      const more = this.add.rectangle(left + this.k.cardW / 2, y + this.k.cardH / 2, this.k.cardW, this.k.cardH, 0x1a1e30)
        .setStrokeStyle(2, 0x3a3f5c, 0.8)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(left + this.k.cardW / 2, y + this.k.cardH / 2, 'Load more', {
        fontFamily: 'system-ui, sans-serif', fontSize: Layout.font(16), color: '#7a80a8',
      }).setOrigin(0.5);
      more.on('pointerdown', () => {
        AudioManager.ui();
        this._cursor = this._nextCursor;
        this._load();
      });
      this._list.add([more, label]);
    }

    this._applyScroll();
  }

  _card(meta, x, y) {
    const card = this.add.container(0, 0);

    const bg = this.add.rectangle(x + this.k.cardW / 2, y + this.k.cardH / 2, this.k.cardW, this.k.cardH, 0x2a2f45)
      .setStrokeStyle(2, 0x3a3f5c, 0.8)
      .setInteractive({ useHandCursor: true });

    const name = this.add.text(x + 16, y + 14, meta.name || 'Untitled', {
      fontFamily: 'system-ui, sans-serif', fontSize: Layout.font(18), color: '#ffffff', fontStyle: 'bold',
    });
    const author = this.add.text(x + 16, y + 38, `by ${meta.author || 'Anonymous'}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: Layout.font(13), color: '#7a80a8',
    });

    const stats = this.add.text(
      x + this.k.cardW - 16, y + this.k.cardH / 2,
      `par ${meta.par ?? '-'}    ▶ ${meta.plays ?? 0}    ♥ ${meta.likes ?? 0}`,
      { fontFamily: 'monospace', fontSize: Layout.font(14), color: '#9aa0c3' }
    ).setOrigin(1, 0.5);

    bg.on('pointerover', () => bg.setFillStyle(0x343b58));
    bg.on('pointerout', () => bg.setFillStyle(0x2a2f45));
    bg.on('pointerdown', () => this._play(meta));

    card.add([bg, name, author, stats]);
    return card;
  }

  // --- Scrolling -------------------------------------------------------------------------------

  _wireScrolling() {
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      this._scroll -= dy * 0.5;
      this._applyScroll();
    });

    // Drag to scroll, so the list works on touch as well as with a wheel.
    let dragging = false;
    let lastY = 0;
    this.input.on('pointerdown', (p) => { dragging = true; lastY = p.y; });
    this.input.on('pointerup', () => { dragging = false; });
    this.input.on('pointermove', (p) => {
      if (!dragging) return;
      this._scroll += p.y - lastY;
      lastY = p.y;
      this._applyScroll();
    });
  }

  _applyScroll() {
    const rows = this._items.length + (this._nextCursor !== null ? 1 : 0);
    const contentH = rows * (this.k.cardH + this.k.gap);
    const viewH = this._listBottom - this.k.top;
    const minScroll = Math.min(0, viewH - contentH);
    this._scroll = Phaser.Math.Clamp(this._scroll, minScroll, 0);
    this._list.y = this.k.top + this._scroll;
  }

  // --- Play ------------------------------------------------------------------------------------

  async _play(meta) {
    if (this._loading) return;
    this._loading = true;
    this._setStatus(`Loading “${meta.name}”…`);

    const res = await LevelApi.fetchLevel(meta.id);
    this._loading = false;

    if (!res.ok || !res.level) {
      this._setStatus(res.error || 'That level could not be loaded.');
      return;
    }

    // Counting the play is not worth making the player wait for.
    LevelApi.recordPlay(meta.id);

    this.registry.set('customLevel', res.level);
    this.registry.set('customLevelMeta', meta);
    this.scene.start('GameScene', { custom: true });
  }
}
