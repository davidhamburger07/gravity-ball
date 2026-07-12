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

> Requires Node 18+. Phaser and the CrazyGames SDK load from a CDN in `index.html`, so an internet
> connection is needed on first load. For a production/CrazyGames upload, bundle these locally (see *Roadmap*).

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
├── index.html              # Entry point: loads Phaser + CrazyGames SDK, boots src/main.js
├── serve.mjs               # Zero-dependency static dev server (localhost:3000)
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
│   │   └── SaveManager.js         # Progress, star ratings, unlock logic
│   ├── objects/
│   │   └── Ball.js          # Matter circle body; no self-locomotion by design
│   ├── ui/
│   │   └── Button.js        # Reusable spring-pop button (Container)
│   ├── sdk/
│   │   └── CrazyGamesSDK.js # Ads, gameplay lifecycle, cloud/local save
│   └── data/
│       └── levels.json      # Levels arrayed by chapter → level
└── assets/                  # sprites / audio / fonts (placeholders until final art)
```

---

## 🕹️ Controls

| Input | Action |
|-------|--------|
| `↑` / `W` · `↓` / `S` · `←` / `A` · `→` / `D` | Shift gravity Up / Down / Left / Right |
| Swipe (touch) | Shift gravity in the swiped direction |
| `R` | Restart level |

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
- [x] Chapter 1 — Ground Zero (4 levels) & Chapter 2 — Spike Fields (20 levels)
- [x] Juice pass — procedural audio, particle bursts, squash-and-stretch, parallax, mute
- [ ] Chapters 3–10 mechanics + full level set
- [ ] Production bundle (local Phaser/SDK) for CrazyGames upload

## 🧪 Tooling & QA

Every level and UI change is verified before commit — no "looks fine" guesses.

```bash
npm run shot                              # headless Canvas screenshot (visual QA)
node screenshot.mjs URL lbl --level=2-12  # jump to a level and capture it
node verify-levels.mjs URL 2              # play every Chapter-2 solution, assert each reaches the goal
```

`verify-levels.mjs` loads the real game, plays each level's embedded `solution` key-sequence with
physics-settle waits, and fails if the ball doesn't reach the goal — so an unsolvable level can't
slip in. All 24 shipped levels pass.

---

## 📜 License

MIT © David Hambi
