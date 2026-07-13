// GameScene.js — assembles a level from data and wires the three decoupled systems:
//   InputManager (raw input) → 'gravity:request' → GravityController (mechanic)
//   GravityController → 'gravity:changed' → juice (camera lead, screen shake)
// Tracks shift count, computes a star rating on win, and persists it via SaveManager.
import Ball from '../objects/Ball.js';
import GravityController, { GravityDirection } from '../systems/GravityController.js';
import InputManager from '../systems/InputManager.js';
import Button from '../ui/Button.js';
import { AudioManager } from '../systems/AudioManager.js';
import { Effects } from '../systems/Effects.js';
import { CrazyGamesSDK } from '../sdk/CrazyGamesSDK.js';
import { VIEW, PHYSICS, FEEL } from '../config/GameConfig.js';

const BORDER = 24; // auto border-wall thickness

// Key/door colors (Ch.4). A key opens every door of the same color.
const KEY_COLORS = { gold: 0xffd23f, blue: 0x38a1ff, pink: 0xff5c8a };

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data = {}) {
    this._playtest = data.playtest ?? false;
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
    this.shiftCount = 0;
  }

  create() {
    this.save = this.registry.get('save');
    this.levelsData = this.registry.get('levels');
    let level;
    if (this._playtest) {
      level = this.registry.get('playtestLevel');
      this.chapterId = 0;
      if (!level.id) level.id = 'test';
    } else {
      level = this._resolveLevel(this.levelId);
    }
    this.level = level;
    const bounds = level.bounds ?? { w: VIEW.WIDTH, h: VIEW.HEIGHT };

    this.matter.world.setBounds(0, 0, bounds.w, bounds.h);
    this.cameras.main.setBounds(0, 0, bounds.w, bounds.h);

    this._buildParallax(bounds);
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
    this.events.on('gravity:request', (dir) => { if (!this._solved) this.gravity.request(dir); });
    this.events.on('gravity:changed', ({ vector }) => this._onGravityShift(vector));

    this.matter.world.on('collisionstart', (event) => this._onCollision(event));

    this._buildHud(level);
    this.input.keyboard.on('keydown-R', () => this.scene.restart(this._playtest ? { playtest: true } : undefined));
    this.input.keyboard.on('keydown-ESC', () => this._toLevelSelect());

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

    (level.hazards ?? []).forEach((hz) => {
      const w = hz.w ?? 32;
      const h = hz.h ?? 32;
      this.matter.add.rectangle(hz.x, hz.y, w, h, { isStatic: true, isSensor: true, label: 'hazard' });
      // Orient the spike sprite toward the surface it sits on (texture points up by default).
      const angle = { up: 0, right: 90, down: 180, left: 270 }[hz.dir ?? 'up'];
      this.add.image(hz.x, hz.y, 'spike').setDisplaySize(w, h).setAngle(angle).setDepth(4);
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

    // Keys (Ch.4): collectible sensors, colored.
    (level.keys ?? []).forEach((k) => {
      const colorKey = k.color ?? 'gold';
      const body = this.matter.add.rectangle(k.x, k.y, 24, 26, { isStatic: true, isSensor: true, label: 'key' });
      body.gbColor = colorKey;
      body.gbVisual = this.add.image(k.x, k.y, 'key').setTint(KEY_COLORS[colorKey]).setDepth(6);
      this.tweens.add({ targets: body.gbVisual, y: k.y - 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    });

    // Goal sensor + a gently pulsing icon. A locked goal (`requires`) stays gray until its key is taken.
    const g = level.goal;
    this.goalRequires = g.requires ?? null;
    this.matter.add.rectangle(g.x, g.y, 40, 40, { isStatic: true, isSensor: true, label: 'goal' });
    this.goalIcon = this.add.image(g.x, g.y, 'goal').setDepth(5);
    if (this.goalRequires) this.goalIcon.setTint(0x555b7a);
    this.tweens.add({ targets: this.goalIcon, scale: 1.15, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  _wall(x, y, w, h) {
    this.matter.add.rectangle(x, y, w, h, { isStatic: true, label: 'wall' });
    this.add.rectangle(x, y, w, h, 0x3a3f5c).setStrokeStyle(2, 0x4c5378);
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
    if (!this.ball) return;
    const v = this.ball.visual;
    this.tweens.killTweensOf(v);
    v.setScale(sx, sy);
    this.tweens.add({ targets: v, scaleX: 1, scaleY: 1, duration: dur, ease: 'Back.easeOut' });
  }

  update() {
    if (this.ball) this.ball.sync();
  }

  _buildHud(level) {
    this.hud = this.add
      .text(12, 10, '', { fontFamily: 'monospace', fontSize: '16px', color: '#9aa0c3' })
      .setScrollFactor(0)
      .setDepth(100);
    this._updateHud();

    // Back button — sized as a comfortable touch target (>=44px).
    new Button(this, VIEW.WIDTH - 44, 28, '‹', () => this._toLevelSelect(), {
      width: 48, height: 44, fontSize: '22px', color: 0x2a2f45, textColor: '#ffffff',
    }).setScrollFactor(0).setDepth(100);

    // Mute toggle (persists via AudioManager/localStorage). Padding enlarges the tap area.
    const mute = this.add
      .text(VIEW.WIDTH - 98, 28, AudioManager.muted ? '\u{1F507}' : '\u{1F50A}', { fontSize: '24px', padding: { x: 8, y: 8 } })
      .setOrigin(0.5).setScrollFactor(0).setDepth(100)
      .setInteractive({ useHandCursor: true });
    mute.on('pointerdown', () => mute.setText(AudioManager.toggleMute() ? '\u{1F507}' : '\u{1F50A}'));

    if (level.hint) {
      this.add
        .text(VIEW.WIDTH / 2, VIEW.HEIGHT - 24, level.hint, {
          fontFamily: 'monospace', fontSize: '13px', color: '#5a6089',
        })
        .setOrigin(0.5).setScrollFactor(0).setDepth(100);
    }
  }

  _updateHud() {
    this.hud.setText(`Level ${this.level.id}    Shifts: ${this.shiftCount}    Par: ${this.level.par ?? '-'}`);
  }

  // --- Feedback / juice ----------------------------------------------------
  _onGravityShift(vector) {
    this.shiftCount += 1;
    this._updateHud();
    this.cameras.main.shake(120, FEEL.SHIFT_SHAKE);
    this.cameras.main.setFollowOffset(-vector.x * FEEL.CAMERA_LEAD_PX, -vector.y * FEEL.CAMERA_LEAD_PX);

    // Release from a sticky pad when the player flips gravity.
    if (this._stuck) {
      this._stuck = false;
      this._stickCooldownUntil = this.time.now + 300;
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
      if (other.label === 'goal') { this._reachGoal(); continue; }
      if (other.label === 'hazard') return this._die();
      if (other.label === 'bouncer') { this._onBounce(other); continue; }
      if (other.label === 'sticky') { this._onSticky(other); continue; }
      if (other.label === 'key') { this._collectKey(other); continue; }
      if (other.label === 'door') { if (!other.gbOpen) this._onWallImpact(); continue; }
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

  // Weight zones (Ch.5): a heavy ball falls faster and can smash breakables.
  _setHeavy(heavy) {
    if (this._solved || this._dying || this._heavy === heavy) return;
    this._heavy = heavy;
    this.gravity.setStrengthMultiplier(heavy ? 1.4 : 1);
    const v = this.ball.visual;
    if (heavy) { v.setTexture('ball-heavy'); v.setScale(1.18); AudioManager.stick(); }
    else { v.setTexture('ball'); v.setScale(1); }
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
      b.visual.destroy();
    }
    AudioManager.smash();
    this.cameras.main.shake(120, 0.006);
  }

  // Collect a key: remember its color, open matching doors, unlock the goal if it required it.
  _collectKey(body) {
    if (this._solved || this._dying || body.gbCollected) return;
    body.gbCollected = true;
    const colorKey = body.gbColor;
    this._keys.add(colorKey);
    const tint = KEY_COLORS[colorKey];

    AudioManager.key();
    Effects.burst(this, body.position.x, body.position.y, { color: tint, count: 12, speed: 170, lifespan: 450, scale: 0.5 });
    if (body.gbVisual) body.gbVisual.destroy();

    // Open matching doors: make them non-blocking (isSensor) rather than mutating the world mid-step.
    this._doors.forEach((d) => {
      if (d.color !== colorKey || d.body.gbOpen) return;
      d.body.isSensor = true;
      d.body.gbOpen = true;
      Effects.burst(this, d.visual.x, d.visual.y, { color: tint, count: 10, speed: 150, lifespan: 400, scale: 0.5 });
      d.visual.destroy();
    });

    if (this.goalRequires === colorKey) this.goalIcon.clearTint();
  }

  // Reach the goal — honored only if any required key has been collected.
  _reachGoal() {
    if (this.goalRequires && !this._keys.has(this.goalRequires)) return; // still locked
    this._win();
  }

  // Trampoline: overwrite velocity with a fixed launch perpendicular to the pad.
  _onBounce(body) {
    if (this._solved || this._dying) return;
    const now = this.time.now;
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
    if (this.time.now < this._stickCooldownUntil) return;
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
    const now = this.time.now;
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
    if (!this._playtest) this.save.recordResult(this.level.id, { stars, shifts: this.shiftCount });
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
    this.cameras.main.shake(220, 0.014);
    this.cameras.main.flash(150, 255, 77, 94);

    // Snap out of the hazard immediately, hide briefly, then pop back in at spawn.
    this.ball.respawn();
    this.ball.visual.setTexture('ball');
    this.ball.visual.setVisible(false);
    this.time.delayedCall(170, () => {
      this.ball.visual.setVisible(true);
      this._squash(0.2, 0.2, 320);
      this._dying = false;
    });
  }

  _showCompletePanel(stars) {
    const panel = this.add
      .container(VIEW.WIDTH / 2, VIEW.HEIGHT / 2)
      .setScrollFactor(0)
      .setDepth(200);

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
      if (nextId) actions.push(['Next', () => this.scene.restart({ levelId: nextId }), 0x38e1ff, '#0b1020']);
    }

    const spacing = 116;
    const startX = -((actions.length - 1) * spacing) / 2;
    actions.forEach(([label, cb, color, textColor], i) => {
      const b = new Button(this, startX + i * spacing, 100, label, cb, {
        width: 106, height: 46, fontSize: '18px', color, textColor,
      });
      panel.add(b);
    });

    panel.setScale(0.7).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, ease: 'Back.easeOut', duration: 380 });
  }

  _toLevelSelect() {
    CrazyGamesSDK.gameplayStop();
    if (this._playtest) { window.location.href = 'editor.html'; return; }
    this.scene.start('LevelSelectScene', { chapterId: this.chapterId });
  }
}
