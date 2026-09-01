// panel.js — builds the editor's DOM control panel and wires it to the shared `model`.
// Kept framework-free; the panel only mutates the model (and sets `model.dirty`), while the
// canvas scene renders. Playtest hands the level to the real game via localStorage.
import { model } from './model.js';
import { encodeLevel, shareUrl } from '../systems/ShareCode.js';
import { loadPlaylist, addToPlaylist, removeAt, moveEntry, replaceAt, clearPlaylist } from './playlist.js';
import { bestSolve, hashLevel } from '../systems/SolveProof.js';
import * as LevelApi from '../systems/LevelApi.js';
import { displayIdentity, setLocalName } from '../systems/PlayerIdentity.js';
import { notice, confirm as confirmDialog } from './modal.js';

const PLAYTEST_KEY = 'gravityball:playtest';

const TOOLS = [
  ['spawn', 'Spawn'], ['goal', 'Goal'], ['wall', 'Wall'],
  ['ramp', 'Ramp'], ['spike', 'Spike'], ['sticky', 'Sticky'], ['bouncer', 'Bounce'],
  ['key', 'Key'], ['door', 'Door'], ['portal', 'Portal'],
  ['weight', 'Weight'], ['breakable', 'Break'], ['cblock', 'ColorBlk'],
  ['switch', 'Switch'], ['slowzone', 'SlowZone'], ['laser', 'Laser'],
  ['gravzone', 'GravZone'], ['blackhole', 'BlackHole'], ['erase', 'Erase'],
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

function checkbox(id, checked) {
  const c = el('input', { id, type: 'checkbox' });
  c.checked = checked;
  return c;
}

export function initPanel(root) {
  const inputs = {};

  // Tool palette.
  const toolButtons = TOOLS.map(([tool, label]) =>
    el('button', {
      class: 'tool', 'data-tool': tool,
      onclick: () => {
        model.tool = tool;
        model._pendingPortal = null; // switching tools cancels a half-placed portal pair
        model.dirty = true;
        setActiveTool(tool);
      },
    }, document.createTextNode(label))
  );
  function setActiveTool(tool) {
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  }

  // --- Piece options --------------------------------------------------------
  inputs.dir = select('prop-dir', ['up', 'down', 'left', 'right'], model.dir);
  inputs.dir.onchange = () => { model.dir = inputs.dir.value; };
  inputs.rampDir = select('prop-ramp-dir', [
    ['bl', 'slope ⟋ (square: bottom-left)'],
    ['br', 'slope ⟍ (square: bottom-right)'],
    ['tl', 'slope ⟍ (square: top-left)'],
    ['tr', 'slope ⟋ (square: top-right)'],
  ], model.rampDir);
  inputs.rampDir.onchange = () => { model.rampDir = inputs.rampDir.value; };
  inputs.color = select('prop-color', ['gold', 'blue', 'pink'], model.color);
  inputs.color.onchange = () => { model.color = inputs.color.value; };
  inputs.volatileKey = checkbox('prop-volatile', model.volatileKey);
  inputs.volatileKey.onchange = () => { model.volatileKey = inputs.volatileKey.checked; };
  inputs.cblockColor = select('prop-cblock', ['red', 'blue'], model.cblockColor);
  inputs.cblockColor.onchange = () => { model.cblockColor = inputs.cblockColor.value; };
  inputs.power = el('input', { id: 'prop-power', type: 'number', min: '8', max: '30', value: model.power });
  inputs.power.onchange = () => { model.power = Number(inputs.power.value) || 20; };
  inputs.laserOn = el('input', { id: 'prop-laser-on', type: 'number', min: '100', step: '100', value: model.laserOn });
  inputs.laserOn.onchange = () => { model.laserOn = Number(inputs.laserOn.value) || 700; };
  inputs.laserOff = el('input', { id: 'prop-laser-off', type: 'number', min: '300', step: '100', value: model.laserOff });
  inputs.laserOff.onchange = () => { model.laserOff = Number(inputs.laserOff.value) || 1800; };
  inputs.bhRadius = el('input', { id: 'prop-bh-radius', type: 'number', min: '60', max: '260', step: '10', value: model.bhRadius });
  inputs.bhRadius.onchange = () => { model.bhRadius = Number(inputs.bhRadius.value) || 150; };
  inputs.weightKind = select('prop-weight-kind', [['heavy', 'heavy (smash)'], ['normal', 'normal (reset)']], model.weightKind);
  inputs.weightKind.onchange = () => { model.weightKind = inputs.weightKind.value; };
  inputs.lineMode = checkbox('prop-line', model.lineMode);
  inputs.lineMode.onchange = () => { model.lineMode = inputs.lineMode.checked; };
  inputs.snapOn = checkbox('prop-snap', model.snapEnabled);
  inputs.snapOn.onchange = () => { model.snapEnabled = inputs.snapOn.checked; };
  inputs.snapSize = select('prop-snap-size', [['5', '5 px'], ['10', '10 px'], ['20', '20 px'], ['40', '40 px']], String(model.snapSize));
  inputs.snapSize.onchange = () => { model.snapSize = Number(inputs.snapSize.value) || 20; };

  // --- Level settings -------------------------------------------------------
  inputs.id = el('input', { id: 'lvl-id', value: model.id });
  inputs.id.oninput = () => { model.id = inputs.id.value; };
  inputs.gravity = select('lvl-gravity', ['down', 'up', 'left', 'right'], model.gravity);
  inputs.gravity.onchange = () => { model.gravity = inputs.gravity.value; };
  inputs.par = el('input', { id: 'lvl-par', type: 'number', min: '1', value: model.par });
  inputs.par.oninput = () => { model.par = Number(inputs.par.value) || 1; };
  inputs.maxShifts = el('input', { id: 'lvl-max-shifts', type: 'number', min: '0', value: model.maxShifts });
  inputs.maxShifts.oninput = () => { model.maxShifts = Number(inputs.maxShifts.value) || 0; };
  inputs.fog = el('input', { id: 'lvl-fog', type: 'number', min: '0', step: '20', value: model.fog });
  inputs.fog.oninput = () => { model.fog = Number(inputs.fog.value) || 0; };
  inputs.activeColor = select('lvl-active-color', ['red', 'blue'], model.activeColor);
  inputs.activeColor.onchange = () => { model.activeColor = inputs.activeColor.value; model.dirty = true; };
  inputs.resetGravity = checkbox('lvl-reset-gravity', model.resetGravityOnDeath);
  inputs.resetGravity.onchange = () => { model.resetGravityOnDeath = inputs.resetGravity.checked; };
  inputs.requires = select('goal-requires', [['', 'none'], 'gold', 'blue', 'pink'], model.goal.requires ?? '');
  inputs.requires.onchange = () => { model.goal.requires = inputs.requires.value || null; model.dirty = true; };
  inputs.hint = el('input', { id: 'lvl-hint', value: model.hint });
  inputs.hint.oninput = () => { model.hint = inputs.hint.value; };

  const jsonArea = el('textarea', { id: 'json-io', rows: '8', spellcheck: 'false' });
  const status = el('div', { class: 'status' });
  const flash = (msg) => { status.textContent = msg; setTimeout(() => (status.textContent = ''), 1800); };

  // --- Publish -----------------------------------------------------------------------------
  // A level can only be published once its author has beaten it in Playtest, and the par that
  // goes out is their best run. SolveProof files each solve under a hash of the level's content,
  // so editing the level after beating it locks this button again until it is beaten afresh.

  const publishButton = el('button', { class: 'wide', onclick: doPublish }, document.createTextNode('Publish'));
  const publishHint = el('div', { class: 'hint' }, document.createTextNode(''));

  /** Reflect the current solve state in the button. Cheap enough to poll (see below). */
  function refreshPublishState() {
    const solve = bestSolve(model.toLevel());
    const label = solve ? `☁ Publish  ·  par ${solve.shifts}` : 'Publish (locked)';
    const hint = solve
      ? `Beaten in ${solve.shifts} shift${solve.shifts === 1 ? '' : 's'} — that becomes the par.`
      : 'Beat this level in Playtest first. Your best run sets the par.';

    if (publishButton.firstChild.nodeValue !== label) publishButton.firstChild.nodeValue = label;
    if (publishHint.firstChild.nodeValue !== hint) publishHint.firstChild.nodeValue = hint;
    publishButton.disabled = !solve;
    publishButton.classList.toggle('primary', Boolean(solve));
  }

  async function doPublish() {
    const level = model.toLevel();
    const solve = bestSolve(level);
    if (!solve) { flash('Beat it in Playtest first'); return; }

    const name = window.prompt('Name your level:', model.id || '');
    if (name === null) return;

    // Off-platform there is no account to read a name from, so ask once and remember it.
    const me = await displayIdentity();
    if (!me.verified) {
      const author = window.prompt('Publish as (your display name):', me.name === 'Anonymous' ? '' : me.name);
      if (author === null) return;
      await setLocalName(author);
    }

    publishButton.disabled = true;
    flash('Publishing…');

    // The hash travels with the solve so the server can confirm the level being published is the
    // one that was actually beaten, and not a draft edited afterwards.
    const res = await LevelApi.publish({
      level,
      name,
      solve: { shifts: solve.shifts, hash: hashLevel(level) },
    });

    refreshPublishState();

    if (!res.ok) {
      flash(res.error);
      notice(res.error, { title: 'Could not publish', titleColor: '#e0574f' });
      return;
    }
    flash('Published!');
    notice(`Published as "${res.meta.name}" (par ${res.meta.par}).

Find it under Custom Levels -> Newest.`, { title: 'Published' });
  }

  // Open a level straight from disk. Accepts a single level object, or a whole levels.json /
  // chapter file — in which case the first level is loaded so the file is never a dead end.
  const fileInput = el('input', { id: 'file-open', type: 'file', accept: '.json,application/json', style: 'display:none' });
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const lvl = Array.isArray(data?.chapters)
        ? data.chapters.flatMap((c) => c.levels ?? [])[0]
        : Array.isArray(data?.levels) ? data.levels[0]
          : Array.isArray(data) ? data[0] : data;
      if (!lvl || !lvl.spawn || !lvl.goal) { flash('No level found in file'); return; }
      model.fromLevel(lvl);
      syncInputs();
      jsonArea.value = JSON.stringify(model.toLevel(), null, 2);
      flash(`Opened ${lvl.id ?? file.name}`);
    } catch {
      flash('Could not read that file');
    } finally {
      fileInput.value = ''; // allow re-opening the same file
    }
  };

  // --- Playlist: an ordered set of your own levels, for rehearsing progression ---------------
  // Starts empty. Add levels as you build them, drag the order around with the arrows, then play
  // the whole run in sequence to judge pacing the way a player actually meets it.
  let selected = -1;
  const grid = el('div', { class: 'pl-grid' });
  const meta = el('div', { class: 'pl-meta' });

  function renderPlaylist() {
    const list = loadPlaylist();
    grid.replaceChildren();
    if (!list.length) {
      grid.append(el('div', { class: 'pl-empty' }, document.createTextNode('empty — add a level below')));
    }
    list.forEach((lvl, i) => {
      const tile = el('button', {
        class: 'pl-tile' + (i === selected ? ' selected' : ''),
        title: lvl.id ?? `level ${i + 1}`,
        onclick: () => { selected = i; renderPlaylist(); },
      }, document.createTextNode(String(i + 1)));
      grid.append(tile);
    });

    if (selected >= list.length) selected = list.length - 1;
    const cur = selected >= 0 ? list[selected] : null;
    meta.textContent = cur ? `#${selected + 1} · ${cur.id ?? 'untitled'}` : `${list.length} level${list.length === 1 ? '' : 's'}`;
    playFrom.disabled = !list.length;
    playAll.disabled = !list.length;
  }

  const withSelection = (fn) => () => {
    const list = loadPlaylist();
    if (selected < 0 || selected >= list.length) { flash('Select a slot first'); return; }
    fn(list);
    renderPlaylist();
  };

  const playAll = el('button', { class: 'primary', onclick: () => startPlaylist(0) }, document.createTextNode('▶ Play in order'));
  const playFrom = el('button', { onclick: () => startPlaylist(Math.max(0, selected)) }, document.createTextNode('▶ From here'));

  function startPlaylist(index) {
    if (!loadPlaylist().length) { flash('Playlist is empty'); return; }
    window.location.href = `./?playlist=1&i=${index}`;
  }

  // --- Campaign loader: pick any shipped level and load it for editing ------
  let campaignData = {};
  const campaignSelect = el('select', { id: 'campaign-level' });
  const placeholderOpt = el('option', { value: '' });
  placeholderOpt.textContent = '— pick a level —';
  campaignSelect.append(placeholderOpt);

  async function populateCampaign() {
    try {
      const res = await fetch('src/data/levels.json');
      const data = await res.json();
      data.chapters.forEach((ch) => {
        if (!ch.levels?.length) return;
        const grp = el('optgroup', { label: `Ch ${ch.id} — ${ch.name}` });
        ch.levels.forEach((l) => {
          campaignData[l.id] = l;
          const o = el('option', { value: l.id });
          o.textContent = l.id;
          grp.append(o);
        });
        campaignSelect.append(grp);
      });
    } catch {
      flash('Campaign data unavailable');
    }
  }

  function loadCampaign() {
    const id = campaignSelect.value;
    if (!id || !campaignData[id]) { flash('Pick a level first'); return; }
    model.fromLevel(campaignData[id]);
    syncInputs();
    flash(`Loaded ${id}`);
  }

  function syncInputs() {
    inputs.dir.value = model.dir;
    inputs.rampDir.value = model.rampDir;
    inputs.color.value = model.color;
    inputs.volatileKey.checked = model.volatileKey;
    inputs.cblockColor.value = model.cblockColor;
    inputs.power.value = model.power;
    inputs.laserOn.value = model.laserOn;
    inputs.laserOff.value = model.laserOff;
    inputs.bhRadius.value = model.bhRadius;
    inputs.weightKind.value = model.weightKind;
    inputs.lineMode.checked = model.lineMode;
    inputs.snapOn.checked = model.snapEnabled;
    inputs.snapSize.value = String(model.snapSize);
    inputs.id.value = model.id;
    inputs.gravity.value = model.gravity;
    inputs.par.value = model.par;
    inputs.maxShifts.value = model.maxShifts;
    inputs.fog.value = model.fog;
    inputs.activeColor.value = model.activeColor;
    inputs.resetGravity.checked = model.resetGravityOnDeath;
    inputs.requires.value = model.goal.requires ?? '';
    inputs.hint.value = model.hint;
  }

  root.append(
    el('h1', {}, document.createTextNode('Level Editor')),
    section('Tool', el('div', { class: 'grid' }, toolButtons)),
    section('Placement', [
      row(inputs.lineMode, 'Line tool — drag to stamp a row'),
      row(inputs.snapOn, 'Grid snapping'),
      labeled('Snap size', inputs.snapSize),
    ]),
    section('Piece options', [
      labeled('Direction (spike / sticky / bounce / grav zone) — Q/E', inputs.dir),
      labeled('Ramp orientation — Q/E', inputs.rampDir),
      labeled('Key / door color', inputs.color),
      row(inputs.volatileKey, 'Volatile key — lost on death'),
      labeled('Color block', inputs.cblockColor),
      labeled('Bounce power', inputs.power),
      labeled('Laser on (ms)', inputs.laserOn),
      labeled('Laser off (ms)', inputs.laserOff),
      labeled('Black hole radius', inputs.bhRadius),
      labeled('Weight zone', inputs.weightKind),
    ]),
    section('Level', [
      labeled('ID', inputs.id),
      labeled('Start gravity', inputs.gravity),
      labeled('Par (shifts)', inputs.par),
      labeled('Shift budget (0 = unlimited)', inputs.maxShifts),
      labeled('Fog of war radius (0 = off)', inputs.fog),
      labeled('Solid color at start (color blocks)', inputs.activeColor),
      row(inputs.resetGravity, 'Reset gravity when the player dies'),
      labeled('Goal needs key', inputs.requires),
      labeled('Hint', inputs.hint),
    ]),
    section('Playlist — test level order', [
      grid,
      meta,
      el('div', { class: 'grid' }, [
        el('button', { onclick: () => { addToPlaylist(model.toLevel()); selected = loadPlaylist().length - 1; renderPlaylist(); flash('Added to playlist'); } }, document.createTextNode('+ Add current')),
        el('button', { onclick: withSelection(() => { moveEntry(selected, -1); selected = Math.max(0, selected - 1); }) }, document.createTextNode('◀ Move')),
        el('button', { onclick: withSelection((list) => { moveEntry(selected, 1); selected = Math.min(list.length - 1, selected + 1); }) }, document.createTextNode('Move ▶')),
        el('button', { onclick: withSelection((list) => { model.fromLevel(list[selected]); syncInputs(); flash('Loaded into editor'); }) }, document.createTextNode('Load')),
        el('button', { onclick: withSelection(() => { replaceAt(selected, model.toLevel()); flash('Slot updated'); }) }, document.createTextNode('Save to slot')),
        el('button', { onclick: withSelection(() => { removeAt(selected); }) }, document.createTextNode('× Remove')),
      ]),
      el('div', { class: 'grid' }, [
        playAll,
        playFrom,
        el('button', { onclick: () => confirmDialog('Clear the whole playlist? This cannot be undone.', { title: 'Clear playlist', confirmLabel: 'Clear all', danger: true, onConfirm: () => { clearPlaylist(); selected = -1; renderPlaylist(); } }) }, document.createTextNode('Clear all')),
      ]),
    ]),
    section('Campaign', [
      labeled('Open a shipped level to edit or replace', campaignSelect),
      el('button', { onclick: loadCampaign }, document.createTextNode('Load level')),
    ]),
    section('', [
      el('button', { class: 'primary', onclick: playtest }, document.createTextNode('▶ Playtest')),
      el('button', { onclick: () => confirmDialog('Clear the level? Everything on the canvas will be discarded.', { title: 'Clear level', confirmLabel: 'Clear', danger: true, onConfirm: () => { model.reset(); syncInputs(); } }) }, document.createTextNode('Clear')),
    ]),
    section('Publish', [
      publishButton,
      publishHint,
    ]),
    section('JSON', [
      el('div', { class: 'grid' }, [
        el('button', { onclick: () => { jsonArea.value = JSON.stringify(model.toLevel(), null, 2); flash('Exported'); } }, document.createTextNode('Export')),
        el('button', { onclick: () => { try { model.fromLevel(JSON.parse(jsonArea.value)); syncInputs(); flash('Loaded'); } catch (e) { flash('Invalid JSON'); } } }, document.createTextNode('Load')),
        el('button', { onclick: () => { navigator.clipboard?.writeText(jsonArea.value); flash('Copied'); } }, document.createTextNode('Copy')),
        el('button', { onclick: download }, document.createTextNode('Download')),
      ]),
      el('button', { class: 'wide', onclick: () => fileInput.click() }, document.createTextNode('📂 Open .json file…')),
      el('button', { class: 'wide', onclick: () => {
        const code = encodeLevel(model.toLevel());
        jsonArea.value = code;
        navigator.clipboard?.writeText(code);
        flash('Share code copied');
      } }, document.createTextNode('🔗 Copy share code')),
      el('button', { class: 'wide', onclick: () => {
        const url = shareUrl(model.toLevel(), window.location.origin + window.location.pathname.replace(/editor\.html$/, ''));
        jsonArea.value = url;
        navigator.clipboard?.writeText(url);
        flash('Share link copied');
      } }, document.createTextNode('🔗 Copy play link')),
      fileInput,
      jsonArea,
      status,
    ]),
    el('p', { class: 'help' }, document.createTextNode(
      'Click to place (default size) or drag to draw a box. Portal takes two clicks (a linked pair). ' +
      'Line tool stamps a row of the selected piece along a drag. Erase removes the piece under the cursor. ' +
      'Press Q / E to rotate the piece you are placing. Grid snapping and snap size are set under Placement.'
    )),
    el('a', { href: './', class: 'back' }, document.createTextNode('← Back to game')),
  );

  setActiveTool(model.tool);
  syncInputs();
  populateCampaign();
  renderPlaylist();

  // Q/E rotation happens in the canvas scene; mirror it back into the dropdowns.
  window.addEventListener('editor:rotated', () => {
    inputs.dir.value = model.dir;
    inputs.rampDir.value = model.rampDir;
  });

  function section(title, kids) {
    const s = el('div', { class: 'section' });
    if (title) s.append(el('label', { class: 'section-title' }, document.createTextNode(title)));
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => s.append(k));
    return s;
  }
  function labeled(text, control) {
    return el('div', { class: 'field' }, [el('label', {}, document.createTextNode(text)), control]);
  }
  function row(control, text) {
    return el('label', { class: 'field-row' }, [control, document.createTextNode(text)]);
  }

  function playtest() {
    try { localStorage.setItem(PLAYTEST_KEY, JSON.stringify(model.toLevel())); } catch { /* ignore */ }
    window.location.href = './?playtest=1';
  }

  // The publish gate depends on the level's exact contents, and the canvas mutates the model
  // without going through syncInputs. Polling is the honest way to stay accurate: hashing a level
  // this size is measured in microseconds, and the DOM is only touched when the label changes.
  refreshPublishState();
  setInterval(refreshPublishState, 400);

  function download() {
    const blob = new Blob([JSON.stringify(model.toLevel(), null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${model.id || 'level'}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  return { syncInputs };
}
