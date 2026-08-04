// GameScene.js — assembles a level from data and wires the three decoupled systems:
//   InputManager (raw input) → 'gravity:request' → GravityController (mechanic)
//   GravityController → 'gravity:changed' → juice (camera lead, screen shake)
// Tracks shift count, computes a star rating on win, and persists it via SaveManager.
import Ball from '../objects/Ball.js';
import GravityController, { GravityDirection, GRAVITY_VECTORS } from '../systems/GravityController.js';
import InputManager from '../systems/InputManager.js';
import Button from '../ui/Button.js';
import { AudioManager } from '../systems/AudioManager.js';
import { Effects } from '../systems/Effects.js';
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import { VIEW, PHYSICS, FEEL } from '../config/GameConfig.js';
import { skinById, skinTextureKey, isSkinUnlocked } from '../systems/Skins.js';

const BORDER = 24; // auto border-wall thickness

// --- Physics pacing ---------------------------------------------------------------------------
// The world advances in discrete steps of SIM_STEP_MS, and we run one every STEP_INTERVAL_MS of
// real time. Because we fire 144 steps per second but each advances 1/60s of simulated time, the
// world deliberately runs ~2.4x faster than wall-clock: that is exactly the pace the game had when
// physics was tied to a 144Hz display, which is what every level and tuning constant was authored
// against. Keeping the step size at Matter's calibrated 1/60 means per-step travel — and therefore
// tunnelling risk — is unchanged from that original build.
// HUD banding: a translucent strip keeps readouts legible over whatever geometry is beneath.
const HUD_BAR_H = 44;        // top row height (sized around the 44px touch targets)
const HUD_ROW_Y = HUD_BAR_H / 2;
const HUD_ROW2_H = 20;       // extra row, only when the death-rule indicator is shown
const HUD_BAND_DEPTH = 95;   // above gameplay, below HUD text (100) and the win panel (200)
const FOG_DEPTH = 60;        // over the playfield, under every HUD layer

const SIM_STEP_MS = 1000 / 60;       // simulated time advanced per step (Matter's tuned delta)
const STEP_INTERVAL_MS = 1000 / 144; // real time consumed per step
// Most steps we'll run in one frame while catching up (~83ms of real time). Past this the game
// slows down instead of fast-forwarding, so a stalled tab can't hurl the ball through a wall.
const MAX_CATCHUP_STEPS = 12;

// Key/door colors (Ch.4). A key opens every door of the same color.
const KEY_COLORS = { gold: 0xffd23f, blue: 0x38a1ff, pink: 0xff5c8a };

// Portal pair colors (Ch.6), cycled per pair.
const PORTAL_COLORS = [0x2bd6c0, 0xff5cf0, 0xffef5c];

// Color-switch colors (Ch.7). One color is solid at a time; a switch toggles which.
const SWITCH_COLORS = { red: 0xe0574f, blue: 0x4f8fe0 };

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data = {}) {
    this._playtest = data.playtest ?? false;
    // Agent mode (AI playtester): the level comes from the procedural generator, the world is
    // stepped as fast as the frame budget allows, and all juice is suppressed.
    this._agentMode = data.agent ?? false;
    // A human playing a procedurally generated level: same level source, full juice, but kept
    // out of the save file since generated ids aren't part of the campaign.
    this._generated = this._agentMode || (data.generated ?? false);
    this._fx = !this._agentMode; // gate for particles / shake / tweens / audio
    this.levelId = data.levelId ?? this.levelId ?? '1-1';
    this.chapterId = data.chapterId ?? this.chapterId ?? 1;
    this._solved = false;
    this._dying = false;
    this._stuck = false;
    this._lastBounce = 0;
    this._lastTrampoline = 0;
    this._stickCooldownUntil = 0;
    this._keys = new Set(); // colors of keys collected
    this._heavy = false; // Ch.5 weight state
    this._portalCooldownUntil = 0; // Ch.6 anti re-trigger
    this._active = 'red'; // Ch.7 active (solid) color
    this._switchCooldownUntil = 0;
    this._accum = 0;      // physics-step carry-over, reset so a restart never fast-forwards
    this._lastTime = 0;
    this._clockMs = 0;    // gameplay clock — see now()
    this._contacts = new Set(); // ids of solid bodies the ball is resting against — see isGrounded()
    this.shiftCount = 0;
  }

  /**
   * Is the ball currently resting against something solid?
   *
   * Tracked from collision start/end rather than probed, because Matter has no cheap "is this
   * body supported" query. Sensors are excluded: a trampoline or sticky pad is contact, but it
   * is not a surface you can push off.
   *
   * The AI uses this to decide when a gravity flip is allowed — a ball in free fall flipping
   * every decision just vibrates in mid-air without going anywhere.
   */
  isGrounded() {
    return this._contacts.size > 0;
  }

  /**
   * The clock every gameplay rule reads: cooldowns, laser phases, impact debounces.
   *
   * It advances by STEP_INTERVAL_MS per physics step rather than tracking wall time, which
   * makes it identical to real elapsed milliseconds during normal play (steps are driven by
   * real time) while staying correct when the AI playtester runs the world hundreds of times
   * faster than the clock on the wall. Reading Date/time.now here instead would mean a 120ms
   * shift cooldown swallowing hundreds of simulated frames under acceleration.
   */
  now() {
    return this._clockMs;
  }

  create() {
    this.save = this.registry.get('save');
    this.levelsData = this.registry.get('levels');
    let level;
    if (this._generated) {
      level = this.registry.get('generatedLevel');
      this.chapterId = 0;
    } else if (this._playtest) {
      level = this.registry.get('playtestLevel');
      this.chapterId = 0;
      if (!level.id) level.id = 'test';
    } else {
      level = this._resolveLevel(this.levelId);
    }
    this.level = level;
    const bounds = level.bounds ?? { w: VIEW.WIDTH, h: VIEW.HEIGHT };

    // Silence the juice systems for the whole run rather than at a dozen call sites. Restored
    // on shutdown so returning to normal play brings the game feel back.
    Effects.enabled = this._fx;
    AudioManager.silent = this._agentMode;
    this.events.once('shutdown', () => { Effects.enabled = true; AudioManager.silent = false; });

    this.matter.world.setBounds(0, 0, bounds.w, bounds.h);
    this.cameras.main.setBounds(0, 0, bounds.w, bounds.h);

    this._active = level.activeColor ?? 'red';
    if (this._fx) this._buildParallax(bounds);
    this._buildStatic(level, bounds);
    this.ball = new Ball(this, level.spawn.x, level.spawn.y);
    this.cameras.main.startFollow(this.ball, true, FEEL.CAMERA_LERP, FEEL.CAMERA_LERP);

    // --- Systems ---------------------------------------------------------
    this.gravity = new GravityController(this, {
      initial: level.gravity ?? GravityDirection.DOWN,
      strength: PHYSICS.GRAVITY_STRENGTH,
      cooldown: FEEL.GRAVITY_COOLDOWN_MS,
    });
    this.inputManager = new InputManager(this);

    // Guard against duplicate handlers across scene.restart() (scene.events persists).
    this.events.off('gravity:request');
    this.events.off('gravity:changed');
    this.events.on('gravity:request', (dir) => {
      if (this._solved) return;
      // Shift budget (Ch.10): once spent, real shift requests are denied with feedback.
      const max = this.level.maxShifts;
      if (max && this.shiftCount >= max && dir !== this.gravity.direction) { this._denyShift(); return; }
      this.gravity.request(dir);
    });
    this.events.on('gravity:changed', ({ vector }) => this._onGravityShift(vector));

    this.matter.world.on('collisionstart', (event) => this._onCollision(event));
    this.matter.world.on('collisionend', (event) => this._onCollisionEnd(event));

    this._buildFog(level, bounds);
    this._buildHud(level);
    this._splitCameras();
    this.input.keyboard.on('keydown-R', () => this.scene.restart(this._playtest ? { playtest: true } : undefined));
    this.input.keyboard.on('keydown-ESC', () => this._toLevelSelect());

    if (this._agentMode) {
      // The pipeline outlives scene restarts (it lives in the registry), so it re-attaches to
      // each new scene instance and keeps driving.
      this._agentDriver = this.registry.get('aiPipeline') ?? null;
      this._agentDriver?.attach(this);
      return;
    }

    CrazyGamesSDK.gameplayStart();
  }

  // --- Level construction --------------------------------------------------
  _resolveLevel(levelId) {
    for (const c of this.levelsData.chapters) {
      const found = (c.levels ?? []).find((l) => l.id === levelId);
      if (found) { this.chapterId = c.id; return found; }
    }
    throw new Error(`Level "${levelId}" not found in levels.json`);
  }

  _buildStatic(level, bounds) {
    // Auto border walls from bounds (unless the level opts out).
    if (level.border !== false) {
      const t = BORDER;
      const { w, h } = bounds;
      [
        { x: w / 2, y: h - t / 2, w, h: t }, // floor
        { x: w / 2, y: t / 2, w, h: t },     // ceiling
        { x: t / 2, y: h / 2, w: t, h },     // left
        { x: w - t / 2, y: h / 2, w: t, h }, // right
      ].forEach((b) => this._wall(b.x, b.y, b.w, b.h));
    }

    (level.walls ?? []).forEach((wl) => this._wall(wl.x, wl.y, wl.w, wl.h));

    // Ramps: right-triangle solids the ball rolls along instead of stopping dead.
    // `dir` names the corner holding the right angle, so the slope faces the opposite way.
    (level.ramps ?? []).forEach((r) => this._ramp(r.x, r.y, r.w, r.h, r.dir ?? 'bl'));

    // Positions are kept alongside the bodies so the AI's observation can answer
    // "how far is the nearest spike" without walking the Matter world every step.
    this._hazardPts = [];
    (level.hazards ?? []).forEach((hz) => {
      const w = hz.w ?? 32;
      const h = hz.h ?? 32;
      this._hazardPts.push({ x: hz.x, y: hz.y });
      this.matter.add.rectangle(hz.x, hz.y, w, h, { isStatic: true, isSensor: true, label: 'hazard' });
      // Orient the spike sprite toward the surface it sits on (texture points up by default).
      const angle = { up: 0, right: 90, down: 180, left: 270 }[hz.dir ?? 'up'];
      this.add.image(hz.x, hz.y, 'spike').setDisplaySize(w, h).setAngle(angle).setDepth(4);
    });

    // Gravity zones (Ch.9): while inside, gravity is a fixed local direction (e.g. reversed).
    this._gravzones = (level.gravzones ?? []).map((z) => {
      const dir = z.dir ?? 'up';
      this.add.rectangle(z.x, z.y, z.w, z.h, 0x4fd0c0, 0.12).setStrokeStyle(1, 0x8affea, 0.5).setDepth(1);
      const glyph = { up: '↑', down: '↓', left: '←', right: '→' }[dir];
      for (let gy = z.y - z.h / 2 + 40; gy < z.y + z.h / 2; gy += 90) {
        for (let gx = z.x - z.w / 2 + 40; gx < z.x + z.w / 2; gx += 90) {
          this.add.text(gx, gy, glyph, { fontSize: '22px', color: '#8affea' }).setOrigin(0.5).setAlpha(0.35).setDepth(1);
        }
      }
      return { x: z.x, y: z.y, w: z.w, h: z.h, dir };
    });

    // Black holes (Ch.9): pull the ball toward the center within a radius; lethal at the core.
    this._blackholes = (level.blackholes ?? []).map((h) => {
      const radius = h.radius ?? 120;
      this.add.circle(h.x, h.y, radius, 0x120a24, 0.35).setStrokeStyle(2, 0x9a5cff, 0.35).setDepth(1);
      this.add.circle(h.x, h.y, 16, 0x1a0f34, 1).setStrokeStyle(3, 0xc79aff, 0.9).setDepth(2);
      return { x: h.x, y: h.y, radius, strength: h.strength ?? 0.5 };
    });

    // Slow-motion zones (Ch.8): cap the ball's speed while inside (lasers keep real time).
    this._slowzones = (level.slowzones ?? []).map((z) => {
      this.add.rectangle(z.x, z.y, z.w, z.h, 0x8a6bff, 0.14).setStrokeStyle(1, 0xb9a3ff, 0.5).setDepth(1);
      return { x: z.x, y: z.y, w: z.w, h: z.h };
    });

    // Lasers (Ch.8): blinking beams, lethal only while on. Overlap is checked in update().
    this._lasers = (level.lasers ?? []).map((l) => {
      const onDur = l.on ?? 700;
      const period = onDur + (l.off ?? 1800);
      const visual = this.add.rectangle(l.x, l.y, l.w, l.h, 0xff3b3b, 0.12).setStrokeStyle(1, 0xff8a8a, 0.4).setDepth(4);
      return { x: l.x, y: l.y, w: l.w, h: l.h, onDur, period, phase: l.phase ?? 0, visual, isOn: false };
    });

    // Sticky pads (Ch.3): sensors that pin the ball until the next gravity flip.
    (level.sticky ?? []).forEach((s) => {
      const body = this.matter.add.rectangle(s.x, s.y, s.w, s.h, { isStatic: true, isSensor: true, label: 'sticky' });
      body.gbAxis = s.w >= s.h ? 'x' : 'y'; // snap along the surface it lies on
      body.gbAnchor = { x: s.x, y: s.y };
      this.add.rectangle(s.x, s.y, s.w, s.h, 0x9b6dff, 0.85).setStrokeStyle(2, 0xc9a9ff).setDepth(3);
    });

    // Trampolines (Ch.3): sensors that fling the ball in a fixed direction on contact.
    (level.bouncers ?? []).forEach((b) => {
      const body = this.matter.add.rectangle(b.x, b.y, b.w, b.h, { isStatic: true, isSensor: true, label: 'bouncer' });
      body.gbDir = b.dir ?? 'up';
      body.gbPower = b.power ?? 17;
      this.add.rectangle(b.x, b.y, b.w, b.h, 0x2bd67b, 0.95).setStrokeStyle(2, 0x8affc0).setDepth(3);
    });

    // Doors (Ch.4): solid barriers that open (become passable) when the matching key is taken.
    this._doors = (level.doors ?? []).map((d) => {
      const colorKey = d.color ?? 'gold';
      const tint = KEY_COLORS[colorKey];
      const body = this.matter.add.rectangle(d.x, d.y, d.w, d.h, { isStatic: true, label: 'door' });
      body.gbColor = colorKey;
      const visual = this.add.rectangle(d.x, d.y, d.w, d.h, tint, 0.45).setStrokeStyle(2, tint).setDepth(3);
      return { body, visual, color: colorKey };
    });

    // Color blocks (Ch.7): solid when their color is active, passable (ghosted) otherwise.
    this._cblocks = (level.cblocks ?? []).map((c) => {
      const color = c.color ?? 'red';
      const body = this.matter.add.rectangle(c.x, c.y, c.w, c.h, { isStatic: true, label: 'cblock' });
      body.gbColor = color;
      const visual = this.add.rectangle(c.x, c.y, c.w, c.h, SWITCH_COLORS[color]).setDepth(3);
      const entry = { body, visual, color };
      this._applyBlockState(entry);
      return entry;
    });

    // Color switches (Ch.7): toggle which color is solid.
    (level.switches ?? []).forEach((s) => {
      this.matter.add.rectangle(s.x, s.y, 36, 36, { isStatic: true, isSensor: true, label: 'cswitch' });
      this.add.rectangle(s.x, s.y, 36, 36, 0x3a3f5c, 0.95).setStrokeStyle(2, 0xc9cde8, 0.8).setDepth(4);
      this.add.text(s.x, s.y, '⇄', { fontSize: '20px', color: '#dfe3f5' }).setOrigin(0.5).setDepth(5);
    });

    // Portals (Ch.6): linked pairs. Entering one warps the ball to the other, keeping velocity.
    (level.portals ?? []).forEach((pair, i) => {
      const color = PORTAL_COLORS[i % PORTAL_COLORS.length];
      const mk = (from) => {
        const body = this.matter.add.rectangle(from.x, from.y, 40, 40, { isStatic: true, isSensor: true, label: 'portal' });
        this.add.circle(from.x, from.y, 20, color, 0.22).setStrokeStyle(3, color).setDepth(5);
        this.add.circle(from.x, from.y, 9, color, 0.6).setDepth(5);
        return body;
      };
      const a = mk(pair.a);
      const b = mk(pair.b);
      a.gbExit = pair.b; a.gbPartner = b;
      b.gbExit = pair.a; b.gbPartner = a;
    });

    // Weight zones (Ch.5): sensors that make the ball heavy (or reset it to normal).
    (level.weights ?? []).forEach((z) => {
      const body = this.matter.add.rectangle(z.x, z.y, z.w, z.h, { isStatic: true, isSensor: true, label: 'weight' });
      body.gbKind = z.kind ?? 'heavy';
      const tint = body.gbKind === 'heavy' ? 0xd4663a : 0x6db3ff;
      this.add.rectangle(z.x, z.y, z.w, z.h, tint, 0.16).setStrokeStyle(1, tint, 0.5).setDepth(1);
    });

    // Breakable blocks (Ch.5): solid walls (orange) that a HEAVY ball smashes through.
    this._breakables = (level.breakables ?? []).map((br) => {
      const body = this.matter.add.rectangle(br.x, br.y, br.w, br.h, { isStatic: true, label: 'breakable' });
      const visual = this.add.rectangle(br.x, br.y, br.w, br.h, 0xc8763a, 0.9).setStrokeStyle(3, 0xf0a86a).setDepth(3);
      return { body, visual };
    });

    // Keys (Ch.4): collectible sensors, colored. Volatile keys are returned on death
    // (and any doors they opened re-lock), so visuals are hidden, never destroyed.
    this._keyItems = (level.keys ?? []).map((k) => {
      const colorKey = k.color ?? 'gold';
      const volatile = !!k.volatile;
      const body = this.matter.add.rectangle(k.x, k.y, 24, 26, { isStatic: true, isSensor: true, label: 'key' });
      const visual = this.add.image(k.x, k.y, 'key').setTint(KEY_COLORS[colorKey]).setDepth(6);
      if (volatile) visual.setAlpha(0.7); // reads as fragile
      if (this._fx) this.tweens.add({ targets: visual, y: k.y - 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const item = { body, visual, color: colorKey, volatile, collected: false };
      body.gbItem = item;
      return item;
    });

    // Goal sensor + a gently pulsing icon. A locked goal (`requires`) stays gray until its key is taken.
    const g = level.goal;
    this.goalRequires = g.requires ?? null;
    this.matter.add.rectangle(g.x, g.y, 40, 40, { isStatic: true, isSensor: true, label: 'goal' });
    this.goalIcon = this.add.image(g.x, g.y, 'goal').setDepth(5);
    if (this.goalRequires) this.goalIcon.setTint(0x555b7a);
    if (this._fx) this.tweens.add({ targets: this.goalIcon, scale: 1.15, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  _wall(x, y, w, h) {
    this.matter.add.rectangle(x, y, w, h, { isStatic: true, label: 'wall' });
    this.add.rectangle(x, y, w, h, 0x3a3f5c).setStrokeStyle(2, 0x4c5378);
  }

  // Right-triangle ramp. `dir` = which corner is square ('bl','br','tl','tr'); the hypotenuse
  // runs from the other two corners. Matter needs vertices relative to the body centroid, so we
  // hand it the raw corner list and let fromVertices recentre — then place it by the shape's
  // bounding-box centre so editor coordinates line up with what's drawn.
  _ramp(x, y, w, h, dir) {
    const corners = GameScene.rampCorners(w, h, dir); // origin at the rect's top-left
    const verts = corners.map((p) => ({ x: p.x, y: p.y }));
    const body = this.matter.add.fromVertices(x, y, [verts], { isStatic: true, label: 'wall' }, true);
    if (body) {
      // fromVertices centres on the centroid; nudge so the bounding box matches the editor rect.
      const bb = body.bounds;
      const cx = (bb.min.x + bb.max.x) / 2;
      const cy = (bb.min.y + bb.max.y) / 2;
      this.matter.body.setPosition(body, { x: body.position.x + (x - cx), y: body.position.y + (y - cy) });
    }

    const poly = this.add.polygon(x, y, corners.map((p) => ({ x: p.x - w / 2, y: p.y - h / 2 })), 0x3a3f5c);
    poly.setStrokeStyle(2, 0x4c5378).setDepth(3);
  }

  /** Corner list (top-left origin) for a right triangle whose square corner is `dir`. */
  static rampCorners(w, h, dir) {
    switch (dir) {
      case 'br': return [{ x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]; // slope down-left
      case 'tl': return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }]; // slope up-right
      case 'tr': return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }]; // slope up-left
      case 'bl':
      default: return [{ x: 0, y: 0 }, { x: w, y: h }, { x: 0, y: h }];   // slope down-right
    }
  }

  // Layered dot field behind the playfield; low scroll factors give parallax depth.
  _buildParallax(bounds) {
    const layers = [
      { n: 26, sf: 0.25, alpha: 0.22, r: [1, 2] },
      { n: 16, sf: 0.5, alpha: 0.32, r: [2, 3] },
    ];
    layers.forEach((L) => {
      for (let i = 0; i < L.n; i++) {
        this.add
          .circle(
            Phaser.Math.Between(-80, bounds.w + 80),
            Phaser.Math.Between(-80, bounds.h + 80),
            Phaser.Math.Between(L.r[0], L.r[1]),
            0x2a2f45,
            L.alpha
          )
          .setScrollFactor(L.sf)
          .setDepth(-10);
      }
    });
  }

  // Squash-and-stretch: snap the ball's visual proxy to a scale, then spring back to 1.
  // Targets ball.visual (never the physics body), so collisions stay exact.
  _squash(sx, sy, dur = 220) {
    if (!this.ball || !this._fx) return;
    const v = this.ball.visual;
    this.tweens.killTweensOf(v);
    v.setScale(sx, sy);
    this.tweens.add({ targets: v, scaleX: 1, scaleY: 1, duration: dur, ease: 'Back.easeOut' });
  }

  update(time, delta) {
    if (this._agentMode) return this._agentFrame();

    // --- Fixed-timestep physics -------------------------------------------------------------
    // Physics advances in whole 1/60s steps driven by REAL elapsed time, so the ball moves at the
    // same speed on a 60Hz phone, a 144Hz monitor, or a struggling low-end device. Leftover time
    // carries to the next frame; the backlog is capped so a stall (backgrounded tab, breakpoint)
    // makes the game briefly slow down rather than teleporting the ball through walls.
    // Phaser smooths the `delta` it hands us, which under-reports real time during a stall, so
    // measure the frame gap from the raw loop timestamp instead.
    const rawDelta = this._lastTime ? time - this._lastTime : (delta || STEP_INTERVAL_MS);
    this._lastTime = time;
    this._accum = Math.min((this._accum ?? 0) + rawDelta, STEP_INTERVAL_MS * MAX_CATCHUP_STEPS);
    while (this._accum >= STEP_INTERVAL_MS) {
      this._stepWorld();
      this._accum -= STEP_INTERVAL_MS;
    }

    if (this.ball) this.ball.sync();
    if (this._fogHole) this._drawFogHole();
  }

  /**
   * The AI playtester's replacement for the real-time loop: burn as many physics steps per
   * rendered frame as the budget allows, giving the agent a decision point before each one.
   * A wall-clock budget (rather than a fixed step count) keeps the page responsive on any
   * machine, and the hard step cap stops a fast machine from running away with the frame.
   */
  _agentFrame() {
    const budgetMs = this._agentBudgetMs ?? 12;
    const cap = this._agentMaxSteps ?? 4000;
    const until = performance.now() + budgetMs;
    for (let i = 0; i < cap; i++) {
      if (this._agentDriver?.tick() !== 'run') break;
      this._stepWorld();
      if ((i & 31) === 31 && performance.now() >= until) break;
    }
    if (this.ball) this.ball.sync();
    if (this._fogHole) this._drawFogHole();
  }

  /**
   * One fixed physics step plus every per-step world rule. Shared by normal play and the AI
   * loop, so an accelerated playtest exercises exactly the rules a human plays against.
   * Rules live here rather than in update() because lasers and black holes have to be
   * evaluated per step — at turbo speed, a once-per-frame check would step straight over
   * a laser's whole ON window.
   */
  _stepWorld() {
    this.matter.world.step(SIM_STEP_MS);
    this._clockMs += STEP_INTERVAL_MS;
    if (!this.ball) return;

    const now = this.now();
    const r = PHYSICS.BALL_RADIUS;

    // Lasers: toggle on/off, restyle, and kill on overlap while on.
    let anyOn = false;
    for (const L of this._lasers ?? []) {
      L.isOn = ((now + L.phase) % L.period) < L.onDur;
      if (L.isOn) anyOn = true;
      L.visual.setFillStyle(0xff3b3b, L.isOn ? 0.9 : 0.12);
      if (
        L.isOn && !this._solved && !this._dying &&
        Math.abs(this.ball.x - L.x) < L.w / 2 + r &&
        Math.abs(this.ball.y - L.y) < L.h / 2 + r
      ) {
        this._die();
      }
    }
    this._lasersActive = anyOn; // read by the verifier to time crossings

    // Gravity zones: override world gravity to a fixed local direction while the ball is inside.
    if (this._gravzones?.length) {
      const z = this._gravzones.find((g) => Math.abs(this.ball.x - g.x) < g.w / 2 && Math.abs(this.ball.y - g.y) < g.h / 2);
      const dir = z ? z.dir : this.gravity.direction;
      const gv = GRAVITY_VECTORS[dir];
      this.matter.world.setGravity(gv.x * this.gravity.strength, gv.y * this.gravity.strength);
    }

    // Black holes: pull the ball toward the core; die if it reaches the center.
    if (!this._solved && !this._dying) {
      for (const H of this._blackholes ?? []) {
        const dx = H.x - this.ball.x;
        const dy = H.y - this.ball.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < H.radius) {
          if (dist < 22) { this._die(); break; }
          const pull = H.strength;
          const v = this.ball.body.velocity;
          this.ball.setVelocity(v.x + (dx / dist) * pull, v.y + (dy / dist) * pull);
        }
      }
    }

    // Shift budget (Ch.10): if the budget is spent and the ball has settled without reaching the
    // goal, the attempt failed — auto-fail so the player is never soft-locked waiting on a dead run.
    const max = this.level.maxShifts;
    if (max && !this._solved && !this._dying && this.shiftCount >= max) {
      const v = this.ball.body.velocity;
      // Measured in milliseconds, not frames, so the grace period is the same on every device.
      this._restMs = Math.hypot(v.x, v.y) < 0.2 ? (this._restMs ?? 0) + STEP_INTERVAL_MS : 0;
      if (this._restMs > 1250) { this._restMs = 0; this._die(); }
    }

    // Slow-motion zones: cap speed while inside.
    if (!this._solved && !this._dying && this._slowzones?.length) {
      const b = this.ball;
      const inSlow = this._slowzones.some(
        (z) => Math.abs(b.x - z.x) < z.w / 2 + r && Math.abs(b.y - z.y) < z.h / 2 + r
      );
      if (inSlow) {
        const v = b.body.velocity;
        const sp = Math.hypot(v.x, v.y);
        const cap = 3.5;
        if (sp > cap) b.setVelocity((v.x / sp) * cap, (v.y / sp) * cap);
      }
    }
  }

  _buildHud(level) {
    // The playfield fills the whole canvas, so HUD text used to sit directly on top of walls and
    // pieces and became unreadable. Everything now lives in dedicated translucent bands: one row
    // across the top, one along the bottom for the hint. Bands sit above gameplay but below the
    // HUD text itself, and below the level-complete panel.
    const secondRow = !!level.resetGravityOnDeath;
    const topBarH = HUD_BAR_H + (secondRow ? HUD_ROW2_H : 0);
    this._addHud(this.add
      .rectangle(VIEW.WIDTH / 2, topBarH / 2, VIEW.WIDTH, topBarH, 0x0d1018, 0.62)
      .setScrollFactor(0).setDepth(HUD_BAND_DEPTH));

    this.hud = this._addHud(this.add
      .text(12, HUD_ROW_Y, '', { fontFamily: 'monospace', fontSize: '16px', color: '#9aa0c3' })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(100));
    this._updateHud();

    // Right-hand controls, laid out from the right edge so they never collide.
    this._addHud(new Button(this, VIEW.WIDTH - 44, HUD_ROW_Y, '‹', () => this._toLevelSelect(), {
      width: 48, height: 44, fontSize: '22px', color: 0x2a2f45, textColor: '#ffffff',
    }).setScrollFactor(0).setDepth(100));

    // Mute toggle (persists via AudioManager/localStorage). Padding enlarges the tap area.
    const mute = this._addHud(this.add
      .text(VIEW.WIDTH - 98, HUD_ROW_Y, AudioManager.muted ? '\u{1F507}' : '\u{1F50A}', { fontSize: '24px', padding: { x: 8, y: 8 } })
      .setOrigin(0.5).setScrollFactor(0).setDepth(100)
      .setInteractive({ useHandCursor: true }));
    mute.on('pointerdown', () => mute.setText(AudioManager.toggleMute() ? '\u{1F507}' : '\u{1F50A}'));

    // Zoom-to-fit, only for levels larger than the viewport (see _toggleZoom).
    this._buildZoomButton(level);

    // Ch.7: show which color is currently solid.
    if ((level.cblocks ?? []).length) {
      this._activeDot = this._addHud(this.add
        .rectangle(VIEW.WIDTH - 206, HUD_ROW_Y, 20, 20, SWITCH_COLORS[this._active])
        .setStrokeStyle(2, 0xffffff, 0.4)
        .setScrollFactor(0).setDepth(100));
    }

    // Held-keys inventory, centred between the level readout and the right-hand controls.
    this._keyHud = this._addHud(this.add.container(VIEW.WIDTH / 2, HUD_ROW_Y).setScrollFactor(0).setDepth(100));

    // Death-rule indicator gets its own row so it never sits on the playfield.
    if (secondRow) {
      this._addHud(this.add
        .text(12, HUD_BAR_H + HUD_ROW2_H / 2, '⟲ gravity resets on death', {
          fontFamily: 'monospace', fontSize: '12px', color: '#7a80a8',
        })
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(100));
    }

    if (level.hint) {
      const hintY = VIEW.HEIGHT - 16;
      this._addHud(this.add
        .rectangle(VIEW.WIDTH / 2, hintY, VIEW.WIDTH, 32, 0x0d1018, 0.62)
        .setScrollFactor(0).setDepth(HUD_BAND_DEPTH));
      this._addHud(this.add
        .text(VIEW.WIDTH / 2, hintY, level.hint, {
          fontFamily: 'monospace', fontSize: '13px', color: '#8990b8',
        })
        .setOrigin(0.5).setScrollFactor(0).setDepth(100));
    }
  }

  /**
   * Give the HUD its own camera. `setScrollFactor(0)` pins an object against scrolling but does
   * NOT exempt it from zoom, so without this the whole HUD shrank when the player zoomed out.
   * The world camera ignores HUD objects and vice versa; anything created later routes through
   * _addHud / _addWorld so the split keeps holding.
   */
  _splitCameras() {
    this.uiCam = this.cameras.add(0, 0, VIEW.WIDTH, VIEW.HEIGHT);
    this.uiCam.setName('ui');
    const hud = new Set(this._hudObjects ?? []);
    this.uiCam.ignore(this.children.list.filter((o) => !hud.has(o)));
    if (hud.size) this.cameras.main.ignore([...hud]);
    // Particle bursts are world-space and are spawned long after create().
    Effects.onCreate = (obj) => this._addWorld(obj);
  }

  /** Register an object as HUD (drawn only by the UI camera). */
  _addHud(obj) {
    (this._hudObjects ??= []).push(obj);
    this.cameras.main?.ignore(obj);
    return obj;
  }

  /** Register an object as world-space (drawn only by the main camera). */
  _addWorld(obj) {
    this.uiCam?.ignore(obj);
    return obj;
  }

  /**
   * Fog of war: a dark sheet over the level with a hole cut around the ball, so only nearby
   * geometry is visible. Driven by `fog` on the level (vision radius in pixels, 0/absent = off).
   *
   * The hole is a geometry mask with inverted alpha — cheaper and sharper than redrawing a
   * radial gradient every frame, and it keeps working when the camera zooms out.
   */
  _buildFog(level, bounds) {
    const radius = Number(level.fog) || 0;
    if (!radius || !this._fx) return;
    this._fogRadius = radius;

    this._fogHole = this.make.graphics({ x: 0, y: 0, add: false });
    const sheet = this.add
      .rectangle(bounds.w / 2, bounds.h / 2, bounds.w * 2, bounds.h * 2, 0x05070e, 0.97)
      .setDepth(FOG_DEPTH);
    const mask = this._fogHole.createGeometryMask();
    mask.invertAlpha = true; // punch the circle OUT of the sheet
    sheet.setMask(mask);
    this._fogSheet = sheet;
    this._drawFogHole();
  }

  _drawFogHole() {
    if (!this._fogHole || !this.ball) return;
    this._fogHole.clear();
    this._fogHole.fillStyle(0xffffff, 1);
    this._fogHole.fillCircle(this.ball.x, this.ball.y, this._fogRadius);
  }

  /**
   * Texture key for the ball's normal state, honouring the equipped skin. Falls back to the
   * default if the stored skin is missing or no longer unlocked, so tampered or stale save data
   * can never hand out a cosmetic that hasn't been earned.
   */
  _ballTexture() {
    const skin = skinById(this.save?.equippedSkin ?? 'classic');
    const allowed = this.save ? isSkinUnlocked(skin, this.save, this.levelsData) : false;
    const key = skinTextureKey(allowed ? skin.id : 'classic');
    return this.textures.exists(key) ? key : 'ball';
  }

  // Zoom-to-fit for levels bigger than one screen. Only built when it would do something, so
  // ordinary 800x600 levels keep an uncluttered HUD.
  _buildZoomButton(level) {
    const bounds = level.bounds ?? { w: VIEW.WIDTH, h: VIEW.HEIGHT };
    this._fitZoom = Math.min(VIEW.WIDTH / bounds.w, VIEW.HEIGHT / bounds.h);
    if (this._fitZoom >= 0.999) return; // level already fits — no button needed

    this._zoomedOut = false;
    this._zoomBtn = this._addHud(this.add
      .text(VIEW.WIDTH - 152, HUD_ROW_Y, '⤢', { fontSize: '22px', padding: { x: 10, y: 8 }, color: '#c9cde8' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(100)
      .setInteractive({ useHandCursor: true }));
    this._zoomBtn.on('pointerdown', () => this._toggleZoom());
    this.input.keyboard?.on('keydown-Z', () => this._toggleZoom());
  }

  /** Swap between following the ball at 1:1 and showing the whole level at once. */
  _toggleZoom() {
    if (!this._zoomBtn) return;
    const cam = this.cameras.main;
    this._zoomedOut = !this._zoomedOut;
    const bounds = this.level.bounds ?? { w: VIEW.WIDTH, h: VIEW.HEIGHT };

    if (this._zoomedOut) {
      cam.stopFollow();
      cam.pan(bounds.w / 2, bounds.h / 2, 260, 'Sine.easeInOut');
      cam.zoomTo(this._fitZoom, 260);
      this._zoomBtn.setText('⤡').setColor('#38e1ff');
    } else {
      cam.zoomTo(1, 260);
      cam.startFollow(this.ball, true, FEEL.CAMERA_LERP, FEEL.CAMERA_LERP);
      this._zoomBtn.setText('⤢').setColor('#c9cde8');
    }
    AudioManager.ui();
  }

  _updateHud() {
    const max = this.level.maxShifts;
    if (max) {
      const left = max - this.shiftCount;
      this.hud.setText(`Level ${this.level.id}    Shifts: ${this.shiftCount}/${max}    Par: ${this.level.par ?? '-'}`);
      this.hud.setColor(left <= 0 ? '#ff4d5e' : left === 1 ? '#ffd23f' : '#9aa0c3');
    } else {
      this.hud.setText(`Level ${this.level.id}    Shifts: ${this.shiftCount}    Par: ${this.level.par ?? '-'}`);
    }
  }

  // Out of shifts: buzz + red HUD pulse so the denial reads clearly.
  _denyShift() {
    AudioManager.deny();
    if (!this._fx) return;
    this.cameras.main.shake(80, 0.002);
    this.hud.setColor('#ff4d5e');
    this.tweens.add({ targets: this.hud, alpha: 0.3, duration: 90, yoyo: true, repeat: 1 });
  }

  // --- Feedback / juice ----------------------------------------------------
  _onGravityShift(vector) {
    this.shiftCount += 1;
    this._updateHud();
    if (this._fx) {
      this.cameras.main.shake(120, FEEL.SHIFT_SHAKE);
      this.cameras.main.setFollowOffset(-vector.x * FEEL.CAMERA_LEAD_PX, -vector.y * FEEL.CAMERA_LEAD_PX);
    }

    // Release from a sticky pad when the player flips gravity.
    if (this._stuck) {
      this._stuck = false;
      this._stickCooldownUntil = this.now() + 300;
      this.ball.setStatic(false);
    }

    AudioManager.shift();
    Effects.directional(this, this.ball.x, this.ball.y, vector);
    // Anticipation stretch: elongate the ball along the new "down" axis.
    if (vector.x !== 0) this._squash(1.25, 0.82, 260);
    else this._squash(0.82, 1.25, 260);
  }

  // --- Win / lose ----------------------------------------------------------
  _onCollision(event) {
    for (const { bodyA, bodyB } of event.pairs) {
      if (bodyA.label !== 'ball' && bodyB.label !== 'ball') continue;
      const other = bodyA.label === 'ball' ? bodyB : bodyA;
      if (!other.isSensor) this._contacts.add(other.id);
      if (other.label === 'goal') { this._reachGoal(); continue; }
      if (other.label === 'hazard') return this._die();
      if (other.label === 'bouncer') { this._onBounce(other); continue; }
      if (other.label === 'sticky') { this._onSticky(other); continue; }
      if (other.label === 'key') { this._collectKey(other); continue; }
      if (other.label === 'door') { if (!other.gbOpen) this._onWallImpact(); continue; }
      if (other.label === 'portal') { this._onPortal(other); continue; }
      if (other.label === 'cswitch') { this._toggleColor(other); continue; }
      if (other.label === 'cblock') { if (!other.isSensor) this._onWallImpact(); continue; }
      if (other.label === 'weight') { this._setHeavy(other.gbKind === 'heavy'); continue; }
      if (other.label === 'breakable') {
        if (other.gbOpen) continue;
        if (this._heavy) this._smash(other);
        else this._onWallImpact(); // solid to a normal ball
        continue;
      }
      if (other.label === 'wall') this._onWallImpact();
    }
  }

  /**
   * Drop contacts as the ball separates. A body that turns into a sensor underneath the ball
   * (a door opening, a block smashed) never fires this, so anything reading isGrounded() must
   * tolerate a briefly stale `true` — the AI pairs it with a time-based fallback for exactly
   * that reason.
   */
  _onCollisionEnd(event) {
    for (const { bodyA, bodyB } of event.pairs) {
      if (bodyA.label !== 'ball' && bodyB.label !== 'ball') continue;
      const other = bodyA.label === 'ball' ? bodyB : bodyA;
      this._contacts.delete(other.id);
    }
  }

  // Color switch (Ch.7): flip which color is solid, and restyle every color block.
  _applyBlockState(entry) {
    const solid = entry.color === this._active;
    entry.body.isSensor = !solid;
    entry.visual
      .setFillStyle(SWITCH_COLORS[entry.color], solid ? 0.85 : 0.15)
      .setStrokeStyle(solid ? 3 : 1, SWITCH_COLORS[entry.color], solid ? 1 : 0.5);
  }

  _toggleColor(sw) {
    if (this._solved || this._dying) return;
    // Per-switch cooldown: debounces one switch's repeated contacts without blocking others,
    // so several switches hit in quick succession each fire.
    if (this.now() < (sw._cooldownUntil ?? 0)) return;
    sw._cooldownUntil = this.now() + 150;
    this._active = this._active === 'red' ? 'blue' : 'red';
    this._cblocks.forEach((e) => this._applyBlockState(e));
    if (this._activeDot) this._activeDot.setFillStyle(SWITCH_COLORS[this._active]);
    AudioManager.swap();
  }

  // Portal (Ch.6): teleport to the linked portal, preserving velocity. The exit is nudged along
  // the travel direction to clear the sensor. Only the DESTINATION portal is put on a brief
  // cooldown (to stop an instant warp-back) — other pairs stay live, so warps can be chained.
  _onPortal(body) {
    if (this._solved || this._dying) return;
    if (this.now() < (body._cooldownUntil ?? 0)) return;
    const v = this.ball.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    const off = 40;
    const ox = speed > 0.1 ? (v.x / speed) * off : 0;
    const oy = speed > 0.1 ? (v.y / speed) * off : 0;
    Effects.burst(this, this.ball.x, this.ball.y, { color: 0x9a7bff, count: 8, speed: 120, lifespan: 300, scale: 0.4 });
    this.ball.setPosition(body.gbExit.x + ox, body.gbExit.y + oy);
    this.ball.setVelocity(v.x, v.y); // preserve momentum through the warp
    if (body.gbPartner) body.gbPartner._cooldownUntil = this.now() + 220;
    AudioManager.portal();
    Effects.burst(this, body.gbExit.x, body.gbExit.y, { color: 0x9a7bff, count: 10, speed: 160, lifespan: 350, scale: 0.5 });
  }

  // Weight zones (Ch.5): a heavy ball falls faster and can smash breakables.
  _setHeavy(heavy) {
    if (this._solved || this._dying || this._heavy === heavy) return;
    this._heavy = heavy;
    this.gravity.setStrengthMultiplier(heavy ? 1.4 : 1);
    const v = this.ball.visual;
    if (heavy) { v.setTexture('ball-heavy'); v.setScale(1.18); AudioManager.stick(); }
    else { v.setTexture(this._ballTexture()); v.setScale(1); }
  }

  // Smash a breakable: make it non-blocking (like an opened door) + feedback. Momentum is
  // preserved (with a floor) so a heavy ball can punch through blocks back-to-back.
  _smash(body) {
    body.isSensor = true;
    body.gbOpen = true;
    const v = this.ball.body.velocity;
    const speed = Math.hypot(v.x, v.y) || 1;
    const boost = Math.max(speed, 7);
    this.ball.setVelocity((v.x / speed) * boost, (v.y / speed) * boost);
    const b = this._breakables.find((x) => x.body === body);
    if (b) {
      Effects.burst(this, b.visual.x, b.visual.y, { color: 0xf0a86a, count: 16, speed: 220, lifespan: 500, scale: 0.7 });
      // Agent mode replays the same level hundreds of times, so a smashed block has to be
      // restorable — hide it instead of destroying the game object.
      if (this._agentMode) b.visual.setVisible(false);
      else b.visual.destroy();
    }
    AudioManager.smash();
    if (this._fx) this.cameras.main.shake(120, 0.006);
  }

  // Collect a key: remember its color, open matching doors, unlock the goal if it required it.
  _collectKey(body) {
    const item = body.gbItem;
    if (this._solved || this._dying || !item || item.collected) return;
    item.collected = true;
    this._keys.add(item.color);

    AudioManager.key();
    Effects.burst(this, body.position.x, body.position.y, { color: KEY_COLORS[item.color], count: 12, speed: 170, lifespan: 450, scale: 0.5 });
    item.visual.setVisible(false);

    this._syncDoors(true);
    this._syncGoalLock();
    this._updateKeyHud();
  }

  // Doors follow the held-key set: open (non-blocking, hidden) iff their color is held.
  // isSensor is toggled rather than mutating the world mid-step; visuals hide, never destroy,
  // so a door can re-lock when a volatile key is lost.
  _syncDoors(withEffects = false) {
    this._doors.forEach((d) => {
      const open = this._keys.has(d.color);
      if (open === !!d.body.gbOpen) return;
      d.body.gbOpen = open;
      d.body.isSensor = open;
      d.visual.setVisible(!open);
      if (open && withEffects) {
        Effects.burst(this, d.visual.x, d.visual.y, { color: KEY_COLORS[d.color], count: 10, speed: 150, lifespan: 400, scale: 0.5 });
      }
    });
  }

  _syncGoalLock() {
    if (!this.goalRequires) return;
    if (this._keys.has(this.goalRequires)) this.goalIcon.clearTint();
    else this.goalIcon.setTint(0x555b7a);
  }

  // Held-keys inventory (top center). Volatile keys pulse to signal they're lost on death.
  _updateKeyHud() {
    if (!this._keyHud) return;
    this._keyHud.removeAll(true);
    const held = (this._keyItems ?? []).filter((k) => k.collected);
    held.forEach((k, i) => {
      const icon = this.add
        .image((i - (held.length - 1) / 2) * 26, 0, 'key')
        .setTint(KEY_COLORS[k.color])
        .setScale(1.1);
      this._keyHud.add(icon);
      if (k.volatile) this.tweens.add({ targets: icon, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
    });
  }

  // Return volatile keys on death: uncollect them, recompute the held set, re-lock doors/goal.
  _dropVolatileKeys() {
    const dropped = (this._keyItems ?? []).filter((k) => k.collected && k.volatile);
    if (!dropped.length) return;
    dropped.forEach((k) => { k.collected = false; k.visual.setVisible(true); });
    this._keys = new Set(this._keyItems.filter((k) => k.collected).map((k) => k.color));
    this._syncDoors();
    this._syncGoalLock();
    this._updateKeyHud();
  }

  // Reach the goal — honored only if any required key has been collected.
  _reachGoal() {
    if (this.goalRequires && !this._keys.has(this.goalRequires)) return; // still locked
    this._win();
  }

  // Trampoline: overwrite velocity with a fixed launch perpendicular to the pad.
  _onBounce(body) {
    if (this._solved || this._dying) return;
    const now = this.now();
    if (now - this._lastTrampoline < 150) return;
    this._lastTrampoline = now;
    const dir = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[body.gbDir];
    this.ball.setVelocity(dir.x * body.gbPower, dir.y * body.gbPower);
    AudioManager.bounce(1);
    Effects.directional(this, this.ball.x, this.ball.y, dir, { color: 0x2bd67b, count: 14, speed: 260 });
    if (dir.y !== 0) this._squash(0.78, 1.28, 240);
    else this._squash(1.28, 0.78, 240);
  }

  // Sticky pad: pin the ball, snapped to the pad's anchor along its surface axis.
  _onSticky(body) {
    if (this._solved || this._dying || this._stuck) return;
    if (this.now() < this._stickCooldownUntil) return;
    this._stuck = true;
    this.ball.setVelocity(0, 0);
    this.ball.setAngularVelocity(0);
    if (body.gbAxis === 'x') this.ball.setPosition(body.gbAnchor.x, this.ball.y);
    else this.ball.setPosition(this.ball.x, body.gbAnchor.y);
    this.ball.setStatic(true);
    AudioManager.stick();
    this._squash(1.15, 0.85, 200);
  }

  // Hard landing against a wall → boing + squash + puff, gated by impact speed & a short cooldown.
  _onWallImpact() {
    if (this._solved || this._dying) return;
    const speed = this.ball.body.speed;
    if (speed < 4) return;
    const now = this.now();
    if (now - this._lastBounce < 90) return;
    this._lastBounce = now;

    const s = Phaser.Math.Clamp(speed / 12, 0.15, 0.5);
    const v = this.gravity.vector;
    if (v.x !== 0) this._squash(1 - s, 1 + s * 0.6, 200); // horizontal gravity → squash X
    else this._squash(1 + s * 0.6, 1 - s, 200);           // vertical gravity → squash Y
    AudioManager.bounce(speed / 14);
    Effects.burst(this, this.ball.x, this.ball.y, { color: 0x38e1ff, count: 6, speed: 120, lifespan: 300, scale: 0.4 });
  }

  _computeStars() {
    const par = this.level.par ?? 3;
    if (this.shiftCount <= par) return 3;
    if (this.shiftCount <= par + 2) return 2;
    return 1;
  }

  _win() {
    if (this._solved) return;
    this._solved = true;
    const stars = this._computeStars();
    // Agent runs never touch the save file or the platform SDK — they are not a player's
    // progress, and the AI would otherwise star-rate its way through the whole game.
    if (this._agentMode) return;
    if (!this._playtest && !this._generated) this.save.recordResult(this.level.id, { stars, shifts: this.shiftCount });
    CrazyGamesSDK.happytime();
    CrazyGamesSDK.gameplayStop();

    AudioManager.win();
    this.cameras.main.flash(200, 43, 214, 123);
    Effects.burst(this, this.ball.x, this.ball.y, { color: 0xffd23f, count: 24, speed: 260, lifespan: 700, scale: 0.8 });
    Effects.burst(this, this.ball.x, this.ball.y, { color: 0x2bd67b, count: 16, speed: 170, lifespan: 700, scale: 0.6 });
    // Zoom punch, then settle back.
    this.cameras.main.zoomTo(1.08, 130, 'Sine.easeInOut', true);
    this.time.delayedCall(170, () => this.cameras.main.zoomTo(1, 220));
    this._squash(1.4, 1.4, 200);

    this.time.delayedCall(260, () => this._showCompletePanel(stars));
  }

  _die() {
    if (this._solved || this._dying) return;
    this._dying = true;
    this._stuck = false;
    this._heavy = false;
    this.gravity.setStrengthMultiplier(1);
    if (this.ball.body.isStatic) this.ball.setStatic(false);
    AudioManager.death();
    Effects.burst(this, this.ball.x, this.ball.y, { color: 0xff4d5e, count: 18, speed: 220, lifespan: 500, scale: 0.7 });
    if (this._fx) {
      this.cameras.main.shake(220, 0.014);
      this.cameras.main.flash(150, 255, 77, 94);
    }

    // Snap out of the hazard immediately, hide briefly, then pop back in at spawn.
    this.ball.respawn();

    // Designer-authored death rules (set in the level editor):
    // optionally reset gravity to the level's start direction (prevents death loops where the
    // respawned ball falls straight back into a hazard), and return any volatile keys.
    if (this.level.resetGravityOnDeath) {
      this.gravity.apply(this.level.gravity ?? GravityDirection.DOWN, { silent: true });
      this.cameras.main.setFollowOffset(0, 0);
    }
    this._dropVolatileKeys();

    // Budget levels: death is a fresh attempt — restore the full shift budget.
    if (this.level.maxShifts) {
      this.shiftCount = 0;
      this._restMs = 0;
      this._updateHud();
    }

    this.ball.visual.setTexture(this._ballTexture());
    this.ball.visual.setVisible(false);
    // Agent mode ends the episode on death, so `_dying` stays set until resetForAgent() clears
    // it — a real-time delayedCall would fire thousands of simulated frames later anyway.
    if (this._agentMode) return;
    this.time.delayedCall(170, () => {
      this.ball.visual.setVisible(true);
      this._squash(0.2, 0.2, 320);
      this._dying = false;
    });
  }

  // --- AI playtester interface ---------------------------------------------
  // Everything below exists so an automated agent can observe and restart the level without
  // reaching into scene internals, and without a scene rebuild between attempts.

  /** How many keys are currently held — the AI's cue for the +200 collection reward. */
  countCollectedKeys() {
    return (this._keyItems ?? []).reduce((n, k) => n + (k.collected ? 1 : 0), 0);
  }

  /**
   * A raw snapshot of everything the agent is allowed to "see": position, velocity, gravity
   * state, and distances to the goal, the nearest spike and the nearest uncollected key.
   * Discretisation happens in AIPlaytester — this stays continuous so the encoding can change
   * without touching the scene.
   */
  getAgentObservation() {
    const b = this.ball;
    const v = b.body.velocity;
    const g = this.level.goal;
    const nearest = (pts) => {
      let best = null;
      let bestSq = Infinity;
      for (const p of pts) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const sq = dx * dx + dy * dy;
        if (sq < bestSq) { bestSq = sq; best = { dx, dy, dist: Math.sqrt(sq) }; }
      }
      return best;
    };

    const openKeys = (this._keyItems ?? []).filter((k) => !k.collected).map((k) => k.body.position);
    return {
      x: b.x,
      y: b.y,
      vx: v.x,
      vy: v.y,
      speed: Math.hypot(v.x, v.y),
      gravity: this.gravity.direction,
      goal: { x: g.x, y: g.y, dx: g.x - b.x, dy: g.y - b.y, dist: Math.hypot(g.x - b.x, g.y - b.y) },
      spike: nearest(this._hazardPts ?? []) ?? { dx: 0, dy: 0, dist: Infinity },
      key: openKeys.length ? nearest(openKeys) : null,
      keysHeld: this.countCollectedKeys(),
      keysLeft: openKeys.length,
      grounded: this.isGrounded(),
      shifts: this.shiftCount,
      stuck: this._stuck,
      solved: this._solved,
      dying: this._dying,
    };
  }

  /**
   * Return the level to its opening state for the next attempt — ball, gravity, keys, doors,
   * breakables and color blocks. Deliberately NOT scene.restart(): rebuilding several hundred
   * static bodies between every attempt would dominate the run time, and the AI plays a level
   * dozens of times. The gameplay clock keeps running rather than resetting, so cooldowns left
   * over from the previous attempt are always safely in the past.
   */
  resetForAgent() {
    this._solved = false;
    this._dying = false;
    this._stuck = false;
    this._heavy = false;
    this._restMs = 0;
    this.shiftCount = 0;
    this._keys.clear();
    // The ball is about to be teleported to spawn, so no collisionend will fire for whatever
    // it was resting on. Clearing by hand keeps isGrounded() honest across attempts.
    this._contacts.clear();

    this.gravity.setStrengthMultiplier(1);
    this.gravity.apply(this.level.gravity ?? GravityDirection.DOWN, { silent: true });

    if (this.ball.body.isStatic) this.ball.setStatic(false);
    this.ball.respawn();
    this.ball.visual.setTexture('ball').setScale(1).setVisible(true);

    (this._keyItems ?? []).forEach((k) => { k.collected = false; k.visual.setVisible(true); });
    (this._breakables ?? []).forEach((br) => {
      br.body.isSensor = false;
      br.body.gbOpen = false;
      br.visual.setVisible(true);
    });
    this._active = this.level.activeColor ?? 'red';
    (this._cblocks ?? []).forEach((e) => this._applyBlockState(e));

    this._syncDoors();
    this._syncGoalLock();
    this._updateKeyHud();
    this._updateHud();
  }

  _showCompletePanel(stars) {
    const panel = this._addHud(this.add
      .container(VIEW.WIDTH / 2, VIEW.HEIGHT / 2)
      .setScrollFactor(0)
      .setDepth(200));

    const bg = this.add.rectangle(0, 0, 380, 300, 0x1a1e30, 0.98).setStrokeStyle(3, 0x38e1ff, 0.5);
    const title = this.add
      .text(0, -110, 'LEVEL COMPLETE', {
        fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#2bd67b', fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const info = this.add
      .text(0, 22, `Shifts: ${this.shiftCount}    Par: ${this.level.par ?? '-'}`, {
        fontFamily: 'monospace', fontSize: '15px', color: '#9aa0c3',
      })
      .setOrigin(0.5);
    panel.add([bg, title, info]);

    // Star row with a staggered pop.
    for (let i = 0; i < 3; i++) {
      const star = this.add
        .text(-70 + i * 70, -40, '★', { fontSize: '52px', color: i < stars ? '#ffd23f' : '#3a3f5c' })
        .setOrigin(0.5)
        .setScale(0);
      this.tweens.add({ targets: star, scale: 1, ease: 'Back.easeOut', duration: 350, delay: 250 + i * 130 });
      panel.add(star);
    }

    // Playtest → Retry / Editor. Normal → Retry / Levels / (Next if another level exists).
    let actions;
    let goNext = null; // bound to Enter below
    if (this._playtest) {
      actions = [
        ['Retry', () => this.scene.restart({ playtest: true }), 0x2a2f45, '#ffffff'],
        ['Editor', () => { window.location.href = 'editor.html'; }, 0x38e1ff, '#0b1020'],
      ];
    } else {
      const nextId = this.save.nextLevelId(this.level.id);
      actions = [
        ['Retry', () => this.scene.restart(), 0x2a2f45, '#ffffff'],
        ['Levels', () => this._toLevelSelect(), 0x2a2f45, '#ffffff'],
      ];
      if (nextId) {
        goNext = () => this.scene.restart({ levelId: nextId });
        actions.push(['Next', goNext, 0x38e1ff, '#0b1020']);
      }
    }

    const spacing = 116;
    const startX = -((actions.length - 1) * spacing) / 2;
    actions.forEach(([label, cb, color, textColor], i) => {
      const b = new Button(this, startX + i * spacing, 100, label, cb, {
        width: 106, height: 46, fontSize: '18px', color, textColor,
      });
      panel.add(b);
    });

    // Enter advances to the next level. `once` so it can't fire twice mid-transition, and it is
    // registered with the panel (not in create) so it only ever listens while the panel is up.
    if (goNext) {
      panel.add(
        this.add
          .text(0, 136, 'press ⏎ for next level', {
            fontFamily: 'monospace', fontSize: '11px', color: '#5a6089',
          })
          .setOrigin(0.5)
      );
      this.input.keyboard?.once('keydown-ENTER', goNext);
    }

    panel.setScale(0.7).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, ease: 'Back.easeOut', duration: 380 });
  }

  _toLevelSelect() {
    CrazyGamesSDK.gameplayStop();
    if (this._playtest) { window.location.href = 'editor.html'; return; }
    this.scene.start('LevelSelectScene', { chapterId: this.chapterId });
  }
}
