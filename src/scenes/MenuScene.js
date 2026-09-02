// MenuScene.js — title screen. Springy title, tagline, PLAY button, and a parallax dot
// backdrop for depth. PLAY leads into level select.
import Button from '../ui/Button.js';
import { decodeLevel } from '../systems/ShareCode.js';
import { Banners } from '../systems/Banners.js';
import { Modal } from '../ui/Modal.js';
import { Layout } from '../config/Layout.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const { width, height } = this.scale;
    const L = Layout;
    this._backdrop(width, height);
    // Menu screens are where a banner is allowed to live — never over gameplay.
    Banners.show();

    // Everything is anchored to a single stack rather than to fractions of the canvas height. In
    // portrait the canvas is more than twice as tall, so fractions spread the menu into a thin
    // column with the links stranded near the middle of an empty screen.
    const centre = L.isPortrait ? height * 0.42 : height * 0.30;

    const title = this.add
      .text(width / 2, centre, 'GRAVITY BALL', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: L.font(56),
        color: '#38e1ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScale(0);
    this.tweens.add({ targets: title, scale: 1, ease: 'Back.easeOut', duration: 550 });
    this.tweens.add({
      targets: title, y: title.y - 8, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    const tagline = this.add
      .text(width / 2, centre + L.s(74), 'Flip. Roll. Solve.', {
        fontFamily: 'system-ui, sans-serif', fontSize: L.font(20), color: '#9aa0c3',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: tagline, alpha: 1, duration: 600, delay: 300 });

    const playY = centre + L.s(190);
    new Button(this, width / 2, playY, 'PLAY', () => this.scene.start('LevelSelectScene'), {
      delay: 350,
      width: L.s(220), height: L.s(60), fontSize: L.font(24),
    });

    // Secondary entries, hung off the PLAY button rather than off a fraction of the canvas height.
    // As proportions the last link and the controls hint overlapped by ~10px, at any canvas size.
    const links = [
      ['Custom Levels', () => this.scene.start('LevelBrowserScene')],
      ['Ball Skins', () => this.scene.start('SkinsScene')],
      ['Play a Shared Map', () => this._promptForCode()],
      ['Level Editor', () => { window.location.href = 'editor.html'; }],
    ];
    const step = L.s(26);
    const linkTop = playY + L.s(62);
    links.forEach(([label, onClick], i) => {
      const t = this.add
        .text(width / 2, linkTop + i * step, label, {
          fontFamily: 'system-ui, sans-serif', fontSize: L.font(16), color: '#7a80a8',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', function () { this.setColor('#38e1ff'); })
        .on('pointerout', function () { this.setColor('#7a80a8'); })
        .on('pointerdown', onClick);
      // A 16px label is a small tap target on a phone; grow the hit area, not the text.
      if (L.isPortrait) t.input.hitArea.setTo(-40, -10, t.width + 80, t.height + 20);
    });

    this.add
      .text(width / 2, height - L.s(32), L.isPortrait
        ? 'Swipe, or use the arrows on screen, to shift gravity'
        : 'Arrow Keys / WASD or Swipe to shift gravity', {
        fontFamily: 'monospace', fontSize: L.font(14), color: '#5a6089',
        align: 'center', wordWrap: { width: width - L.s(40) },
      })
      .setOrigin(0.5);
  }

  /**
   * Ask for a share code and play it. Uses a plain prompt so it works identically on desktop and
   * mobile without building a virtual keyboard; the code itself is validated by decodeLevel.
   */
  _promptForCode() {
    const input = window.prompt('Paste a Gravity Ball share code or link:');
    if (input === null) return;
    const level = decodeLevel(input);
    if (!level) {
      Modal.notice(this, 'That does not look like a valid share code.\n\nPaste the whole code, or the full link someone sent you.', {
        title: 'Could not read that code', titleColor: '#e0574f',
      });
      return;
    }
    this.registry.set('playtestLevel', level);
    this.scene.start('GameScene', { playtest: true });
  }

  _backdrop(width, height) {
    for (let i = 0; i < 24; i++) {
      const dot = this.add.circle(
        Phaser.Math.Between(0, width),
        Phaser.Math.Between(0, height),
        Phaser.Math.Between(2, 5),
        0x2a2f45
      );
      this.tweens.add({
        targets: dot,
        y: dot.y - Phaser.Math.Between(20, 60),
        alpha: { from: 0.3, to: 0.8 },
        duration: Phaser.Math.Between(2000, 4000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }
}
