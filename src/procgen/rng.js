// rng.js — a tiny seeded PRNG so every generated level is reproducible from its seed.
// Math.random() can't be seeded, and the whole content pipeline depends on being able to say
// "level 3821946 played badly" and get that exact level back.

/** mulberry32: 32-bit state, fast, good enough distribution for level layout. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random 32-bit seed, for when the caller doesn't supply one. */
export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}

/** Integer in [0, n). */
export function randInt(rand, n) {
  return Math.floor(rand() * n);
}

/** Uniform pick from an array. */
export function pick(rand, arr) {
  return arr[randInt(rand, arr.length)];
}

/** Fisher-Yates on a copy — never mutates the caller's array. */
export function shuffled(rand, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rand, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Weighted pick. `weightOf` maps an item to a non-negative weight; items weighing 0 are
 * never chosen. Returns null if every weight is 0.
 */
export function pickWeighted(rand, arr, weightOf) {
  let total = 0;
  for (const item of arr) total += Math.max(0, weightOf(item));
  if (total <= 0) return null;
  let roll = rand() * total;
  for (const item of arr) {
    roll -= Math.max(0, weightOf(item));
    if (roll <= 0) return item;
  }
  return arr[arr.length - 1];
}
