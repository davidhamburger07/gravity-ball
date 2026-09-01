// modal.js — in-page notice and confirm dialogs for the editor.
//
// The editor is plain DOM rather than Phaser, so unlike the game's Modal these are real elements.
// Same reason for existing though: window.alert and window.confirm cannot be styled, they look
// like the page has broken, and inside an embedded frame they are browser chrome sitting on top
// of the game rather than part of it.
//
// Text ENTRY (level name, author name) still uses window.prompt — replacing that is a separate
// job, and a native prompt at least gives mobile a real keyboard.

const PALETTE = {
  backdrop: 'rgba(5, 7, 14, 0.62)',
  panel: '#161a2b',
  border: '#2a2f45',
  text: '#c9cde8',
  muted: '#9aa0c3',
  accent: '#38e1ff',
  danger: '#e0574f',
};

function build({ title, message, titleColor, buttons }) {
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '200', background: PALETTE.backdrop,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    width: 'min(420px, calc(100vw - 48px))', background: PALETTE.panel,
    border: `1px solid ${PALETTE.border}`, borderRadius: '10px',
    padding: '20px 22px', color: PALETTE.text,
    boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
  });

  if (title) {
    const h = document.createElement('div');
    h.textContent = title;
    Object.assign(h.style, {
      fontSize: '16px', fontWeight: '600', marginBottom: '8px',
      color: titleColor || PALETTE.accent,
    });
    panel.append(h);
  }

  const body = document.createElement('div');
  body.textContent = message;
  Object.assign(body.style, {
    fontSize: '13px', lineHeight: '1.5', color: PALETTE.muted,
    whiteSpace: 'pre-wrap', marginBottom: '18px',
  });
  panel.append(body);

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

  for (const spec of buttons) {
    const b = document.createElement('button');
    b.textContent = spec.label;
    Object.assign(b.style, {
      padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
      fontSize: '13px', fontWeight: spec.primary ? '600' : '400',
      background: spec.danger ? PALETTE.danger : spec.primary ? PALETTE.accent : '#2a2f45',
      color: spec.danger ? '#ffffff' : spec.primary ? '#0b1020' : '#dfe3f5',
    });
    b.addEventListener('click', () => { dismiss(); spec.onClick?.(); });
    row.append(b);
    if (spec.autofocus) setTimeout(() => b.focus(), 0);
  }
  panel.append(row);
  backdrop.append(panel);

  const onKey = (e) => {
    if (e.key === 'Escape') { dismiss(); buttons.find((b) => b.isCancel)?.onClick?.(); }
  };
  function dismiss() {
    window.removeEventListener('keydown', onKey, true);
    backdrop.remove();
  }
  // Capture phase, so Escape closes the dialog instead of reaching the editor's own shortcuts.
  window.addEventListener('keydown', onKey, true);

  document.body.append(backdrop);
  return dismiss;
}

/** A message with a single dismiss button. Replaces window.alert. */
export function notice(message, { title = null, titleColor = null, label = 'OK', onClose } = {}) {
  return build({
    title, message, titleColor,
    buttons: [{ label, primary: true, autofocus: true, isCancel: true, onClick: onClose }],
  });
}

/** A yes/no question. Replaces window.confirm. `danger` marks a destructive answer. */
export function confirm(message, { title = null, confirmLabel = 'Yes', cancelLabel = 'Cancel', danger = false, onConfirm, onCancel } = {}) {
  return build({
    title, message, titleColor: danger ? PALETTE.danger : null,
    buttons: [
      { label: cancelLabel, isCancel: true, autofocus: true, onClick: onCancel },
      { label: confirmLabel, primary: !danger, danger, onClick: onConfirm },
    ],
  });
}
