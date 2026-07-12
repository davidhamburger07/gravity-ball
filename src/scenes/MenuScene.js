// MenuScene.js — title screen. Springy title, tagline, PLAY button, and a parallax dot
// backdrop for depth. PLAY leads into level select.
import Button from '../ui/Button.js';
import { VIEW } from '../config/GameConfig.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(VIEW.BACKGROUND);
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

    this.add
      .text(width / 2, height * 0.82, 'Arrow Keys / WASD or Swipe to shift gravity', {
        fontFamily: 'monospace', fontSize: '14px', color: '#5a6089',
      })
      .setOrigin(0.5);
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
