// playtest-ai.mjs — headless driver for the automated content pipeline.
//
// Boots the game in a headless browser, runs the generator + Q-learning playtester, and
// writes the levels worth keeping to disk. Levels the AI beat on its first attempt are
// discarded; the ones that fought back are saved.
//
// Usage:
//   node serve.mjs                          # in another terminal (or use PORT=3210)
//   node playtest-ai.mjs                    # 10 levels, default settings
//   node playtest-ai.mjs --levels=25 --keep-min=4
//   node playtest-ai.mjs --seed=1234 --cols=4 --rows=2 --action-set=quad
//   node playtest-ai.mjs --url=http://localhost:3210 --headful
//
// Flags:
//   --url=<url>          dev server (default http://localhost:3000)
//   --levels=<n>         how many levels to generate and test (default 10)
//   --seed=<n>           master seed, for a reproducible run
//   --keep-min=<n>       attempts required before a level is kept (default 3)
//   --chapter=<n>        build for campaign chapter n (1-10): only uses mechanics that
//                        chapter has taught, and features the one it introduces
//   --cols=<n> --rows=<n>  room-grid size (default 2 x 2 → 3-4 rooms)
//   --max-episodes=<n>   attempts before giving up on a level (default 120)
//   --max-steps=<n>      physics steps per attempt (default 3000)
//   --action-set=<s>     quad | cycle | binary (default quad — the action set a real player
//                        has; see docs/PROCGEN-AI.md for why that matters)
//   --shaping=<f>        distance-to-goal shaping weight; 0 = pure sparse rewards
//   --shared-brain       carry one Q-table across levels instead of a fresh one per level
//                        (faster, but "attempts" stops measuring the level in isolation)
//   --out=<dir>          output directory (default ./generated)
//   --headful            show the browser window
//   --timeout=<ms>       give up on the whole run (default 900000)
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const OUT = resolve(args.out ?? 'generated');

const runOpts = clean({
  levels: args.levels ?? 10,
  seed: args.seed,
  keepMin: args['keep-min'] ?? 3,
  chapter: args.chapter,
  cols: args.cols,
  rows: args.rows,
  minRooms: args['min-rooms'],
  maxRooms: args['max-rooms'],
  difficultyBias: args['difficulty-bias'],
  sharedBrain: args['shared-brain'] ? true : undefined,
  hud: true,
  ai: clean({
    actionSet: args['action-set'],
    maxEpisodes: args['max-episodes'],
    maxSteps: args['max-steps'],
    shaping: args.shaping,
  }),
});

const url = args.url ?? 'http://localhost:3000';
console.log(`\n  Gravity Ball — automated content pipeline`);
console.log(`  ${url}  ·  ${runOpts.levels} levels  ·  keep at >= ${runOpts.keepMin} attempts\n`);

const browser = await puppeteer.launch({
  headless: !args.headful,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 740 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForFunction(() => window.GravityBallAI && window.game?.registry?.get('levels'), { timeout: 20000 });

  await page.evaluate((opts) => window.GravityBallAI.run(opts), runOpts);

  // Poll for progress. The run lives inside the game's frame loop, so we just watch it tick.
  const timeout = args.timeout ?? 900000;
  const started = Date.now();
  let printed = 0;
  while (Date.now() - started < timeout) {
    // Pull everything finished since the last poll — a fast run can complete several levels
    // inside one polling interval, and every one of them deserves a line.
    const st = await page.evaluate((from) => {
      const p = window.GravityBallAI.pipeline;
      if (!p) return null;
      return { done: p.done, fresh: p.results.slice(from) };
    }, printed);
    for (const r of st?.fresh ?? []) {
      const tag = { keep: 'KEEP ', discard: 'DROP ', borderline: 'MEH  ', unsolved: 'HARD ' }[r.verdict];
      console.log(
        `  ${tag} ${r.id.padEnd(16)} attempts ${String(r.attempts).padStart(3)}` +
        `  deaths ${String(r.deaths).padStart(3)}  closest ${String(r.closestApproach).padStart(5)}px` +
        `  [${r.rooms.join(' > ')}]`
      );
      printed++;
    }
    if (st?.done) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  const report = await page.evaluate(() => window.GravityBallAI.report);
  if (!report) throw new Error('pipeline produced no report (did the page error out?)');

  // --- Write results ----------------------------------------------------------------------
  await mkdir(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const keepers = report.kept.filter((k) => k.verdict === 'keep');
  const unsolved = report.kept.filter((k) => k.verdict === 'unsolved');

  for (const k of keepers) {
    await writeFile(resolve(OUT, `${k.level.id}.json`), JSON.stringify(k.level, null, 2));
  }
  if (unsolved.length) {
    await mkdir(resolve(OUT, 'unsolved'), { recursive: true });
    for (const k of unsolved) {
      await writeFile(resolve(OUT, 'unsolved', `${k.level.id}.json`), JSON.stringify(k.level, null, 2));
    }
  }
  const reportPath = resolve(OUT, `report-${stamp}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  const s = report.summary;
  console.log(`\n  tested ${report.tested} in ${(report.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  kept ${s.keep}  ·  discarded (first try) ${s.discard}  ·  borderline ${s.borderline}  ·  never solved ${s.unsolved}`);
  console.log(`\n  master seed: ${report.masterSeed}   (rerun with --seed=${report.masterSeed})`);
  if (keepers.length) {
    console.log(`  saved to ${OUT}:`);
    for (const k of keepers) console.log(`    ${k.level.id}.json`);
    console.log(`\n  Open one in the editor (editor.html → Open), or play it:`);
    console.log(`    GravityBallAI.playSeed(${keepers[0].level.meta.seed})`);
  } else {
    console.log(`  nothing met the keep threshold — try --keep-min=2 or a harder --difficulty-bias`);
  }
  if (unsolved.length) console.log(`  ${unsolved.length} unsolved layout(s) parked in ${OUT}/unsolved for a human look`);
  console.log(`  full report: ${reportPath}\n`);

  if (pageErrors.length) console.log('  page errors:', [...new Set(pageErrors)].slice(0, 5).join(' | '), '\n');
} catch (err) {
  console.error('\n  playtest failed:', err.message);
  console.error('  is the dev server running?  node serve.mjs\n');
  process.exitCode = 1;
} finally {
  await browser.close();
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, key, value] = m;
    if (value === undefined) out[key] = true;
    else out[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return out;
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}
