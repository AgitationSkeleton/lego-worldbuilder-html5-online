// The online game's own controls, outside the game: a settings button in the window's
// corner, the settings it opens, and the score tables, drawn like the game's own bubbles
// (white, a black rounded edge, green buttons in the game's pixel font).

import { UI_SCALES, loadSettings, saveSettings } from './settings.js';
import { isClean } from './profanity.js';
import { WORLD_NAMES, clock } from './scores.js';
import { parseCode, showCode } from './puzzle.js';
import { el, dialog, focusField } from './dom.js';

const SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
  ['fill', 'Fill window'],
];

// (a generated mission's code says how hard it is and how it looks: src/online/puzzle.js)
const DIFFICULTIES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const LOOKS = { A: 'Grassland', B: 'Prehistoric', C: 'Jungle', D: 'City' };

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
    this.history = null;    // and those played here (src/online/history.js)
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
    // Sound: a slider for each kind's loudness (src/online/controls.js); the sounds' sliders
    // play one as they are let go.
    const slider = (key, sample) => {
      const input = el('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': key });
      input.addEventListener('input', () => { this.settings[key] = Number(input.value) / 100; this.save(); this.applySound(); });
      if (sample) input.addEventListener('change', () => this.controls && this.controls.sfx(sample));
      return input;
    };
    this.sliders = {
      music: slider('music'),
      sound: slider('sound', 'sfx_game_assembly'),
      ui: slider('ui', 'sfx_interface_click_button'),
    };
    // Controls: an On and an Off for each switch.
    this.switches = {};
    const toggle = (key) => {
      const b = [true, false].map((on) => el('button', {
        type: 'button', class: 'choice', text: on ? 'On' : 'Off', 'data-on': String(on),
        onclick: () => { this.settings[key] = on; this.save(); },
      }));
      this.switches[key] = b;
      return el('div', { class: 'choices' }, ...b);
    };
    const row = (label, control) => el('div', { class: 'row' }, el('span', { class: 'label', text: label }), control);
    this.randomDifficulty = el('select', { 'aria-label': 'Difficulty' },
      el('option', { value: '1', text: 'Easy' }),
      el('option', { value: '2', text: 'Medium' }),
      el('option', { value: '3', text: 'Hard' }),
      el('option', { value: '', text: 'Random', selected: '' }));
    this.randomLook = el('select', { 'aria-label': 'Look' },
      el('option', { value: '', text: 'Any look' }),
      el('option', { value: 'A', text: 'Grassland' }),
      el('option', { value: 'B', text: 'Prehistoric' }),
      el('option', { value: 'C', text: 'Jungle' }),
      el('option', { value: 'D', text: 'City' }));
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
        el('h3', { text: 'Sound' }),
        row('Music', this.sliders.music),
        row('Sounds', this.sliders.sound),
        row('Interface sounds', this.sliders.ui)),
      el('section', null,
        el('h3', { text: 'Controls' }),
        row('Menu Button Pauses Game', toggle('menuPauses')),
        row('Mouse 2 Camera Pan', toggle('panRight')),
        row('Mouse 3 Camera Pan', toggle('panMiddle')),
        row('Mouse 2 Deselect', toggle('deselectRight')),
        row('Smooth Arrow-Key Camera', toggle('smoothKeys')),
        row('Smooth Unit Movement', toggle('smoothUnits'))),
      el('section', null,
        el('h3', { text: 'Score tables' }),
        el('p', { text: 'Each mission is timed to its goal and to its bonus goal. Your best times are kept in this browser; these say whether they go on the tables everyone sees.' }),
        el('div', { class: 'choices' }, ...this.sendButtons),
        el('div', { class: 'choices name' }, this.nameInput)),
      this.leaveSection = el('section', null,
        el('h3', { text: 'Leave' }),
        el('p', { text: 'Back to the main menu (a mission being played is left).' }),
        el('div', { class: 'choices' },
          el('button', { type: 'button', class: 'choice', text: 'Main menu', onclick: () => this.showMenu() }))));
    // (the generated missions played here before: src/online/history.js)
    this.seedList = el('ul', { class: 'seeds' });
    this.seedEmpty = el('p', { class: 'note', text: 'The random missions you play are kept here.' });
    this.randomPanel = dialog('random', 'Random mission', () => this.closeRandom(),
      el('div', { class: 'choices pick' }, this.randomDifficulty, this.randomLook),
      el('div', { class: 'choices pick' }, this.codeInput),
      el('div', { class: 'choices' },
        el('button', { type: 'button', class: 'choice', text: 'New code', onclick: () => this.newCode() }),
        this.randomPlay = el('button', { type: 'button', class: 'choice', text: 'Play', onclick: () => this.playCode() }),
        el('button', { type: 'button', class: 'choice', text: 'Copy link', onclick: () => this.copyLink() })),
      this.randomNote,
      el('section', { class: 'history' }, el('h3', { text: 'Seed History' }), this.seedEmpty, this.seedList));
    this.buildTables();
    document.addEventListener('fullscreenchange', () => this.render());
    document.body.append(this.gear, this.panel, this.randomPanel, this.tables);
    // the panels' buttons click as the game's own do
    document.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('.panel button') && this.controls) this.controls.sfx('sfx_interface_click_button');
    }, true);
    this.render();
  }
  buildTables() {
    this.worldSelect = el('select', { 'aria-label': 'World' },
      ...WORLD_NAMES.map((n, i) => el('option', { value: String(i + 1), text: n })),
      el('option', { value: 'all', text: 'All missions' }));
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
    this.missionSelect.hidden = w === 'all';
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
      const mission = this.missionSelect.value;
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
  // All missions' table, or a mission's (a result's own, from its line under it)
  openTables(mission) {
    this.panel.hidden = true;
    // (generated missions are not on the tables)
    const m = mission && !mission.startsWith('R-') ? mission : null;
    const w = m ? m.split('.')[0] : 'all';
    this.worldSelect.value = w === 'all' || WORLD_NAMES[w - 1] ? w : 'all';
    this.fillMissions(m);
    this.tables.hidden = false;
    (this.missionSelect.hidden ? this.worldSelect : this.missionSelect).focus();
    this.showTable();
  }
  closeTables() {
    this.tables.hidden = true;
    this.focusGame();
  }
  render() {
    const size = this.forcedScale ? null : this.settings.size;
    for (const b of this.sizeButtons) b.setAttribute('aria-pressed', String(b.dataset.key === size));
    for (const b of this.sendButtons) b.setAttribute('aria-pressed', String(b.dataset.key === this.settings.scores));
    for (const [key, input] of Object.entries(this.sliders)) {
      if (document.activeElement !== input) input.value = String(Math.round(this.settings[key] * 100));
    }
    for (const [key, buttons] of Object.entries(this.switches)) {
      for (const b of buttons) b.setAttribute('aria-pressed', String((b.dataset.on === 'true') === !!this.settings[key]));
    }
    this.fullButton.setAttribute('aria-pressed', String(!!document.fullscreenElement));
    if (document.activeElement !== this.nameInput) this.nameInput.value = this.settings.name;
    if (this.random) {
      const a = this.random.active;
      this.randomNote.textContent = a ? 'Playing ' + showCode(a.code) + '.' : '';
    }
  }
  applySound() {
    if (this.controls) this.controls.applyVolumes();
  }
  save() {
    saveSettings(this.settings);
    this.render();
  }
  newCode() {
    if (!this.random) return;
    const code = this.random.newCode(Number(this.randomDifficulty.value) || 0, this.randomLook.value || '');
    this.codeInput.value = code ? showCode(code) : '';
    this.randomNote.textContent = '';
  }
  playCode() {
    if (!this.random) return;
    if (!this.codeInput.value.trim()) this.newCode();
    const c = parseCode(this.codeInput.value);
    if (!c) {
      this.randomNote.textContent = 'A code is two characters and four more, like 2C-K2Q9.';
      return;
    }
    if (!this.random.make(c.code)) {
      this.randomNote.textContent = 'That code makes no mission.';
      return;
    }
    this.enterGame({ map: false });
    const problem = this.random.go('R-' + c.code);
    if (problem) {
      this.randomNote.textContent = problem;
      return;
    }
    this.closeRandom();
  }
  // (blank unless a code is given: Play with no code makes a new mission and starts it)
  openRandom(code) {
    this.panel.hidden = true;
    this.codeInput.value = code || '';
    this.render();
    this.renderSeeds();
    this.randomPanel.hidden = false;
    // (on a phone, not the code: Play makes one)
    focusField(this.codeInput, this.randomPlay);
  }
  // The Seed History: each generated mission played here, the last first, with the world
  // map's own flags for its goal and its bonus goal (grey until reached) and the best times
  // to them, and a Play button.
  renderSeeds() {
    const list = this.history ? this.history.list : [];
    this.seedEmpty.hidden = list.length > 0;
    if (!this.flags || !this.flags.goal) this.flags = { goal: this.icon('flag1'), bonus: this.icon('bonus_flag1') };
    const result = (kind, ms) => {
      const name = kind === 'goal' ? 'Goal' : 'Bonus goal';
      const done = ms !== null;
      return el('span', { class: 'result' + (done ? '' : ' none'), title: done ? name + ' in ' + clock(ms) : name + ' not reached yet' },
        this.flags[kind] ? el('img', { src: this.flags[kind], alt: name }) : null,
        el('span', { class: 'time', text: done ? clock(ms) : '–' }));
    };
    this.seedList.replaceChildren(...list.map((e) => {
      const c = parseCode(e.code);
      return el('li', null,
        el('span', { class: 'seed' },
          el('b', { text: showCode(e.code) }),
          el('span', { class: 'what', text: DIFFICULTIES[c.difficulty] + ' · ' + LOOKS[c.look] })),
        result('goal', e.goal),
        result('bonus', e.bonus),
        el('button', { type: 'button', class: 'choice', text: 'Play', 'aria-label': 'Play ' + showCode(e.code), onclick: () => this.playSeed(e.code) }));
    }));
  }
  playSeed(code) {
    this.codeInput.value = showCode(code);
    this.playCode();
  }
  // A picture of the game's for the page, as the game draws it (its ink; the world map's
  // flags are matte on the map): a data URL, or null before the game has loaded.
  icon(name) {
    const rt = this.rt;
    const m = rt.builtins.member(name);
    if (!m || !m.width || !rt.renderer || !rt.bitmapBytes) return null;
    try {
      const c = document.createElement('canvas');
      c.width = m.width;
      c.height = m.height;
      rt.renderer.drawSprite(c.getContext('2d'), { member: m, ink: 8, blend: 100, foreColor: 255, backColor: 0, left: 0, top: 0, width: m.width, height: m.height });
      return c.toDataURL();
    } catch (e) {
      return null;
    }
  }
  closeRandom() {
    this.randomPanel.hidden = true;
    this.focusGame();
  }
  // Into the game, from the main menu: it starts if it has not yet (the menu's click lets
  // its sound play), at the first world map unless asked not to.
  enterGame(opts = {}) {
    const rt = this.rt;
    rt.sound.resume();
    if (this.menu) this.menu.hide();
    if (!rt.started) {
      rt.run();
      if (rt.testMode) rt.step(0);
    }
    if (opts.map !== false && !/^(world \d|play)$/.test(rt.labelAt(rt.frame) || '')) {
      rt.go('world 1');
      if (rt.testMode) rt.step(1);
    }
    this.canvas.focus();
  }
  // Back to the main menu, leaving a mission being played.
  showMenu() {
    this.panel.hidden = true;
    const rt = this.rt;
    const glob = rt.started && rt.globals.glob;
    if (glob && this.random && rt.labelAt(rt.frame) === 'play') {
      const main = rt.movieHandlers.quitlevel.script;
      this.random.quietly(() => rt.call(rt.scriptSelf(main), main, 'quitlevel'));
    }
    if (this.menu) this.menu.show();
  }
  // A mission played out of the campaign's order (a generated one, a race's) left by the
  // game itself (its End Mission, its goal popups' Main Menu, its menu's quit): not the world
  // map the game would go to, which the campaign may not have got to (src/online/missions.js),
  // but the main menu; the race's panel over it, after a race. (A generated mission's goal
  // popups offer a new one as well: newRandomMission, src/main.js.)
  randomLeft(how) {
    this.showMenu();
    if (how.race && this.races && this.races.code) this.races.open();
  }
  // A new generated mission, as the random-mission panel is set, the one being played left.
  playAnother() {
    this.codeInput.value = '';
    this.randomNote.textContent = '';
    this.playCode();
    // (if it could not start, the random-mission panel says why)
    if (this.randomNote.textContent) this.openRandom();
  }
  // Focus back where it belongs: the menu if it is up, else the game.
  focusGame() {
    if (this.menu && this.menu.shown) this.menu.show();
    else this.canvas.focus();
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
    // (from the main menu, there is nowhere to leave)
    this.leaveSection.hidden = !!(this.menu && this.menu.shown);
    this.tables.hidden = true;
    this.panel.hidden = false;
    (this.panel.querySelector('button[aria-pressed="true"]') || this.panel.querySelector('button')).focus();
  }
  close() {
    this.panel.hidden = true;
    this.focusGame();
  }
}
