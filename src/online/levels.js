// Custom levels (the main menu's Custom Levels): those made in the level editor (src/online/editor.js),
// uploaded and approved (server/src/levels.js), played by anyone as "C-" and their number, with a
// score table each, likes (no dislikes) and plays.  One kept offline is here with its picture,
// to play without the server, and to race (src/online/race.js asks for it by `cached`).
//
// Also the editor's upload: a level beaten in Test Play, its picture, the author's name.

import { el, dialog } from './dom.js';
import { clock } from './scores.js';
import { toFile, fileName, saveFile } from './levelfile.js';

const KEPT = 'lego-wb-online:custom';
const BROWSER = 'lego-wb-online:browser';
const SKIES = ['World One', 'World Two', 'World Three', 'Ocean World', 'Prehistoric World', 'WB2 World One', 'WB2 World Two'];
const STATUS = { pending: 'waiting to be looked at', approved: 'out', rejected: 'turned down', unpublished: 'taken down' };
const UPLOAD_ERRORS = {
  closed: 'Uploads are closed just now.', banned: 'Uploads from here are not taken.', later: 'Not so fast: try again in a moment.',
  already: 'That level is up already.', name: 'Your name first (Settings), a decent one.', 'beat it first': 'Beat it in Test Play first, goal and bonus.',
  image: 'Its picture could not be made.', level: 'The server turned the level down',
};

// This browser's own id: its likes and its uploads are its own.
export function browserId() {
  try {
    let id = localStorage.getItem(BROWSER);
    if (!id || !/^[A-Za-z0-9_-]{12,64}$/.test(id)) {
      const b = new Uint8Array(18);
      crypto.getRandomValues(b);
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(BROWSER, id);
    }
    return id;
  } catch (e) {
    return (window.__wbBrowser = window.__wbBrowser || 'visit' + Math.random().toString(36).slice(2, 14).padEnd(12, '0'));
  }
}

function loadKept() {
  try {
    const k = JSON.parse(localStorage.getItem(KEPT) || '{}');
    return k && typeof k === 'object' ? k : {};
  } catch (e) {
    return {};
  }
}

export class CustomLevels {
  constructor(ui) {
    this.ui = ui;
    this.rt = ui.rt;
    this.kept = loadKept();       // {id: {id, name, author, level, thumb, at}}
    this.cache = new Map();       // id → {id, name, author, level, likes, plays}
    this.liked = new Set();
    this.view = 'browse';
    this.sort = 'new';
    this.asked = 0;
    this.build();
  }
  get server() { return this.ui.scores ? this.ui.scores.server : ''; }

  // ---------- the panel ----------

  build() {
    const tab = (id, text) => el('button', { type: 'button', class: 'choice small', 'data-view': id, text, onclick: () => this.show(id) });
    this.tabs = [tab('browse', 'Browse'), tab('kept', 'Kept offline'), tab('mine', 'Your uploads')];
    this.search = el('input', { type: 'search', maxlength: '30', spellcheck: 'false', 'aria-label': 'Search by name or author', placeholder: 'Search' });
    this.search.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.load(); });
    this.sortSelect = el('select', { 'aria-label': 'Order' },
      el('option', { value: 'new', text: 'Newest' }), el('option', { value: 'likes', text: 'Most liked' }), el('option', { value: 'plays', text: 'Most played' }));
    this.sortSelect.addEventListener('change', () => { this.sort = this.sortSelect.value; this.load(); });
    this.filters = el('div', { class: 'choices pick' }, this.search, this.sortSelect,
      el('button', { type: 'button', class: 'choice', text: 'Search', onclick: () => this.load() }));
    this.list = el('div', { class: 'customlist', 'aria-live': 'polite' });
    this.more = el('button', { type: 'button', class: 'choice', text: 'More', hidden: '', onclick: () => this.load(true) });
    this.detail = el('div', { class: 'customdetail', hidden: '' });
    this.note = el('p', { class: 'note', 'aria-live': 'polite' });
    this.panel = dialog('customs', 'Custom levels', () => this.close(),
      el('div', { class: 'choices tabs' }, ...this.tabs), this.filters, this.list, this.more, this.detail, this.note);
    document.body.append(this.panel);
  }
  open(view) {
    this.ui.panel.hidden = true;
    this.panel.hidden = false;
    this.show(view || this.view);
    this.refreshLiked();
  }
  close() {
    this.panel.hidden = true;
    this.ui.focusGame();
  }
  show(view) {
    this.view = view;
    for (const t of this.tabs) t.setAttribute('aria-pressed', String(t.dataset.view === view));
    this.detail.hidden = true;
    this.list.hidden = false;
    this.filters.hidden = view !== 'browse';
    this.note.textContent = '';
    if (view === 'kept') this.renderKept();
    else if (view === 'mine') this.loadMine();
    else this.load();
  }

  async load(more) {
    const ask = ++this.asked;
    this.offset = more ? (this.offset || 0) + 30 : 0;
    if (!more) this.list.replaceChildren(el('p', { class: 'empty', text: 'Loading…' }));
    this.more.hidden = true;
    let got;
    try {
      const q = new URLSearchParams({ sort: this.sort, q: this.search.value.trim(), offset: String(this.offset) });
      const r = await fetch(this.server + '/levels?' + q);
      if (!r.ok) throw new Error(r.status);
      got = await r.json();
    } catch (e) {
      if (ask === this.asked) this.list.replaceChildren(el('p', { class: 'empty', text: 'The level server could not be reached. Levels kept offline can still be played.' }));
      return;
    }
    if (ask !== this.asked || this.view !== 'browse') return;
    const cards = got.levels.map((l) => this.card(l, this.server + '/levels/' + l.id + '/image'));
    if (more) this.list.append(...cards);
    else this.list.replaceChildren(...(cards.length ? cards : [el('p', { class: 'empty', text: this.search.value.trim() ? 'No level by that name.' : 'No custom levels yet. Make one in the Level editor!' })]));
    this.more.hidden = !got.more;
  }
  renderKept() {
    const kept = Object.values(this.kept).sort((a, b) => b.at - a.at);
    this.more.hidden = true;
    this.list.replaceChildren(...(kept.length ? kept.map((k) => this.card(k, k.thumb)) : [el('p', { class: 'empty', text: 'Keep a level offline (its Keep offline button) to play it without the server, and to race with it.' })]));
  }
  async loadMine() {
    this.more.hidden = true;
    this.list.replaceChildren(el('p', { class: 'empty', text: 'Loading…' }));
    try {
      const r = await fetch(this.server + '/levels/mine?browser=' + encodeURIComponent(browserId()));
      if (!r.ok) throw new Error(r.status);
      const { levels } = await r.json();
      if (this.view !== 'mine') return;
      this.list.replaceChildren(...(levels.length ? levels.map((l) => el('div', { class: 'mine ' + l.status },
        el('b', { text: l.name }), el('span', { text: ' · C-' + l.id + ' · ' + STATUS[l.status] + (l.status === 'approved' ? ' · ♥ ' + l.likes + ' · played ' + l.plays : '') }),
        l.status === 'approved' ? el('button', { type: 'button', class: 'choice small', text: 'Open', onclick: () => this.openLevel(l.id) }) : null))
        : [el('p', { class: 'empty', text: 'Nothing uploaded from here yet: beat a level of yours in the Level editor’s Test Play, then Upload.' })]));
    } catch (e) {
      this.list.replaceChildren(el('p', { class: 'empty', text: 'The level server could not be reached.' }));
    }
  }
  card(l, image) {
    return el('button', { type: 'button', class: 'customcard', 'aria-label': l.name + ' by ' + l.author, onclick: () => this.openLevel(l.id) },
      image ? el('img', { src: image, alt: '', loading: 'lazy' }) : el('span', { class: 'noimg' }),
      el('b', { text: l.name }),
      el('span', { class: 'by', text: 'by ' + l.author }),
      l.likes !== undefined ? el('span', { class: 'stats', text: '♥ ' + l.likes + ' · played ' + l.plays }) : el('span', { class: 'stats', text: 'kept offline' }));
  }

  // One level: its picture, what it is, its buttons and its score table.
  async openLevel(id) {
    this.list.hidden = true;
    this.filters.hidden = true;
    this.more.hidden = true;
    this.detail.hidden = false;
    this.detail.replaceChildren(el('p', { text: 'Loading…' }));
    const l = await this.fetchLevel(id).catch(() => null);
    if (!l) { this.detail.replaceChildren(el('p', { text: 'That level could not be had.' }), this.back()); return; }
    const kept = !!this.kept[id];
    const likeButton = el('button', { type: 'button', class: 'choice', 'aria-pressed': String(this.liked.has(id)), text: (this.liked.has(id) ? '♥ Liked' : '♡ Like') + (l.likes !== undefined ? ' · ' + l.likes : ''), onclick: () => this.like(id, likeButton) });
    const keepButton = el('button', { type: 'button', class: 'choice', text: kept ? 'Remove from offline' : 'Keep offline', onclick: async () => {
      if (this.kept[id]) this.forget(id); else await this.keep(id);
      keepButton.textContent = this.kept[id] ? 'Remove from offline' : 'Keep offline';
    } });
    const table = el('div', { class: 'tables' }, el('p', { text: 'Loading the times…' }));
    const sky = l.level ? SKIES[l.level.sky - 1] : '';
    this.detail.replaceChildren(
      el('div', { class: 'customhead' },
        el('img', { src: this.kept[id] && this.kept[id].thumb && !navigator.onLine ? this.kept[id].thumb : this.server + '/levels/' + id + '/image', alt: 'The map of ' + l.name }),
        el('div', null,
          el('h3', { text: l.name }),
          el('p', { text: 'by ' + l.author + ' · C-' + id + (sky ? ' · ' + sky : '') + (l.level ? ' · ' + l.level.rows[0].length + ' × ' + l.level.rows.length : '') + (l.plays !== undefined ? ' · played ' + l.plays : '') }),
          el('div', { class: 'choices' },
            el('button', { type: 'button', class: 'choice primary', text: 'Play', onclick: () => this.play(id) }),
            likeButton, keepButton,
            el('button', { type: 'button', class: 'choice', text: 'Race it', onclick: () => this.race(id) }),
            l.level ? el('button', { type: 'button', class: 'choice', text: 'Export', title: 'The level as a file, to keep or pass on', onclick: () => this.exportLevel(l) }) : null,
            l.level && this.ui.editor ? el('button', { type: 'button', class: 'choice', text: 'Edit a copy', title: 'A copy of it in the Level editor, to make your own from', onclick: () => { this.panel.hidden = true; this.ui.editor.openCopy(Object.assign({}, l.level, { name: l.level.name })); } }) : null))),
      table, this.back());
    this.showTimes(id, table);
  }
  back() {
    return el('button', { type: 'button', class: 'choice small', text: 'Back', onclick: () => this.show(this.view) });
  }
  async showTimes(id, into) {
    const s = this.ui.scores;
    if (!s) return;
    try {
      const t = await s.table('C-' + id);
      const me = (this.ui.settings.name || '').toLowerCase();
      const mine = s.bests['C-' + id] || {};
      const part = (kind, title) => el('section', null,
        el('h3', { text: title + (mine[kind] !== undefined ? ' · your best ' + clock(mine[kind]) : '') }),
        t[kind].length ? el('table', null, el('tbody', null, ...t[kind].map((r, i) => el('tr', { class: r.name.toLowerCase() === me ? 'me' : '' },
          el('td', { text: String(i + 1) }), el('td', { text: r.name }), el('td', { text: clock(r.ms) })))))
          : el('p', { text: 'No times yet.' }));
      into.replaceChildren(part('goal', 'Goal'), part('bonus', 'Bonus goal'));
    } catch (e) {
      into.replaceChildren(el('p', { text: 'The times could not be had.' }));
    }
  }

  // ---------- the levels themselves ----------

  // A level by its number: kept offline, had already this visit, or from the server.
  cached(id) {
    const k = this.kept[id] || this.cache.get(Number(id));
    return k && k.level ? k : null;
  }
  async fetchLevel(id) {
    id = Number(id);
    try {
      const r = await fetch(this.server + '/levels/' + id);
      if (r.ok) {
        const l = await r.json();
        this.cache.set(id, l);
        return l;
      }
      if (r.status === 404 && !this.kept[id]) return null;
    } catch (e) {
      // (offline: the kept copy)
    }
    return this.cached(id);
  }
  async keep(id) {
    const l = await this.fetchLevel(id);
    if (!l) return;
    let thumb = null;
    try {
      const r = await fetch(this.server + '/levels/' + id + '/image');
      if (r.ok) thumb = await smaller(await r.blob());
    } catch (e) {
      // (no picture: it is kept all the same)
    }
    this.kept[id] = { id: l.id, name: l.name, author: l.author, level: l.level, thumb, at: Date.now() };
    this.saveKept();
  }
  forget(id) {
    delete this.kept[id];
    this.saveKept();
    if (this.view === 'kept' && !this.detail.hidden) return;
    if (this.view === 'kept') this.renderKept();
  }
  saveKept() {
    try { localStorage.setItem(KEPT, JSON.stringify(this.kept)); } catch (e) { this.note.textContent = 'There is no more room here to keep levels offline.'; }
  }
  async refreshLiked() {
    try {
      const r = await fetch(this.server + '/levels/liked?browser=' + encodeURIComponent(browserId()));
      if (r.ok) this.liked = new Set((await r.json()).liked);
    } catch (e) {
      // (as they were)
    }
  }
  async like(id, button) {
    const want = !this.liked.has(id);
    try {
      const r = await fetch(this.server + '/levels/' + id + '/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ browser: browserId(), like: want }) });
      const b = await r.json();
      if (!r.ok) { this.note.textContent = b.error === 'later' ? 'Enough likes from here for that level.' : 'It could not be liked just now.'; return; }
      if (b.liked) this.liked.add(id); else this.liked.delete(id);
      button.textContent = (b.liked ? '♥ Liked' : '♡ Like') + ' · ' + b.likes;
      button.setAttribute('aria-pressed', String(b.liked));
    } catch (e) {
      this.note.textContent = 'The level server could not be reached.';
    }
  }

  // Plays it: into the game from wherever it is, a play counted.
  async play(id) {
    const l = this.cached(id) || await this.fetchLevel(id);
    if (!l) { this.note.textContent = 'That level could not be had.'; return; }
    this.ui.enterGame({ map: false });
    const problem = this.ui.random.go('C-' + id);
    if (problem) { this.note.textContent = problem; return; }
    this.panel.hidden = true;
    fetch(this.server + '/levels/' + id + '/play', { method: 'POST' }).catch(() => {});
  }
  // A race with it: kept offline (so that it is here when the race starts), and the race's
  // panel, hosting one with it.
  async race(id) {
    if (!this.kept[id]) await this.keep(id);
    this.panel.hidden = true;
    if (this.ui.races) this.ui.races.hostWith('C-' + id);
  }
  async exportLevel(l) {
    try {
      const how = await saveFile(toFile(l.level, { author: l.author, from: 'C-' + l.id }), fileName(l.level));
      this.note.textContent = { downloaded: 'Saved as ' + fileName(l.level) + '.', shared: 'Shared.', copied: 'Copied as text.', cancelled: '' }[how];
    } catch (e) {
      this.note.textContent = 'It could not be saved here.';
    }
  }
  name(id) {
    const l = this.cached(id);
    return l ? l.name : 'Custom level ' + id;
  }

  // ---------- uploading, from the editor ----------

  // Answers {id, status} or throws an Error whose message is for the player.
  async upload(level, beaten, image) {
    const s = this.ui.settings;
    if (!s.name) throw new Error(UPLOAD_ERRORS.name);
    const form = new FormData();
    form.append('level', JSON.stringify(level));
    form.append('name', s.name);
    form.append('browser', browserId());
    form.append('proof', JSON.stringify({ goal: Math.round(beaten.goal), bonus: Math.round(beaten.bonus) }));
    form.append('image', image, 'level.jpg');
    let r, b;
    try {
      r = await fetch(this.server + '/levels', { method: 'POST', body: form });
      b = await r.json();
    } catch (e) {
      throw new Error('The level server could not be reached.');
    }
    if (!r.ok && b.error === 'wait') {
      const s = Math.max(1, Number(b.seconds) || 1);
      const m = Math.ceil(s / 60);
      throw new Error('A moment between uploads: try again in ' + (s < 60 ? s + (s === 1 ? ' second' : ' seconds') : m + (m === 1 ? ' minute' : ' minutes')) + '.');
    }
    if (!r.ok) throw new Error((UPLOAD_ERRORS[b.error] || 'The upload was turned down').replace(/\.$/, '') + (b.why ? ': ' + b.why.join('; ') : '') + '.');
    return b;
  }
}

// A picture made small, for keeping: a JPEG data URL 240 wide.
function smaller(blob) {
  return new Promise((done) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const w = 240, h = Math.max(1, Math.round(img.height * w / img.width));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      done(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); done(null); };
    img.src = url;
  });
}
