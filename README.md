# 🌀 Gravity Ball

**A 2.5D physics puzzle game where you don't move the ball — you move the world.** Flip the
direction of gravity (Up / Down / Left / Right) to roll a ball through 200+ bite-sized puzzles.
Built as an HTML5 game for [CrazyGames](https://crazygames.com), optimized for desktop and mobile web.

<p align="center">
  <em>Phaser 3 · Matter.js · Vanilla ES Modules · Zero-build local dev</em>
</p>

---

## 🎮 The Core Idea

Most platformers give you a *move* button. Gravity Ball gives you **one verb: shift gravity.**
The ball only ever responds to which way "down" currently is. Master momentum — because your
speed carries through every flip — and thread the ball past spikes, through portals, and into the goal.

| | |
|---|---|
| **Genre** | 2.5D physics puzzle |
| **Controls** | Arrow keys / WASD (desktop) · swipe (mobile) |
| **Scope** | 10 chapters × 20–30 levels (~200–300 total) |
| **Platform** | CrazyGames (HTML5, desktop + mobile web) |
| **Engine** | Phaser 3 + Matter.js |

---

## 🚀 Run it locally

No build step, no bundler — just Node for a static server (loading over `http://` is required
so ES modules and `fetch()` work; `file://` will not).

```bash
npm run dev          # → http://localhost:3000
# or:  node serve.mjs
```

Open **http://localhost:3000** and use **Arrow keys / WASD** (or swipe on a touch device) to shift gravity.

> Requires Node 18+. In dev, Phaser loads from a CDN and source runs as unbundled ES modules for an
> instant edit-refresh loop. The production build (below) vendors everything locally.

---

## 📦 Build & deploy (CrazyGames)

```bash
npm run build     # → dist/  (minified bundle + local Phaser, no external CDNs except the CG SDK)
npm run preview   # serve dist/ at http://localhost:3000 to test the exact upload
```

`build.mjs` bundles every ES module into one minified `dist/bundle.js` via **esbuild** (Phaser stays a
global from the vendored `phaser.min.js`), copies the level data, and writes a production `index.html`.
The CrazyGames SDK keeps loading from `sdk.crazygames.com` — the one external the platform requires.

**To publish:** zip the *contents* of `dist/` (so `index.html` sits at the zip root) and upload to the
[CrazyGames developer portal](https://developer.crazygames.com/). The whole build is ~1.2 MB (Phaser is
the bulk) and loads in a second. The production bundle is verified to solve all shipped levels identically
to dev (`node verify-levels.mjs http://localhost:3000 2`).

---

## 🏗️ Architecture

The project is built around **decoupled systems that communicate over Phaser's scene event bus**,
so input, the core mechanic, and feedback never reach into each other:

```
InputManager  ──(gravity:request)──►  GravityController  ──(gravity:changed)──►  Camera / Juice
  (raw input)                            (the mechanic)                            (feedback)
```

- **`GravityController`** — the single source of truth for "down." Applies the Matter world gravity
  vector; changing it snaps the force instantly while preserving every body's velocity (momentum carry-over).
- **`InputManager`** — maps keyboard + touch swipes to abstract direction requests. Contains **zero** physics code.
- **Level data is data** — `src/data/levels.json`, arrayed by chapter → level. Never hardcoded into scripts.
- **`CrazyGamesSDK`** — a defensive wrapper so the game behaves identically on-platform and on localhost (mock mode).

### 📁 Folder structure

```
gravity-ball/
├── index.html              # Dev entry point: loads Phaser + CrazyGames SDK, boots src/main.js
├── serve.mjs               # Zero-dependency static dev server (root, or dist/ via SERVE_DIR)
├── build.mjs               # esbuild production bundle → dist/ (upload-ready for CrazyGames)
├── screenshot.mjs          # Headless Canvas capture for visual QA
├── verify-levels.mjs       # Headless solvability check (plays each level's solution)
├── package.json
├── README.md
├── docs/
│   └── GDD.md              # Full Game Design Document (chapters, mechanics, feel)
├── src/
│   ├── main.js             # Phaser bootstrap + engine config
│   ├── config/
│   │   └── GameConfig.js   # Tuning constants (feel, physics, view)
│   ├── scenes/
│   │   ├── BootScene.js         # SDK init + placeholder texture generation
│   │   ├── PreloadScene.js      # Loads level data + boots the save system
│   │   ├── MenuScene.js         # Title screen (springy UI, parallax backdrop)
│   │   ├── LevelSelectScene.js  # Chapter tabs + level grid with stars/locks
│   │   └── GameScene.js         # Assembles a level, wires systems, win/lose + stars
│   ├── systems/
│   │   ├── GravityController.js   # ★ THE CORE MECHANIC
│   │   ├── InputManager.js        # Keyboard + swipe → gravity requests
│   │   ├── SaveManager.js         # Progress, star ratings, unlock logic
│   │   └── Textures.js            # Shared placeholder-shape generation
│   ├── editor/                    # Standalone level editor (editor.html)
│   │   ├── EditorScene.js         # Canvas: grid, render model, click/drag placement
│   │   ├── panel.js               # DOM control panel (tools, props, JSON, playtest)
│   │   └── model.js               # Shared level model (single source of truth)
│   ├── objects/
│   │   └── Ball.js          # Matter circle body; no self-locomotion by design
│   ├── ui/
│   │   └── Button.js        # Reusable spring-pop button (Container)
│   ├── sdk/
│   │   └── CrazyGamesSDK.js # Ads, gameplay lifecycle, cloud/local save
│   └── data/
│       └── levels.json      # Levels arrayed by chapter → level
├── editor.html             # Level editor page (linked from the main menu)
└── assets/                  # sprites / audio / fonts (placeholders until final art)
```

---

## 🕹️ Controls

| Input | Action |
|-------|--------|
| `↑` / `W` · `↓` / `S` · `←` / `A` · `→` / `D` | Shift gravity Up / Down / Left / Right |
| Swipe (touch) | Shift gravity in the swiped direction |
| `R` | Restart level |

**Mobile:** plays in **portrait or landscape** — **swipe anywhere** on the screen to shift gravity.
Swipes are captured on `window` (not just the canvas), so they register even in the space around a
portrait-fit playfield. The canvas is centered with a dynamic-viewport (`100dvh`) layout over a
full-screen background, and a loading spinner covers the initial engine download. All in the
production bundle.

---

## 🛠️ Level Editor

A standalone visual editor at **`/editor.html`** (also linked from the main menu). Build levels the
same way they're authored in `levels.json`, then play them instantly.

- **Every mechanic is placeable** — spawn, goal, walls, spikes, sticky pads, trampolines, keys,
  doors, **portals** (two clicks place a linked pair), **weight zones**, **breakable blocks**,
  **color blocks + switches**, **slow-motion zones**, **lasers** (with on/off timing),
  **gravity zones**, and **black holes** (with radius). Click for a default size or click-drag to
  draw a box; the grid snaps to 20px. A translucent **ghost** of the current piece follows the cursor.
- **Line tool** — toggle it on and drag to stamp a whole row of the selected piece (e.g. a spike floor).
- **Erase** removes the piece under the cursor — any type; erasing either end of a portal removes the pair.
- **Configure** — piece options (direction, colors, power, laser timing, black-hole radius,
  **volatile keys** that are lost on death), plus level settings: start gravity, par, hint, locked goal,
  which color-block color starts solid, and **reset gravity on death** (prevents respawn death-loops;
  the game shows a `⟲` indicator when it's on). Held keys appear in an in-game inventory HUD.
- **▶ Playtest** — hands the level to the *real game* (via `localStorage` + `?playtest=1`) so it plays
  with full physics and juice; a work-in-progress autosaves so the round-trip is lossless.
- **Export / Import** — copy or download the level as `levels.json`-shaped JSON, or paste JSON back
  in to keep editing.

The editor shares the game's textures and reuses `GameScene` for playtesting, and is bundled into the
production build (`dist/editor.html`).

---

## 🧩 Mechanics roadmap

Difficulty ramps one idea at a time. Each chapter introduces 1–2 new mechanics and ends with a combination finale.

| Ch | Theme | New mechanic |
|----|-------|--------------|
| 1 | Ground Zero | 4-way gravity shift |
| 2 | Spike Fields | Static hazards |
| 3 | Bounce House | Trampolines + sticky walls |
| 4 | Locksmith | Keys & doors |
| 5 | Fragile Ground | Breakable blocks + weight zones |
| 6 | Wormholes | Momentum-preserving portals |
| 7 | Chromatic | Color switches |
| 8 | Time Warp | Slow-mo zones + lasers |
| 9 | Singularity | Black holes + local gravity reversal |
| 10 | Event Horizon | Capstone: limited gravity shifts |

Full details, the mechanics library, and game-feel spec live in [`docs/GDD.md`](docs/GDD.md).

---

## 🛠️ Tech decisions (the "why")

- **Phaser 3 over Unity WebGL / Godot** — Phaser ships a tiny runtime and cold-loads in a second or two,
  which is exactly what CrazyGames rewards. Unity WebGL builds are multi-megabyte and struggle on mobile web;
  Phaser is pure JS with a first-class 2D physics story.
- **Matter.js over Arcade physics** — real rolling, restitution, and momentum make the "flip and carry speed"
  fantasy feel great. A fixed timestep keeps puzzle solutions reproducible.
- **Vanilla ES modules, no bundler (yet)** — keeps the repo readable and the local loop instant. A production
  bundle step is a deliberate, separate milestone.

---

## 🗺️ Roadmap

- [x] Core 4-way gravity system + input (keyboard & swipe)
- [x] Data-driven levels + runnable Chapter 1 slice
- [x] Menu + Level-select scenes with star ratings & unlock progression
- [x] Save system (CrazyGames data module, localStorage fallback)
- [x] **All 10 chapters** — Ground Zero (4) · Spike Fields · Bounce House · Locksmith · Fragile Ground ·
  Wormholes · Chromatic · Time Warp · Singularity · **Event Horizon** (20 each, 184 levels total)
- [x] Juice pass — procedural audio, particle bursts, squash-and-stretch, parallax, mute
- [x] Production build (esbuild bundle + vendored Phaser) — upload-ready `dist/` for CrazyGames
- [x] Visual level editor with playtest round-trip + JSON export/import
- [ ] Flesh out Chapter 1 to a full 20-level set
- [ ] Real art & audio pass, then CrazyGames submission

## 🧪 Tooling & QA

Every level and UI change is verified before commit — no "looks fine" guesses.

```bash
npm run shot                              # headless Canvas screenshot (visual QA)
node screenshot.mjs URL lbl --level=2-12  # jump to a level and capture it
node verify-levels.mjs URL 2              # play every Chapter-2 solution, assert each reaches the goal
```

`verify-levels.mjs` loads the real game, plays each level's embedded `solution` key-sequence with
physics-settle waits, and fails if the ball doesn't reach the goal — so an unsolvable level can't
slip in. All 184 shipped levels pass — including timing-based laser levels, where the checker
waits for a fresh laser off-window before each crossing (as a player watching the beam would).

---

## 📜 License

MIT © David Hambi
