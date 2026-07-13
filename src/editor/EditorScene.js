// EditorScene.js — the editor canvas. Draws a grid + border, renders every element from the
// shared `model`, and turns pointer input into placement/erase edits. It redraws whenever
// `model.dirty` is set (by placement here, or by the DOM panel).
//
// Placement styles:
//   - point tools (spawn/goal/key/switch/blackhole): click to place; portal takes TWO clicks (a pair)
//   - rect tools: click for the default size, or click-drag to draw a box
//   - line tool ON: click-drag stamps a row of default-size pieces along the drag
// A translucent ghost of the current piece follows the cursor.
import { generatePlaceholderTextures } from '../systems/Textures.js';
import { model, GRID, ARENA, DEFAULT_SIZE, RECT_TOOLS, LINE_TOOLS } from './model.js';

const KEY_COLORS = { gold: 0xffd23f, blue: 0x38a1ff, pink: 0xff5c8a };
const CBLOCK_COLORS = { red: 0xe0574f, blue: 0x4f8fe0 };
const PORTAL_COLORS = [0x2bd6c0, 0xff5cf0, 0xffef5c];
const MIN = ARENA.border;
const MAXX = ARENA.w - ARENA.border;
const MAXY = ARENA.h - ARENA.border;
const DIR_ANGLE = { up: 0, right: 90, down: 180, left: 270 };
const DIR_GLYPH = { up: '↑', down: '↓', left: '←', right: '→' };

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
    this.ghost = this.add.container(-999, -999).setDepth(30).setAlpha(0.45);
    this._ghostSig = '';

    this.input.on('pointerdown', (p) => this._onDown(p));
    this.input.on('pointermove', (p) => this._onMove(p));
    this.input.on('pointerup', (p) => this._onUp(p));

    this._drag = null;
    this._redraw();
  }

  update() {
    if (model.dirty) this._redraw();
    const sig = [model.tool, model.dir, model.color, model.cblockColor, model.weightKind, model.bhRadius, model.activeColor].join('|');
    if (sig !== this._ghostSig) { this._ghostSig = sig; this._buildGhost(); }
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

    // Zones first (underlays)...
    model.gravzones.forEach((z) => {
      this._rect(z, 0x4fd0c0, 0x8affea, 0.12);
      this.layer.add(this.add.text(z.x, z.y, DIR_GLYPH[z.dir ?? 'up'], { fontSize: '30px', color: '#8affea' }).setOrigin(0.5).setAlpha(0.5));
    });
    model.slowzones.forEach((z) => this._rect(z, 0x8a6bff, 0xb9a3ff, 0.14));
    model.weights.forEach((z) => {
      const tint = (z.kind ?? 'heavy') === 'heavy' ? 0xd4663a : 0x6db3ff;
      this._rect(z, tint, tint, 0.16);
    });
    model.blackholes.forEach((h) => {
      this.layer.add(this.add.circle(h.x, h.y, h.radius ?? 150, 0x120a24, 0.35).setStrokeStyle(2, 0x9a5cff, 0.35));
      this.layer.add(this.add.circle(h.x, h.y, 16, 0x1a0f34, 1).setStrokeStyle(3, 0xc79aff, 0.9));
    });

    // ...then solids and interactives.
    model.walls.forEach((w) => this._rect(w, 0x3a3f5c, 0x4c5378));
    model.breakables.forEach((b) => this._rect(b, 0xc8763a, 0xf0a86a, 0.9));
    model.cblocks.forEach((c) => {
      const tint = CBLOCK_COLORS[c.color ?? 'red'];
      const solid = (c.color ?? 'red') === model.activeColor;
      this._rect(c, tint, tint, solid ? 0.85 : 0.15);
    });
    model.sticky.forEach((s) => this._rect(s, 0x9b6dff, 0xc9a9ff, 0.85));
    model.bouncers.forEach((b) => {
      this._rect(b, 0x2bd67b, 0x8affc0, 0.95);
      this._arrow(b.x, b.y, b.dir ?? 'up');
    });
    model.doors.forEach((d) => {
      const c = KEY_COLORS[d.color ?? 'gold'];
      this._rect(d, c, c, 0.45);
    });
    model.lasers.forEach((l) => this._rect(l, 0xff3b3b, 0xff8a8a, 0.5));
    model.portals.forEach((pair, i) => {
      const color = PORTAL_COLORS[i % PORTAL_COLORS.length];
      [pair.a, pair.b].forEach((end) => {
        this.layer.add(this.add.circle(end.x, end.y, 20, color, 0.22).setStrokeStyle(3, color));
        this.layer.add(this.add.circle(end.x, end.y, 9, color, 0.6));
      });
    });
    model.hazards.forEach((h) => {
      this.layer.add(
        this.add.image(h.x, h.y, 'spike').setDisplaySize(h.w ?? 32, h.h ?? 32).setAngle(DIR_ANGLE[h.dir ?? 'up'])
      );
    });
    model.keys.forEach((k) => {
      const img = this.add.image(k.x, k.y, 'key').setTint(KEY_COLORS[k.color ?? 'gold']).setScale(1.4);
      if (k.volatile) img.setAlpha(0.65);
      this.layer.add(img);
    });
    model.switches.forEach((s) => {
      this.layer.add(this.add.rectangle(s.x, s.y, 36, 36, 0x3a3f5c, 0.95).setStrokeStyle(2, 0xc9cde8, 0.8));
      this.layer.add(this.add.text(s.x, s.y, '⇄', { fontSize: '20px', color: '#dfe3f5' }).setOrigin(0.5));
    });

    // Half-placed portal pair.
    if (model._pendingPortal) {
      const color = PORTAL_COLORS[model.portals.length % PORTAL_COLORS.length];
      const pp = model._pendingPortal;
      this.layer.add(this.add.circle(pp.x, pp.y, 20, color, 0.15).setStrokeStyle(3, color, 0.7));
      this.layer.add(this.add.text(pp.x, pp.y - 32, '1/2', { fontSize: '12px', color: '#c9cde8' }).setOrigin(0.5));
    }

    // Goal + spawn always on top.
    const goal = this.add.image(model.goal.x, model.goal.y, 'goal');
    if (model.goal.requires) goal.setTint(0x777c9a);
    this.layer.add(goal);
    this.layer.add(this.add.image(model.spawn.x, model.spawn.y, 'ball'));
  }

  _rect(r, fill, stroke, alpha = 1) {
    this.layer.add(this.add.rectangle(r.x, r.y, r.w, r.h, fill, alpha).setStrokeStyle(2, stroke, 0.9));
  }

  _arrow(x, y, dir) {
    const a = { up: -90, down: 90, left: 180, right: 0 }[dir];
    this.layer.add(this.add.text(x, y, '▶', { fontSize: '16px', color: '#0b1020' }).setOrigin(0.5).setAngle(a));
  }

  // --- ghost preview ---------------------------------------------------------
  _buildGhost() {
    this.ghost.removeAll(true);
    const t = model.tool;
    const size = DEFAULT_SIZE[t];

    if (t === 'erase') {
      this.ghost.add(this.add.circle(0, 0, 14, 0xff4d5e, 0).setStrokeStyle(2, 0xff4d5e, 0.9));
      this.ghost.add(this.add.text(0, 0, '×', { fontSize: '18px', color: '#ff4d5e' }).setOrigin(0.5));
    } else if (t === 'spawn') {
      this.ghost.add(this.add.image(0, 0, 'ball'));
    } else if (t === 'goal') {
      this.ghost.add(this.add.image(0, 0, 'goal'));
    } else if (t === 'key') {
      this.ghost.add(this.add.image(0, 0, 'key').setTint(KEY_COLORS[model.color]).setScale(1.4));
    } else if (t === 'switch') {
      this.ghost.add(this.add.rectangle(0, 0, 36, 36, 0x3a3f5c, 0.95).setStrokeStyle(2, 0xc9cde8, 0.8));
      this.ghost.add(this.add.text(0, 0, '⇄', { fontSize: '20px', color: '#dfe3f5' }).setOrigin(0.5));
    } else if (t === 'portal') {
      const color = PORTAL_COLORS[model.portals.length % PORTAL_COLORS.length];
      this.ghost.add(this.add.circle(0, 0, 20, color, 0.22).setStrokeStyle(3, color));
    } else if (t === 'blackhole') {
      this.ghost.add(this.add.circle(0, 0, model.bhRadius, 0x120a24, 0.3).setStrokeStyle(2, 0x9a5cff, 0.5));
      this.ghost.add(this.add.circle(0, 0, 16, 0x1a0f34, 1).setStrokeStyle(3, 0xc79aff, 0.9));
    } else if (t === 'spike') {
      this.ghost.add(this.add.image(0, 0, 'spike').setDisplaySize(size.w, size.h).setAngle(DIR_ANGLE[model.dir]));
    } else if (size) {
      const tint = {
        wall: 0x3a3f5c, sticky: 0x9b6dff, bouncer: 0x2bd67b,
        door: KEY_COLORS[model.color], breakable: 0xc8763a,
        cblock: CBLOCK_COLORS[model.cblockColor], weight: model.weightKind === 'heavy' ? 0xd4663a : 0x6db3ff,
        slowzone: 0x8a6bff, laser: 0xff3b3b, gravzone: 0x4fd0c0,
      }[t] ?? 0xffffff;
      this.ghost.add(this.add.rectangle(0, 0, size.w, size.h, tint, 0.5).setStrokeStyle(2, tint, 0.9));
      if (t === 'gravzone') {
        this.ghost.add(this.add.text(0, 0, DIR_GLYPH[model.dir], { fontSize: '30px', color: '#8affea' }).setOrigin(0.5));
      }
    }
  }

  // --- input ---------------------------------------------------------------
  _onDown(p) {
    const s = this._snapped(p);
    const tool = model.tool;

    if (tool === 'erase') { this._erase(p); return; }
    if (tool === 'spawn') { model.spawn = s; model.dirty = true; return; }
    if (tool === 'goal') { model.goal.x = s.x; model.goal.y = s.y; model.dirty = true; return; }
    if (tool === 'portal') {
      if (!model._pendingPortal) {
        model._pendingPortal = s;
      } else {
        model.portals.push({ a: model._pendingPortal, b: s });
        model._pendingPortal = null;
      }
      model.dirty = true;
      return;
    }

    // Line tool: any stampable tool becomes a drag-to-stamp-a-row gesture.
    if (model.lineMode && LINE_TOOLS.includes(tool)) { this._drag = { start: s, line: true }; return; }

    if (tool === 'key' || tool === 'switch' || tool === 'blackhole') { this._placeAt(tool, s.x, s.y); return; }
    if (RECT_TOOLS.includes(tool)) this._drag = { start: s, line: false };
  }

  _onMove(p) {
    this.preview.clear();
    if (!this._drag) {
      const s = this._snapped(p);
      this.ghost.setVisible(true).setPosition(s.x, s.y);
      return;
    }
    this.ghost.setVisible(false);
    const s = this._snapped(p);
    if (this._drag.line) {
      // Preview each stamp position along the line.
      for (const pos of this._linePositions(this._drag.start, s)) {
        const fp = this._footprint(model.tool);
        this.preview.lineStyle(2, 0x38e1ff, 0.9).strokeRect(pos.x - fp.w / 2, pos.y - fp.h / 2, fp.w, fp.h);
      }
    } else {
      const { x, y, w, h } = this._rectFrom(this._drag.start, s);
      this.preview.fillStyle(0x38e1ff, 0.25).fillRect(x - w / 2, y - h / 2, w, h);
      this.preview.lineStyle(2, 0x38e1ff, 0.9).strokeRect(x - w / 2, y - h / 2, w, h);
    }
  }

  _onUp(p) {
    this.preview.clear();
    if (!this._drag) return;
    const s = this._snapped(p);
    const drag = this._drag;
    this._drag = null;
    if (drag.line) {
      for (const pos of this._linePositions(drag.start, s)) this._placeAt(model.tool, pos.x, pos.y);
    } else {
      const rect = this._rectFrom(drag.start, s, model.tool);
      this._placeRect(model.tool, rect);
    }
    model.dirty = true;
  }

  // Footprint used for line spacing + preview (default size; points use their marker size).
  _footprint(tool) {
    if (tool === 'key') return { w: 48, h: 48 };
    if (tool === 'switch') return { w: 48, h: 48 };
    if (tool === 'blackhole') return { w: model.bhRadius * 2, h: model.bhRadius * 2 };
    return DEFAULT_SIZE[tool] ?? { w: 40, h: 40 };
  }

  // Evenly spaced, snapped, deduped positions from a to b (spacing = footprint along the axis).
  _linePositions(a, b) {
    const fp = this._footprint(model.tool);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(GRID, Math.abs(dx) >= Math.abs(dy) ? fp.w : fp.h);
    const count = Math.floor(dist / spacing) + 1;
    const out = [];
    let last = null;
    for (let i = 0; i < count; i++) {
      const t = dist === 0 ? 0 : (i * spacing) / dist;
      const pos = { x: this._snap(a.x + dx * t, MAXX), y: this._snap(a.y + dy * t, MAXY) };
      if (!last || last.x !== pos.x || last.y !== pos.y) out.push(pos);
      last = pos;
    }
    return out;
  }

  _rectFrom(a, b, tool = null) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    let w = Math.abs(b.x - a.x);
    let h = Math.abs(b.y - a.y);
    // A click (no real drag) → default size for the tool.
    if (tool && (w < GRID || h < GRID)) {
      const d = DEFAULT_SIZE[tool];
      return { x: a.x, y: a.y, w: d.w, h: d.h };
    }
    return { x: x1 + w / 2, y: y1 + h / 2, w, h };
  }

  // Place a point piece, or a rect piece at its default size (used by click + line tool).
  _placeAt(tool, x, y) {
    if (tool === 'key') { model.keys.push({ x, y, color: model.color, ...(model.volatileKey ? { volatile: true } : {}) }); }
    else if (tool === 'switch') { model.switches.push({ x, y }); }
    else if (tool === 'blackhole') { model.blackholes.push({ x, y, radius: Number(model.bhRadius) || 150 }); }
    else if (RECT_TOOLS.includes(tool)) { const d = DEFAULT_SIZE[tool]; this._placeRect(tool, { x, y, w: d.w, h: d.h }); }
    model.dirty = true;
  }

  _placeRect(tool, r) {
    const base = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (tool === 'wall') model.walls.push(base);
    else if (tool === 'spike') model.hazards.push({ ...base, dir: model.dir });
    else if (tool === 'sticky') model.sticky.push(base);
    else if (tool === 'bouncer') model.bouncers.push({ ...base, dir: model.dir, power: Number(model.power) || 20 });
    else if (tool === 'door') model.doors.push({ ...base, color: model.color });
    else if (tool === 'breakable') model.breakables.push(base);
    else if (tool === 'cblock') model.cblocks.push({ ...base, color: model.cblockColor });
    else if (tool === 'weight') model.weights.push({ ...base, kind: model.weightKind });
    else if (tool === 'slowzone') model.slowzones.push(base);
    else if (tool === 'laser') model.lasers.push({ ...base, on: Number(model.laserOn) || 700, off: Number(model.laserOff) || 1800 });
    else if (tool === 'gravzone') model.gravzones.push({ ...base, dir: model.dir });
  }

  // Erase the piece under the cursor. Point pieces use a generous radius (the key visual bobs
  // ±6px and draws at 1.4x, so a tight radius made keys feel un-erasable). Portals erase the pair.
  _erase(p) {
    const near = (o, d = 30) => Phaser.Math.Distance.Between(p.x, p.y, o.x, o.y) < d;
    const inRect = (o) => Math.abs(p.x - o.x) <= o.w / 2 && Math.abs(p.y - o.y) <= o.h / 2;

    const pi = model.portals.findIndex((pair) => near(pair.a, 26) || near(pair.b, 26));
    if (pi >= 0) { model.portals.splice(pi, 1); model.dirty = true; return; }
    if (model._pendingPortal && near(model._pendingPortal, 26)) { model._pendingPortal = null; model.dirty = true; return; }

    for (const [arr, test] of [
      [model.keys, (o) => near(o, 30)],
      [model.switches, (o) => near(o, 26)],
      [model.blackholes, (o) => near(o, 26)],
      [model.hazards, inRect],
      [model.bouncers, inRect],
      [model.sticky, inRect],
      [model.doors, inRect],
      [model.breakables, inRect],
      [model.cblocks, inRect],
      [model.lasers, inRect],
      [model.walls, inRect],
      [model.weights, inRect],
      [model.slowzones, inRect],
      [model.gravzones, inRect],
    ]) {
      const i = arr.findIndex(test);
      if (i >= 0) { arr.splice(i, 1); model.dirty = true; return; }
    }
  }
}
