// EditorScene.js — the editor canvas. Draws a grid + border, renders every element from the
// shared `model`, and turns pointer input into placement/erase edits. It redraws whenever
// `model.dirty` is set (by placement here, or by the DOM panel).
import { generatePlaceholderTextures } from '../systems/Textures.js';
import { model, GRID, ARENA, DEFAULT_SIZE, RECT_TOOLS, POINT_TOOLS } from './model.js';

const KEY_COLORS = { gold: 0xffd23f, blue: 0x38a1ff, pink: 0xff5c8a };
const MIN = ARENA.border;
const MAXX = ARENA.w - ARENA.border;
const MAXY = ARENA.h - ARENA.border;

export default class EditorScene extends Phaser.Scene {
  constructor() {
    super('EditorScene');
  }

  create() {
    generatePlaceholderTextures(this);
    this.cameras.main.setBackgroundColor('#0d1020');

    this._drawGridAndBorder();
    this.layer = this.add.container(0, 0).setDepth(5);
    this.preview = this.add.graphics().setDepth(20);

    this.input.on('pointerdown', (p) => this._onDown(p));
    this.input.on('pointermove', (p) => this._onMove(p));
    this.input.on('pointerup', (p) => this._onUp(p));

    this._drag = null;
    this._redraw();
  }

  update() {
    if (model.dirty) this._redraw();
  }

  // --- helpers -------------------------------------------------------------
  _snap(v, max) {
    const s = Math.round(v / GRID) * GRID;
    return Phaser.Math.Clamp(s, MIN, max);
  }

  _snapped(p) {
    return { x: this._snap(p.x, MAXX), y: this._snap(p.y, MAXY) };
  }

  // --- static grid + border ------------------------------------------------
  _drawGridAndBorder() {
    const g = this.add.graphics().setDepth(0);
    g.lineStyle(1, 0x232840, 1);
    for (let x = 0; x <= ARENA.w; x += 40) g.lineBetween(x, 0, x, ARENA.h);
    for (let y = 0; y <= ARENA.h; y += 40) g.lineBetween(0, y, ARENA.w, y);
    const t = ARENA.border;
    g.fillStyle(0x3a3f5c, 1);
    g.fillRect(0, 0, ARENA.w, t);
    g.fillRect(0, ARENA.h - t, ARENA.w, t);
    g.fillRect(0, 0, t, ARENA.h);
    g.fillRect(ARENA.w - t, 0, t, ARENA.h);
  }

  // --- render model --------------------------------------------------------
  _redraw() {
    model.dirty = false;
    this.layer.removeAll(true);

    model.walls.forEach((w) => this._rect(w, 0x3a3f5c, 0x4c5378));
    model.sticky.forEach((s) => this._rect(s, 0x9b6dff, 0xc9a9ff, 0.85));
    model.bouncers.forEach((b) => {
      this._rect(b, 0x2bd67b, 0x8affc0, 0.95);
      this._arrow(b.x, b.y, b.dir ?? 'up', 0x0b1020);
    });
    model.doors.forEach((d) => {
      const c = KEY_COLORS[d.color ?? 'gold'];
      this._rect(d, c, c, 0.45);
    });
    model.hazards.forEach((h) => {
      const img = this.add.image(h.x, h.y, 'spike')
        .setDisplaySize(h.w ?? 32, h.h ?? 32)
        .setAngle({ up: 0, right: 90, down: 180, left: 270 }[h.dir ?? 'up']);
      this.layer.add(img);
    });
    model.keys.forEach((k) => {
      this.layer.add(this.add.image(k.x, k.y, 'key').setTint(KEY_COLORS[k.color ?? 'gold']).setScale(1.4));
    });

    // Goal + spawn always on top.
    const goal = this.add.image(model.goal.x, model.goal.y, 'goal');
    if (model.goal.requires) goal.setTint(0x777c9a);
    this.layer.add(goal);
    this.layer.add(this.add.image(model.spawn.x, model.spawn.y, 'ball'));
  }

  _rect(r, fill, stroke, alpha = 1) {
    const rect = this.add.rectangle(r.x, r.y, r.w, r.h, fill, alpha).setStrokeStyle(2, stroke, 0.9);
    this.layer.add(rect);
  }

  _arrow(x, y, dir, color) {
    const a = { up: -90, down: 90, left: 180, right: 0 }[dir];
    const t = this.add.text(x, y, '▶', { fontSize: '16px', color: '#0b1020' }).setOrigin(0.5).setAngle(a);
    this.layer.add(t);
  }

  // --- input ---------------------------------------------------------------
  _onDown(p) {
    const s = this._snapped(p);
    const tool = model.tool;

    if (tool === 'spawn') { model.spawn = s; model.dirty = true; return; }
    if (tool === 'goal') { model.goal.x = s.x; model.goal.y = s.y; model.dirty = true; return; }
    if (tool === 'key') { model.keys.push({ x: s.x, y: s.y, color: model.color }); model.dirty = true; return; }
    if (tool === 'erase') { this._erase(p); return; }
    if (RECT_TOOLS.includes(tool)) this._drag = { start: s };
  }

  _onMove(p) {
    this.preview.clear();
    if (!this._drag) return;
    const s = this._snapped(p);
    const { x, y, w, h } = this._rectFrom(this._drag.start, s);
    this.preview.fillStyle(0x38e1ff, 0.25).fillRect(x - w / 2, y - h / 2, w, h);
    this.preview.lineStyle(2, 0x38e1ff, 0.9).strokeRect(x - w / 2, y - h / 2, w, h);
  }

  _onUp(p) {
    this.preview.clear();
    if (!this._drag) return;
    const s = this._snapped(p);
    const rect = this._rectFrom(this._drag.start, s, model.tool);
    this._addRect(model.tool, rect);
    this._drag = null;
    model.dirty = true;
  }

  _rectFrom(a, b, tool = null) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    let w = Math.abs(b.x - a.x);
    let h = Math.abs(b.y - a.y);
    // A click (no real drag) → default size for the tool.
    if (tool && (w < GRID || h < GRID)) {
      const d = DEFAULT_SIZE[tool];
      w = d.w; h = d.h;
      return { x: a.x, y: a.y, w, h };
    }
    return { x: x1 + w / 2, y: y1 + h / 2, w, h };
  }

  _addRect(tool, r) {
    const base = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (tool === 'wall') model.walls.push(base);
    else if (tool === 'spike') model.hazards.push({ ...base, dir: model.dir });
    else if (tool === 'sticky') model.sticky.push(base);
    else if (tool === 'bouncer') model.bouncers.push({ ...base, dir: model.dir, power: Number(model.power) || 20 });
    else if (tool === 'door') model.doors.push({ ...base, color: model.color });
  }

  _erase(p) {
    // Topmost-first: check point elements, then rects.
    const near = (o, d = 20) => Phaser.Math.Distance.Between(p.x, p.y, o.x, o.y) < d;
    const inRect = (o) => Math.abs(p.x - o.x) <= o.w / 2 && Math.abs(p.y - o.y) <= o.h / 2;
    for (const [arr, test] of [
      [model.keys, near],
      [model.hazards, inRect],
      [model.bouncers, inRect],
      [model.sticky, inRect],
      [model.doors, inRect],
      [model.walls, inRect],
    ]) {
      const i = arr.findIndex(test);
      if (i >= 0) { arr.splice(i, 1); model.dirty = true; return; }
    }
  }
}
