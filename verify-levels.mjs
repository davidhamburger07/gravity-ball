// verify-levels.mjs — headless solvability check. For every level in a chapter that has a
// `solution` key-sequence, it jumps to the level, plays the sequence (waiting for the ball to
// settle against a surface between inputs, mimicking a real player), and reports whether the
// ball actually reached the goal (GameScene._solved).
//
// Usage:  node verify-levels.mjs [url=http://localhost:3000] [chapterId=2]
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:3000';
const CHAPTER = parseInt(process.argv[3] || '2', 10);
const KEY_MAP = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

const levels = JSON.parse(fs.readFileSync('src/data/levels.json', 'utf8'));
const chapter = levels.chapters.find((c) => c.id === CHAPTER);
if (!chapter) { console.error(`Chapter ${CHAPTER} not found`); process.exit(1); }

// Poll the live GameScene until the ball settles (speed ~0), the level is solved, or we time out.
// "Rest" requires several consecutive slow samples so a transient dip mid-coast (e.g. the brief
// slowdown as a heavy ball punches through a breakable) isn't mistaken for the ball stopping.
async function settle(page, timeout = 4500) {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 320)); // let the shift take effect before sampling
  let restStreak = 0;
  while (Date.now() - start < timeout) {
    const st = await page.evaluate(() => {
      const s = window.game.scene.getScene('GameScene');
      if (!s || !s.ball || !s.ball.body) return { solved: false, speed: 999 };
      if (s._solved) return { solved: true, speed: 0 };
      const v = s.ball.body.velocity;
      return { solved: false, speed: Math.hypot(v.x, v.y) };
    });
    if (st.solved) return 'solved';
    if (st.speed < 0.5) {
      if (++restStreak >= 3) return 'rest';
    } else {
      restStreak = 0;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'timeout';
}

// For laser levels, wait for a fresh OFF window before moving (as a player watching the beam would):
// wait until a laser is on, then until all are off, so a full off-window lies ahead of the crossing.
async function waitLaserWindow(page, timeout = 7000) {
  const has = await page.evaluate(() => (window.game.scene.getScene('GameScene')._lasers || []).length > 0);
  if (!has) return;
  const on = () => page.evaluate(() => !!window.game.scene.getScene('GameScene')._lasersActive);
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await on()) break; await new Promise((r) => setTimeout(r, 40)); }
  while (Date.now() - start < timeout) { if (!(await on())) return; await new Promise((r) => setTimeout(r, 40)); }
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 740 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('canvas');
await page.waitForFunction(() => window.game?.registry?.get('levels'), { timeout: 15000 });

let pass = 0, fail = 0, skip = 0;
const failed = [];

for (const lvl of chapter.levels) {
  if (!lvl.solution) { console.log(`SKIP  ${lvl.id} (no solution)`); skip++; continue; }

  await page.evaluate((id) => {
    const g = window.game;
    ['MenuScene', 'LevelSelectScene'].forEach((k) => g.scene.isActive(k) && g.scene.stop(k));
    g.scene.start('GameScene', { levelId: id });
  }, lvl.id);

  await page.waitForFunction(
    () => { const s = window.game.scene.getScene('GameScene'); return s && s.ball && s.ball.body && !s._solved; },
    { timeout: 8000 }
  ).catch(() => {});
  await settle(page); // initial fall from spawn

  for (const mv of lvl.solution) {
    await waitLaserWindow(page);
    await page.keyboard.press(KEY_MAP[mv] ?? mv);
    if ((await settle(page)) === 'solved') break;
  }

  const solved = await page.evaluate(() => !!window.game.scene.getScene('GameScene')._solved);
  if (solved) { console.log(`PASS  ${lvl.id}  [${lvl.solution.join(' ')}]`); pass++; }
  else { console.log(`FAIL  ${lvl.id}  [${lvl.solution.join(' ')}]`); fail++; failed.push(lvl.id); }
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
if (failed.length) console.log('Failing:', failed.join(', '));
if (pageErrors.length) console.log('Page errors:', [...new Set(pageErrors)].join(' | '));

await browser.close();
process.exit(fail ? 1 : 0);
