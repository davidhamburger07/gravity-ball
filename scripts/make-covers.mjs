// make-covers.mjs — render the CrazyGames cover images at the exact sizes the portal asks for.
//
//   npm run covers
//
// The art is composed from the game's own shapes and palette (ball #38e1ff with its offset
// highlight, #ff4d5e spikes, the #2bd67b goal ring, #3a3f5c walls) so the thumbnail looks like the
// thing it links to. The one idea it has to land at thumbnail size is the hook: the ball falls,
// gravity flips, and it turns a hard corner. That is the L-shaped trail.
//
// Rendered through a headless browser rather than drawn by hand so the three sizes stay in sync —
// change the scene once and all three re-cut.
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = resolve(ROOT, 'builds/covers');

const C = {
  bg0: '#171d31',
  bg1: '#0b0e18',
  ball: '#38e1ff',
  spike: '#ff4d5e',
  goal: '#2bd67b',
  wall: '#3a3f5c',
  wallEdge: '#4c5378',
  text: '#ffffff',
  muted: '#9aa0c3',
};

/**
 * The scene: a ball dropping, flipping, and running along a spiked floor toward the goal.
 * Drawn in a 1000x600 viewBox and letterboxed per format, so it reads the same in all three.
 */
function scene({ w, h, scale = 1, shiftY = 0, top = 0, pad = 0 }) {
  return `
  <svg class="scene" viewBox="0 ${top} 1000 ${600 + pad - top}" preserveAspectRatio="xMidYMid slice"
       style="width:${w}px;height:${h}px;transform:translateY(${shiftY}px) scale(${scale});">
    <defs>
      <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="18" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
        <linearGradient id="trail" x1="0" y1="0" x2="0.55" y2="1">
        <stop offset="0%" stop-color="${C.ball}" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="${C.ball}" stop-opacity="0.95"/>
      </linearGradient>
      <radialGradient id="vig" cx="50%" cy="38%" r="78%">
        <stop offset="0%" stop-color="${C.bg0}"/>
        <stop offset="100%" stop-color="${C.bg1}"/>
      </radialGradient>
    </defs>

    <!-- No background here: the page gradient shows through, so there is no seam. -->

    ${Array.from({ length: 26 }, (_, i) => {
      const x = (i * 137 + 40) % 990;
      const y = (i * 91 + 25) % 560;
      const r = 1.5 + ((i * 7) % 3);
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="#2a2f45" opacity="0.5"/>`;
    }).join('')}

    <!-- Everything sits in the lower two thirds so the title has clean space above it in 16:9. -->

    <!-- Ceiling, broken by the gap the ball fell through. Its spikes are the threat, and they hang
         clear of the ball's path so nothing ever looks like it is touching one — in this game that
         would read as death. -->
    <rect x="90" y="286" width="250" height="24" rx="4" fill="${C.wall}" stroke="${C.wallEdge}" stroke-width="3"/>
    <rect x="440" y="286" width="470" height="24" rx="4" fill="${C.wall}" stroke="${C.wallEdge}" stroke-width="3"/>
    ${Array.from({ length: 5 }, (_, i) => {
      const x = 470 + i * 86;
      return `<polygon points="${x},310 ${x + 26},362 ${x + 52},310" fill="${C.spike}"/>`;
    }).join('')}

    <!-- Floor. -->
    <rect x="90" y="516" width="820" height="26" rx="4" fill="${C.wall}" stroke="${C.wallEdge}" stroke-width="3"/>
    ${Array.from({ length: 2 }, (_, i) => {
      const x = 130 + i * 74;
      return `<polygon points="${x},516 ${x + 26},464 ${x + 52},516" fill="${C.spike}"/>`;
    }).join('')}

    <!-- The hook, in one shape: it fell through the gap, gravity flipped, and it now runs right. -->
    <path d="M 388 ${top + 40} L 388 400 Q 388 448 436 448 L 470 448"
          fill="none" stroke="url(#trail)" stroke-width="15"
          stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>

    <!-- Goal, in a clear stretch of floor. -->
    <g transform="translate(742 470)">
      <circle r="36" fill="${C.goal}" opacity="0.22"/>
      <circle r="36" fill="none" stroke="${C.goal}" stroke-width="9"/>
    </g>

    <!-- The ball, resting on the floor, with the game's own offset highlight. -->
    <g transform="translate(436 470)" filter="url(#glow)">
      <circle r="46" fill="${C.ball}"/>
      <circle cx="-14" cy="-14" r="13" fill="#ffffff" opacity="0.6"/>
    </g>

    ${[532, 578, 624].map((x, i) =>
      `<path d="M ${x} 452 L ${x + 20} 470 L ${x} 488" fill="none" stroke="${C.ball}"
             stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
             opacity="${0.8 - i * 0.18}"/>`).join('')}
  </svg>`;
}

function page({ w, h, layout }) {
  const title = `<div class="title">GRAVITY<span class="brk"> </span>BALL</div>`;
  const tag = `<div class="tag">Flip. Roll. Solve.</div>`;

  const layouts = {
    // 16:9 — the scene fills the frame, the words sit over the quiet top-left.
    landscape: `
      <div class="wrap">
        ${scene({ w, h: h * 1.02, scale: 1.02, pad: 26 })}
        <div class="copy landscape">${title}${tag}</div>
      </div>`,
    // 2:3 — a tall stack: words on top, scene beneath, so nothing is cropped.
    portrait: `
      <div class="wrap stack">
        <div class="copy portrait">${title}${tag}</div>
        <div class="sceneBox">${scene({ w, h: h * 0.56, top: -190, pad: 70 })}</div>
      </div>`,
    // 1:1 — the tightest crop, so the scene is pushed down and the words get the top third.
    square: `
      <div class="wrap stack">
        <div class="copy square">${title}${tag}</div>
        <div class="sceneBox">${scene({ w, h: h * 0.66, top: -90, pad: 80 })}</div>
      </div>`,
  };

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: ${C.bg1};
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
    .wrap { position: relative; width: ${w}px; height: ${h}px; overflow: hidden;
      background: radial-gradient(120% 90% at 50% 35%, ${C.bg0} 0%, ${C.bg1} 72%); }
    .wrap.stack { display: flex; flex-direction: column; }
    .scene { position: absolute; inset: 0; }
    .wrap.stack .scene { position: relative; height: 100% !important; }
    .sceneBox { position: relative; flex: 1; overflow: hidden; display: flex; align-items: stretch; }
    .copy { position: relative; z-index: 2; }
    .title { font-weight: 900; color: ${C.ball}; letter-spacing: -0.02em; line-height: 0.92;
      text-shadow: 0 0 ${Math.round(w * 0.03)}px rgba(56,225,255,0.45); }
    .tag { color: ${C.text}; opacity: 0.9; font-weight: 600; }

    /* 16:9 — words over the top-left, clear of the ball and the goal. */
    .copy.landscape { position: absolute; left: ${w * 0.06}px; top: ${h * 0.13}px; }
    .copy.landscape .title { font-size: ${w * 0.098}px; }
    .copy.landscape .tag { font-size: ${w * 0.026}px; margin-top: ${h * 0.03}px; letter-spacing: 0.18em; }

    /* 2:3 — centred stack. The title breaks onto two lines at this width. */
    .copy.portrait { text-align: center; padding: ${h * 0.07}px ${w * 0.06}px 0; }
    .copy.portrait .title { font-size: ${w * 0.155}px; }
    .copy.portrait .title .brk { display: block; height: 0; }
    .copy.portrait .tag { font-size: ${w * 0.05}px; margin-top: ${h * 0.022}px; letter-spacing: 0.14em; }

    /* 1:1 — same idea, tighter. */
    .copy.square { text-align: center; padding: ${h * 0.09}px ${w * 0.06}px 0; }
    .copy.square .title { font-size: ${w * 0.145}px; }
    .copy.square .title .brk { display: block; height: 0; }
    .copy.square .tag { font-size: ${w * 0.046}px; margin-top: ${h * 0.02}px; letter-spacing: 0.14em; }
  </style></head><body>${layouts[layout]}</body></html>`;
}

const FORMATS = [
  { name: 'cover-landscape-1920x1080', w: 1920, h: 1080, layout: 'landscape' },
  { name: 'cover-portrait-800x1200', w: 800, h: 1200, layout: 'portrait' },
  { name: 'cover-square-800x800', w: 800, h: 800, layout: 'square' },
];

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

for (const f of FORMATS) {
  const p = await browser.newPage();
  await p.setViewport({ width: f.w, height: f.h, deviceScaleFactor: 1 });
  await p.setContent(page(f), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  const file = resolve(OUT, `${f.name}.png`);
  await p.screenshot({ path: file, clip: { x: 0, y: 0, width: f.w, height: f.h } });
  console.log(`  ${f.w}x${f.h}  ${file}`);
  await p.close();
}

await browser.close();
console.log(`\n  ${FORMATS.length} covers written to builds/covers/\n`);
