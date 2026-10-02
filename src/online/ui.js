// The online game's own controls, outside the game: a settings button in the window's
// corner, the settings it opens, and the score tables, drawn like the game's own bubbles
// (white, a black rounded edge, green buttons in the game's pixel font).

import { UI_SCALES, loadSettings, saveSettings } from './settings.js';
import { isClean } from './profanity.js';
import { WORLD_NAMES, clock } from './scores.js';
import { parseCode, showCode } from './random.js';
import { el, dialog } from './dom.js';

const SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
  ['fill', 'Fill window'],
];

const SENDS = [
  ['ask', 'Ask each time'],
  ['always', 'Always send'],
  ['never', 'Never send'],
];

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

// A row's place on a table: an equal time shares the place of the first with it, as the
// server counts it.
function place(list, i) {
  while (i > 0 && list[i - 1].ms === list[i].ms) i--;
  return i + 1;
}

export class OnlineUI {
  constructor(rt, canvas) {
    this.rt = rt;
    this.canvas = canvas;
    this.settings = loadSettings();
    this.scores = null;     // set by main.js (src/online/scores.js)
    this.random = null;     // and the generated missions (src/online/missions.js)
    this.races = null;      // and races (src/online/race.js)
    this.asked = 0;         // the tables last asked for (an older answer is dropped)
    // ?ui=1.5 (any factor) overrides the setting for the visit, for testing sizes
    const forced = parseFloat(new URLSearchParams(location.search).get('ui'));
    this.forcedScale = forced > 0 ? forced : 0;
    this.build();
  }
  // How many CSS pixels a stage pixel may take: the layout asks this on every resize.
  maxScale() {
    return this.forcedScale || UI_SCALES[this.settings.size];
  }
  // Two fingers pinched the interface to this size (for the visit; the settings' sizes
  // are kept).
  pinched(scale) {
    this.forcedScale = Math.max(0.5, Math.min(4, scale));
    this.render();
    this.rt.renderer.resize();
    this.rt.needsDraw = true;
  }
  build() {
    this.gear = el('button', {
      id: 'gear', type: 'button', title: 'Settings', 'aria-label': 'Settings', html: GEAR,
      onclick: () => this.open(),
    });
    this.sizeButtons = SIZES.map(([key, label]) => el('button', {
      type: 'button', class: 'choice', 'data-key': key, text: label,
      onclick: () => { this.settings.size = key; this.forcedScale = 0; this.apply(); },
    }));
    this.fullButton = el('button', {
      type: 'button', class: 'choice', text: 'Full screen',
      onclick: () => this.toggleFullscreen(),
    });
    this.sendButtons = SENDS.map(([key, label]) => el('button', {
      type: 'button', class: 'choice', 'data-key': key, text: label,
      onclick: () => { this.settings.scores = key; this.save(); },
    }));
    this.nameInput = el('input', { type: 'text', maxlength: '15', autocomplete: 'nickname', spellcheck: 'false', 'aria-label': 'Your name on the score tables', placeholder: 'Your name' });
    this.nameInput.addEventListener('change', () => {
      const n = this.nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 15);
      if (n && !isClean(n)) { this.nameInput.value = this.settings.name; return; }
      this.settings.name = n;
      this.save();
    });
    this.randomWorld = el('select', { 'aria-label': 'Made from the missions of' },
      el('option', { value: '', text: 'Any world' }),
      ...WORLD_NAMES.map((n, i) => el('option', { value: String(i + 1), text: n })));
    this.codeInput = el('input', { type: 'text', maxlength: '8', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': 'Mission code', placeholder: 'Code' });
    this.randomNote = el('p', { class: 'note', 'aria-live': 'polite' });
    const fullRow = document.fullscreenEnabled
      ? el('section', null, el('h3', { text: 'Screen' }), el('div', { class: 'choices' }, this.fullButton))
      : null;
    this.panel = dialog('settings', 'Settings', () => this.close(),
      el('section', null,
        el('h3', { text: 'Interface size' }),
        el('p', { text: 'How large the game is drawn. In a bigger window, more of the map shows instead.' }),
        el('div', { class: 'choices' }, ...this.sizeButtons)),
      fullRow,
      el('section', null,
        el('h3', { text: 'Score tables' }),
        el('p', { text: 'Each mission is timed to its goal and to its bonus goal. Your best times are kept in this browser; these say whether they go on the tables everyone sees.' }),
        el('div', { class: 'choices' }, ...this.sendButtons),
        el('div', { class: 'choices name' }, this.nameInput,
          el('button', { type: 'button', class: 'choice', text: 'See the tables', onclick: () => this.openTables() }))),
      el('section', null,
        el('h3', { text: 'Random missions' }),
        el('p', { text: "A mission made from one of the game's own: its units, bricks, plans and goals are the designers', the ground between them is new. The same code makes the same mission, so a code can be shared." }),
        el('div', { class: 'choices pick' }, this.randomWorld, this.codeInput),
        el('div', { class: 'choices' },
          el('button', { type: 'button', class: 'choice', text: 'New code', onclick: () => this.newCode() }),
          el('button', { type: 'button', class: 'choice', text: 'Play', onclick: () => this.playCode() }),
          el('button', { type: 'button', class: 'choice', text: 'Copy link', onclick: () => this.copyLink() })),
        this.randomNote),
      el('section', null,
        el('h3', { text: 'Races' }),
        el('p', { text: 'Two to six players, the same mission, each in their own game: the fastest to the goal wins.' }),
        el('div', { class: 'choices' },
          el('button', { type: 'button', class: 'choice', text: 'Race with others', onclick: () => this.races && this.races.open() }))));
    this.buildTables();
    // an upright phone draws the game small: a word about turning it, until it is turned
    // or the word is closed
    this.hint = el('div', { id: 'turn-hint', role: 'status', hidden: '' },
      el('span', { text: 'Turn your phone sideways for a bigger view.' }),
      el('button', { type: 'button', 'aria-label': 'Close', text: '×', onclick: () => {
        this.hintClosed = true;
        this.checkHint();
      } }));
    window.addEventListener('resize', () => this.checkHint());
    document.addEventListener('fullscreenchange', () => this.render());
    document.body.append(this.gear, this.panel, this.tables, this.hint);
    this.checkHint();
    this.render();
  }
  buildTables() {
    this.worldSelect = el('select', { 'aria-label': 'World' },
      ...WORLD_NAMES.map((n, i) => el('option', { value: String(i + 1), text: n })),
      el('option', { value: 'all', text: 'All missions' }));
    this.randomOption = el('option', { value: '', text: '', hidden: '' });
    this.worldSelect.append(this.randomOption);
    this.missionSelect = el('select', { 'aria-label': 'Mission' });
    this.worldSelect.addEventListener('change', () => { this.fillMissions(); this.showTable(); });
    this.missionSelect.addEventListener('change', () => this.showTable());
    this.tableBody = el('div', { class: 'tables' });
    this.tables = dialog('scores', 'Score tables', () => this.closeTables(),
      el('div', { class: 'choices pick' }, this.worldSelect, this.missionSelect),
      this.tableBody);
  }
  fillMissions(selected) {
    const w = this.worldSelect.value;
    this.missionSelect.hidden = w === 'all' || w.startsWith('R-');
    if (this.missionSelect.hidden) return;
    this.missionSelect.replaceChildren(...Array.from({ length: 12 }, (_, i) => {
      const mission = w + '.' + (i + 1);
      const name = this.scores ? this.scores.missionName(mission) : 'Mission ' + (i + 1);
      return el('option', { value: mission, text: (i + 1) + '. ' + name });
    }));
    if (selected) this.missionSelect.value = selected;
  }
  async showTable() {
    const scores = this.scores;
    if (!scores) return;
    const me = (this.settings.name || '').toLowerCase();
    const w = this.worldSelect.value;
    const ask = ++this.asked;
    this.tableBody.replaceChildren(el('p', { text: 'Loading…' }));
    const rows = (list, cols) => el('table', null,
      el('thead', null, el('tr', null, ...cols.map(([h]) => el('th', { text: h })))),
      el('tbody', null, ...list.map((r, i) => el('tr', { class: r.name.toLowerCase() === me ? 'me' : '' },
        ...cols.map(([, f]) => el('td', { text: f(r, i) }))))));
    try {
      if (w === 'all') {
        const o = await scores.overall();
        if (ask !== this.asked) return;
        this.tableBody.replaceChildren(o.overall.length
          ? rows(o.overall, [['#', (r, i) => i + 1], ['Name', (r) => r.name], ['Goals', (r) => r.goals], ['Bonuses', (r) => r.bonuses], ['Goal times', (r) => clock(r.ms)]])
          : el('p', { text: 'No one is on the tables yet.' }));
        return;
      }
      const mission = w.startsWith('R-') ? w : this.missionSelect.value;
      const t = await scores.table(mission);
      if (ask !== this.asked) return;
      const mine = scores.bests[mission] || {};
      const part = (kind, title) => el('section', null,
        el('h3', { text: title + (mine[kind] !== undefined ? ' · your best ' + clock(mine[kind]) : '') }),
        t[kind].length ? rows(t[kind], [['#', (r, i) => place(t[kind], i)], ['Name', (r) => r.name], ['Time', (r) => clock(r.ms)]]) : el('p', { text: 'No times yet.' }));
      this.tableBody.replaceChildren(part('goal', 'Goal'), part('bonus', 'Bonus goal'));
    } catch (e) {
      if (ask !== this.asked) return;
      this.tableBody.replaceChildren(el('p', { text: 'The score server could not be reached.' }));
    }
  }
  openTables(mission) {
    this.panel.hidden = true;
    const m = mission || (this.scores && this.scores.attempt && this.scores.attempt.mission) || '1.1';
    const w = m.split('.')[0];
    if (m.startsWith('R-')) {
      // a generated mission's tables: an entry of its own in the list
      this.randomOption.value = m;
      this.randomOption.textContent = 'Random ' + showCode(m.slice(2));
      this.randomOption.hidden = false;
      this.worldSelect.value = m;
    } else {
      this.worldSelect.value = WORLD_NAMES[w - 1] ? w : '1';
    }
    this.fillMissions(m);
    this.tables.hidden = false;
    this.missionSelect.focus();
    this.showTable();
  }
  closeTables() {
    this.tables.hidden = true;
    this.canvas.focus();
  }
  render() {
    const size = this.forcedScale ? null : this.settings.size;
    for (const b of this.sizeButtons) b.setAttribute('aria-pressed', String(b.dataset.key === size));
    for (const b of this.sendButtons) b.setAttribute('aria-pressed', String(b.dataset.key === this.settings.scores));
    this.fullButton.setAttribute('aria-pressed', String(!!document.fullscreenElement));
    if (document.activeElement !== this.nameInput) this.nameInput.value = this.settings.name;
    if (this.random) {
      const a = this.random.active;
      if (a) {
        this.codeInput.value = showCode(a.code);
        this.randomNote.textContent = 'Playing ' + showCode(a.code) + '.';
      } else if (!this.random.canPlay()) {
        this.randomNote.textContent = 'A random mission starts from a world map.';
      } else {
        this.randomNote.textContent = '';
      }
    }
  }
  save() {
    saveSettings(this.settings);
    this.render();
  }
  checkHint() {
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const upright = window.innerHeight > window.innerWidth && window.innerWidth < 700;
    this.hint.hidden = !(touch && upright) || !!this.hintClosed;
  }
  newCode() {
    if (!this.random) return;
    const code = this.random.newCode(Number(this.randomWorld.value) || 0);
    this.codeInput.value = code ? showCode(code) : '';
    this.randomNote.textContent = '';
  }
  playCode() {
    if (!this.random) return;
    if (!this.codeInput.value.trim()) this.newCode();
    const c = parseCode(this.codeInput.value);
    const problem = c ? this.random.play(c.code) : 'A code is two characters and four more, like 6D-K2Q9.';
    if (problem) {
      this.randomNote.textContent = problem;
      return;
    }
    this.close();
  }
  copyLink() {
    const c = parseCode(this.codeInput.value) || (this.random && this.random.active && parseCode(this.random.active.code));
    if (!c) {
      this.randomNote.textContent = 'Make or type a code first.';
      return;
    }
    const url = new URL(location.href);
    url.search = '?random=' + showCode(c.code);
    url.hash = '';
    const done = () => { this.randomNote.textContent = 'Copied: ' + url.href; };
    if (navigator.clipboard) navigator.clipboard.writeText(url.href).then(done, () => { this.randomNote.textContent = url.href; });
    else this.randomNote.textContent = url.href;
  }
  apply() {
    this.save();
    this.rt.renderer.resize();
    this.rt.needsDraw = true;
  }
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  open() {
    this.render();
    this.tables.hidden = true;
    this.panel.hidden = false;
    (this.panel.querySelector('button[aria-pressed="true"]') || this.panel.querySelector('button')).focus();
  }
  close() {
    this.panel.hidden = true;
    this.canvas.focus();
  }
}
