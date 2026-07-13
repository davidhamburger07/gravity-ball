// main.js (editor) — boots the editor Phaser canvas + DOM panel, restores the last working
// level from localStorage, and autosaves it so a Playtest round-trip preserves your work.
import EditorScene from './EditorScene.js';
import { initPanel } from './panel.js';
import { model } from './model.js';

const AUTOSAVE_KEY = 'gravityball:editor';

// Restore the previous session (survives the Playtest round-trip) before UI is built.
try {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) model.fromLevel(JSON.parse(saved));
} catch { /* ignore */ }

initPanel(document.getElementById('editor-panel'));

// Debug/testing hook (harmless in production), mirrors window.game.
window.__editorModel = model;

// eslint-disable-next-line no-new
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'editor-stage',
  backgroundColor: '#0d1020',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600,
  },
  scene: [EditorScene],
});

setInterval(() => {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(model.toLevel())); } catch { /* ignore */ }
}, 1500);
