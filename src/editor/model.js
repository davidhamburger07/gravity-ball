// model.js — the single source of truth for the editor. Both the canvas scene (renders it,
// handles placement) and the DOM panel (settings, actions) mutate this shared instance and
// set `dirty` so the scene knows to redraw.

export const GRID = 20;
export const ARENA = { w: 800, h: 600, border: 24 };

// Rect tools get a sensible default size when clicked (vs. click-dragged for a custom size).
export const DEFAULT_SIZE = {
  wall: { w: 40, h: 120 },
  spike: { w: 40, h: 36 },
  sticky: { w: 44, h: 24 },
  bouncer: { w: 48, h: 20 },
  door: { w: 24, h: 552 },
};

export const RECT_TOOLS = ['wall', 'spike', 'sticky', 'bouncer', 'door'];
export const POINT_TOOLS = ['spawn', 'goal', 'key'];

class EditorModel {
  constructor() {
    this.tool = 'wall';
    this.dir = 'up';
    this.color = 'gold';
    this.power = 20;
    this.dirty = true;
    this.reset();
  }

  reset() {
    this.id = '5-1';
    this.gravity = 'down';
    this.par = 3;
    this.hint = '';
    this.spawn = { x: 120, y: 120 };
    this.goal = { x: 680, y: 500, requires: null };
    this.walls = [];
    this.hazards = [];
    this.sticky = [];
    this.bouncers = [];
    this.keys = [];
    this.doors = [];
    this.dirty = true;
  }

  // Serialize to a levels.json-shaped object (omitting empty arrays / null fields).
  toLevel() {
    const lvl = {
      id: this.id,
      par: Number(this.par) || 1,
      gravity: this.gravity,
      spawn: { x: this.spawn.x, y: this.spawn.y },
      goal: { x: this.goal.x, y: this.goal.y },
    };
    if (this.goal.requires) lvl.goal.requires = this.goal.requires;
    if (this.hint) lvl.hint = this.hint;
    if (this.walls.length) lvl.walls = this.walls.map((o) => ({ ...o }));
    if (this.hazards.length) lvl.hazards = this.hazards.map((o) => ({ ...o }));
    if (this.sticky.length) lvl.sticky = this.sticky.map((o) => ({ ...o }));
    if (this.bouncers.length) lvl.bouncers = this.bouncers.map((o) => ({ ...o }));
    if (this.keys.length) lvl.keys = this.keys.map((o) => ({ ...o }));
    if (this.doors.length) lvl.doors = this.doors.map((o) => ({ ...o }));
    return lvl;
  }

  fromLevel(l) {
    this.reset();
    this.id = l.id ?? '5-1';
    this.par = l.par ?? 3;
    this.gravity = l.gravity ?? 'down';
    this.hint = l.hint ?? '';
    if (l.spawn) this.spawn = { x: l.spawn.x, y: l.spawn.y };
    if (l.goal) this.goal = { x: l.goal.x, y: l.goal.y, requires: l.goal.requires ?? null };
    this.walls = (l.walls ?? []).map((o) => ({ ...o }));
    this.hazards = (l.hazards ?? []).map((o) => ({ ...o }));
    this.sticky = (l.sticky ?? []).map((o) => ({ ...o }));
    this.bouncers = (l.bouncers ?? []).map((o) => ({ ...o }));
    this.keys = (l.keys ?? []).map((o) => ({ ...o }));
    this.doors = (l.doors ?? []).map((o) => ({ ...o }));
    this.dirty = true;
  }
}

export const model = new EditorModel();
