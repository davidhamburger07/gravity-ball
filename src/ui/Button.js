// Button.js — reusable UI button with spring pop-in, hover scale, and click feedback.
// A Container so it can be dropped straight into any scene or nested inside a panel.
import { AudioManager } from '../systems/AudioManager.js';

export default class Button extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x @param {number} y
   * @param {string} label
   * @param {Function} onClick
   * @param {object} [opts] width, height, fontSize, color, textColor, delay
   */
  constructor(scene, x, y, label, onClick, opts = {}) {
    super(scene, x, y);
    const w = opts.width ?? 220;
    const h = opts.height ?? 60;

    const bg = scene.add
      .rectangle(0, 0, w, h, opts.color ?? 0x38e1ff)
      .setStrokeStyle(3, 0xffffff, 0.15)
      .setInteractive({ useHandCursor: true });

    const txt = scene.add
      .text(0, 0, label, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: opts.fontSize ?? '24px',
        color: opts.textColor ?? '#0b1020',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add([bg, txt]);
    scene.add.existing(this);

    // Hover / press micro-interactions (scale + rotation/alpha only, per feel guardrails).
    bg.on('pointerover', () =>
      scene.tweens.add({ targets: this, scale: 1.06, duration: 120, ease: 'Back.easeOut' })
    );
    bg.on('pointerout', () =>
      scene.tweens.add({ targets: this, scale: 1, duration: 120, ease: 'Back.easeOut' })
    );
    bg.on('pointerdown', () => {
      AudioManager.ui();
      scene.tweens.add({ targets: this, scale: 0.94, duration: 80, yoyo: true, onComplete: onClick });
    });

    // Spring pop-in.
    this.setScale(0);
    scene.tweens.add({
      targets: this,
      scale: 1,
      duration: 400,
      ease: 'Back.easeOut',
      delay: opts.delay ?? 0,
    });
  }
}
