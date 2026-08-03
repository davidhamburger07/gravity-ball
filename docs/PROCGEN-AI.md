# Procedural generation + AI playtesting

An automated content pipeline: generate a level from hand-authored room chunks, let a
Q-learning agent play it at accelerated speed, and keep only the levels that fought back.

## The studio (no terminal needed)

```
node serve.mjs        →  open http://localhost:3000/ai.html
```

Pick a chapter, press **Generate & playtest**, watch it run. Every kept level gets three
buttons: **Play** it yourself, **Save** it to `generated/`, or **Add** it straight into a
chapter of `src/data/levels.json`. Adding renames the level to the next free id (`6-17`),
strips generator bookkeeping, and backs the file up to `levels.json.bak` first.

The headless driver is still there if you want batches in CI:

```
npm run ai -- --levels=25 --chapter=6
```

---

## Chapters

The campaign is cumulative — each chapter introduces one object and keeps everything before
it. [`chapters.js`](../src/procgen/chapters.js) encodes that, verified against what each
shipped chapter actually places:

| Ch | Name | Introduces |
|---|---|---|
| 1 | Ground Zero | — (walls and ramps) |
| 2 | Spike Fields | spike |
| 3 | Bounce House | bouncer, sticky |
| 4 | Locksmith | key (+ doors) |
| 5 | Fragile Ground | weight, breakable |
| 6 | Wormholes | portal |
| 7 | Chromatic | cblock (+ switches) |
| 8 | Time Warp | laser, slowzone |
| 9 | Singularity | gravzone, blackhole |
| 10 | Event Horizon | — (mixer, under a shift budget) |

Every chunk declares a `uses` list, and generating for chapter N filters the room pool to
mechanics chapters 1..N have taught — so a chapter-3 level can never contain a portal. The
generator also *biases toward* rooms featuring the chapter's new object (weight ×6), and
rejects any layout that fails to include one, because a chapter-6 level with no portal in it
has failed at its job.

### The teaching ladder

Gating controls *what* a chapter may use; the ladder controls the order things arrive within
it. Generating a chapter run assigns level i of n a `progress` of i/(n-1), which resolves to
a band:

| Band | Mechanics | Rooms | Par |
|---|---|---|---|
| tutorial | the new object + spikes, nothing else | 2-3 | 3 |
| practice | adds exactly **one** other taught mechanic | 3 | 5 |
| challenge | the full unlocked set | 3-4 | 7 |

So a chapter-6 run opens with portals alone against a plain backdrop and only combines them
with trampolines and breakables by the last level. The band owns level shape, overriding
`minRooms` / `maxRooms` / `difficultyBias`. Pass `ladder: false` for a flat batch.

`validateChunks()` cross-checks `uses` against the characters a room actually draws, in both
directions — so you cannot leak an untaught object into an early chapter by forgetting a tag,
or lock a room out of chapters for a mechanic it does not really use.

---

## Part 1 — The level generator

### Designing rooms

Everything you author lives in [`src/procgen/chunks.js`](../src/procgen/chunks.js). A chunk is
one room drawn as a 15×20 character grid — at 40px per cell that is exactly one 800×600
screen, the same size as a hand-made level.

```js
{
  name: 'spike-hall',
  role: 'any',                    // 'entry' (holds S) | 'exit' (holds G) | 'any'
  connects: ['left', 'right'],    // edges the generator may open
  difficulty: 2,                  // weighting hint only — the AI measures the real thing
  grid: [
    '####################',
    '#..vvv.......vvv...#',
    ...
  ],
}
```

Adding a room is adding one entry to the `CHUNKS` array. `validateChunks()` runs at import
time and throws with the offending chunk and row if a grid is malformed, so a miscounted row
fails the moment the page loads rather than producing a subtly broken level.

The full legend is at the top of `chunks.js`. Two authoring rules matter more than the rest,
because breaking either produces a level that *looks* fine and is quietly unplayable:

**Doorways hug the floor and the left wall** — rows 11-13 for left/right, cols 1-3 for
top/bottom. The ball is always pinned to whichever surface gravity points at, so it only ever
travels *along* a wall. A doorway in the middle of a wall can only be hit by a lucky mid-air
trajectory; a doorway at floor level means a ball rolling east simply rolls into the next room.

**Furniture goes on the row the ball occupies, not the row it touches.** A ball resting on the
floor sits in row 13; pinned to the ceiling it sits in row 1. A goal drawn on row 12 floats
about 8px above a ball rolling past it and can never be collected. A spike hung on row 2 sits
just under a ceiling-riding ball and never bites.

### Stitching

[`LevelGenerator.js`](../src/procgen/LevelGenerator.js) walks a self-avoiding random path
across a `cols × rows` grid of room slots, picks a chunk per step whose `connects` covers the
sides that step needs, blits them into one big character grid, carves the doorways, and
compiles the result.

Wandering (rather than marching east) is what makes the silhouette unpredictable; off-path
slots are filled with solid rock so the level reads as carved out of a block.

Carving also strips hazards for `DOOR_APRON` cells inside each doorway. Without that, a room
whose spike bed starts near its edge kills the ball the instant it arrives, before it has been
shown anything to react to.

Walls are merged into the fewest rectangles possible (greedy decomposition) — Matter is far
happier with ~20 large static bodies than with 4000 tiles, and the saved JSON stays readable.

The output is an ordinary levels.json-shaped object. GameScene loads it with no special
casing, the editor can open it, and it can be pasted straight into `src/data/levels.json`.

```js
GravityBallAI.preview(12345)      // ASCII dump of a layout, no physics
GravityBallAI.playSeed(12345)     // play one yourself
```

---

## Part 2 — The AI playtester

[`QLearningAgent.js`](../src/ai/QLearningAgent.js) is plain tabular Q-learning — no engine
knowledge, just `(state key) → action` and `(s, a, r, s') → update`. Everything game-specific
is in [`AIPlaytester.js`](../src/ai/AIPlaytester.js).

**State.** Discretised from a live `GameScene.getAgentObservation()`: ball X/Y bucketed onto a
32px grid (one ball-width), per-axis velocity (5 signed buckets each — direction *and*
magnitude, so a resting ball is distinguishable from a slow drift), gravity direction, whether
the ball is touching a surface, bucketed distance to the current target and to the nearest
spike, and keys held.

The target is the nearest uncollected key while any remain, and the goal only once they are all
held — a locked level is two problems in sequence, and rewarding goal-proximity throughout
makes the agent hug a door it cannot open.

**Action.** The agent emits the same `'gravity:request'` event an arrow key produces, so it is
subject to every rule a player is — shift cooldown, shift budgets, sticky-pad release. There is
no privileged path into the physics. A decision is made every 20 physics steps (~139ms, just
past the 120ms shift cooldown), and a flip is only offered when the ball is grounded or the
flip cooldown has elapsed (see the tuning section).

Three action sets, via `--action-set`:

| Set | Actions | Notes |
|---|---|---|
| `quad` | do nothing / set each direction | **Default.** What a human with arrow keys has. |
| `binary` | do nothing / **FLIP** | The literal 180° flip. Only ever reaches two of the four directions. |
| `cycle` | do nothing / **FLIP** | One button; gravity advances down→left→up→right, so every direction is still reachable. |

**Reward.** Exactly as specified — goal `+1000`, death `-500`, key `+200`, `-1` per frame — and
that is what gets reported. See the caveat below.

### Two things worth knowing about the reward system

**The strict point system has a perverse optimum.** At −1/frame, dying at step 150 scores −650
while surviving to a 3000-step timeout scores −3000. An agent that has not yet found the goal
therefore learns to kill itself as fast as possible, and every level comes back "unsolved". I
measured this: with sparse rewards the agent's own logs converge on shorter and shorter deaths.

The fix is a distance-to-goal shaping term (`shaping: 0.4`) that feeds **only** the Q update —
the reported score stays on the specified scale. Moving toward the goal is then worth more than
the clock it costs. Set `--shaping=0` to see the raw behaviour.

**Terminal transitions carry no shaping term.** The textbook potential-based form subtracts the
final state's potential, which here means paying out `+distance × shaping` for dying far from
the goal — precisely the wrong lesson. Timeouts are truncations rather than endings, so their
dangling transition is dropped instead of being taught a value of 0.

Exploration also stays broad (ε 0.5 → 0.1) rather than annealing to near-greedy. An agent that
anneals early locks onto whatever it found first, and "attempts to win" stops measuring the
level and starts measuring how fast the agent gave up.

---

## Part 3 — The automation loop

[`ContentPipeline.js`](../src/ai/ContentPipeline.js):

```
generate → AI plays it → count attempts to first win
  → won first try   → discard (too easy)
  → took >= keepMin → KEEP, written to generated/<id>.json
  → never won       → parked in generated/unsolved/ for a human look
```

Each level gets a **fresh Q-table** by default, so "attempts" measures that level rather than
what the agent already learned elsewhere (`--shared-brain` to change this).

**Acceleration** comes from GameScene's fixed-timestep loop. In agent mode `_agentFrame()`
burns as many physics steps per rendered frame as a 12ms wall-clock budget allows, and juice
(particles, shake, tweens, audio, parallax) is suppressed. Roughly 50,000 steps/sec — about
350× real time — so a 12-level run with 120 attempts each finishes in about four seconds.

Between attempts the pipeline calls `GameScene.resetForAgent()` rather than restarting the
scene: rebuilding several hundred static bodies between every one of ~1400 attempts would
dominate the run.

### The simulated clock

Every gameplay rule now reads `GameScene.now()` instead of `this.time.now`. It advances by
`STEP_INTERVAL_MS` per physics step, which makes it identical to real elapsed milliseconds
during normal play (steps are driven by real time) while staying correct under acceleration.
Reading wall time here would mean a 120ms shift cooldown swallowing hundreds of simulated
frames, and lasers blinking hundreds of times per simulated second.

All 136 hand-authored levels in chapters 2-10 still pass `npm run verify` after this change.

---

## Tuning the agent

Every default below was measured, not guessed. Reproduce any row with the flags in the
reference table; the metric is levels solved out of 24 on one seed, chapter 2.

**Flip gating** — a flip is offered only when the ball is on a surface, or after
`flipCooldownMs`. Ungated, the agent flips on nearly every airborne decision and each flip
cancels the momentum the last one built, so it hovers instead of travelling.

| `--flip-cooldown` | solved |
|---|---|
| 0 (ungated) | 11 |
| 150ms | 14 |
| **250ms (default)** | **14** |
| 500ms | 10 |

500ms withheld 66% of all decisions. In a game where the ball is airborne most of the time,
redirecting mid-flight is the mechanic, not vibration — the gate has to stop oscillation
without removing air control.

**State grid** — position was always bucketed rather than tracked as raw pixel floats. At
`--pos-cell` 32 vs 60 the solve counts are identical (16 each, 24 levels); 32 is one
ball-width, so it is the more meaningful unit, not the faster one.

**Exploration** — slower annealing helps; a pure-random warmup helps only if it is not
competing with learning for the same episode budget.

| config | 120 episodes | 200 episodes |
|---|---|---|
| no warmup | 17 | 16 |
| 25-episode warmup | 12 | 17 |

Hence `maxEpisodes: 200` alongside `explorationWarmup: 25`.

**Net effect** across three seed/chapter combinations, 72 levels: 38 solved before these
changes, 43 after. Single seeds vary by ±3, so treat any one row as indicative rather than
precise — the flip gate is the change carrying most of the difference.

## Calibration

The agent is a difficulty oracle, so it defaults to `quad` — the action set a real player has.
A handicapped agent measures the handicap, not the level. Identical seeds, 16 levels each:

| Level size | `cycle` (one button) | `quad` (four directions) |
|---|---|---|
| 2 rooms | 5 kept | 15 kept |
| 3-4 rooms (default) | 0 kept | 7 kept |
| 5-6 rooms | 0 kept | — |

Pass `--action-set=cycle` for the literal one-button brief, but expect most levels to come
back "unsolved", which tells you little about the level itself.

The agent's reach runs out past about four rooms — it never leaves the opening rooms within
`maxEpisodes`, so every level reads as impossible and the run stops discriminating. Raise
`--cols`/`--rows` and `--max-episodes` together if you want sprawling levels.

`closestApproach` in the report is the field to read when a level comes back unsolved: ~50px
means the agent nearly had it, ~1500px means it barely left the first room — that is usually a
layout problem rather than a hard level.

## Reference

```
npm run ai -- --levels=25 --keep-min=4 --action-set=quad
npm run ai -- --seed=2024 --cols=4 --rows=2 --headful
```

| Flag | Default | |
|---|---|---|
| `--levels` | 10 | levels generated and tested |
| `--seed` | random | master seed; reproduces a whole run |
| `--keep-min` | 3 | attempts required before a level is kept |
| `--cols` / `--rows` | 2 / 2 | room-slot grid (3-4 rooms) |
| `--max-episodes` | 200 | attempts before giving up on a level |
| `--max-steps` | 3000 | physics steps per attempt |
| `--action-set` | quad | `quad` / `cycle` / `binary` |
| `--shaping-step` | 10 | points per grid cell of progress; 0 = raw sparse rewards |
| `--pos-cell` | 32 | px per position bucket in the state |
| `--flip-cooldown` | 250 | ms before an airborne flip is allowed; 0 = ungated |
| `--warmup` | 25 | episodes of pure random play before the Q-table is trusted |
| `--chapter` | none | build for a campaign chapter (1-10), with the teaching ladder |
| `--out` | `generated` | output directory |
| `--headful` | off | show the browser |

In the browser, `?ai=1` starts a run on load (`?ai=1&levels=20&actionSet=quad&seed=7`), with a
progress overlay. `window.GravityBallAI` exposes `run()`, `report`, `playSeed()`, `preview()`.
