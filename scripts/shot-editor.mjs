// shot-editor.mjs — capture the editor's DOM panel and report any console errors.
//
//   node scripts/shot-editor.mjs <url> <label>
//
// screenshot.mjs captures the game canvas; the editor's controls are plain DOM, so this grabs the
// page instead. Console errors are surfaced because a panel that throws while building still
// renders a partial UI, which looks fine in a screenshot and is broken in use.

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.argv[2] || 'http://localhost:3000/editor.html';
const label = process.argv[3] || 'editor';

mkdirSync(resolve('screenshots'), { recursive: true });

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

console.log(`-> loading ${url}`);
await page.goto(url, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1500));

const publish = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')];
  const b = buttons.find((x) => /publish/i.test(x.textContent));
  const hint = document.querySelector('.hint');
  return b
    ? { found: true, label: b.textContent, disabled: b.disabled, hint: hint?.textContent ?? null }
    : { found: false, buttonCount: buttons.length };
});

const out = resolve('screenshots', `${label}.png`);
await page.screenshot({ path: out });
await browser.close();

console.log('\nPublish button:', JSON.stringify(publish, null, 2));
console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
console.log(`\nsaved ${out}\n`);
process.exit(errors.length ? 1 : 0);
