// Modal.js — in-canvas notice and confirm panels.
//
// These replace window.alert and window.confirm. Native dialogs are jarring inside an embedded
// game frame, they cannot be styled, and on mobile they arrive as browser chrome over the top of
// the canvas — so they read as "the page broke" rather than "the game is asking you something".
//
// Text ENTRY still uses window.prompt (share codes, search). That is a different problem: Phaser
// has no text input, so replacing those means an HTML overlay, not a drawn panel.
import Button from './Button.js';
import { AudioManager } from '../systems/AudioManager.js';

const DEPTH = 900; // above the level-complete panel (200) — a modal is always the top thing
const W = 420;

/**
 * Build the shared shell: dimmer, panel, message. Returns the container plus the y the buttons
 * should sit at, so notice() and confirm() only differ by their buttons.
 */
function shell(scene, message, { title, titleColor = '#ffffff' }) {
  const cx = scene.scale.width / 2;
  const cy = scene.scale.height / 2;

  const layer = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);

  // Swallow clicks on anything behind the modal.
  const dimmer = scene.add
    .rectangle(cx, cy, scene.scale.width, scene.scale.height, 0x05070e, 0.62)
    .setScrollFactor(0)
    .setInteractive();

  const text = scene.add
    .text(0, 0, message, {
      fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: '#c9cde8',
      align: 'center', wordWrap: { width: W - 56 }, lineSpacing: 5,
    })
    .setOrigin(0.5);

  const titleH = title ? 34 : 0;
  const bodyH = Math.max(text.height, 20);
  const panelH = titleH + bodyH + 104;
  const topY = cy - panelH / 2;

  const panel = scene.add
    .rectangle(cx, cy, W, panelH, 0x1a1e30, 0.98)
    .setStrokeStyle(3, 0x38e1ff, 0.5)
    .setScrollFactor(0);

  layer.add([dimmer, panel]);

  if (title) {
    layer.add(scene.add
      .text(cx, topY + 26, title, {
        fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: titleColor, fontStyle: 'bold',
      })
      .setOrigin(0.5).setScrollFactor(0));
  }

  text.setPosition(cx, topY + titleH + 20 + bodyH / 2).setScrollFactor(0);
  layer.add(text);

  // GameScene splits the world and HUD onto separate cameras; registering the layer as HUD stops
  // the world camera drawing it too (and keeps it out of the playfield viewport). Scenes with a
  // single camera have no _addHud and simply draw it normally.
  scene._addHud?.(layer);

  layer.setScale(0.85).setAlpha(0);
  scene.tweens.add({ targets: layer, scale: 1, alpha: 1, ease: 'Back.easeOut', duration: 260 });

  return { layer, buttonY: topY + panelH - 40, cx };
}

/** A destroyed game object has its `scene` cleared — the reliable "is this still up" check. */
const isOpen = (layer) => Boolean(layer?.scene);

function close(scene, layer, then) {
  scene.tweens.add({
    targets: layer, scale: 0.9, alpha: 0, duration: 140,
    onComplete: () => { layer.destroy(); then?.(); },
  });
}

export const Modal = {
  /** A message with a single dismiss button. Replaces window.alert. */
  notice(scene, message, { title = null, titleColor = '#ffffff', label = 'OK', onClose } = {}) {
    const { layer, buttonY, cx } = shell(scene, message, { title, titleColor });
    const btn = new Button(scene, cx, buttonY, label, () => close(scene, layer, onClose), {
      width: 120, height: 42, fontSize: '16px', color: 0x38e1ff, textColor: '#0b1020',
    });
    layer.add(btn);
    scene.input.keyboard?.once('keydown-ENTER', () => { if (isOpen(layer)) close(scene, layer, onClose); });
    scene.input.keyboard?.once('keydown-ESC', () => { if (isOpen(layer)) close(scene, layer, onClose); });
    return layer;
  },

  /**
   * A yes/no question. Replaces window.confirm.
   * `danger` colours the affirmative red, for destructive or irreversible answers.
   */
  confirm(scene, message, { title = null, confirmLabel = 'Yes', cancelLabel = 'Cancel', danger = false, onConfirm, onCancel } = {}) {
    const { layer, buttonY, cx } = shell(scene, message, { title, titleColor: danger ? '#ff8a8a' : '#ffffff' });

    const cancel = new Button(scene, cx - 70, buttonY, cancelLabel, () => close(scene, layer, onCancel), {
      width: 128, height: 42, fontSize: '16px', color: 0x2a2f45, textColor: '#ffffff',
    });
    const confirm = new Button(scene, cx + 70, buttonY, confirmLabel, () => {
      AudioManager.ui();
      close(scene, layer, onConfirm);
    }, {
      width: 128, height: 42, fontSize: '16px',
      color: danger ? 0xe0574f : 0x38e1ff, textColor: danger ? '#ffffff' : '#0b1020',
    });
    layer.add([cancel, confirm]);

    // Escape always means "no" — the safe answer, and what a native dialog does.
    scene.input.keyboard?.once('keydown-ESC', () => { if (isOpen(layer)) close(scene, layer, onCancel); });
    return layer;
  },
};
