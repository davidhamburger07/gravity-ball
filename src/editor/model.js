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
  door: { w: 24, h: 252 },
  breakable: { w: 24, h: 252 },
  cblock: { w: 24, h: 252 },
  weight: { w: 260, h: 180 },
  slowzone: { w: 160, h: 300 },
  laser: { w: 12, h: 552 },
  gravzone: { w: 240, h: 552 },
};

export const RECT_TOOLS = ['wall', 'spike', 'sticky', 'bouncer', 'door', 'breakable', 'cblock', 'weight', 'slowzone', 'laser', 'gravzone'];
export const POINT_TOOLS = ['spawn', 'goal', 'key', 'switch', 'portal', 'blackhole'];
// Tools the line tool can stamp in a row (portal pairs and singletons excluded).
export const LINE_TOOLS = [...RECT_TOOLS, 'key', 'switch', 'blackhole'];

class EditorModel {
  constructor() {
    // Current tool + piece options.
    this.tool = 'wall';
    this.dir = 'up';           // spike / trampoline / gravity zone
    this.color = 'gold';       // key / door
    this.volatileKey = false;  // key: lost on death
    this.cblockColor = 'red';  // color block
    this.power = 20;           // trampoline
    this.laserOn = 700;        // laser timing (ms)
    this.laserOff = 1800;
    this.bhRadius = 150;       // black hole influence radius
    this.weightKind = 'heavy'; // weight zone: heavy | normal (reset)
    this.lineMode = false;     // drag to stamp a row
    this.dirty = true;
    this.reset();
  }

  reset() {
    this.id = 'custom-1';
    this.gravity = 'down';
    this.par = 3;
    this.hint = '';
    this.activeColor = 'red';          // which color-block color starts solid
    this.resetGravityOnDeath = false;  // death rule: reset gravity to level start
    this.maxShifts = 0;                // shift budget; 0 = unlimited
    this.spawn = { x: 120, y: 120 };
    this.goal = { x: 680, y: 500, requires: null };
    this.walls = [];
    this.hazards = [];
    this.sticky = [];
    this.bouncers = [];
    this.keys = [];
    this.doors = [];
    this.portals = [];
    this.weights = [];
    this.breakables = [];
    this.cblocks = [];
    this.switches = [];
    this.slowzones = [];
    this.lasers = [];
    this.gravzones = [];
    this.blackholes = [];
    this._pendingPortal = null; // first half of a portal pair being placed
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
    if (this.resetGravityOnDeath) lvl.resetGravityOnDeath = true;
    if (Number(this.maxShifts) > 0) lvl.maxShifts = Number(this.maxShifts);
    if (this.cblocks.length) lvl.activeColor = this.activeColor;
    const arrays = ['walls', 'hazards', 'sticky', 'bouncers', 'keys', 'doors', 'portals', 'weights', 'breakables', 'cblocks', 'switches', 'slowzones', 'lasers', 'gravzones', 'blackholes'];
    for (const key of arrays) {
      if (this[key].length) lvl[key] = this[key].map((o) => JSON.parse(JSON.stringify(o)));
    }
    return lvl;
  }

  fromLevel(l) {
    this.reset();
    this.id = l.id ?? 'custom-1';
    this.par = l.par ?? 3;
    this.gravity = l.gravity ?? 'down';
    this.hint = l.hint ?? '';
    this.activeColor = l.activeColor ?? 'red';
    this.resetGravityOnDeath = !!l.resetGravityOnDeath;
    this.maxShifts = l.maxShifts ?? 0;
    if (l.spawn) this.spawn = { x: l.spawn.x, y: l.spawn.y };
    if (l.goal) this.goal = { x: l.goal.x, y: l.goal.y, requires: l.goal.requires ?? null };
    const arrays = ['walls', 'hazards', 'sticky', 'bouncers', 'keys', 'doors', 'portals', 'weights', 'breakables', 'cblocks', 'switches', 'slowzones', 'lasers', 'gravzones', 'blackholes'];
    for (const key of arrays) {
      this[key] = (l[key] ?? []).map((o) => JSON.parse(JSON.stringify(o)));
    }
    this.dirty = true;
  }
}

export const model = new EditorModel();
