// screenshot.mjs — headless Canvas capture for visual QA of the running game.
//
// Usage:
//   node screenshot.mjs                         # localhost:3000, default settle
//   node screenshot.mjs http://localhost:3100   # custom URL/port
//   node screenshot.mjs http://localhost:3100 menu           # + label
//   node screenshot.mjs http://localhost:3100 lvl1-3 --level=1-3
//   node screenshot.mjs http://localhost:3100 solved --level=1-1 --keys=right
//
// Flags:
//   --level=<id>      jump straight to a level (via window.game)
//   --chapter=<n>     chapter id to pass alongside --level
//   --keys=a,b,c      press gravity keys (up/down/left/right or arrow names) before capture
//   --wait=<ms>       settle time for tweens/physics (default 1800)
//   --eval="<js>"     run arbitrary page JS before capture
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const KEY_MAP = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  w: 'w', a: 'a', s: 's', d: 'd',
};

function parseArgs(argv) {
  const o = { url: 'http://localhost:3000', label: 'shot', wait: 1800, level: null, chapter: null, keys: [], eval: null };
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--wait=')) o.wait = parseInt(a.slice(7), 10);
    else if (a.startsWith('--level=')) o.level = a.slice(8);
    else if (a.startsWith('--chapter=')) o.chapter = parseInt(a.slice(10), 10);
    else if (a.startsWith('--keys=')) o.keys = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--eval=')) o.eval = a.slice(7);
    else positional.push(a);
  }
  if (positional[0]) o.url = positional[0];
  if (positional[1]) o.label = positional[1];
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const outDir = resolve('screenshots');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = resolve(outDir, `${opts.label}-${stamp}.png`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 740, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });
  page.on('pageerror', (e) => console.log('  [page exception]', e.message));

  console.log(`→ loading ${opts.url}`);
  await page.goto(opts.url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 15000 });

  // Wait until Phaser has booted and level data is loaded.
  await page
    .waitForFunction(() => window.game?.registry?.get('levels'), { timeout: 15000 })
    .catch(() => console.log('  (note: game/levels not detected — capturing whatever is on screen)'));

  if (opts.level) {
    await page.evaluate(({ level, chapter }) => {
      const g = window.game;
      ['MenuScene', 'LevelSelectScene'].forEach((k) => g.scene.isActive(k) && g.scene.stop(k));
      g.scene.start('GameScene', { levelId: level, chapterId: chapter ?? undefined });
    }, { level: opts.level, chapter: opts.chapter });
  }

  if (opts.eval) await page.evaluate(opts.eval);

  await new Promise((r) => setTimeout(r, opts.wait)); // let tweens/physics settle

  for (const k of opts.keys) {
    await page.keyboard.press(KEY_MAP[k.toLowerCase()] ?? k);
    await new Promise((r) => setTimeout(r, 350));
  }

  await page.screenshot({ path: outPath });
  console.log(`✓ saved ${outPath}`);
} catch (err) {
  console.error('✗ screenshot failed:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
