// Races: two to six players play the same mission, each in their own game, and see how the
// others are doing (server/src/race.js keeps the race).  The race page is a lobby, as
// CrystAlien Conflict Online has one: the races open to anyone, listed by the server
// (server/src/lobby.js), to join; a race to host, open to anyone or by invitation (its
// code, or a link, ?race=CODE); and in a race, its players, its chat, and the mission the
// host picks, a campaign one or a generated one, shown as a small map with its name.  When
// the host starts it, everyone's game counts down and starts the mission at once.  Each game tells the race when its player reaches the goal and the bonus
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
import { parseCode, showCode } from './puzzle.js';

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

  async create(access) {
    const r = await fetch(this.server + '/races', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access: access === 'invite' ? 'invite' : 'public' }),
    });
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
    this.chat = [];
    this.ghosts.clear();
    this.hud.hidden = true;
    if (!quiet) this.close();
  }

  onMessage(m) {
    if (m.type === 'welcome') {
      this.you = m.you;
      this.room = m.room;
      this.chat = Array.isArray(m.chat) ? m.chat.slice() : [];
      this.renderChat();
      this.note('');
    } else if (m.type === 'room') {
      this.room = m.room;
    } else if (m.type === 'start') {
      this.ghosts.clear();
      this.countdown(m.mission, m.in);
    } else if (m.type === 'chat') {
      this.chat.push(m);
      if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);
      this.renderChat();
      return;
    } else if (m.type === 'units') {
      const g = this.ghosts.get(m.from) || {};
      this.ghosts.set(m.from, { prev: g.next || null, next: { t: performance.now(), u: m.u } });
      return;
    } else if (m.type === 'error') {
      const why = { full: 'That race is full.', running: 'That race has started without you.', mission: 'That mission does not exist.', 'slow down': 'Not so fast: wait a moment before saying more.' }[m.reason];
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
      problem = this.ui.random.go(r.mission, true);
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
    const z = placed.length ? rt.zoomOf(placed[0].s) : 1;
    for (const g of placed.slice().sort((a, b) => b.s.locZ - a.s.locZ)) {
      if (r.hit(g.s, rt.mouse.x / z, rt.mouse.y / z)) { hit = g; break; }
    }
    if (!hit) {
      this.tag.hidden = true;
      return;
    }
    const rect = rt.canvas.getBoundingClientRect();
    const box = rt.box || { x: 0, y: 0 };
    const px = (sx, sy) => [rect.left + ((sx + box.x) * r.scale + r.ox) / r.dpr, rect.top + ((sy + box.y) * r.scale + r.oy) / r.dpr];
    const [x, y] = px(hit.s.locH * z, hit.s.top * z);
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
    // the lobby: the open races, hosting one, joining one by its code
    this.raceList = el('div', { class: 'racelist', 'aria-live': 'polite' });
    this.accessSelect = el('select', { 'aria-label': 'Who can join' },
      el('option', { value: 'public', text: 'Anyone (listed here)' }),
      el('option', { value: 'invite', text: 'By invitation (its code or link)' }));
    this.codeInput = el('input', { type: 'text', maxlength: '6', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': 'Race code', placeholder: 'Code' });
    this.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(this.codeInput.value); });
    this.lobbyView = el('div', { class: 'lobby' },
      el('p', { text: 'Two to six players play the same mission, each in their own game, and see one another\u2019s units as ghosts; the fastest to the goal wins.' }),
      el('div', { class: 'lobby-grid' },
        el('section', { class: 'open' },
          el('div', { class: 'headrow' }, el('h3', { text: 'Open races' }),
            el('button', { type: 'button', class: 'choice small', text: 'Refresh', onclick: () => this.refresh() })),
          this.raceList),
        el('section', { class: 'side' },
          el('h3', { text: 'Host a race' }),
          el('div', { class: 'choices pick' }, this.accessSelect,
            el('button', { type: 'button', class: 'choice', text: 'Host', onclick: () => this.create(this.accessSelect.value).catch(() => this.note('The race server could not be reached.')) })),
          el('h3', { text: 'Join by code' }),
          el('div', { class: 'choices pick' }, this.codeInput,
            el('button', { type: 'button', class: 'choice', text: 'Join', onclick: () => this.join(this.codeInput.value) })))));
    // a race: its players, its mission, its chat
    this.worldSelect = el('select', { 'aria-label': 'World' },
      ...WORLD_NAMES.map((n, i) => el('option', { value: String(i + 1), text: n })),
      el('option', { value: 'R', text: 'A random mission' }));
    this.missionSelect = el('select', { 'aria-label': 'Mission' });
    this.randomInput = el('input', { type: 'text', maxlength: '8', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': 'Random mission code', placeholder: 'Code' });
    this.worldSelect.addEventListener('change', () => this.fillMissions());
    for (const e of [this.missionSelect, this.randomInput]) e.addEventListener('change', () => this.pickMission());
    this.newRandom = el('button', { type: 'button', class: 'choice', text: 'New code', onclick: () => {
      const code = this.ui.random.newCode();
      this.randomInput.value = code ? showCode(code) : '';
      this.pickMission();
    } });
    this.chooser = el('div', { class: 'choices pick' }, this.worldSelect, this.missionSelect, this.randomInput, this.newRandom);
    this.preview = el('canvas', { class: 'preview', width: '240', height: '150', 'aria-hidden': 'true' });
    this.previewName = el('div', { class: 'mapname' });
    this.previewNote = el('div', { class: 'mapnote' });
    this.list = el('ol', { class: 'players' });
    this.chatLog = el('div', { class: 'chatlog', role: 'log', 'aria-live': 'polite' });
    this.chatInput = el('input', { type: 'text', maxlength: '200', spellcheck: 'true', 'aria-label': 'Say something', placeholder: 'Say something, then Enter' });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const text = this.chatInput.value.trim();
      if (text) this.send({ type: 'chat', text });
      this.chatInput.value = '';
    });
    this.message = el('p', { class: 'note', 'aria-live': 'polite' });
    this.readyButton = el('button', { type: 'button', class: 'choice', text: 'Ready', onclick: () => this.send({ type: 'ready', ready: !this.me().ready }) });
    this.startButton = el('button', { type: 'button', class: 'choice', text: 'Start the race', onclick: () => this.send({ type: 'start' }) });
    this.againButton = el('button', { type: 'button', class: 'choice', text: 'Race again', onclick: () => this.send({ type: 'again' }) });
    this.accessButton = el('button', { type: 'button', class: 'choice', text: '', onclick: () => this.send({ type: 'access', access: this.room && this.room.access === 'invite' ? 'public' : 'invite' }) });
    this.linkButton = el('button', { type: 'button', class: 'choice', text: 'Copy link', onclick: () => this.copyLink() });
    this.leaveButton = el('button', { type: 'button', class: 'choice', text: 'Leave the race', onclick: () => { this.leave(true); this.render(); this.open(); } });
    this.roomView = el('div', { class: 'room' },
      el('div', { class: 'room-grid' },
        el('section', { class: 'players-part' },
          el('h3', { text: 'Players' }), this.list,
          el('h3', { text: 'Mission' }), this.chooser,
          el('div', { class: 'mapcard' }, this.preview, el('div', null, this.previewName, this.previewNote))),
        el('section', { class: 'chat-part' },
          el('h3', { text: 'Chat' }), this.chatLog, this.chatInput)),
      el('div', { class: 'choices actions-row' }, this.readyButton, this.startButton, this.againButton, this.accessButton, this.linkButton, this.leaveButton));
    this.panel = dialog('race', 'Races', () => this.close(), this.lobbyView, this.roomView, this.message);
    this.hud = el('button', { type: 'button', id: 'race-hud', hidden: '', onclick: () => this.open() });
    this.count = el('div', { id: 'race-count', hidden: '', 'aria-live': 'assertive' });
    this.tagDot = el('span', { class: 'dot' });
    this.tagName = el('span');
    this.tag = el('div', { id: 'ghost-tag', hidden: '' }, this.tagDot, this.tagName);
    document.body.append(this.panel, this.hud, this.count, this.tag);
    this.chat = [];
    this.fillMissions();
  }

  // The open races, from the lobby: again every ten seconds while the lobby is shown.
  async refresh() {
    clearTimeout(this.refreshTimer);
    if (this.panel.hidden || this.code) return;
    this.refreshTimer = setTimeout(() => this.refresh(), 10000);
    let races;
    try {
      const r = await fetch(this.server + '/lobbies');
      if (!r.ok) throw new Error(r.status);
      races = (await r.json()).races || [];
    } catch (e) {
      this.raceList.replaceChildren(el('p', { class: 'empty', text: 'The race server could not be reached.' }));
      return;
    }
    if (this.code) return;
    if (!races.length) {
      this.raceList.replaceChildren(el('p', { class: 'empty', text: 'No races are open just now. Host one, and it is listed here for others to join.' }));
      return;
    }
    this.raceList.replaceChildren(...races.map((r) => el('div', { class: 'racerow' },
      el('span', { class: 'host', text: r.host || '?' }),
      el('span', { class: 'mission', text: this.missionName(r.mission) }),
      el('span', { class: 'count', text: r.players + '/' + r.max }),
      el('span', { class: 'phase', text: r.phase === 'lobby' ? 'waiting' : 'racing' }),
      el('button', { type: 'button', class: 'choice small', text: 'Join', disabled: r.phase !== 'lobby' || r.players >= r.max ? '' : null,
        onclick: () => this.join(r.code) }))));
  }

  renderChat() {
    if (!this.chatLog) return;
    const near = this.chatLog.scrollHeight - this.chatLog.scrollTop - this.chatLog.clientHeight < 30;
    this.chatLog.replaceChildren(...this.chat.map((c) => c.system
      ? el('div', { class: 'system', text: c.text })
      : el('div', null,
        el('span', { class: 'dot', style: 'background:' + this.colour(c.from) }),
        el('b', { text: c.name + ': ' }), document.createTextNode(c.text))));
    if (near) this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  // The mission's map, small: its ground by the game's own terrain key (the member
  // terrainmap), what is on it marked (units, monsters, bricks, plans, the goal), drawn
  // skewed as the game draws its map; and its name.
  drawPreview(mission) {
    const c = this.preview, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    this.previewName.textContent = mission ? this.missionName(mission) : 'No mission chosen yet';
    this.previewNote.textContent = '';
    if (!mission) return;
    let text = '';
    try {
      if (mission.startsWith('R-')) {
        const g = this.ui.random && this.ui.random.make(mission.slice(2));
        text = g ? g.text : '';
      } else {
        const [w, l] = mission.split('.');
        const m = this.rt.builtins.member('map' + w + '.' + l);
        text = m ? L.gp(m, 'text') : '';
      }
    } catch (e) {
      text = '';
    }
    if (!text) return;
    const map = readMap(text, this.terrainKey());
    if (!map.rows.length) return;
    if (map.name) this.previewNote.textContent = map.name.charAt(0) + map.name.slice(1).toLowerCase();
    const rows = map.rows.length, cols = Math.max(...map.rows.map((r) => r.length));
    // (each row half a cell left of the one above, as the game's map is drawn)
    const cell = Math.max(2, Math.min(10, Math.floor(Math.min((c.width - 4) / (cols + rows / 2), (c.height - 4) / rows))));
    const w = (cols + rows / 2) * cell, h = rows * cell;
    const ox = Math.round((c.width - w) / 2 + rows / 2 * cell), oy = Math.round((c.height - h) / 2);
    const at = (x, y) => [ox + x * cell - y * cell / 2, oy + y * cell];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < map.rows[y].length; x++) {
        const t = map.tile(x, y);
        if (!t.colour) continue;
        const [px, py] = at(x, y);
        ctx.fillStyle = t.colour;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + cell, py);
        ctx.lineTo(px + cell / 2, py + cell);
        ctx.lineTo(px - cell / 2, py + cell);
        ctx.closePath();
        ctx.fill();
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < map.rows[y].length; x++) {
        const t = map.tile(x, y);
        if (!t.mark) continue;
        const [px, py] = at(x, y);
        const r = Math.max(1.5, cell * 0.38);
        ctx.fillStyle = t.mark;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px + cell / 4, py + cell / 2, r, 0, Math.PI * 2);
        ctx.fill();
        if (cell >= 5) ctx.stroke();
      }
    }
  }

  // The game's terrain key: map character -> terrain name.
  terrainKey() {
    if (this.key) return this.key;
    const key = {};
    try {
      const m = this.rt.builtins.member('terrainmap');
      for (const line of String(L.gp(m, 'text') || '').split(/\r\n|\r|\n/)) {
        if (line.length > 2) key[line[0]] = line.slice(2).trim().toLowerCase();
      }
    } catch (e) {
      // (none: the preview has only what it knows)
    }
    return (this.key = key);
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
      const code = this.ui.random && this.ui.random.newCode();
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
    this.lobbyView.hidden = !!this.code;
    this.roomView.hidden = !this.code;
    if (!r) {
      this.panel.querySelector('h2').textContent = this.code ? 'Race ' + this.code : 'Races';
      this.hud.hidden = true;
      return;
    }
    const host = r.host === this.you;
    this.panel.querySelector('h2').textContent = 'Race ' + r.code + (r.access === 'invite' ? ' (by invitation)' : '');
    this.chooser.hidden = !host || r.phase !== 'lobby';
    // (the host's first visit: their choice goes to the race)
    if (host && r.phase === 'lobby' && !r.mission) this.pickMission();
    if (this.previewFor !== r.mission) {
      this.previewFor = r.mission;
      this.drawPreview(r.mission);
    }
    this.list.replaceChildren(...this.standings().map((p) => el('li', { class: p.id === this.you ? 'me' : '' },
      el('span', { class: 'name' }, el('span', { class: 'dot', style: 'background:' + this.colour(p.id) }), p.name + (p.id === r.host ? ' (host)' : '') + (p.connected ? '' : ' (away)')),
      el('span', { class: 'status', text: this.status(p) }))));
    this.readyButton.hidden = host || r.phase !== 'lobby';
    this.readyButton.textContent = this.me().ready ? 'Not ready' : 'Ready';
    this.startButton.hidden = !host || r.phase !== 'lobby';
    this.startButton.disabled = !r.mission || r.players.length < 1;
    this.againButton.hidden = !host || r.phase === 'lobby';
    this.accessButton.hidden = !host;
    this.accessButton.textContent = r.access === 'invite' ? 'List it for anyone' : 'Make it invitation only';
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
    (this.code ? this.chatInput : this.codeInput).focus();
    if (!this.code) {
      this.raceList.replaceChildren(el('p', { class: 'empty', text: 'Looking for races\u2026' }));
      this.refresh();
    }
  }

  close() {
    this.panel.hidden = true;
    clearTimeout(this.refreshTimer);
    this.ui.focusGame();
  }
}

// A map's text, read for its preview: its rows, its name, and for each place its ground's
// colour and a mark for what is on it.
const GROUND = {
  normal: '#33c033', normal_undiggable: '#8cba60', water: '#1eb4e8', water_undiggable: '#0d86b8',
  water_reefs: '#3aa6c4', mountain: '#9c9c9c', swamp: '#6b8e23', volcano: '#a8322a',
  goal: '#ffd400', cement: '#c8c8c8', roadblock: '#e08a00', billboard: '#e6e6e6',
};
function groundColour(t) {
  if (!t || t === 'hole') return null;
  if (GROUND[t]) return GROUND[t];
  if (/^street/.test(t)) return '#5a5a5a';
  if (/^(tree|jungle)/.test(t)) return '#1d7a1d';
  return GROUND.normal;
}
function readMap(text, key) {
  const rows = [], items = {};
  let name = '';
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/--.*$/, '');
    let m = /^\s*map\s*=\s*(.*?)\s*$/i.exec(line);
    if (m) { rows.push(m[1]); continue; }
    m = /^\s*name\s*=\s*(.*?)\s*$/i.exec(line);
    if (m) { name = m[1]; continue; }
    m = /^\s*(\S)\s*=\s*(.+?)\s*$/.exec(line);
    if (m) items[m[1]] = m[2].toLowerCase().split(/\s*,\s*/);
  }
  const tile = (x, y) => {
    const ch = (rows[y] || '')[x];
    if (ch === undefined || ch === ' ') return {};
    if (key[ch]) return { colour: groundColour(key[ch]) };
    const it = items[ch];
    if (!it) return { colour: GROUND.normal };
    const kind = it[0], water = /^water/.test(kind);
    let mark = null;
    if (kind === 'goal') mark = '#ffd400';
    else if (/unit$/.test(kind)) mark = it[1] === 'monster' ? '#e3000b' : '#ffffff';
    else if (/pile$/.test(kind)) mark = '#ff9a00';
    else if (/plan$/.test(kind)) mark = '#4f6bff';
    return { colour: water ? GROUND.water : GROUND.normal, mark };
  };
  return { rows, name, tile };
}
