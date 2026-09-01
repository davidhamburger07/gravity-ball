// check-physics.mjs — the campaign's levels are hand-tuned against these exact values.
//
// Every level was authored and beaten against one specific physics configuration. Change a friction
// value, the gravity strength, the step rate or the Phaser version, and levels do not fail loudly —
// they quietly become harder, easier, or impossible, and you find out from a player. The campaign
// has no recorded `solution` arrays, so nothing else in the repo would notice.
//
// This is a deliberate freeze, not a correctness check. If you MEAN to retune the game, change the
// numbers here in the same commit, and retest every level that depends on the value you moved.
//
// Usage:  node scripts/check-physics.mjs   (runs as part of `npm run verify`)
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// --- The frozen values -------------------------------------------------------------------------
const LOCKED = {
  'PHYSICS.GRAVITY_STRENGTH': 1,
  'PHYSICS.BALL_RADIUS': 16,
  'PHYSICS.BALL_FRICTION': 0.01,
  'PHYSICS.BALL_FRICTION_AIR': 0.005,
  'PHYSICS.BALL_BOUNCE': 0.15,
  // Input pacing: raising this swallows quick double-flips that tight levels rely on.
  'FEEL.GRAVITY_COOLDOWN_MS': 120,
  // The world box. Changing either moves the auto border walls and shifts every level's geometry.
  'VIEW.WIDTH': 800,
  'VIEW.PLAY_H': 600,
};

// Constants that live in GameScene rather than GameConfig. Read from source because exporting them
// purely for this check would be tail-wagging-dog.
const LOCKED_SCENE = {
  SIM_STEP_MS: '1000 / 60',        // simulated time per step (Matter's calibrated delta)
  STEP_INTERVAL_MS: '1000 / 144',  // real time per step — sets how fast the world actually runs
  MAX_CATCHUP_STEPS: '12',
  BORDER: '24',                    // auto border-wall thickness
};

const PHASER = '3.80.1';

// --- The check ---------------------------------------------------------------------------------
const problems = [];

const { PHYSICS, FEEL, VIEW } = await import(new URL('../src/config/GameConfig.js', import.meta.url));
const actual = { PHYSICS, FEEL, VIEW };

for (const [path, want] of Object.entries(LOCKED)) {
  const [group, key] = path.split('.');
  const got = actual[group]?.[key];
  if (got !== want) problems.push(`${path} is ${got}, frozen at ${want}`);
}

const sceneSrc = await readFile(resolve(ROOT, 'src/scenes/GameScene.js'), 'utf8');
for (const [name, want] of Object.entries(LOCKED_SCENE)) {
  const match = sceneSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  if (!match) {
    problems.push(`${name} not found in GameScene.js — this checker needs updating`);
    continue;
  }
  const got = match[1].trim();
  if (got !== want) problems.push(`GameScene ${name} is "${got}", frozen at "${want}"`);
}

// A minor Phaser bump can bring a different Matter build with it, and build.mjs vendors whatever is
// installed straight into dist/. The dependency is pinned exactly; this catches a drifted install.
const declared = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')).dependencies?.phaser;
if (declared !== PHASER) problems.push(`package.json wants phaser "${declared}", frozen at "${PHASER}" (no caret — see this file)`);
try {
  const installed = JSON.parse(await readFile(resolve(ROOT, 'node_modules/phaser/package.json'), 'utf8')).version;
  if (installed !== PHASER) problems.push(`installed phaser is ${installed}, frozen at ${PHASER} — run: npm install phaser@${PHASER}`);
} catch {
  problems.push('phaser is not installed — run npm install');
}

if (problems.length) {
  console.error('\n  PHYSICS LOCK BROKEN\n');
  for (const p of problems) console.error(`    - ${p}`);
  console.error('\n  The campaign is hand-tuned against these values and has no recorded solutions,');
  console.error('  so nothing else here would catch a level becoming impossible.');
  console.error('  If the change is intentional, update scripts/check-physics.mjs in the same commit');
  console.error('  and replay every affected level.\n');
  process.exit(1);
}

console.log(`\n  physics lock intact — ${Object.keys(LOCKED).length + Object.keys(LOCKED_SCENE).length} values + phaser ${PHASER}\n`);
