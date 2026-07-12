# Gravity Ball — Game Design Document

> **Logline:** You don't move the ball. You move the *world*. Flip gravity Up, Down, Left, or Right to roll a ball through 200+ bite-sized physics puzzles.

- **Platform:** CrazyGames (HTML5, desktop + mobile web)
- **Engine:** Phaser 3 + Matter.js physics
- **Genre:** 2.5D physics puzzle
- **Session shape:** 30–90 second levels, "one more level" loop
- **Scope:** 10 chapters × 20–30 levels ≈ **200–300 levels**

---

## 1. Core Pillars

1. **Control the environment, not the character.** The single verb is *shift gravity*. The ball never moves under direct player command — this is a hard rule.
2. **Snappy, not floaty.** Gravity snaps instantly; the ball's momentum carries through the shift. Every shift, bounce, and death has juice.
3. **One idea at a time.** Each chapter introduces exactly 1–2 new mechanics, ramps from a safe tutorial to a combination finale, then hands off cleanly to the next.
4. **Readable at a glance.** A player should understand a level's threat and goal within one second, on a phone screen.

---

## 2. Title Candidates (SEO-friendly for CrazyGames)

| # | Title | Why it works |
|---|-------|--------------|
| 1 | **Gravity Ball** | Exact-match search term, clean, brandable. (Working title.) |
| 2 | **Gravity Flip** | "Flip" is the verb; high search intent, reads instantly. |
| 3 | **Gravity Maze** | Bundles the puzzle promise ("maze") with the mechanic. |
| 4 | **Fall Any Way** | Playful, memorable, hints at 4-way gravity. |
| 5 | **Roll & Reverse** | Alliterative, describes the loop, easy to say aloud. |

**Recommendation:** ship as **Gravity Ball** (this repo) — strongest exact-match SEO — and reserve *Gravity Flip* as the marketing subtitle: *"Gravity Ball — Flip. Roll. Solve."*

---

## 3. Chapter Outline (progression map)

Each chapter = a new "toy," a tutorial level that teaches it safely, and a finale that combines it with everything prior.

| Ch | Theme / Name | New mechanic(s) | Teaches the player… |
|----|--------------|-----------------|---------------------|
| **1** | **Ground Zero** | 4-way gravity shift + goal portal | The core verb. Fall in every direction. |
| **2** | **Spike Fields** | Static hazards (spikes) | Route *around* danger; a shift can save or kill you. |
| **3** | **Bounce House** | Bouncy surfaces (trampolines) **+** sticky walls | Managing momentum: build speed, then cancel it. |
| **4** | **Locksmith** | Keys & doors | Ordering / detours: grab the key *before* the exit. |
| **5** | **Fragile Ground** | Breakable/crumbling blocks **+** weight (heavy) zones | Timing & one-shot paths; heavier ball changes routes. |
| **6** | **Wormholes** | Portals that preserve momentum | Thinking in vectors: you exit going the way you entered. |
| **7** | **Chromatic** | Color switches & color-coded walls | Boolean logic: toggle which walls are solid. |
| **8** | **Time Warp** | Slow-motion zones **+** sweeping lasers | Precision timing against moving threats. |
| **9** | **Singularity** | Black holes (gravity wells) **+** local gravity-reversal zones | The world fights your gravity; plan around competing forces. |
| **10** | **Event Horizon** | Capstone: **limited gravity shifts** (move budget) | Mastery — solve remix levels with everything, using few shifts. |

**Design cadence within a chapter (≈24 levels):**
- Levels 1–3: safe introduction of the new mechanic in isolation.
- Levels 4–15: escalating variations, then combine with 1–2 earlier mechanics.
- Levels 16–22: multi-mechanic pressure.
- Levels 23–24: "boss" level — the hardest fair combination in the chapter.

---

## 4. Interesting Mechanics Library

A backlog of "toys" to keep the loop fresh. Each is designed to be *composable* with gravity shifting.

### Hazards (destroy the ball)
- **Spikes** — static, directional; only dangerous on the pointed side.
- **Lasers** — sweeping or blinking beams; add timing.
- **Black holes** — pull the ball in with an inverse-square force; a shift can escape orbit.
- **Crushers** — moving blocks that pin the ball against a wall.
- **Void / out-of-bounds** — falling off-screen in the current gravity resets the level.

### Environment interactivity
- **Trampolines** — high restitution; convert a fall into a launch.
- **Sticky walls** — the ball clings until you shift away from them.
- **Breakable blocks** — shatter after one impact or a short delay (crumbling platforms).
- **Ice** — near-zero friction; the ball keeps sliding, overshoot risk.
- **Conveyors / wind zones** — apply a constant lateral force independent of gravity.
- **One-way gates** — pass in one direction only.

### Complex logic
- **Keys & doors** — collect to open the exit or a barrier.
- **Color switches** — toggle sets of color-coded walls solid/passable.
- **Buttons & timed gates** — the ball's weight holds a plate; race the timer.
- **Portals (momentum-preserving)** — teleport while keeping speed and direction.
- **Collectible stars** — optional 3-star rating per level (retention hook).

### Physics tweaks (bend the rules)
- **Slow-motion zones** — bullet-time bubbles for precise threading.
- **Local gravity-reversal fields** — inside them, "down" is inverted regardless of your global choice.
- **Weight zones (heavy/light)** — change mass/terminal velocity; alters bounce and reach.
- **Magnet fields** — attract or repel the metal ball.
- **Gravity-lock tiles** — while touching them, gravity can't be changed (forces commitment).

---

## 5. Controls

| Context | Input | Action |
|---------|-------|--------|
| Desktop | Arrow keys **or** WASD | Set gravity Up / Down / Left / Right |
| Mobile | Swipe in a direction | Set gravity in that direction |
| Both | R / on-screen button | Restart level |

- A short **cooldown** (~120 ms) debounces double taps.
- **Momentum is preserved** across every shift — this is the skill ceiling.
- No direct ball movement, ever.

---

## 6. Game Feel (juice) checklist

Per the game-feel guardrails — every interactive state gets feedback:

- **Gravity shift:** instant force snap · screen shake (light) · camera leads into the new "down" · directional particle streak · *whoosh* SFX.
- **Bounce:** squash-and-stretch on the ball · pitch-scaled *boing*.
- **Death:** red flash · shatter particles · heavy shake · respawn with a spring pop.
- **Goal:** green flash · confetti burst · `happytime()` to the SDK · level-complete panel with spring easing and star rating.
- **Camera:** always lerped (never hard-locked), with lead in the shift direction.
- **Depth:** parallax background → playfield → foreground hazards → UI. Never a flat z-index.

---

## 7. Progression & Retention

- **Level select** with per-level star ratings (e.g., stars for fewest shifts / stars collected / time).
- **Cloud save** via the CrazyGames data module (localStorage fallback off-platform).
- **Daily challenge** — one remix level per day for return visits.
- **Chapter unlocks** gate difficulty and give a sense of milestone.
- **Rewarded ads** for hints / skip-level / extra undo — opt-in, never punishing.

---

## 8. Technical Architecture (summary)

See [`README.md`](../README.md) for the full folder map. Key principle: **decoupled systems** communicate over the scene event bus.

```
InputManager  --(gravity:request)-->  GravityController  --(gravity:changed)-->  Juice/Camera
   (raw input)                           (the mechanic)                             (feedback)
```

- **GravityController** — single source of truth for "down"; applies the Matter world gravity vector.
- **InputManager** — keyboard + swipe → abstract direction requests. Knows nothing about physics.
- **Level data** — external `levels.json`, arrayed by chapter → level. Never hardcoded.
- **CrazyGamesSDK** — defensive wrapper; identical behavior on-platform and on localhost.

---

## 9. Out of Scope (v1)

- Level editor / user-generated content.
- Multiplayer / leaderboards beyond CrazyGames-native.
- 3D rendering (the "2.5D" is parallax + lighting, not true 3D).
