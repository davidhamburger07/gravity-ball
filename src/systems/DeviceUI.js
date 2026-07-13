// DeviceUI.js — mobile helpers. Touch detection uses a coarse-pointer query so it doesn't
// false-positive on touch-capable laptops driven by a mouse.
export function isTouch() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// The playfield is landscape-only (800x600). On touch devices, show a full-screen prompt while
// the device is held in portrait. It's driven entirely by a CSS orientation media query — no
// resize listeners — and only exists on touch devices, so desktop is never affected.
export function installOrientationGate() {
  if (typeof document === 'undefined' || !isTouch()) return;
  if (document.getElementById('rotate-gate')) return;

  const style = document.createElement('style');
  style.textContent = `
    #rotate-gate {
      position: fixed; inset: 0; z-index: 9999; display: none;
      align-items: center; justify-content: center; text-align: center;
      background: #10131f; color: #9aa0c3;
      font-family: system-ui, sans-serif;
    }
    #rotate-gate .rg-icon { font-size: 58px; margin-bottom: 18px;
      animation: rg-rock 1.6s ease-in-out infinite; transform-origin: 50% 50%; }
    #rotate-gate p { margin: 0; font-size: 18px; letter-spacing: .02em; }
    @keyframes rg-rock { 0%,100% { transform: rotate(-16deg); } 50% { transform: rotate(16deg); } }
    @media (orientation: portrait) { #rotate-gate { display: flex; } }
  `;
  document.head.appendChild(style);

  const gate = document.createElement('div');
  gate.id = 'rotate-gate';
  gate.innerHTML = '<div><div class="rg-icon">\u{1F4F1}</div><p>Rotate your device to landscape</p></div>';
  document.body.appendChild(gate);
}
