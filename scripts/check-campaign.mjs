// check-campaign.mjs — fast, browser-free invariants over the shipped campaign.
//
// This runs ahead of the puppeteer solvability pass (see package.json "verify") because it catches
// the class of bug that is invisible at runtime: a skin that demands more stars than the campaign
// contains, a chapter gate pointing at a chapter with no levels, a level number missing from the
// middle of a chapter. Each of those silently strands a player rather than throwing.
//
// Usage:  node scripts/check-campaign.mjs
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

const levels = JSON.parse(await readFile(resolve(ROOT, 'src/data/levels.json'), 'utf8'));
const { SKINS } = await import(new URL('../src/systems/Skins.js', import.meta.url));
const { CHAPTERS } = await import(new URL('../src/procgen/chapters.js', import.meta.url));

const chapters = levels.chapters ?? [];

// 1. Chapter ids are unique, start at 1 and run consecutively; presentation fields are present.
chapters.forEach((c, i) => {
  if (c.id !== i + 1) fail(`chapter at position ${i + 1} has id ${c.id} — ids must run 1..N in order`);
  for (const field of ['name', 'short', 'mechanic']) {
    if (!c[field]) fail(`chapter ${c.id}: missing "${field}"`);
  }
  if (c.short && c.short.length > 10) fail(`chapter ${c.id}: short name "${c.short}" is too long for a tab (max 10)`);
  if (!c.levels?.length && !c.blurb) fail(`chapter ${c.id} is "coming soon" but has no blurb for its card`);
});

// 2. Level ids match their chapter, are unique campaign-wide, and are contiguous 1..N.
const seen = new Map();
for (const c of chapters) {
  const numbers = [];
  for (const lvl of c.levels ?? []) {
    const parts = String(lvl.id).split('-');
    if (parts.length !== 2 || Number(parts[0]) !== c.id || !/^[0-9]+$/.test(parts[1])) {
      fail(`level "${lvl.id}" is not a valid id for chapter ${c.id}`);
      continue;
    }
    if (seen.has(lvl.id)) fail(`duplicate level id "${lvl.id}" (also in chapter ${seen.get(lvl.id)})`);
    seen.set(lvl.id, c.id);
    numbers.push(Number(parts[1]));

    // 3. Every level needs the fields GameScene reads unconditionally.
    for (const field of ['spawn', 'goal', 'par', 'gravity']) {
      if (lvl[field] == null) fail(`level ${lvl.id}: missing "${field}"`);
    }

    // 4. A door the player can never open is an unwinnable level.
    const keyColors = new Set((lvl.keys ?? []).map((k) => k.color ?? 'gold'));
    for (const door of lvl.doors ?? []) {
      const color = door.color ?? 'gold';
      if (!keyColors.has(color)) fail(`level ${lvl.id}: a ${color} door has no ${color} key`);
    }
    if (lvl.goal?.requires && !keyColors.has(lvl.goal.requires)) {
      fail(`level ${lvl.id}: the goal requires a ${lvl.goal.requires} key that the level does not contain`);
    }
  }
  numbers.sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1) fail(`chapter ${c.id}: level numbers are not contiguous (found ${n} where ${i + 1} was expected)`);
  });
}

const builtLevels = [...seen.keys()].length;
const maxStars = builtLevels * 3;

// 5. No star gate may exceed what the campaign can actually yield. This is the check that would
//    have caught the 160-star skin surviving into an 84-star campaign.
for (const skin of SKINS) {
  if (skin.req?.type === 'stars' && skin.req.n > maxStars) {
    fail(`skin "${skin.id}" needs ${skin.req.n} stars but the campaign only contains ${maxStars}`);
  }
  // 6. A chapter gate must name a chapter that exists AND has levels — an empty chapter can never
  //    be cleared, so gating on one locks the skin forever.
  if (skin.req?.type === 'chapter') {
    const ch = chapters.find((c) => c.id === skin.req.id);
    if (!ch) fail(`skin "${skin.id}" is gated on chapter ${skin.req.id}, which does not exist`);
    else if (!ch.levels?.length) fail(`skin "${skin.id}" is gated on chapter ${skin.req.id} ("${ch.name}"), which has no levels`);
  }
  if (skin.req?.type === 'level' && !seen.has(skin.req.id)) {
    fail(`skin "${skin.id}" is gated on level "${skin.req.id}", which is not in the campaign`);
  }
}

// 7. The generator's chapter table has to agree with the shipped one, or chapter-gated generation
//    will allow mechanics the player has not met.
if (CHAPTERS.length !== chapters.length) {
  fail(`src/procgen/chapters.js declares ${CHAPTERS.length} chapters, levels.json has ${chapters.length}`);
}
for (const gen of CHAPTERS) {
  const shipped = chapters.find((c) => c.id === gen.id);
  if (!shipped) fail(`src/procgen/chapters.js declares chapter ${gen.id}, which is not in levels.json`);
  else if (shipped.name !== gen.name) {
    fail(`chapter ${gen.id} name mismatch — levels.json "${shipped.name}" vs chapters.js "${gen.name}"`);
  }
}

// 8. Solvability coverage. Reported, not enforced: hand-authoring a solution for every level is
//    real work, and blocking the build on it would just get the check disabled.
const noSolution = [...seen.keys()].filter((id) => {
  const lvl = chapters.flatMap((c) => c.levels ?? []).find((l) => l.id === id);
  return !Array.isArray(lvl?.solution);
});
if (noSolution.length) {
  notes.push(`${noSolution.length}/${builtLevels} levels have no recorded "solution" and are skipped by the`
    + ` solvability gate: ${noSolution.join(', ')}`);
}

for (const n of notes) console.warn(`  note  ${n}`);
if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error(`\n${problems.length} campaign invariant(s) violated.\n`);
  process.exit(1);
}
console.log(`\n  campaign OK — ${chapters.length} chapters, ${builtLevels} levels, ${maxStars} stars, `
  + `${SKINS.length} skins all reachable.\n`);
