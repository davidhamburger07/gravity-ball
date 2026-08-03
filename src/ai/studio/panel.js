// studio/panel.js — the AI Level Studio's DOM: control panel on the right, live results table
// underneath the canvas. Framework-free, matching the level editor's conventions.
//
// The whole point of this page is that a level can go from "does not exist" to "in the
// campaign" without touching a terminal: configure → Run → watch → Add to chapter.
import { CHAPTERS } from '../../procgen/chapters.js';
import { DEFAULTS as AI_DEFAULTS } from '../AIPlaytester.js';
import { PIPELINE_DEFAULTS } from '../ContentPipeline.js';

const PLAYTEST_KEY = 'gravityball:playtest';

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => node.append(c));
  return node;
}

function select(options, value) {
  const s = el('select');
  options.forEach(([val, label]) => {
    const o = el('option', { value: val, text: label });
    s.append(o);
  });
  s.value = String(value);
  return s;
}

function number(value, { min, max, step } = {}) {
  const i = el('input', { type: 'number', value: String(value) });
  if (min !== undefined) i.min = String(min);
  if (max !== undefined) i.max = String(max);
  if (step !== undefined) i.step = String(step);
  return i;
}

export function initStudio({ game, panel, results }) {
  let levelsData = null;   // src/data/levels.json, refreshed after every write
  let lastRenderKey = '';

  // --- Controls ---------------------------------------------------------------------------
  const chapterSel = select(
    [['', 'Any — no chapter restriction'], ...CHAPTERS.map((c) => [c.id, `Ch ${c.id} — ${c.name}`])],
    ''
  );
  const levelsIn = number(10, { min: 1, max: 200 });
  const keepMinIn = number(PIPELINE_DEFAULTS.keepMin, { min: 2, max: 50 });
  const actionSel = select(
    [['quad', 'Four directions (like a player)'], ['cycle', 'One button — cycles'], ['binary', 'One button — 180°']],
    AI_DEFAULTS.actionSet
  );
  const episodesIn = number(AI_DEFAULTS.maxEpisodes, { min: 5, max: 1000 });
  const colsIn = number(PIPELINE_DEFAULTS.cols, { min: 1, max: 6 });
  const rowsIn = number(PIPELINE_DEFAULTS.rows, { min: 1, max: 4 });
  const maxRoomsIn = number(PIPELINE_DEFAULTS.maxRooms, { min: 2, max: 10 });
  const seedIn = el('input', { placeholder: 'random' });

  const runBtn = el('button', { class: 'primary wide', text: '▶  Generate & playtest' });
  const stopBtn = el('button', { class: 'stop wide', text: '■  Stop' });
  stopBtn.style.display = 'none';

  const bar = el('i');
  const progress = el('div', { class: 'progress' }, bar);
  const runline = el('div', { class: 'runline', text: 'Idle.' });
  const status = el('div', { class: 'status' });
  const flash = (msg, bad = false) => {
    status.textContent = msg;
    status.style.color = bad ? '#e0574f' : '#2bd67b';
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { status.textContent = ''; }, 3200);
  };

  const chapterHelp = el('p', { class: 'help' });
  function updateChapterHelp() {
    const id = Number(chapterSel.value);
    const ch = CHAPTERS.find((c) => c.id === id);
    if (!ch) {
      chapterHelp.textContent = 'Rooms may use any mechanic. Good for exploring; not for campaign levels.';
      chapterHelp.classList.remove('warn');
      return;
    }
    const intro = ch.introduces.length ? ch.introduces.join(' + ') : 'no new object (a mixer)';
    chapterHelp.textContent =
      `Ch ${ch.id} introduces ${intro}. Levels use only what chapters 1-${ch.id} have taught, ` +
      'and are biased toward rooms that feature the new object.';
    chapterHelp.classList.remove('warn');
  }
  chapterSel.onchange = updateChapterHelp;
  updateChapterHelp();

  runBtn.onclick = () => {
    const seedRaw = seedIn.value.trim();
    const opts = {
      levels: Number(levelsIn.value) || 10,
      keepMin: Number(keepMinIn.value) || 3,
      chapter: chapterSel.value ? Number(chapterSel.value) : null,
      cols: Number(colsIn.value) || 3,
      rows: Number(rowsIn.value) || 2,
      maxRooms: Number(maxRoomsIn.value) || 4,
      hud: false, // this page draws its own progress
      ai: {
        actionSet: actionSel.value,
        maxEpisodes: Number(episodesIn.value) || AI_DEFAULTS.maxEpisodes,
      },
    };
    if (seedRaw && Number.isFinite(Number(seedRaw))) opts.seed = Number(seedRaw);
    lastRenderKey = '';
    window.GravityBallAI.run(opts);
    flash('Running…');
  };

  stopBtn.onclick = () => {
    window.GravityBallAI.pipeline?.stop();
    flash('Stopped — results so far are kept');
  };

  panel.append(
    el('h1', { text: 'AI Level Studio' }),
    el('p', { class: 'sub', text: 'Generate levels, let the AI play them, keep the ones that fight back.' }),

    section('Campaign chapter', [
      chapterSel,
      chapterHelp,
    ]),
    section('Run', [
      field('Levels to generate', levelsIn),
      field('Keep if it takes at least (attempts)', keepMinIn),
      field('Seed (blank = random)', seedIn),
      runBtn,
      stopBtn,
      progress,
      runline,
      status,
    ]),
    section('AI', [
      field('Controls the AI has', actionSel),
      field('Attempts before giving up', episodesIn),
      el('p', { class: 'help', text:
        'Four directions matches what a player can do, so it is the fairest difficulty measure. ' +
        'The one-button modes are much weaker and mark most levels unsolvable.' }),
    ]),
    section('Level shape', [
      el('div', { class: 'two' }, [field('Grid cols', colsIn), field('Grid rows', rowsIn)]),
      field('Max rooms per level', maxRoomsIn),
      el('p', { class: 'help', text:
        'Each room is one 800x600 screen. Past about 4 rooms the AI stops reaching the goal, ' +
        'so everything comes back unsolved — raise attempts too if you go bigger.' }),
    ]),
    el('a', { class: 'back', href: './', text: '← Game' }),
    el('a', { class: 'back', href: 'editor.html', text: '  ·  Level editor' }),
  );

  // --- Results ----------------------------------------------------------------------------
  function verdictTag(v) {
    const label = { keep: 'KEEP', discard: 'TOO EASY', borderline: 'BORDERLINE', unsolved: 'UNSOLVED' }[v];
    return el('span', { class: `tag ${v}`, text: label });
  }

  async function refreshLevels() {
    try {
      levelsData = await (await fetch('src/data/levels.json')).json();
    } catch { levelsData = null; }
  }

  function nextIdFor(chapterId) {
    const ch = levelsData?.chapters?.find((c) => c.id === chapterId);
    const used = new Set((ch?.levels ?? []).map((l) => l.id));
    for (let n = 1; n < 999; n++) if (!used.has(`${chapterId}-${n}`)) return `${chapterId}-${n}`;
    return `${chapterId}-new`;
  }

  function levelFor(record) {
    return window.GravityBallAI.pipeline?.kept.find((k) => k.level.id === record.id)?.level ?? null;
  }

  function playLevel(record) {
    const level = levelFor(record);
    if (!level) return flash('That level was not retained (only kept/unsolved levels are)', true);
    try { localStorage.setItem(PLAYTEST_KEY, JSON.stringify(level)); } catch { /* ignore */ }
    window.open('./?playtest=1', '_blank');
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'request failed');
    return data;
  }

  async function saveLevel(record) {
    const level = levelFor(record);
    if (!level) return flash('That level was not retained', true);
    try {
      const r = await post('/api/save-level', { level });
      flash(`Saved ${r.path}`);
    } catch (e) {
      flash(`Save failed: ${e.message}`, true);
    }
  }

  async function addToChapter(record, chapterId) {
    const level = levelFor(record);
    if (!level) return flash('That level was not retained', true);
    if (!levelsData) await refreshLevels();
    const id = nextIdFor(chapterId);
    try {
      const r = await post('/api/add-to-chapter', { level: { ...level, id }, chapterId });
      await refreshLevels();
      flash(`Added as ${r.id} (chapter ${chapterId} now has ${r.total} levels)`);
      render(true);
    } catch (e) {
      flash(`Could not add: ${e.message}`, true);
    }
  }

  function resultRow(record, defaultChapter) {
    const chapterPick = select(CHAPTERS.map((c) => [c.id, `Ch ${c.id}`]), defaultChapter ?? 2);
    chapterPick.style.cssText = 'width:auto;padding:3px 4px;font-size:11px';

    return el('tr', { class: record.verdict === 'keep' ? 'keep' : '' }, [
      el('td', {}, verdictTag(record.verdict)),
      el('td', {}, [
        el('div', { text: record.solved ? `${record.attempts} attempts` : `never solved (${record.attempts})` }),
        el('div', { class: 'rooms', text: record.rooms.join(' › ') }),
        record.featuredMissing
          ? el('div', { class: 'rooms warn', text: '⚠ could not feature this chapter\'s object' })
          : el('span'),
      ]),
      el('td', { text: record.solved ? '—' : `${record.closestApproach}px short` }),
      el('td', {}, el('div', { class: 'acts' }, [
        el('button', { class: 'tiny', text: 'Play', onclick: () => playLevel(record) }),
        el('button', { class: 'tiny', text: 'Save', onclick: () => saveLevel(record) }),
        chapterPick,
        el('button', { class: 'tiny', text: 'Add', onclick: () => addToChapter(record, Number(chapterPick.value)) }),
      ])),
    ]);
  }

  function render(force = false) {
    const p = window.GravityBallAI.pipeline;
    if (!p) {
      if (lastRenderKey !== 'idle') {
        lastRenderKey = 'idle';
        results.replaceChildren(el('p', { class: 'empty', text:
          'No run yet. Pick a chapter and press Generate & playtest — the AI plays each level at ' +
          'about 350x speed, so a batch of ten takes a few seconds.' }));
      }
      return;
    }

    // Live line + progress bar update every frame; the table only rebuilds when it changes.
    const t = p.playtester;
    const pct = Math.min(100, (p.results.length / Math.max(1, p.opts.levels)) * 100);
    bar.style.width = `${pct}%`;
    runline.textContent = p.done
      ? `Finished — ${p.results.length} tested${p.stopped ? ' (stopped early)' : ''}.`
      : [
        `level ${Math.min(p.index + 1, p.opts.levels)}/${p.opts.levels}`,
        t ? `attempt ${t.episode}/${t.cfg.maxEpisodes}` : 'building…',
        t ? `score ${Math.round(t.score)}` : '',
      ].filter(Boolean).join('   ');

    runBtn.style.display = p.done ? '' : 'none';
    stopBtn.style.display = p.done ? 'none' : '';

    const key = `${p.results.length}:${p.done}`;
    if (!force && key === lastRenderKey) return;
    lastRenderKey = key;

    const tally = p.results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] ?? 0) + 1; return a; }, {});
    const kept = p.results.filter((r) => r.verdict !== 'discard');

    results.replaceChildren(
      el('h2', { text: 'Results' }),
      el('p', { class: 'tally', text:
        `${p.results.length} tested · ${tally.keep ?? 0} keep · ${tally.discard ?? 0} too easy · ` +
        `${tally.borderline ?? 0} borderline · ${tally.unsolved ?? 0} unsolved` }),
      kept.length
        ? el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Verdict' }), el('th', { text: 'AI result' }),
            el('th', { text: 'Gap' }), el('th', {}),
          ])),
          el('tbody', {}, kept.map((r) => resultRow(r, p.opts.chapter))),
        ])
        : el('p', { class: 'empty', text: p.results.length
          ? 'Nothing kept yet. Levels the AI beats first try are discarded on purpose.'
          : 'Testing…' }),
    );
  }

  // The pipeline advances inside the game's frame loop, so mirror it on the same clock.
  (function loop() {
    render();
    requestAnimationFrame(loop);
  })();

  refreshLevels();

  function section(title, kids) {
    const s = el('div', { class: 'section' });
    if (title) s.append(el('label', { class: 'section-title', text: title }));
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => s.append(k));
    return s;
  }
  function field(text, control) {
    return el('div', { class: 'field' }, [el('label', { text }), control]);
  }
}
