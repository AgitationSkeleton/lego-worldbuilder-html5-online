// Times and the score tables.  Neither game kept scores, but each mission has a clock: a
// result is the time from the mission's start (startlevel; a restart starts again) to its
// goal, and to its bonus goal, which opens once the goal is reached.  Both are timed by the
// game's own clock, as the panel's clock shows it.
//
// The player's best times are kept in the browser.  Sending them to the score tables
// (server/, at wbserver.viosarcade.xyz) is the player's choice, in the settings: ask each
// time (the first time, a name is asked for), always, or never.  The tutorial is not timed.

import * as L from '../director/lingo.js';
import { isClean } from './profanity.js';
import { showCode } from './random.js';

const BESTS = 'lego-wb-online:bests';

export const WORLD_NAMES = ['World One', 'World Two', 'World Three', 'Ocean World', 'Prehistoric World',
  'World Builder 2: World One', 'World Builder 2: World Two'];

// The server; ?server=URL (its root) points the game at another, for testing.
export function scoreServer(params) {
  const root = params.get('server') || 'https://wbserver.viosarcade.xyz';
  return root.replace(/\/+$/, '');
}

// A time as the game's clock shows it: "3:07", "1:02:45".
export function clock(ms) {
  const t = Math.floor(ms / 1000);
  const s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

function loadBests() {
  try {
    const b = JSON.parse(localStorage.getItem(BESTS) || '{}');
    return b && typeof b === 'object' ? b : {};
  } catch (e) {
    return {};
  }
}

function saveBests(b) {
  try {
    localStorage.setItem(BESTS, JSON.stringify(b));
  } catch (e) {
    // (kept for the visit)
  }
}

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

export class Scores {
  // ui: the settings (src/online/ui.js), whose `settings` hold the name and the choice
  constructor(rt, ui, params) {
    this.rt = rt;
    this.ui = ui;
    this.server = scoreServer(params);
    // the test mode's runs send nothing, unless pointed at a server on purpose
    this.sending = !params.has('test') || params.has('server');
    this.bests = loadBests();
    this.attempt = null;
    this.random = null;     // the generated missions (src/online/missions.js), set by main.js
    this.toast = el('div', { id: 'scores-toast', role: 'status', hidden: '' });
    document.body.append(this.toast);
  }

  // Hooks into the game's scripts, before the runtime binds them: the start of a mission,
  // and the worlds manager hearing that a goal was reached.
  install(scripts) {
    const self = this;
    for (const s of scripts) {
      if (s.handlers.startlevel && s.type === 'movie') {
        const start = s.handlers.startlevel;
        s.handlers.startlevel = function (...args) {
          const r = start.apply(this, args);
          self.started();
          return r;
        };
      }
      if (s.name === 'worlds manager' && s.handlers.reportsuccess) {
        const report = s.handlers.reportsuccess;
        s.handlers.reportsuccess = function (me, a, ...rest) {
          const r = report.call(this, me, a, ...rest);
          const kind = a instanceof L.LSymbol ? a.key.toLowerCase() : '';
          if (kind === 'goal' || kind === 'bonus') self.reached(kind);
          return r;
        };
      }
    }
  }

  glob(name) {
    const glob = this.rt.globals.glob;
    return glob ? L.gp(glob, name) : undefined;
  }

  tutorial() {
    const glob = this.rt.globals.glob;
    return !!(glob && L.t(L.gi(glob, L.sym('tutorialMode'))));
  }

  started() {
    const level = this.glob('currentlevel');
    if (!level) return;
    const w = L.gp(level, 'worldnum'), l = L.gp(level, 'levelnum');
    // a generated mission has a table of its own, by its code
    const random = this.random && this.random.active;
    const mission = random ? 'R-' + random.code : w + '.' + l;
    this.attempt = { mission, start: this.rt.millis(), tutorial: !random && (this.tutorial() || w > 7) };
  }

  missionName(mission) {
    if (mission.startsWith('R-')) return 'Random ' + showCode(mission.slice(2));
    const [w, l] = mission.split('.').map(Number);
    try {
      const names = this.glob('mission_names');
      const n = names ? L.gi(L.gi(names, w), l) : '';
      return typeof n === 'string' && n.trim() ? n.trim() : 'Mission ' + l;
    } catch (e) {
      return 'Mission ' + l;
    }
  }

  reached(kind) {
    const a = this.attempt;
    if (!a || a.tutorial || this.tutorial()) return;
    if (a[kind]) return;
    const ms = Math.round(this.rt.millis() - a.start);
    a[kind] = ms;
    const mine = this.bests[a.mission] || (this.bests[a.mission] = {});
    const prev = mine[kind];
    if (prev === undefined || ms < prev) mine[kind] = ms;
    saveBests(this.bests);
    const what = (kind === 'bonus' ? 'Bonus' : 'Goal') + ' in ' + clock(ms);
    const note = prev === undefined ? '' : ms < prev ? 'a new best' : 'your best is ' + clock(prev);
    const choice = this.ui.settings.scores;
    if (!this.sending || choice === 'never') {
      this.show(what, note);
    } else if (choice === 'always' && this.ui.settings.name) {
      this.show(what, note, 'Sending…');
      this.send(a.mission, kind, ms);
    } else {
      this.ask(a.mission, kind, ms, what, note);
    }
  }

  async send(mission, kind, ms) {
    try {
      const r = await fetch(this.server + '/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission, kind, ms, name: this.ui.settings.name }),
      });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error || r.status);
      this.line('#' + body.rank + ' of ' + body.of + ' on the table', () => this.ui.openTables(mission));
    } catch (e) {
      this.line('The score server could not be reached.');
    }
  }

  // The toast: what was reached, and a line under it.
  show(what, note, line) {
    clearTimeout(this.hideTimer);
    this.toast.replaceChildren(...[
      el('b', { text: what }),
      note ? el('span', { class: 'note', text: ' · ' + note }) : null,
      line ? el('div', { class: 'line', text: line }) : null].filter(Boolean));
    this.toast.hidden = false;
    this.hideTimer = setTimeout(() => { this.toast.hidden = true; }, 7000);
  }

  line(text, onclick) {
    let line = this.toast.querySelector('.line');
    if (!line) this.toast.append(line = el('div', { class: 'line' }));
    line.replaceChildren(onclick ? el('button', { type: 'button', class: 'link', text, onclick }) : text);
    clearTimeout(this.hideTimer);
    this.toast.hidden = false;
    this.hideTimer = setTimeout(() => { this.toast.hidden = true; }, 7000);
  }

  // Asked: put this time on the table?  With the name to put it under.
  ask(mission, kind, ms, what, note) {
    clearTimeout(this.hideTimer);
    const name = el('input', { type: 'text', maxlength: '15', autocomplete: 'nickname', spellcheck: 'false', 'aria-label': 'Your name', placeholder: 'Your name' });
    name.value = this.ui.settings.name || '';
    const always = el('input', { type: 'checkbox' });
    const done = () => { this.toast.hidden = true; this.rt.canvas.focus(); };
    const form = el('form', { class: 'ask' },
      el('div', { text: 'Put it on the score table?' }),
      el('div', { class: 'row' }, name,
        el('button', { type: 'submit', class: 'send', text: 'Send' }),
        el('button', { type: 'button', class: 'skip', text: 'Not now', onclick: done })),
      el('label', { class: 'always' }, always, ' Always send my times'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = name.value.replace(/\s+/g, ' ').trim().slice(0, 15);
      if (!n || !isClean(n)) {
        name.focus();
        name.select();
        return;
      }
      this.ui.settings.name = n;
      if (always.checked) this.ui.settings.scores = 'always';
      this.ui.save();
      this.show(what, note, 'Sending…');
      this.send(mission, kind, ms);
      this.rt.canvas.focus();
    });
    // (keys typed here are not the game's)
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); e.stopPropagation(); });
    this.toast.replaceChildren(...[el('b', { text: what }), note ? el('span', { class: 'note', text: ' · ' + note }) : null, form].filter(Boolean));
    this.toast.hidden = false;
  }

  async table(mission) {
    const r = await fetch(this.server + '/scores?mission=' + encodeURIComponent(mission));
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async overall() {
    const r = await fetch(this.server + '/scores/overall');
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
}
