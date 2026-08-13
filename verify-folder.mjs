// verify-folder.mjs — solvability check for hand-authored level files on disk.
//
// Companion to verify-levels.mjs (which checks the shipped campaign in levels.json). This one
// walks a folder of individual level JSON files, loads each into the real game through the
// playtest hand-off, plays its `solution` key-sequence, and reports whether the ball reached the
// goal. Levels without a `solution` are skipped and listed, so unverified files stay visible.
//
// Usage:  node verify-folder.mjs "GB - Levels/C2 - ..." [url] [--runs=2]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const folder = process.argv[2];
const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:3000';
const runs = Number((process.argv.find((a) => a.startsWith('--runs=')) || '--runs=1').split('=')[1]);
if (!folder) { console.error('usage: node verify-folder.mjs <folder> [url] [--runs=N]'); process.exit(2); }

const KEY_MAP = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

// Natural sort so 1-10 follows 1-9 rather than 1-1.
const files = fs.readdirSync(folder).filter((f) => f.endsWith('.json'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const levels = files.map((f) => ({ file: f, level: JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')) }));

// Wait for the ball to settle. "At rest" needs several consecutive slow samples so a brief
// slowdown mid-flight isn't mistaken for a stop.
async function settle(page, timeout = 4500) {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 320));
  let restStreak = 0;
  while (Date.now() - start < timeout) {
    const st = await page.evaluate(() => {
      const s = window.game.scene.getScene('GameScene');
      if (!s || !s.ball || !s.ball.body) return { solved: false, speed: 999, settled: false, dead: false };
      if (s._solved) return { solved: true, speed: 0, settled: true, dead: false };
      const v = s.ball.body.velocity;
      // Slow is not the same as stopped: a ball at the top of a climb is briefly near-motionless
      // in mid-air. Only count it as rest when something is actually holding it.
      const settled = (s.isGrounded?.() ?? true) || !!s._stuck;
      return { solved: false, speed: Math.hypot(v.x, v.y), settled, dead: !!s._dying };
    });
    if (st.solved) return 'solved';
    if (st.speed < 0.5 && st.settled && !st.dead) { if (++restStreak >= 3) return 'rest'; } else restStreak = 0;
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'timeout';
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

let pass = 0, fail = 0, skip = 0;
const failed = [];

for (const { file, level } of levels) {
  if (!Array.isArray(level.solution)) { console.log(`SKIP  ${file.padEnd(12)} (no solution recorded)`); skip++; continue; }

  let solvedAll = true;
  for (let run = 0; run < runs && solvedAll; run++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate((lvl) => localStorage.setItem('gravityball:playtest', JSON.stringify(lvl)), level);
    await page.goto(`${url}/?playtest=1`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => { const s = window.game?.scene?.getScene('GameScene'); return s && s.ball && s.ball.body; },
      { timeout: 15000 }
    );
    await settle(page); // initial fall from spawn

    for (const mv of level.solution) {
      await page.keyboard.press(KEY_MAP[mv] ?? mv);
      if ((await settle(page)) === 'solved') break;
    }
    solvedAll = await page.evaluate(() => !!window.game.scene.getScene('GameScene')._solved);
  }

  if (solvedAll) { console.log(`PASS  ${file.padEnd(12)} [${level.solution.join(' ')}]`); pass++; }
  else { console.log(`FAIL  ${file.padEnd(12)} [${level.solution.join(' ')}]`); fail++; failed.push(file); }
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped  (${runs} run${runs > 1 ? 's' : ''} each)`);
if (failed.length) console.log('Failing:', failed.join(', '));
if (pageErrors.length) console.log('Page errors:', [...new Set(pageErrors)].join(' | '));

await browser.close();
process.exit(fail ? 1 : 0);
