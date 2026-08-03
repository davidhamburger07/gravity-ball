// LevelGenerator.js — stitches hand-authored chunks (see chunks.js) into a full level.
//
// Pipeline:
//   1. Walk a self-avoiding path across a cols x rows grid of room slots.
//   2. For each step of the path, pick a chunk whose `connects` covers the sides it needs.
//   3. Blit every chosen room into one big character grid; fill off-path slots with rock.
//   4. Carve doorways through the shared borders of consecutive rooms.
//   5. Compile the character grid into a levels.json-shaped object.
//
// The output is an ordinary level: GameScene loads it with no special casing, the editor can
// open it, and it can be pasted straight into src/data/levels.json.
import {
  CHUNKS, SOLID_ROOM, ROOM_COLS, ROOM_ROWS, CELL,
  DOOR_BAND_ROWS, DOOR_BAND_COLS, DOOR_DEPTH, DOOR_APRON,
} from './chunks.js';
import { allowedMechanics, featuredMechanics, chapterById, teachingBand, FOUNDATION } from './chapters.js';
import { mulberry32, randomSeed, randInt, shuffled, pickWeighted } from './rng.js';

const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

// Cell → the level-data it compiles to. Merge axis: 'x' merges horizontal runs into one body,
// 'y' merges vertical runs, null emits one body per cell.
const HAZARD_DIR = { '^': 'up', v: 'down', '>': 'right', '<': 'left' };
const BOUNCER_DIR = { t: 'up', u: 'down', l: 'left', r: 'right' };
const RAMP_DIR = { '/': 'br', '\\': 'bl', 7: 'tr', F: 'tl' };
const KEY_COLOR = { k: 'gold', K: 'blue' };
const DOOR_COLOR = { d: 'gold', D: 'blue' };
const CBLOCK_COLOR = { R: 'red', B: 'blue' };
const WEIGHT_KIND = { h: 'heavy', n: 'normal' };

/**
 * Generate one procedural level.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.seed]        32-bit seed; omit for a random one. Returned on the level.
 * @param {number}  [opts.cols=3]      Room-slot grid width.
 * @param {number}  [opts.rows=2]      Room-slot grid height.
 * @param {number}  [opts.minRooms=3]  Shortest acceptable path (in rooms).
 * @param {number}  [opts.maxRooms]    Longest path; defaults to cols*rows.
 * @param {string}  [opts.id]          Level id; defaults to `gen-<seed>`.
 * @param {string}  [opts.gravity='down']
 * @param {number}  [opts.difficultyBias=1]  >1 favours harder chunks, <1 favours easier ones.
 * @param {Array}   [opts.chunks=CHUNKS]     Room library to draw from.
 * @param {number}  [opts.chapter]     Campaign chapter. Restricts rooms to mechanics that
 *                                     chapter has taught, and biases toward the one it
 *                                     introduces. Omit for an unrestricted level.
 * @param {number}  [opts.progress]    Position within the chapter, 0 (first level) to 1 (last).
 *                                     Drives the teaching band: early levels are a small safe
 *                                     space showing the new object alone, later ones combine
 *                                     mechanics. When given, it OVERRIDES minRooms / maxRooms /
 *                                     difficultyBias — the ladder owns level shape.
 * @returns {object} A levels.json-shaped level, plus a `meta` block describing how it was built.
 */
export function generateLevel(opts = {}) {
  const seed = opts.seed ?? randomSeed();
  const cols = opts.cols ?? 3;
  const rows = opts.rows ?? 2;

  // Chapter gating. A room is legal only if every mechanic it uses has already been taught,
  // so a chapter-3 level can never contain a portal the player has not seen.
  let chunks = opts.chunks ?? CHUNKS;
  let featured = [];
  let band = null;

  if (opts.chapter) {
    const allowed = allowedMechanics(opts.chapter);
    chunks = chunks.filter((c) => (c.uses ?? []).every((m) => allowed.has(m)));
    featured = featuredMechanics(opts.chapter);

    // Teaching ladder: narrow the pool further for early levels in the chapter, so the new
    // object is met on its own before it is ever combined with anything else.
    if (opts.progress !== undefined) {
      band = teachingBand(clamp(opts.progress, 0, 1));
      const teachable = new Set([...featured, ...FOUNDATION]);

      if (band.extraMechanics !== Infinity) {
        // Deterministically pick which previously-taught mechanics may also appear.
        const rand = mulberry32(seed ^ 0x5bf03635);
        const others = shuffled(rand, [...allowed].filter((m) => !teachable.has(m)));
        others.slice(0, band.extraMechanics).forEach((m) => teachable.add(m));
        chunks = chunks.filter((c) => (c.uses ?? []).every((m) => teachable.has(m)));
      }
      chunks = chunks.filter((c) => (c.difficulty ?? 1) <= band.maxChunkDifficulty);

      // Never narrow so far that the chapter's own object drops out of reach.
      const stillTeaches = chunks.some((c) => (c.uses ?? []).some((m) => featured.includes(m)));
      if (featured.length && !stillTeaches) {
        chunks = (opts.chunks ?? CHUNKS).filter((c) => (c.uses ?? []).every((m) => allowed.has(m)));
      }
    }

    if (!chunks.some((c) => (c.role ?? 'any') === 'entry') || !chunks.some((c) => (c.role ?? 'any') === 'exit')) {
      throw new Error(`No entry/exit rooms are legal for chapter ${opts.chapter} — add a chunk with uses: []`);
    }
  }

  // The band owns level shape when a ladder position was given.
  if (band) {
    opts = { ...opts, minRooms: band.minRooms, maxRooms: band.maxRooms, difficultyBias: band.difficultyBias };
  }

  // Layout can fail (a path may demand a side-pair no chunk offers), so retry with a derived
  // seed rather than giving up. Every attempt is deterministic from the original seed.
  let layout = null;
  for (let attempt = 0; attempt < 40 && !layout; attempt++) {
    layout = tryLayout(mulberry32(seed + attempt * 0x9e3779b9), { ...opts, cols, rows, chunks, featured });
  }
  // Last resort: a straight left-to-right corridor, which only needs left/right chunks.
  if (!layout) layout = linearLayout(mulberry32(seed), { ...opts, cols, rows, chunks, featured });

  // Nothing could host the chapter's mechanic on any path — most featured rooms only connect
  // left↔right, so a small slot grid can force corners everywhere. Rather than failing the
  // whole run, drop the requirement and flag it: an off-topic level the author can see is
  // off-topic beats an exception mid-batch.
  let featuredMissing = false;
  if (!layout && featured.length) {
    featuredMissing = true;
    for (let attempt = 0; attempt < 40 && !layout; attempt++) {
      layout = tryLayout(mulberry32(seed + attempt * 0x9e3779b9), { ...opts, cols, rows, chunks, featured: [] });
    }
    if (!layout) layout = linearLayout(mulberry32(seed), { ...opts, cols, rows, chunks, featured: [] });
  }
  if (!layout) throw new Error('LevelGenerator: no chunk combination could satisfy the layout');

  const grid = assemble(layout, cols, rows);
  const level = compileGrid(grid, {
    id: opts.id ?? `gen-${seed}`,
    gravity: opts.gravity ?? 'down',
    entryRoom: layout.path[0],
    exitRoom: layout.path[layout.path.length - 1],
  });

  level.meta = {
    seed,
    cols,
    rows,
    rooms: layout.path.map((p, i) => ({ col: p.c, row: p.r, chunk: layout.chunks[i].name })),
    difficultyHint: layout.chunks.reduce((n, c) => n + (c.difficulty ?? 1), 0),
  };
  // The stitched ASCII is the most readable record of what was built — worth keeping on the
  // levels we save, and the fastest way to eyeball a doorway that carved badly.
  if (opts.includeGrid) level.meta.grid = grid.map((row) => row.join(''));
  if (opts.chapter) {
    level.meta.chapter = opts.chapter;
    const ch = chapterById(opts.chapter);
    if (ch) level.meta.chapterName = ch.name;
    if (featuredMissing) level.meta.featuredMissing = true;
    if (band) {
      level.meta.band = band.name;
      level.meta.progress = Math.round(clamp(opts.progress, 0, 1) * 100) / 100;
      // Par tracks the ladder: a tutorial room should be beatable in a couple of shifts, a
      // challenge room is allowed to demand more before it stops being a 3-star clear.
      level.par = { tutorial: 3, practice: 5, challenge: 7 }[band.name] ?? 4;
    }
    // Chapter 10 introduces no new object — its identity is the shift budget, so generated
    // finale levels get one. Generous, since the AI's win is not a tuned solution.
    if (opts.chapter >= 10) level.maxShifts = 12;
  }
  level.hint = `procedural · seed ${seed}`;
  return level;
}

// --- Layout ---------------------------------------------------------------------------------

/** One attempt at a path + chunk assignment. Returns null if no chunk fits some room. */
function tryLayout(rand, { cols, rows, minRooms = 3, maxRooms, chunks, difficultyBias = 1, featured = [] }) {
  const target = clamp(
    minRooms + randInt(rand, Math.max(1, (maxRooms ?? cols * rows) - minRooms + 1)),
    2,
    cols * rows
  );
  const path = carvePath(rand, cols, rows, target);
  if (path.length < Math.min(minRooms, cols * rows)) return null;
  const chosen = assignChunks(rand, path, chunks, difficultyBias, featured);
  return chosen ? { path, chunks: chosen } : null;
}

/** Deterministic fallback: a single row of rooms, west to east. */
function linearLayout(rand, { cols, chunks, difficultyBias = 1, featured = [] }) {
  const path = Array.from({ length: cols }, (_, c) => ({ c, r: 0 }));
  const chosen = assignChunks(rand, path, chunks, difficultyBias, featured);
  return chosen ? { path, chunks: chosen } : null;
}

/**
 * Self-avoiding random walk from the left column. Wandering (rather than marching east) is
 * what makes the finished level's silhouette unpredictable.
 */
function carvePath(rand, cols, rows, target) {
  let cur = { c: 0, r: randInt(rand, rows) };
  const seen = new Set([`${cur.c},${cur.r}`]);
  const path = [cur];
  while (path.length < target) {
    const open = shuffled(rand, neighbours(cur, cols, rows)).filter((n) => !seen.has(`${n.c},${n.r}`));
    if (!open.length) break; // walked into a dead end — the caller decides if it's long enough
    cur = open[0];
    seen.add(`${cur.c},${cur.r}`);
    path.push(cur);
  }
  return path;
}

function neighbours({ c, r }, cols, rows) {
  return [{ c: c + 1, r }, { c: c - 1, r }, { c, r: r + 1 }, { c, r: r - 1 }]
    .filter((n) => n.c >= 0 && n.c < cols && n.r >= 0 && n.r < rows);
}

/** Which edge of room `a` faces room `b`. */
function sideBetween(a, b) {
  if (b.c > a.c) return 'right';
  if (b.c < a.c) return 'left';
  if (b.r > a.r) return 'bottom';
  return 'top';
}

/** Pick a chunk per path step, or null if any step has no candidate. */
function assignChunks(rand, path, chunks, difficultyBias, featured = []) {
  const out = [];
  const teaches = (c) => (c.uses ?? []).some((m) => featured.includes(m));

  for (let i = 0; i < path.length; i++) {
    const needed = [];
    if (i > 0) needed.push(sideBetween(path[i], path[i - 1]));
    if (i < path.length - 1) needed.push(sideBetween(path[i], path[i + 1]));

    const role = i === 0 ? 'entry' : i === path.length - 1 ? 'exit' : 'any';
    const pool = chunks.filter(
      (c) => (c.role ?? 'any') === role && needed.every((s) => c.connects.includes(s))
    );
    if (!pool.length) return null;

    // Weight by difficulty (bias > 1 favours harder rooms), then heavily favour rooms that
    // feature the chapter's new mechanic — otherwise a chapter-6 level is just a legal spike
    // level that never shows the player a portal.
    const chunk = pickWeighted(rand, pool, (c) =>
      Math.pow(c.difficulty ?? 1, difficultyBias) * (teaches(c) ? 6 : 1));
    out.push(chunk);
  }

  // A chapter level that never uses its own mechanic has failed at its job. If the draw missed
  // it, force one middle room that features it.
  if (featured.length && !out.some(teaches)) {
    let placed = false;
    for (let i = 1; i < path.length - 1 && !placed; i++) {
      const needed = [sideBetween(path[i], path[i - 1]), sideBetween(path[i], path[i + 1])];
      const pool = chunks.filter(
        (c) => (c.role ?? 'any') === 'any' && teaches(c) && needed.every((s) => c.connects.includes(s))
      );
      if (pool.length) {
        out[i] = pickWeighted(rand, pool, (c) => Math.pow(c.difficulty ?? 1, difficultyBias));
        placed = true;
      }
    }
    // Still nothing — this PATH cannot host the chapter's mechanic (most featured rooms only
    // connect left↔right, and a wandering path may need corner rooms throughout). Reject the
    // attempt so the retry loop draws a different path rather than shipping an off-topic level.
    if (!placed) return null;
  }
  return out;
}

// --- Assembly -------------------------------------------------------------------------------

/** Blit chosen rooms into one big mutable character grid and open the connecting doorways. */
function assemble(layout, cols, rows) {
  const W = cols * ROOM_COLS;
  const H = rows * ROOM_ROWS;
  const grid = Array.from({ length: H }, () => new Array(W).fill('#'));

  // Off-path slots stay solid rock; path slots get their chunk.
  const onPath = new Map(layout.path.map((p, i) => [`${p.c},${p.r}`, i]));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = onPath.get(`${c},${r}`);
      const room = idx === undefined ? SOLID_ROOM : layout.chunks[idx].grid;
      for (let y = 0; y < ROOM_ROWS; y++) {
        for (let x = 0; x < ROOM_COLS; x++) {
          grid[r * ROOM_ROWS + y][c * ROOM_COLS + x] = room[y][x];
        }
      }
    }
  }

  // Strip spawn/goal markers outside the rooms that own them, so a middle room carrying an
  // 'S' from its own design can't fight the real spawn.
  const entry = layout.path[0];
  const exit = layout.path[layout.path.length - 1];
  forEachCell(grid, (ch, x, y) => {
    const room = { c: Math.floor(x / ROOM_COLS), r: Math.floor(y / ROOM_ROWS) };
    if (ch === 'S' && !(room.c === entry.c && room.r === entry.r)) grid[y][x] = '.';
    if (ch === 'G' && !(room.c === exit.c && room.r === exit.r)) grid[y][x] = '.';
  });

  for (let i = 0; i < layout.path.length - 1; i++) {
    carveDoorway(grid, layout.path[i], layout.path[i + 1]);
  }
  return grid;
}

/**
 * Open the shared border between two adjacent rooms. Clears DOOR_DEPTH cells inward on both
 * sides so the ball always arrives in open space — hazards sitting in the band are cleared
 * too, otherwise a doorway could open directly onto a spike bed.
 */
function carveDoorway(grid, a, b) {
  const side = sideBetween(a, b);
  const ax = a.c * ROOM_COLS;
  const ay = a.r * ROOM_ROWS;
  const bx = b.c * ROOM_COLS;
  const by = b.r * ROOM_ROWS;

  if (side === 'left' || side === 'right') {
    for (const row of DOOR_BAND_ROWS) {
      for (let d = 0; d < DOOR_DEPTH; d++) {
        const aCol = side === 'right' ? ROOM_COLS - 1 - d : d;
        const bCol = side === 'right' ? d : ROOM_COLS - 1 - d;
        grid[ay + row][ax + aCol] = '.';
        grid[by + row][bx + bCol] = '.';
      }
      for (let d = DOOR_DEPTH; d < DOOR_APRON; d++) {
        const aCol = side === 'right' ? ROOM_COLS - 1 - d : d;
        const bCol = side === 'right' ? d : ROOM_COLS - 1 - d;
        clearHazard(grid, ax + aCol, ay + row);
        clearHazard(grid, bx + bCol, by + row);
      }
    }
  } else {
    for (const col of DOOR_BAND_COLS) {
      for (let d = 0; d < DOOR_DEPTH; d++) {
        const aRow = side === 'bottom' ? ROOM_ROWS - 1 - d : d;
        const bRow = side === 'bottom' ? d : ROOM_ROWS - 1 - d;
        grid[ay + aRow][ax + col] = '.';
        grid[by + bRow][bx + col] = '.';
      }
      for (let d = DOOR_DEPTH; d < DOOR_APRON; d++) {
        const aRow = side === 'bottom' ? ROOM_ROWS - 1 - d : d;
        const bRow = side === 'bottom' ? d : ROOM_ROWS - 1 - d;
        clearHazard(grid, ax + col, ay + aRow);
        clearHazard(grid, bx + col, by + bRow);
      }
    }
  }
}

/** Remove a hazard from the landing zone, leaving walls and everything else in place. */
function clearHazard(grid, x, y) {
  if (HAZARD_DIR[grid[y]?.[x]]) grid[y][x] = '.';
}

// --- Compilation ----------------------------------------------------------------------------

/**
 * Character grid → level object. Exported so you can compile a single hand-drawn grid
 * without going through the generator (handy when prototyping a room).
 */
export function compileGrid(grid, { id = 'gen', gravity = 'down', entryRoom, exitRoom } = {}) {
  const H = grid.length;
  const W = grid[0].length;
  const cx = (x) => x * CELL + CELL / 2;
  const cy = (y) => y * CELL + CELL / 2;

  const level = {
    id,
    par: 4,
    gravity,
    bounds: { w: W * CELL, h: H * CELL },
    border: false, // the chunk grids draw their own outer wall
    spawn: null,
    goal: null,
    walls: [],
    ramps: [],
    hazards: [],
    sticky: [],
    bouncers: [],
    keys: [],
    doors: [],
    portals: [],
    weights: [],
    breakables: [],
    cblocks: [],
    switches: [],
    slowzones: [],
    lasers: [],
    gravzones: [],
    blackholes: [],
  };

  // Walls: merged into the fewest rectangles possible. Matter is far happier with 40 big
  // static bodies than with 4000 tiles, and it keeps the saved JSON readable.
  const wallMask = new Uint8Array(W * H);
  forEachCell(grid, (ch, x, y) => { if (ch === '#') wallMask[y * W + x] = 1; });
  for (const r of mergeRects(wallMask, W, H)) {
    level.walls.push({
      x: r.x * CELL + (r.w * CELL) / 2,
      y: r.y * CELL + (r.h * CELL) / 2,
      w: r.w * CELL,
      h: r.h * CELL,
    });
  }

  forEachCell(grid, (ch, x, y) => {
    if (ch === 'S') level.spawn = { x: cx(x), y: cy(y) };
    else if (ch === 'G') level.goal = { x: cx(x), y: cy(y) };
    else if (HAZARD_DIR[ch]) level.hazards.push({ x: cx(x), y: cy(y), w: CELL, h: CELL - 4, dir: HAZARD_DIR[ch] });
    else if (RAMP_DIR[ch]) level.ramps.push({ x: cx(x), y: cy(y), w: CELL, h: CELL, dir: RAMP_DIR[ch] });
    else if (KEY_COLOR[ch]) level.keys.push({ x: cx(x), y: cy(y), color: KEY_COLOR[ch] });
    else if (ch === 'w') level.switches.push({ x: cx(x), y: cy(y) });
    else if (ch === 'o') level.blackholes.push({ x: cx(x), y: cy(y), radius: 150, strength: 0.5 });
  });

  // Portals are pairs: every 'p' links to the 'P' drawn in the same room, in reading order.
  const portalA = [];
  const portalB = [];
  forEachCell(grid, (ch, x, y) => {
    if (ch === 'p') portalA.push({ x: cx(x), y: cy(y) });
    else if (ch === 'P') portalB.push({ x: cx(x), y: cy(y) });
  });
  for (let i = 0; i < Math.min(portalA.length, portalB.length); i++) {
    level.portals.push({ a: portalA[i], b: portalB[i] });
  }

  // Area zones merge in 2D, like walls — one big sensor reads better than a grid of them.
  for (const [ch, kind] of Object.entries(WEIGHT_KIND)) {
    for (const r of mergeCharRects(grid, W, H, ch)) level.weights.push({ ...rectToBox(r), kind });
  }
  for (const r of mergeCharRects(grid, W, H, 'z')) level.slowzones.push(rectToBox(r));
  for (const r of mergeCharRects(grid, W, H, 'g')) level.gravzones.push({ ...rectToBox(r), dir: 'up' });

  // Runs: pads, trampolines and doors read better (and behave better) as one long body than
  // as a row of abutting ones, so consecutive identical cells collapse into a single entry.
  for (const run of collectRuns(grid, (ch) => ch === '=', 'x')) {
    level.sticky.push({ x: runCentreX(run), y: cy(run.y), w: run.n * CELL, h: 24 });
  }
  for (const run of collectRuns(grid, (ch) => ch === '"', 'y')) {
    level.sticky.push({ x: cx(run.x), y: runCentreY(run), w: 24, h: run.n * CELL });
  }
  for (const ch of ['t', 'u']) {
    for (const run of collectRuns(grid, (c) => c === ch, 'x')) {
      level.bouncers.push({ x: runCentreX(run), y: cy(run.y), w: run.n * CELL, h: 20, dir: BOUNCER_DIR[ch], power: 17 });
    }
  }
  for (const ch of ['l', 'r']) {
    for (const run of collectRuns(grid, (c) => c === ch, 'y')) {
      level.bouncers.push({ x: cx(run.x), y: runCentreY(run), w: 20, h: run.n * CELL, dir: BOUNCER_DIR[ch], power: 17 });
    }
  }
  for (const ch of ['d', 'D']) {
    for (const run of collectRuns(grid, (c) => c === ch, 'y')) {
      level.doors.push({ x: cx(run.x), y: runCentreY(run), w: CELL, h: run.n * CELL, color: DOOR_COLOR[ch] });
    }
  }
  for (const run of collectRuns(grid, (c) => c === 'b', 'y')) {
    level.breakables.push({ x: cx(run.x), y: runCentreY(run), w: CELL, h: run.n * CELL });
  }
  for (const run of collectRuns(grid, (c) => c === 'L', 'y')) {
    level.lasers.push({ x: cx(run.x), y: runCentreY(run), w: 12, h: run.n * CELL, on: 700, off: 1800 });
  }
  for (const ch of ['R', 'B']) {
    for (const run of collectRuns(grid, (c) => c === ch, 'y')) {
      level.cblocks.push({ x: cx(run.x), y: runCentreY(run), w: CELL, h: run.n * CELL, color: CBLOCK_COLOR[ch] });
    }
  }

  // A room may have had its 'S'/'G' carved away by a doorway. Falling back to any open cell in
  // the right room keeps the level playable instead of throwing the whole layout away.
  if (!level.spawn) level.spawn = fallbackPoint(grid, entryRoom, cx, cy) ?? { x: cx(2), y: cy(2) };
  if (!level.goal) level.goal = fallbackPoint(grid, exitRoom, cx, cy, true) ?? { x: cx(W - 3), y: cy(H - 3) };

  // A door with no matching key is an unopenable wall — drop keyless doors so the generator
  // can't hand the playtester a level that is impossible by construction.
  const heldColors = new Set(level.keys.map((k) => k.color));
  level.doors = level.doors.filter((d) => heldColors.has(d.color));

  // Color blocks need a switch to flip them, or one colour is permanently a wall.
  if (level.cblocks.length && !level.switches.length) level.cblocks = [];
  if (level.cblocks.length) level.activeColor = 'red';

  const arrays = [
    'walls', 'ramps', 'hazards', 'sticky', 'bouncers', 'keys', 'doors', 'portals', 'weights',
    'breakables', 'cblocks', 'switches', 'slowzones', 'lasers', 'gravzones', 'blackholes',
  ];
  for (const key of arrays) {
    if (!level[key].length) delete level[key];
  }
  return level;
}

/** Merge all cells matching one character into the fewest rectangles (grid units). */
function mergeCharRects(grid, W, H, ch) {
  const mask = new Uint8Array(W * H);
  forEachCell(grid, (c, x, y) => { if (c === ch) mask[y * W + x] = 1; });
  return mergeRects(mask, W, H);
}

/** Grid-unit rect → pixel {x, y, w, h} centred box. */
function rectToBox(r) {
  return {
    x: r.x * CELL + (r.w * CELL) / 2,
    y: r.y * CELL + (r.h * CELL) / 2,
    w: r.w * CELL,
    h: r.h * CELL,
  };
}

/** First open cell in a room, scanning from the top (or the bottom, for a goal). */
function fallbackPoint(grid, room, cx, cy, fromBottom = false) {
  if (!room) return null;
  const x0 = room.c * ROOM_COLS;
  const y0 = room.r * ROOM_ROWS;
  const ys = Array.from({ length: ROOM_ROWS }, (_, i) => (fromBottom ? ROOM_ROWS - 1 - i : i));
  for (const y of ys) {
    for (let x = 1; x < ROOM_COLS - 1; x++) {
      if (grid[y0 + y][x0 + x] === '.') return { x: cx(x0 + x), y: cy(y0 + y) };
    }
  }
  return null;
}

/** Greedy rectangle decomposition: grow right as far as possible, then down. */
function mergeRects(mask, W, H) {
  const used = new Uint8Array(W * H);
  const rects = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = y * W + x;
      if (!mask[at] || used[at]) continue;
      let w = 1;
      while (x + w < W && mask[at + w] && !used[at + w]) w++;
      let h = 1;
      grow: while (y + h < H) {
        for (let i = 0; i < w; i++) {
          const idx = (y + h) * W + x + i;
          if (!mask[idx] || used[idx]) break grow;
        }
        h++;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[(y + j) * W + x + i] = 1;
      rects.push({ x, y, w, h });
    }
  }
  return rects;
}

/** Consecutive matching cells along one axis → {x, y, n} runs. */
function collectRuns(grid, match, axis) {
  const H = grid.length;
  const W = grid[0].length;
  const runs = [];
  if (axis === 'x') {
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (!match(grid[y][x])) { x++; continue; }
        let n = 1;
        while (x + n < W && match(grid[y][x + n])) n++;
        runs.push({ x, y, n });
        x += n;
      }
    }
  } else {
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        if (!match(grid[y][x])) { y++; continue; }
        let n = 1;
        while (y + n < H && match(grid[y + n][x])) n++;
        runs.push({ x, y, n });
        y += n;
      }
    }
  }
  return runs;
}

const runCentreX = (run) => run.x * CELL + (run.n * CELL) / 2;
const runCentreY = (run) => run.y * CELL + (run.n * CELL) / 2;

function forEachCell(grid, fn) {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) fn(grid[y][x], x, y);
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
