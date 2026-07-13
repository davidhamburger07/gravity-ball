// panel.js — builds the editor's DOM control panel and wires it to the shared `model`.
// Kept framework-free; the panel only mutates the model (and sets `model.dirty`), while the
// canvas scene renders. Playtest hands the level to the real game via localStorage.
import { model } from './model.js';

const PLAYTEST_KEY = 'gravityball:playtest';

const TOOLS = [
  ['spawn', 'Spawn'], ['goal', 'Goal'], ['wall', 'Wall'], ['spike', 'Spike'],
  ['sticky', 'Sticky'], ['bouncer', 'Trampoline'], ['key', 'Key'], ['door', 'Door'], ['erase', 'Erase'],
];

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => node.append(c));
  return node;
}

function select(id, options, value) {
  const s = el('select', { id });
  options.forEach((o) => {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    const opt = el('option', { value: val });
    opt.textContent = label;
    s.append(opt);
  });
  s.value = value;
  return s;
}

export function initPanel(root) {
  const inputs = {};

  // Tool palette.
  const toolButtons = TOOLS.map(([tool, label]) =>
    el('button', {
      class: 'tool', 'data-tool': tool,
      onclick: () => { model.tool = tool; setActiveTool(tool); },
    }, document.createTextNode(label))
  );
  function setActiveTool(tool) {
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  }

  inputs.dir = select('prop-dir', ['up', 'down', 'left', 'right'], model.dir);
  inputs.dir.onchange = () => { model.dir = inputs.dir.value; };
  inputs.color = select('prop-color', ['gold', 'blue', 'pink'], model.color);
  inputs.color.onchange = () => { model.color = inputs.color.value; };
  inputs.power = el('input', { id: 'prop-power', type: 'number', min: '8', max: '30', value: model.power });
  inputs.power.onchange = () => { model.power = Number(inputs.power.value) || 20; };

  inputs.id = el('input', { id: 'lvl-id', value: model.id });
  inputs.id.oninput = () => { model.id = inputs.id.value; };
  inputs.gravity = select('lvl-gravity', ['down', 'up', 'left', 'right'], model.gravity);
  inputs.gravity.onchange = () => { model.gravity = inputs.gravity.value; };
  inputs.par = el('input', { id: 'lvl-par', type: 'number', min: '1', value: model.par });
  inputs.par.oninput = () => { model.par = Number(inputs.par.value) || 1; };
  inputs.requires = select('goal-requires', [['', 'none'], 'gold', 'blue', 'pink'], model.goal.requires ?? '');
  inputs.requires.onchange = () => { model.goal.requires = inputs.requires.value || null; model.dirty = true; };
  inputs.hint = el('input', { id: 'lvl-hint', value: model.hint });
  inputs.hint.oninput = () => { model.hint = inputs.hint.value; };

  const jsonArea = el('textarea', { id: 'json-io', rows: '8', spellcheck: 'false' });
  const status = el('div', { class: 'status' });
  const flash = (msg) => { status.textContent = msg; setTimeout(() => (status.textContent = ''), 1800); };

  function syncInputs() {
    inputs.dir.value = model.dir;
    inputs.color.value = model.color;
    inputs.power.value = model.power;
    inputs.id.value = model.id;
    inputs.gravity.value = model.gravity;
    inputs.par.value = model.par;
    inputs.requires.value = model.goal.requires ?? '';
    inputs.hint.value = model.hint;
  }

  root.append(
    el('h1', {}, document.createTextNode('Level Editor')),
    section('Tool', el('div', { class: 'grid' }, toolButtons)),
    section('Piece options', [
      labeled('Direction (spike / trampoline)', inputs.dir),
      labeled('Color (key / door)', inputs.color),
      labeled('Trampoline power', inputs.power),
    ]),
    section('Level', [
      labeled('ID', inputs.id),
      labeled('Start gravity', inputs.gravity),
      labeled('Par (shifts)', inputs.par),
      labeled('Goal needs key', inputs.requires),
      labeled('Hint', inputs.hint),
    ]),
    section('', [
      el('button', { class: 'primary', onclick: playtest }, document.createTextNode('▶ Playtest')),
      el('button', { onclick: () => { if (confirm('Clear the level?')) { model.reset(); syncInputs(); } } }, document.createTextNode('Clear')),
    ]),
    section('JSON', [
      el('div', { class: 'grid' }, [
        el('button', { onclick: () => { jsonArea.value = JSON.stringify(model.toLevel(), null, 2); flash('Exported'); } }, document.createTextNode('Export')),
        el('button', { onclick: () => { try { model.fromLevel(JSON.parse(jsonArea.value)); syncInputs(); flash('Loaded'); } catch (e) { flash('Invalid JSON'); } } }, document.createTextNode('Load')),
        el('button', { onclick: () => { navigator.clipboard?.writeText(jsonArea.value); flash('Copied'); } }, document.createTextNode('Copy')),
        el('button', { onclick: download }, document.createTextNode('Download')),
      ]),
      jsonArea,
      status,
    ]),
    el('p', { class: 'help' }, document.createTextNode('Click to place (default size) or drag to draw a box. Erase removes the piece under the cursor. Grid snaps to 20px.')),
    el('a', { href: './', class: 'back' }, document.createTextNode('← Back to game')),
  );

  setActiveTool(model.tool);
  syncInputs();

  function section(title, kids) {
    const s = el('div', { class: 'section' });
    if (title) s.append(el('label', { class: 'section-title' }, document.createTextNode(title)));
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => s.append(k));
    return s;
  }
  function labeled(text, control) {
    return el('div', { class: 'field' }, [el('label', {}, document.createTextNode(text)), control]);
  }

  function playtest() {
    try { localStorage.setItem(PLAYTEST_KEY, JSON.stringify(model.toLevel())); } catch { /* ignore */ }
    window.location.href = './?playtest=1';
  }

  function download() {
    const blob = new Blob([JSON.stringify(model.toLevel(), null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${model.id || 'level'}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  return { syncInputs };
}
