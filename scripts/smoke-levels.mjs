// smoke-levels.mjs — load every campaign level and confirm it is playable at all.
//
// This is the cheap half of a regression gate. It cannot tell you a level is still BEATABLE — only
// a recorded solution can do that — but it does catch the failures that actually happen when you
// edit level data: a spawn moved inside a hazard, geometry that throws while building, a level id
// that no longer resolves, a spawn or goal outside the walls.
//
// Usage:
//   node serve.mjs                                   # in another terminal
//   node scripts/smoke-levels.mjs                    # defaults to http://localhost:3000
//   node scripts/smoke-levels.mjs http://localhost:3187
import puppeteer from 'puppeteer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_ = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:3000';
const BORDER = 24; // must match GameScene's auto border-wall thickness

const levels = JSON.parse(await readFile(resolve(ROOT, 'src/data/levels.json'), 'utf8'));
const entries = levels.chapters.flatMap((c) => (c.levels ?? []).map((l) => ({ id: l.id, ch: c.id })));
if (!entries.length) { console.error('No levels in the campaign.'); process.exit(1); }

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(URL_, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.game?.registry?.get('save'), { timeout: 20000 });
// Test mode so a locked level can still be opened directly.
await page.evaluate(() => window.game.registry.get('save').setTestMode(true));

let failed = 0;
for (const { id, ch } of entries) {
  pageErrors.length = 0;

  const r = await page.evaluate(async ({ id, ch, border }) => {
    const g = window.game;
    g.scene.scenes.filter((s) => s.scene.isActive()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('GameScene', { levelId: id, chapterId: ch });
    await new Promise((done) => setTimeout(done, 650)); // let create() finish and physics tick

    const s = g.scene.getScene('GameScene');
    if (!s || !s.ball) return { ok: false, why: 'scene or ball missing' };
    if (s.level?.id !== id) return { ok: false, why: `resolved to "${s.level?.id}" instead` };
    if (s._dying) return { ok: false, why: 'ball dies at spawn' };

    const b = s.level.bounds ?? { w: 800, h: 600 };
    const inside = (p) => p && p.x > border && p.x < b.w - border && p.y > border && p.y < b.h - border;
    if (!inside(s.level.spawn)) return { ok: false, why: 'spawn is outside the border walls' };
    if (!inside(s.level.goal)) return { ok: false, why: 'goal is outside the border walls' };

    return { ok: true };
  }, { id, ch, border: BORDER });

  const errs = [...new Set(pageErrors)];
  const ok = r.ok && !errs.length;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${id.padEnd(6)}${ok ? '' : '  ' + (r.why ?? '') + (errs.length ? '  [' + errs[0] + ']' : '')}`);
}

console.log(`\n${entries.length - failed}/${entries.length} levels loaded cleanly`);
if (failed) console.log('Note: this checks levels LOAD and are not instantly fatal — not that they are beatable.');

await browser.close();
process.exit(failed ? 1 : 0);
