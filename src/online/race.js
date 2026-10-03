// Races: two to six players play the same mission, each in their own game, and see how the
// others are doing (server/src/race.js keeps the race).  One player makes a race and shares
// its code (or a link, ?race=CODE); the host picks the mission, a campaign one or a
// generated one; when the host starts it, everyone's game counts down and starts the
// mission at once.  Each game tells the race when its player reaches the goal and the bonus
// goal, with the time by the game's clock, or leaves the mission; the fastest to the goal
// wins.
//
// While racing, each game also sends where its player's units are, a few times a second,
// and draws the other players' units on its own map as ghosts: their pictures, washed in
// each player's colour and see-through, at the right depth among the map's own (over the
// ground, under the interface), moving smoothly between what was last heard.  Pointing at
// a ghost (or resting a finger on it) shows whose it is, in a tag like the game's own.
// The ghosts are only pictures: nothing in one game touches the other, so nothing has to
// be kept in step.

import * as L from '../director/lingo.js';
import { el, dialog } from './dom.js';
import { WORLD_NAMES, clock, scoreServer } from './scores.js';
import { parseCode, showCode } from './random.js';

const TOKEN = 'lego-wb-online:race-token';

// Each player's colour, by their place in the race (the same in every game).
export const COLOURS = ['#e3000b', '#0057d9', '#ffcc00', '#ff7a00', '#a640d9', '#00b4c8'];
const GHOST_CHANNEL = 4001;     // after the map's own sprites (channels 200 to 4000)
const GHOST_BLEND = 60;
const UNITS_MS = 200;           // how often this game sends where its units are
const GLIDE_MAX = 120;          // stage pixels: further than this between messages is a jump

function token() {
  try {
    let t = sessionStorage.getItem(TOKEN);
    if (!t) sessionStorage.setItem(TOKEN, t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    return t;
  } catch (e) {
    return Math.random().toString(36).slice(2);
  }
}

export class Races {
  constructor(rt, ui, params) {
    this.rt = rt;
    this.ui = ui;
    this.server = scoreServer(params);
    this.code = null;
    this.ws = null;
    this.you = null;
    this.room = null;
    this.leaving = false;
    this.racing = null;     // the race under way here: {mission, started}
    this.ghosts = new Map();    // another player's id -> {prev, next}: their units as last heard
    this.ghostSprites = 0;      // how many ghost channels are in use
    this.build();
    // the ghosts are placed whenever the stage is drawn
    const layout = rt.layout;
    const before = layout.beforeDraw;
    layout.beforeDraw = (r) => {
      before.call(layout, r);
      this.drawGhosts();
    };
    this.sender = setInterval(() => this.sendUnits(), UNITS_MS);
  }

  // Leaving a mission during a race is giving up (unless the goal was reached).
  install(scripts) {
    const self = this;
    for (const s of scripts) {
      if (s.handlers.quitlevel && s.type === 'movie') {
        const quit = s.handlers.quitlevel;
        s.handlers.quitlevel = function (restartp, ...rest) {
          const r = quit.call(this, restartp, ...rest);
          if (!L.t(restartp) && self.racing && self.racing.started && !self.starting) self.send({ type: 'progress', what: 'quit' });
          return r;
        };
      }
    }
  }

  // Each goal and bonus the scores client sees reached (src/online/scores.js).
  reached(kind, ms, mission) {
    if (!this.racing || !this.racing.started || mission !== this.racing.mission) return;
    this.send({ type: 'progress', what: kind, ms });
  }

  // ---------- the connection ----------

  async create() {
    const r = await fetch(this.server + '/races', { method: 'POST' });
    const body = await r.json();
    if (!r.ok || !body.code) throw new Error(body.error || r.status);
    this.join(body.code);
    return body.code;
  }

  join(code) {
    code = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!/^[2-9A-Z]{5}$/.test(code)) {
      this.note('A race code is five letters and numbers.');
      return;
    }
    this.leave(true);
    this.code = code;
    this.leaving = false;
    this.connect();
    this.open();
  }

  connect() {
    const ws = new WebSocket(this.server.replace(/^http/, 'ws') + '/races/' + this.code + '/ws');
    this.ws = ws;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', name: this.ui.settings.name || 'Player', token: token() }));
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ type: 'ping', t: Date.now() }), 5000);
    });
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      this.onMessage(m);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      clearInterval(this.pinger);
      if (this.leaving || !this.code) return;
      // lost: back in a moment, as the same player
      this.note('Connection lost; trying again…');
      setTimeout(() => { if (this.ws === ws && !this.leaving) this.connect(); }, 2000);
    });
  }

  send(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  leave(quiet) {
    this.leaving = true;
    clearInterval(this.pinger);
    if (this.ws) try { this.ws.close(); } catch (e) { /* gone */ }
    this.ws = null;
    this.code = null;
    this.room = null;
    this.racing = null;
    this.ghosts.clear();
    this.hud.hidden = true;
    if (!quiet) this.close();
  }

  onMessage(m) {
    if (m.type === 'welcome') {
      this.you = m.you;
      this.room = m.room;
      this.note('');
    } else if (m.type === 'room') {
      this.room = m.room;
    } else if (m.type === 'start') {
      this.ghosts.clear();
      this.countdown(m.mission, m.in);
    } else if (m.type === 'units') {
      const g = this.ghosts.get(m.from) || {};
      this.ghosts.set(m.from, { prev: g.next || null, next: { t: performance.now(), u: m.u } });
      return;
    } else if (m.type === 'error') {
      const why = { full: 'That race is full.', running: 'That race has started without you.', mission: 'That mission does not exist.' }[m.reason];
      this.note(why || 'The race said no (' + m.reason + ').');
      if (m.reason === 'full' || m.reason === 'running') this.leave(true);
    }
    this.render();
  }

  // ---------- the race ----------

  countdown(mission, ms) {
    this.racing = { mission, started: false };
    this.close();
    this.ui.close();
    // (from the main menu too: the game starts, and shows, for the race)
    this.ui.enterGame({ map: false });
    const at = performance.now() + ms;
    const tick = () => {
      const left = Math.ceil((at - performance.now()) / 1000);
      if (left > 0) {
        this.count.textContent = String(left);
        this.count.hidden = false;
        this.countTimer = setTimeout(tick, 100);
        return;
      }
      this.count.textContent = 'Go!';
      setTimeout(() => { this.count.hidden = true; }, 800);
      this.begin();
    };
    clearTimeout(this.countTimer);
    tick();
  }

  begin() {
    const r = this.racing;
    if (!r) return;
    // (leaving the mission played until now is not giving up the race)
    this.starting = true;
    let problem;
    try {
      problem = this.ui.random.go(r.mission);
    } finally {
      this.starting = false;
    }
    if (problem) {
      this.note(problem);
      this.send({ type: 'progress', what: 'quit' });
      return;
    }
    r.started = true;
    this.send({ type: 'progress', what: 'started' });
    this.rt.canvas.focus();
    this.render();
  }

  // ---------- ghosts ----------

  mapDisplay() {
    const glob = this.rt.globals.glob;
    if (!glob || this.rt.labelAt(this.rt.frame) !== 'play') return null;
    const md = L.gp(glob, 'map_display');
    return md instanceof L.LInstance ? md : null;
  }

  // In this race's mission, as it is being played here.
  inRace() {
    const r = this.racing;
    const a = this.ui.scores && this.ui.scores.attempt;
    return !!(r && r.started && this.room && this.room.phase !== 'lobby' && a && a.mission === r.mission && this.mapDisplay());
  }

  // Where this player's units are: [member, x, y, column, row, flipped] each, x and y from
  // the map's corner (tile 0, 0), so that any game can put them on its own map whatever
  // it is scrolled to.
  sendUnits() {
    if (!this.inRace()) return;
    const md = this.mapDisplay();
    let units = [];
    try {
      const glob = this.rt.globals.glob;
      const corner = L.mc(md, 'postoloc', new L.LPoint(0, 0));
      const objects = L.gp(glob, 'objects');
      for (const o of (objects && objects.a) || []) {
        if (!(o instanceof L.LInstance) || L.t(L.gp(o, 'pdead'))) continue;
        const cls = L.gp(o, 'pclass');
        if (!cls || !cls.a || !cls.a[0] || cls.a[0].key !== 'vehicle') continue;
        const main = L.gp(L.gp(o, 'psprites'), 'main');
        const tile = L.gp(o, 'ptile');
        const pos = tile && L.gp(tile, 'pos');
        if (!main || !main.member || !main.member.name || !pos || !pos.a) continue;
        if (Math.abs(main.locH - corner.h) > 5000) continue;    // (hidden in fog)
        units.push([main.member.name, main.locH - corner.h, main.locV - corner.v, pos.a[0], pos.a[1], main.flipH ? 1 : 0]);
      }
    } catch (e) {
      units = [];
    }
    this.send({ type: 'units', u: units.slice(0, 60) });
  }

  colour(id) {
    const i = this.room ? this.room.players.findIndex((p) => p.id === id) : -1;
    return COLOURS[(i < 0 ? 0 : i) % COLOURS.length];
  }

  // The other players' units on this map, each frame drawn.
  drawGhosts() {
    const rt = this.rt;
    let n = 0;
    const md = this.inRace() ? this.mapDisplay() : null;
    const placed = [];
    if (md) {
      const corner = L.mc(md, 'postoloc', new L.LPoint(0, 0));
      const now = performance.now();
      for (const [id, g] of this.ghosts) {
        const player = this.room.players.find((p) => p.id === id);
        if (!player || player.quit || !g.next) continue;
        // between the last two messages, as they came (a message's worth behind)
        const prev = g.prev && g.prev.u.length === g.next.u.length ? g.prev.u : null;
        const f = Math.min(1, (now - g.next.t) / UNITS_MS);
        for (let i = 0; i < g.next.u.length; i++) {
          const [name, x, y, col, row, flip] = g.next.u[i];
          // (the same unit as before, moving, glides; one that jumped further than a unit
          // moves between two messages, or appeared, is put straight where it is)
          let was = prev && prev[i][0].split('.').slice(0, 2).join() === name.split('.').slice(0, 2).join() ? prev[i] : null;
          if (was && Math.hypot(x - was[1], y - was[2]) > GLIDE_MAX) was = null;
          const gx = was ? was[1] + (x - was[1]) * f : x;
          const gy = was ? was[2] + (y - was[2]) * f : y;
          const s = rt.sprite(GHOST_CHANNEL + n);
          s.puppet = true;
          if (!s.member || s.member.name !== name) L.sp(s, 'member', name);
          s.locH = Math.round(corner.h + gx);
          s.locV = Math.round(corner.v + gy);
          s.locZ = L.mc(md, 'postolocz', L.list([col, row])) + 7;
          s.ink = 36;
          s.blend = GHOST_BLEND;
          s.flipH = !!flip;
          s.visible = true;
          s.tint = this.colour(id);
          placed.push({ s, player });
          n++;
        }
      }
    }
    for (let i = n; i < this.ghostSprites; i++) {
      const s = rt.sprites[GHOST_CHANNEL + i];
      if (s) { s.visible = false; s.tint = null; }
    }
    this.ghostSprites = n;
    this.tagGhost(placed);
  }

  // The tag over the ghost under the pointer.
  tagGhost(placed) {
    const rt = this.rt;
    const r = rt.renderer;
    let hit = null;
    for (const g of placed.slice().sort((a, b) => b.s.locZ - a.s.locZ)) {
      if (r.hit(g.s, rt.mouse.x, rt.mouse.y)) { hit = g; break; }
    }
    if (!hit) {
      this.tag.hidden = true;
      return;
    }
    const rect = rt.canvas.getBoundingClientRect();
    const box = rt.box || { x: 0, y: 0 };
    const px = (sx, sy) => [rect.left + ((sx + box.x) * r.scale + r.ox) / r.dpr, rect.top + ((sy + box.y) * r.scale + r.oy) / r.dpr];
    const [x, y] = px(hit.s.locH, hit.s.top);
    this.tagName.textContent = hit.player.name;
    this.tagDot.style.background = this.colour(hit.player.id);
    this.tag.style.left = Math.round(x) + 'px';
    this.tag.style.top = Math.round(y - 6) + 'px';
    this.tag.hidden = false;
  }

  missionName(mission) {
    if (!mission) return 'not chosen yet';
    const s = this.ui.scores;
    if (mission.startsWith('R-')) return 'Random ' + showCode(mission.slice(2));
    const [w, l] = mission.split('.').map(Number);
    return WORLD_NAMES[w - 1] + ', ' + l + '. ' + (s ? s.missionName(mission) : 'Mission ' + l);
  }

  // The players as the race stands: the goal reached first, fastest first; then those
  // still at it; then those who gave up.
  standings() {
    const ps = (this.room && this.room.players) || [];
    const rank = (p) => (p.goal !== null ? 0 : p.quit ? 2 : 1);
    return ps.slice().sort((a, b) => (rank(a) - rank(b)) || ((a.goal || 0) - (b.goal || 0)));
  }

  status(p) {
    const r = this.room;
    if (r.phase === 'lobby') return p.ready || p.id === r.host ? 'ready' : 'not ready';
    if (p.goal !== null) return 'goal ' + clock(p.goal) + (p.bonus !== null ? ', bonus ' + clock(p.bonus) : '');
    if (p.quit) return 'gave up';
    if (!p.connected) return 'away';
    return p.started ? 'racing' : 'starting';
  }

  // ---------- what the player sees ----------

  build() {
    this.codeInput = el('input', { type: 'text', maxlength: '6', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': 'Race code', placeholder: 'Code' });
    this.worldSelect = el('select', { 'aria-label': 'World' },
      ...WORLD_NAMES.map((n, i) => el('option', { value: String(i + 1), text: n })),
      el('option', { value: 'R', text: 'A random mission' }));
    this.missionSelect = el('select', { 'aria-label': 'Mission' });
    this.randomInput = el('input', { type: 'text', maxlength: '8', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': 'Random mission code', placeholder: 'Code' });
    this.worldSelect.addEventListener('change', () => this.fillMissions());
    for (const e of [this.missionSelect, this.randomInput]) e.addEventListener('change', () => this.pickMission());
    this.newRandom = el('button', { type: 'button', class: 'choice', text: 'New code', onclick: () => {
      const code = this.ui.random.newCode(0);
      this.randomInput.value = code ? showCode(code) : '';
      this.pickMission();
    } });
    this.chooser = el('div', null,
      el('h3', { text: 'Mission' }),
      el('div', { class: 'choices pick' }, this.worldSelect, this.missionSelect, this.randomInput, this.newRandom));
    this.missionLine = el('p');
    this.list = el('ol', { class: 'players' });
    this.message = el('p', { class: 'note', 'aria-live': 'polite' });
    this.readyButton = el('button', { type: 'button', class: 'choice', text: 'Ready', onclick: () => this.send({ type: 'ready', ready: !this.me().ready }) });
    this.startButton = el('button', { type: 'button', class: 'choice', text: 'Start the race', onclick: () => this.send({ type: 'start' }) });
    this.againButton = el('button', { type: 'button', class: 'choice', text: 'Race again', onclick: () => this.send({ type: 'again' }) });
    this.linkButton = el('button', { type: 'button', class: 'choice', text: 'Copy link', onclick: () => this.copyLink() });
    this.leaveButton = el('button', { type: 'button', class: 'choice', text: 'Leave the race', onclick: () => this.leave() });
    this.outside = el('div', null,
      el('p', { text: 'Two to six players play the same mission, each in their own game; the fastest to the goal wins. Make a race and share its code, or join one.' }),
      el('div', { class: 'choices pick' },
        el('button', { type: 'button', class: 'choice', text: 'Make a race', onclick: () => this.create().catch(() => this.note('The race server could not be reached.')) }),
        this.codeInput,
        el('button', { type: 'button', class: 'choice', text: 'Join', onclick: () => this.join(this.codeInput.value) })));
    this.inside = el('div', null,
      this.missionLine, this.chooser,
      el('h3', { text: 'Players' }), this.list,
      el('div', { class: 'choices' }, this.readyButton, this.startButton, this.againButton, this.linkButton, this.leaveButton));
    this.panel = dialog('race', 'Race', () => this.close(), this.outside, this.inside, this.message);
    this.hud = el('button', { type: 'button', id: 'race-hud', hidden: '', onclick: () => this.open() });
    this.count = el('div', { id: 'race-count', hidden: '', 'aria-live': 'assertive' });
    this.tagDot = el('span', { class: 'dot' });
    this.tagName = el('span');
    this.tag = el('div', { id: 'ghost-tag', hidden: '' }, this.tagDot, this.tagName);
    document.body.append(this.panel, this.hud, this.count, this.tag);
    this.fillMissions();
  }

  fillMissions() {
    const w = this.worldSelect.value;
    const random = w === 'R';
    this.missionSelect.hidden = random;
    this.randomInput.hidden = !random;
    this.newRandom.hidden = !random;
    if (!random) {
      this.missionSelect.replaceChildren(...Array.from({ length: 12 }, (_, i) => {
        const mission = w + '.' + (i + 1);
        const s = this.ui.scores;
        return el('option', { value: mission, text: (i + 1) + '. ' + (s ? s.missionName(mission) : 'Mission ' + (i + 1)) });
      }));
      // (the tutorial's mission is no race: World One's second to begin with)
      if (w === '1' && !this.room) this.missionSelect.value = '1.2';
    } else if (!this.randomInput.value) {
      const code = this.ui.random && this.ui.random.newCode(0);
      this.randomInput.value = code ? showCode(code) : '';
    }
    this.pickMission();
  }

  pickMission() {
    if (!this.room || this.room.host !== this.you || this.room.phase !== 'lobby') return;
    let mission = this.missionSelect.value;
    if (this.worldSelect.value === 'R') {
      const c = parseCode(this.randomInput.value);
      if (!c || !this.ui.random.make(c.code)) {
        this.note('That code makes no mission.');
        return;
      }
      mission = 'R-' + c.code;
    }
    this.note('');
    if (mission !== this.room.mission) this.send({ type: 'mission', mission });
  }

  me() {
    return (this.room && this.room.players.find((p) => p.id === this.you)) || {};
  }

  render() {
    const r = this.room;
    this.outside.hidden = !!this.code;
    this.inside.hidden = !this.code;
    if (!r) {
      this.panel.querySelector('h2').textContent = this.code ? 'Race ' + this.code : 'Race';
      this.hud.hidden = true;
      return;
    }
    const host = r.host === this.you;
    this.panel.querySelector('h2').textContent = 'Race ' + r.code;
    this.missionLine.textContent = 'Mission: ' + this.missionName(r.mission);
    this.chooser.hidden = !host || r.phase !== 'lobby';
    // (the host's first visit: their choice goes to the race)
    if (host && r.phase === 'lobby' && !r.mission) this.pickMission();
    this.list.replaceChildren(...this.standings().map((p) => el('li', { class: p.id === this.you ? 'me' : '' },
      el('span', { class: 'name' }, el('span', { class: 'dot', style: 'background:' + this.colour(p.id) }), p.name + (p.id === r.host ? ' (host)' : '')),
      el('span', { class: 'status', text: this.status(p) }))));
    this.readyButton.hidden = host || r.phase !== 'lobby';
    this.readyButton.textContent = this.me().ready ? 'Not ready' : 'Ready';
    this.startButton.hidden = !host || r.phase !== 'lobby';
    this.startButton.disabled = !r.mission || r.players.length < 1;
    this.againButton.hidden = !host || r.phase === 'lobby';
    if (r.phase === 'done') {
      const won = this.standings()[0];
      this.note(won && won.goal !== null ? won.name + ' won, in ' + clock(won.goal) + '.' : 'No one reached the goal.');
    }
    // the race in the corner, while it is on and after
    this.hud.hidden = r.phase === 'lobby';
    if (!this.hud.hidden) {
      this.hud.replaceChildren(el('b', { text: r.phase === 'done' ? 'Race over' : 'Race' }),
        ...this.standings().map((p, i) => el('div', { class: p.id === this.you ? 'me' : '' },
          el('span', { class: 'dot', style: 'background:' + this.colour(p.id) }),
          (p.goal !== null ? (i + 1) + '. ' : '') + p.name + ': ' + this.status(p))));
    }
  }

  note(text) {
    this.message.textContent = text;
  }

  copyLink() {
    const url = new URL(location.href);
    url.search = '?race=' + this.code;
    url.hash = '';
    const done = () => this.note('Copied: ' + url.href);
    if (navigator.clipboard) navigator.clipboard.writeText(url.href).then(done, () => this.note(url.href));
    else this.note(url.href);
  }

  open() {
    this.ui.close();
    this.render();
    this.panel.hidden = false;
    (this.code ? this.panel.querySelector('.done') : this.codeInput).focus();
  }

  close() {
    this.panel.hidden = true;
    this.ui.focusGame();
  }
}
