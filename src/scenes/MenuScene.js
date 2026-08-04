// MenuScene.js — title screen. Springy title, tagline, PLAY button, and a parallax dot
// backdrop for depth. PLAY leads into level select.
import Button from '../ui/Button.js';
import { decodeLevel } from '../systems/ShareCode.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const { width, height } = this.scale;
    this._backdrop(width, height);

    const title = this.add
      .text(width / 2, height * 0.30, 'GRAVITY BALL', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '56px',
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
      .text(width / 2, height * 0.42, 'Flip. Roll. Solve.', {
        fontFamily: 'system-ui, sans-serif', fontSize: '20px', color: '#9aa0c3',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: tagline, alpha: 1, duration: 600, delay: 300 });

    new Button(this, width / 2, height * 0.60, 'PLAY', () => this.scene.start('LevelSelectScene'), {
      delay: 350,
    });

    // Secondary entries, spaced evenly so they never crowd the PLAY button.
    const links = [
      ['Ball Skins', () => this.scene.start('SkinsScene')],
      ['Play a Shared Map', () => this._promptForCode()],
      ['Level Editor', () => { window.location.href = 'editor.html'; }],
    ];
    links.forEach(([label, onClick], i) => {
      this.add
        .text(width / 2, height * 0.70 + i * 26, label, {
          fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#7a80a8',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', function () { this.setColor('#38e1ff'); })
        .on('pointerout', function () { this.setColor('#7a80a8'); })
        .on('pointerdown', onClick);
    });

    this.add
      .text(width / 2, height * 0.82, 'Arrow Keys / WASD or Swipe to shift gravity', {
        fontFamily: 'monospace', fontSize: '14px', color: '#5a6089',
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
      window.alert('That does not look like a valid share code.');
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
