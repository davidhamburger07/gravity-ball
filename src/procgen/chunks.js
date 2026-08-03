// chunks.js — THE ROOM LIBRARY. This is the file you edit to design content.
//
// A chunk is one hand-authored room drawn as a 2D grid of characters. The generator picks
// chunks, stitches them into a room grid, carves doorways between neighbours, and compiles
// the result into a normal levels.json-shaped level (see LevelGenerator.js).
//
// ---------------------------------------------------------------------------------------
// RULES FOR AUTHORING A ROOM
// ---------------------------------------------------------------------------------------
//   1. Every grid is exactly ROOM_ROWS (15) rows of ROOM_COLS (20) characters. At CELL=40px
//      that is one 800x600 screen — the same size as a hand-made level. `validateChunks()`
//      throws with the offending row if you miscount, so mistakes surface immediately.
//   2. Draw the room's own border with '#'. The generator carves doorways through it where
//      rooms connect, and leaves it solid everywhere else.
//   3. `connects` lists the edges the generator is ALLOWED to open. Only list a side if the
//      room is actually playable when entered/exited there.
//   4. Doorways hug the floor and the left wall — rows 11-13 for left/right, cols 1-3 for
//      top/bottom — NOT the middle of the edge. This matters: the ball is always pinned to
//      whichever surface gravity points at, so it only ever travels ALONG a wall. A doorway
//      in the middle of a wall is unreachable without a lucky mid-air trajectory, while a
//      doorway at floor level means a ball rolling east simply rolls into the next room.
//      Keep those bands clear of walls near the border. (Hazards in the band are fine —
//      carving clears them.)
//   5. Furniture belongs on the row the ball OCCUPIES, not the row it touches. A ball resting
//      on the floor sits in row 13; pinned to the ceiling it sits in row 1. So floor spikes,
//      trampolines, portals and goals go on row 13, and ceiling-mounted ones on row 1. A goal
//      drawn on row 12 floats ~8px above a ball rolling past it and can never be collected;
//      a spike hung on row 2 sits just below a ceiling-riding ball and never bites.
//   6. `role` — 'entry' rooms are only used first (they hold 'S'), 'exit' rooms only last
//      (they hold 'G'), 'any' rooms fill the middle.
//   7. `uses` lists the MECHANICS the room needs (see chapters.js). The generator will only
//      pick a room whose `uses` are all unlocked by the chapter being generated, so a room
//      tagged ['portal'] never appears in a chapter-3 level. Terrain — walls and ramps — is
//      always legal and is not listed. Get this wrong and you leak a mechanic into a chapter
//      that has not taught it yet.
//   8. `difficulty` 1-5 is a hint for the generator's weighting. It is NOT a measurement —
//      the AI playtester produces the real number.
//
// ---------------------------------------------------------------------------------------
// LEGEND
// ---------------------------------------------------------------------------------------
//   Terrain (always legal)
//     #  wall (solid)              .  empty space
//     S  spawn point               G  goal
//     /  ramp, solid lower-right   \  ramp, solid lower-left
//     7  ramp, solid upper-right   F  ramp, solid upper-left
//   spike
//     ^  points up   v  points down   >  points right   <  points left
//   bouncer                          sticky
//     t  launches UP    u  DOWN        =  pad (horizontal)
//     l  launches LEFT  r  RIGHT       "  pad (vertical)
//   key                              weight / breakable
//     k  gold key   d  gold door       h  heavy zone   n  normal (reset) zone
//     K  blue key   D  blue door       b  breakable block
//   portal                           cblock
//     p  portal A   P  portal B        R  red block   B  blue block   w  color switch
//   laser / slowzone                 gravzone / blackhole
//     L  laser beam  z  slow zone      g  gravity zone (up)   o  black hole

export const ROOM_COLS = 20;
export const ROOM_ROWS = 15;
export const CELL = 40; // px per grid cell → a room is 800x600

// Doorway bands, in cell indices. Kept here so LevelGenerator and the authoring rules above
// can never drift apart.
export const DOOR_BAND_ROWS = [11, 12, 13]; // left/right doorways: the three rows above the floor
export const DOOR_BAND_COLS = [1, 2, 3];    // top/bottom doorways: the three cols beside the left wall
export const DOOR_DEPTH = 2;                // cells cleared inward from the border
// Hazards are additionally stripped this far inside every doorway. Walls are left alone — this
// is purely a landing zone, so a ball arriving from the next room gets room to react instead of
// dying on a spike it was never shown.
export const DOOR_APRON = 4;

/**
 * Which mechanic each character belongs to. Drives `validateChunks`, which cross-checks every
 * chunk's declared `uses` against what it actually draws — so a room can never quietly smuggle
 * an untaught object into an early chapter.
 */
export const MECHANIC_OF_CHAR = Object.freeze({
  '^': 'spike', v: 'spike', '>': 'spike', '<': 'spike',
  t: 'bouncer', u: 'bouncer', l: 'bouncer', r: 'bouncer',
  '=': 'sticky', '"': 'sticky',
  k: 'key', d: 'key', K: 'key', D: 'key',
  h: 'weight', n: 'weight', b: 'breakable',
  p: 'portal', P: 'portal',
  R: 'cblock', B: 'cblock', w: 'cblock',
  L: 'laser', z: 'slowzone',
  g: 'gravzone', o: 'blackhole',
});

export const CHUNKS = [
  // --- Entry rooms ---------------------------------------------------------------------
  {
    name: 'entry-plain',
    role: 'entry',
    connects: ['right', 'bottom'],
    difficulty: 1,
    uses: [],
    grid: [
      '####################',
      '#S.................#',
      '#..................#',
      '#..................#',
      '#....########......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..........####....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ],
  },
  {
    name: 'entry-drop',
    role: 'entry',
    connects: ['right', 'bottom'],
    difficulty: 1,
    uses: ['spike'],
    grid: [
      '####################',
      '#S.................#',
      '#..................#',
      '#####........###...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...####...........#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#......^^^....^^...#',
      '####################',
    ],
  },
  {
    name: 'entry-ledges',
    role: 'entry',
    connects: ['right', 'bottom'],
    difficulty: 2,
    uses: ['spike'],
    grid: [
      '####################',
      '#........S.........#',
      '#..................#',
      '#..................#',
      '#...##########.....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.....######.......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...^^^......^^^...#',
      '####################',
    ],
  },

  // --- Terrain-only middles (legal in every chapter) ------------------------------------
  {
    name: 'hall-plain',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 1,
    uses: [],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#....####..####....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..####......####..#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ],
  },
  {
    name: 'shaft-plain',
    role: 'any',
    connects: ['left', 'right', 'top', 'bottom'],
    difficulty: 1,
    uses: [],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#......#####.......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#......#####.......#',
      '#..................#',
      '#..................#',
      '#......#####.......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ],
  },
  {
    name: 'zigzag-ramps',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 2,
    uses: ['spike'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#....\\####.........#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.........####/....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...^^....^^^....^.#',
      '####################',
    ],
  },

  // --- Ch.2 spikes ----------------------------------------------------------------------
  {
    name: 'spike-hall',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 2,
    uses: ['spike'],
    grid: [
      '####################',
      '#..vvv.......vvv...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#........####......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..^^^.....^^^^....#',
      '####################',
    ],
  },
  {
    name: 'pillar-run',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 3,
    uses: ['spike'],
    grid: [
      '####################',
      '#..................#',
      '#..#....#....#.....#',
      '#..#....#....#.....#',
      '#..#....#....#.....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#....#....#....#...#',
      '#....#....#....#...#',
      '#....#....#....#...#',
      '#..................#',
      '#..^...^^...^...^^.#',
      '####################',
    ],
  },
  {
    name: 'needle-drop',
    role: 'any',
    connects: ['top', 'bottom'],
    difficulty: 4,
    uses: ['spike'],
    grid: [
      '####################',
      '#..................#',
      '#..>...........<...#',
      '#..>...........<...#',
      '#..>...........<...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..>...........<...#',
      '#..>...........<...#',
      '#..>...........<...#',
      '#..................#',
      '#..................#',
      '####################',
    ],
  },
  {
    name: 'crossroads',
    role: 'any',
    connects: ['left', 'right', 'top', 'bottom'],
    difficulty: 2,
    uses: ['spike'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#..####......####..#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..####......####..#',
      '#..................#',
      '#..................#',
      '#...^^....^^....^^.#',
      '####################',
    ],
  },

  // --- Ch.3 trampolines + sticky pads ---------------------------------------------------
  {
    name: 'bounce-shaft',
    role: 'any',
    connects: ['left', 'top', 'bottom'],
    difficulty: 3,
    uses: ['spike', 'bouncer'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...####....####...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..^....tttt....^..#',
      '####################',
    ],
  },
  {
    name: 'bounce-cross',
    role: 'any',
    connects: ['left', 'right', 'top', 'bottom'],
    difficulty: 3,
    uses: ['spike', 'bouncer'],
    grid: [
      '####################',
      '#....uuu....uuu....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..^^tt.....^^tt...#',
      '####################',
    ],
  },
  {
    name: 'sticky-tower',
    role: 'any',
    connects: ['left', 'right', 'top'],
    difficulty: 3,
    uses: ['spike', 'sticky'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#...====....====...#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...====....====...#',
      '#..................#',
      '#..................#',
      '#...^^^......^^^...#',
      '####################',
    ],
  },

  // --- Ch.4 keys + doors ----------------------------------------------------------------
  {
    name: 'key-gate',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 4,
    uses: ['spike', 'key'],
    grid: [
      '####################',
      '#........d.........#',
      '#.....k..d.........#',
      '#....####d.........#',
      '#........d.........#',
      '#........d.........#',
      '#........d.........#',
      '#........d.........#',
      '#........d.........#',
      '#........d.........#',
      '#........d.........#',
      '#........d.........#',
      '#........d.........#',
      '#..^^....d...^^^...#',
      '####################',
    ],
  },

  // --- Ch.5 weight zones + breakable blocks ---------------------------------------------
  {
    name: 'fragile-run',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 3,
    uses: ['weight', 'breakable'],
    grid: [
      '####################',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '#hhhhhhhh.....b....#',
      '####################',
    ],
  },
  {
    name: 'smash-shaft',
    role: 'any',
    connects: ['left', 'right', 'top'],
    difficulty: 4,
    uses: ['spike', 'weight', 'breakable'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#hhhhhhhhhhhh......#',
      '#hhhhhhhhhhhh......#',
      '#hhhhhhhhhhhh......#',
      '#hhhhhhhhhhhh......#',
      '#hhhhhhhhhhhh......#',
      '#hhhhhhhhhhhh......#',
      '#hhhhhhhhhhhh.b....#',
      '#hhhhhhhhhhhh.b....#',
      '#hhhhhhhhhhhh.b....#',
      '#hhhhhhhhhhhh.b....#',
      '#hhh^^^hhhhhh.b....#',
      '####################',
    ],
  },

  // --- Ch.6 portals ---------------------------------------------------------------------
  {
    name: 'warp-hall',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 3,
    uses: ['spike', 'portal'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#........####......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...p..^^^^^^..P...#',
      '####################',
    ],
  },
  {
    name: 'warp-shaft',
    role: 'any',
    connects: ['left', 'top'],
    difficulty: 4,
    uses: ['spike', 'portal'],
    grid: [
      '####################',
      '#.................P#',
      '#..................#',
      '#..................#',
      '#....##########....#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..p...^^^^^^^^....#',
      '####################',
    ],
  },

  // --- Ch.7 color blocks + switches -----------------------------------------------------
  {
    name: 'chroma-gate',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 4,
    uses: ['cblock'],
    grid: [
      '####################',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#........R....B....#',
      '#..w.....R..w.B....#',
      '####################',
    ],
  },

  // --- Ch.8 lasers + slow zones ---------------------------------------------------------
  {
    name: 'time-hall',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 4,
    uses: ['laser', 'slowzone'],
    grid: [
      '####################',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '#.....L..zz..L.....#',
      '####################',
    ],
  },

  // --- Ch.9 gravity zones + black holes -------------------------------------------------
  {
    name: 'gravity-well',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 3,
    uses: ['gravzone'],
    grid: [
      '####################',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '#.......gggg.......#',
      '####################',
    ],
  },
  {
    name: 'singularity',
    role: 'any',
    connects: ['left', 'right'],
    difficulty: 4,
    uses: ['spike', 'blackhole'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#........o.........#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..^^^......^^^....#',
      '####################',
    ],
  },

  // --- Exit rooms ----------------------------------------------------------------------
  {
    name: 'exit-plain',
    role: 'exit',
    connects: ['left', 'top'],
    difficulty: 1,
    uses: [],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#....######........#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#........#####.....#',
      '#..................#',
      '#..................#',
      '#................G.#',
      '####################',
    ],
  },
  {
    name: 'exit-vault',
    role: 'exit',
    connects: ['left', 'top'],
    difficulty: 2,
    uses: ['spike'],
    grid: [
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#........####......#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..^^^....^^^....G.#',
      '####################',
    ],
  },
  {
    name: 'exit-gauntlet',
    role: 'exit',
    connects: ['left', 'top'],
    difficulty: 4,
    uses: ['spike'],
    grid: [
      '####################',
      '#..vvv......vvv....#',
      '#..................#',
      '#..................#',
      '#....######........#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#........######....#',
      '#..................#',
      '#.........###......#',
      '#..................#',
      '#..................#',
      '#.....^^^^....^^.G.#',
      '####################',
    ],
  },
];

/** A room slot that isn't on the generated path: solid rock, so the level reads as carved. */
export const SOLID_ROOM = Array.from({ length: ROOM_ROWS }, () => '#'.repeat(ROOM_COLS));

const TERRAIN_CHARS = new Set([...'#.SG/\\7F']);
const VALID_SIDES = new Set(['left', 'right', 'top', 'bottom']);

/**
 * Fail loudly on a malformed room rather than generating a broken level. Called once at
 * import time so a typo in this file shows up the moment the page loads.
 */
export function validateChunks(chunks = CHUNKS) {
  for (const c of chunks) {
    if (c.grid.length !== ROOM_ROWS) {
      throw new Error(`chunk "${c.name}": has ${c.grid.length} rows, expected ${ROOM_ROWS}`);
    }
    const declared = new Set(c.uses ?? []);
    const actual = new Set();

    c.grid.forEach((row, y) => {
      if (row.length !== ROOM_COLS) {
        throw new Error(`chunk "${c.name}" row ${y}: is ${row.length} chars, expected ${ROOM_COLS} — "${row}"`);
      }
      for (const ch of row) {
        const mech = MECHANIC_OF_CHAR[ch];
        if (mech) { actual.add(mech); continue; }
        if (!TERRAIN_CHARS.has(ch)) {
          throw new Error(`chunk "${c.name}" row ${y}: unknown character "${ch}" (see the legend in chunks.js)`);
        }
      }
    });

    // The `uses` tag is what keeps untaught objects out of early chapters, so it has to match
    // what the room actually draws — in both directions.
    for (const m of actual) {
      if (!declared.has(m)) {
        throw new Error(`chunk "${c.name}": draws a "${m}" but does not list it in \`uses\` — it would leak into chapters that have not taught it`);
      }
    }
    for (const m of declared) {
      if (!actual.has(m)) {
        throw new Error(`chunk "${c.name}": lists "${m}" in \`uses\` but never draws one — it would be locked out of chapters for no reason`);
      }
    }

    if (!c.connects?.length) throw new Error(`chunk "${c.name}": needs at least one entry in \`connects\``);
    for (const side of c.connects) {
      if (!VALID_SIDES.has(side)) throw new Error(`chunk "${c.name}": bad side "${side}" in \`connects\``);
    }
    const role = c.role ?? 'any';
    if (role === 'entry' && !c.grid.some((r) => r.includes('S'))) {
      throw new Error(`chunk "${c.name}": entry rooms must contain a spawn 'S'`);
    }
    if (role === 'exit' && !c.grid.some((r) => r.includes('G'))) {
      throw new Error(`chunk "${c.name}": exit rooms must contain a goal 'G'`);
    }
  }
  return chunks;
}

validateChunks();
