// test-publish-gate.mjs — drive the editor's Publish button through its real states.
//
//   node scripts/test-publish-gate.mjs <url>
//
// The gate is the feature's whole integrity story, so it is worth testing in the actual browser
// rather than only at the unit level: locked with no solve, unlocked and showing the author's best
// run once beaten, and locked again the moment the level is edited.

import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://localhost:3000/editor.html';
const AUTOSAVE_KEY = 'gravityball:editor';
const SOLVES_KEY = 'gravityball:solves';

let passed = 0;
let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  <- ' + detail : ''}`); }
};

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

/** Read the Publish button's current state out of the live page. */
const publishState = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /publish/i.test(x.textContent));
  return b ? { label: b.textContent, disabled: b.disabled } : null;
});

const settle = () => new Promise((r) => setTimeout(r, 900));

console.log(`\n-> ${url}\n`);
await page.goto(url, { waitUntil: 'networkidle2' });
await settle();

const locked = await publishState();
check('locked before any playtest', locked?.disabled === true, JSON.stringify(locked));
check('label says locked', /locked/i.test(locked?.label || ''), locked?.label);

// Record a solve for exactly the level the editor currently holds, the way a won playtest would.
const recorded = await page.evaluate(async (autosaveKey, solvesKey) => {
  const { hashLevel } = await import('/src/systems/SolveProof.js');
  const level = JSON.parse(localStorage.getItem(autosaveKey) || 'null');
  if (!level) return { ok: false, why: 'no autosaved level' };
  const hash = hashLevel(level);
  localStorage.setItem(solvesKey, JSON.stringify({ [hash]: { shifts: 4, runs: 1, at: Date.now() } }));
  return { ok: true, hash };
}, AUTOSAVE_KEY, SOLVES_KEY);
check('recorded a solve for the current level', recorded.ok, recorded.why);

await page.reload({ waitUntil: 'networkidle2' });
await settle();

const unlocked = await publishState();
check('unlocks after beating it', unlocked?.disabled === false, JSON.stringify(unlocked));
check('shows the par from the solve', /par\s*4/i.test(unlocked?.label || ''), unlocked?.label);

// Now edit the level. The solve was filed under the old contents, so the gate must close again.
await page.evaluate((autosaveKey) => {
  const level = JSON.parse(localStorage.getItem(autosaveKey));
  level.hazards = [...(level.hazards || []), { x: 123, y: 321, w: 40, h: 20 }];
  localStorage.setItem(autosaveKey, JSON.stringify(level));
}, AUTOSAVE_KEY);

await page.reload({ waitUntil: 'networkidle2' });
await settle();

const relocked = await publishState();
check('locks again once the level is edited', relocked?.disabled === true, JSON.stringify(relocked));

check('no page errors throughout', errors.length === 0, errors[0]);

await browser.close();
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
