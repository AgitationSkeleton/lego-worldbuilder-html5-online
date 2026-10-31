// The level editor (the main menu's Level Editor): custom levels (src/online/levelformat.js) made
// on a grid seen from above, drawn with the game's own pictures, and tried in the game itself
// (Test Play).  Levels are kept in this browser as they are made; one beaten in Test Play, its
// goal and its bonus goal, may be uploaded (src/online/levels.js).
//
// Tools: brush (a size of 1 to 9, square or round), line, rectangle and ellipse (outlined or
// filled), fill, pick (the eyedropper), eraser, and select (a rectangle: cut, copy, paste,
// delete, moved by dragging).  Undo and redo.  Keys: Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z, Ctrl+X,
// Ctrl+C, Ctrl+V, Delete, Escape; B, L, R, E, F, I, X, S for the tools; [ and ] the brush's size.
// The wheel zooms, the middle or right button (or Space with the left) pans.

import { TERRAIN, KINDS, BRICKS, LIMITS, parseMap, validate, cleanText } from './levelformat.js';
import { el } from './dom.js';
import { IsoView, groundMember } from './isoview.js';
import { snapshot } from './snapshot.js';
import { toFile, fromText, fileName, saveFile, chooseFile } from './levelfile.js';

const DRAFTS = 'lego-wb-online:levels';
const SHOT = 'lego-wb-online:levelshot';    // the picture of the level last test-played
const CELL = 26;
const UNDO_MAX = 300;
const WATER = new Set(['w', 'x', 'r']);

// The ground, in the order the palette shows it, in groups.
const GROUND = [
  ['Ground', ['.', '_', ':', '#', '`', '-']],
  ['Water', ['w', 'x', 'r']],
  ['Trees', ['T', '!', "'", '?']],
  ['Rocks', ['M', '^', '%', '&', '$', '*', '>', '~']],
  ['Streets', ['(', '[', '{', '\\', '/', ')', ']', '}', '+', '=']],
  ['Hole', ['@']],
];
const NAMES = {
  normal: 'Ground', normal_undiggable: 'Rocky ground', goal: 'Yellow goal ground', swamp: 'Swamp', hole: 'Hole', water: 'Water',
  water_undiggable: 'Deep water', water_reefs: 'Reefs', tree: 'Tree', tree2: 'Cypress', tree3: 'Little pine', tree4: 'Palm tree', mountain: 'Mountain',
  volcano: 'Volcano', jungle1: 'Flowery plant', jungle2: 'Lumpy root', jungle3: 'Cauliflowers', jungle4: 'Rocks and flowers', billboard: 'Billboard',
  cement: 'Cement', roadblock: 'Roadblock', street_undiggable: 'Street (rocky)',
};
const SKIES = ['World One', 'World Two', 'World Three', 'Ocean World', 'Prehistoric World', 'World Builder 2: World One', 'World Builder 2: World Two'];

export class Editor {
  constructor(ui) {
    this.ui = ui;
    this.rt = ui.rt;
    this.images = new Map();
    this.tool = 'brush';
    this.size = 1;
    this.round = false;
    this.filled = false;
    this.paint = { kind: 'ground', ch: '.' };
    this.zoom = 1;
    this.ox = 20;
    this.oy = 20;
    this.undo = [];
    this.redo = [];
    this.sel = null;          // {x0, y0, x1, y1}
    this.clip = null;         // {w, h, cells}
    this.floating = null;     // a paste being placed: {x, y, w, h, cells}
    this.drafts = loadDrafts();
    this.iso = new IsoView(this.rt);
    this.build();
  }

  // ---------- the level ----------

  newLevel(W = 20, H = 14) {
    return { v: 1, name: 'New level', sky: 1, rows: Array.from({ length: H }, () => '.'.repeat(W)), items: [], inventory: {}, center: null };
  }
  // (the level as the editor works on it: its ground a grid, its items by tile)
  load(level, id) {
    this.id = id || 'L' + Date.now().toString(36);
    this.name = level.name;
    this.sky = level.sky;
    this.grid = level.rows.map((r) => [...r]);
    this.items = new Map(level.items.map((it) => { const { x, y, ...rest } = it; return [x + ',' + y, rest]; }));
    this.inventory = Object.assign({}, level.inventory);
    this.center = level.center || null;
    this.beaten = null;
    this.uploadMsg = null;
    this.undo = [];
    this.redo = [];
    this.sel = null;
    this.floating = null;
    this.fit();
    this.refresh();
  }
  level() {
    return {
      v: 1, name: cleanText(this.name) || 'NEW LEVEL', sky: this.sky, rows: this.grid.map((r) => r.join('')),
      items: [...this.items].map(([k, it]) => { const [x, y] = k.split(',').map(Number); return Object.assign({ x, y }, it); }),
      inventory: Object.assign({}, this.inventory), center: this.center || undefined,
    };
  }
  get W() { return this.grid[0].length; }
  get H() { return this.grid.length; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }

  // Before each change: the level as it was, for Undo.
  remember() {
    this.undo.push(JSON.stringify(this.state()));
    if (this.undo.length > UNDO_MAX) this.undo.shift();
    this.redo = [];
    this.beaten = null;
  }
  state() { return { name: this.name, sky: this.sky, grid: this.grid.map((r) => r.join('')), items: [...this.items], inventory: this.inventory, center: this.center }; }
  restore(s) {
    this.name = s.name; this.sky = s.sky; this.grid = s.grid.map((r) => [...r]); this.items = new Map(s.items);
    this.inventory = Object.assign({}, s.inventory); this.center = s.center;
    this.refresh();
  }
  doUndo() { if (!this.undo.length) return; this.redo.push(JSON.stringify(this.state())); this.restore(JSON.parse(this.undo.pop())); }
  doRedo() { if (!this.redo.length) return; this.undo.push(JSON.stringify(this.state())); this.restore(JSON.parse(this.redo.pop())); }

  // ---------- painting ----------

  // One tile painted with what is chosen: ground, or an item (an item goes on plain ground, or
  // on water if it is a water tile: the tile made one if it is neither).
  put(x, y, paint = this.paint) {
    if (!this.inside(x, y)) return;
    const k = x + ',' + y;
    if (paint.kind === 'ground') {
      this.grid[y][x] = paint.ch;
      const it = this.items.get(k);
      // (an item stays where it may stand: on plain ground or water)
      if (it && !(paint.ch === '.' || paint.ch === 'w') && it.t !== 'whirl') this.items.delete(k);
      if (it && it.t === 'whirl' && !WATER.has(paint.ch)) this.items.delete(k);
    } else if (paint.kind === 'item') {
      const it = JSON.parse(JSON.stringify(paint.item));
      const under = this.grid[y][x];
      if (it.t === 'whirl') { if (!WATER.has(under)) this.grid[y][x] = 'w'; } else if (under !== '.' && under !== 'w') this.grid[y][x] = WATER.has(under) ? 'w' : '.';
      this.items.set(k, it);
    } else if (paint.kind === 'erase') this.items.delete(k);
  }
  // The brush's tiles round a point.
  brush(x, y, f) {
    const r = this.size - 1, lo = -Math.floor(r / 2), hi = lo + r;
    for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) {
      if (this.round && this.size > 2) { const c = r / 2; if ((dx - lo - c) ** 2 + (dy - lo - c) ** 2 > (c + 0.35) ** 2) continue; }
      f(x + dx, y + dy);
    }
  }
  line(x0, y0, x1, y1, f) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      f(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  rect(x0, y0, x1, y1, f) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (this.filled || x === ax || x === bx || y === ay || y === by) f(x, y);
  }
  ellipse(x0, y0, x1, y1, f) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
    const inE = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      if (!inE(x, y)) continue;
      if (this.filled || !inE(x - 1, y) || !inE(x + 1, y) || !inE(x, y - 1) || !inE(x, y + 1)) f(x, y);
    }
  }
  // Fill: the ground of one kind (and no item) joined to the tile, painted.
  fill(x, y) {
    if (!this.inside(x, y)) return;
    const ch = this.grid[y][x], hasItem = this.items.has(x + ',' + y);
    const seen = new Set([x + ',' + y]);
    const stack = [[x, y]];
    const tiles = [];
    while (stack.length && tiles.length < LIMITS.maxW * LIMITS.maxH) {
      const [a, b] = stack.pop();
      tiles.push([a, b]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = a + dx, ny = b + dy, k = nx + ',' + ny;
        if (seen.has(k) || !this.inside(nx, ny) || this.grid[ny][nx] !== ch || this.items.has(k) !== hasItem) continue;
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
    for (const [a, b] of tiles) this.put(a, b);
  }
  // The shape the tool draws from one tile to another, each of its tiles as f says (with the
  // brush's size round each, for the brush, line, rectangle and ellipse).
  shape(x0, y0, x1, y1, f) {
    const each = (x, y) => this.brush(x, y, f);
    if (this.tool === 'line') this.line(x0, y0, x1, y1, each);
    else if (this.tool === 'rect') this.rect(x0, y0, x1, y1, this.size > 1 ? each : f);
    else if (this.tool === 'ellipse') this.ellipse(x0, y0, x1, y1, this.size > 1 ? each : f);
  }

  // ---------- the selection, cut, copy, paste ----------

  selected() {
    if (!this.sel) return null;
    const { x0, y0, x1, y1 } = this.sel;
    return [Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)), Math.min(this.W - 1, Math.max(x0, x1)), Math.min(this.H - 1, Math.max(y0, y1))];
  }
  copy() {
    const s = this.selected();
    if (!s) return false;
    const [ax, ay, bx, by] = s;
    const cells = [];
    for (let y = ay; y <= by; y++) {
      const row = [];
      for (let x = ax; x <= bx; x++) row.push({ ch: this.grid[y][x], item: this.items.get(x + ',' + y) || null });
      cells.push(row);
    }
    this.clip = { w: bx - ax + 1, h: by - ay + 1, cells: JSON.parse(JSON.stringify(cells)) };
    return true;
  }
  clear(ch = '.') {
    const s = this.selected();
    if (!s) return;
    this.remember();
    const [ax, ay, bx, by] = s;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { this.grid[y][x] = ch; this.items.delete(x + ',' + y); }
    this.refresh();
  }
  cut() { if (this.copy()) this.clear(); }
  // A paste floats with the pointer until a click puts it down (Escape lets it go).
  paste() {
    if (!this.clip) return;
    const [hx, hy] = this.hover || [0, 0];
    this.floating = { x: hx, y: hy, w: this.clip.w, h: this.clip.h, cells: this.clip.cells };
    this.setTool('select');
    this.draw();
  }
  drop() {
    const f = this.floating;
    if (!f) return;
    this.remember();
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const tx = f.x + x, ty = f.y + y;
      if (!this.inside(tx, ty)) continue;
      const c = f.cells[y][x];
      this.grid[ty][tx] = c.ch;
      if (c.item) this.items.set(tx + ',' + ty, JSON.parse(JSON.stringify(c.item)));
      else this.items.delete(tx + ',' + ty);
    }
    this.sel = { x0: f.x, y0: f.y, x1: f.x + f.w - 1, y1: f.y + f.h - 1 };
    this.floating = null;
    this.refresh();
  }

  // ---------- the map's size ----------

  // Rows or columns added (n > 0) or taken off (n < 0) at a side: 'top', 'bottom', 'left', 'right'.
  grow(side, n) {
    const W = this.W, H = this.H;
    if (side === 'left' || side === 'right') { if (W + n < LIMITS.minW || W + n > LIMITS.maxW) return; } else if (H + n < LIMITS.minH || H + n > LIMITS.maxH) return;
    this.remember();
    const shift = side === 'left' ? n : 0, shiftY = side === 'top' ? n : 0;
    if (side === 'left' || side === 'right') {
      this.grid = this.grid.map((r) => (n > 0 ? (side === 'left' ? Array(n).fill('.').concat(r) : r.concat(Array(n).fill('.'))) : (side === 'left' ? r.slice(-n) : r.slice(0, W + n))));
    } else {
      const add = () => Array(W).fill('.');
      if (n > 0) this.grid = side === 'top' ? Array.from({ length: n }, add).concat(this.grid) : this.grid.concat(Array.from({ length: n }, add));
      else this.grid = side === 'top' ? this.grid.slice(-n) : this.grid.slice(0, H + n);
    }
    const items = new Map();
    for (const [k, it] of this.items) {
      const [x, y] = k.split(',').map(Number);
      const nx = x + shift, ny = y + shiftY;
      if (this.inside(nx, ny)) items.set(nx + ',' + ny, it);
    }
    this.items = items;
    if (this.center) this.center = [Math.max(0, Math.min(this.W - 1, this.center[0] + shift)), Math.max(0, Math.min(this.H - 1, this.center[1] + shiftY))];
    this.refresh();
  }

  // ---------- the page ----------

  build() {
    const tools = [['brush', 'Brush', 'B'], ['line', 'Line', 'L'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'E'], ['fill', 'Fill', 'F'],
      ['pick', 'Pick', 'I'], ['erase', 'Eraser', 'X'], ['select', 'Select', 'S']];
    this.toolButtons = tools.map(([id, label, key]) => el('button', { type: 'button', class: 'tool', 'data-tool': id, title: label + ' (' + key + ')', text: label, onclick: () => this.setTool(id) }));
    this.sizeInput = el('input', { type: 'range', min: '1', max: '9', value: '1', 'aria-label': 'Brush size' });
    this.sizeInput.addEventListener('input', () => { this.size = Number(this.sizeInput.value); this.sizeLabel.textContent = this.size; });
    this.sizeLabel = el('span', { class: 'size', text: '1' });
    this.roundBox = el('input', { type: 'checkbox', 'aria-label': 'Round brush' });
    this.roundBox.addEventListener('change', () => { this.round = this.roundBox.checked; });
    this.filledBox = el('input', { type: 'checkbox', 'aria-label': 'Filled shapes' });
    this.filledBox.addEventListener('change', () => { this.filled = this.filledBox.checked; });
    const btn = (text, f, title) => el('button', { type: 'button', class: 'tool', text, title: title || text, onclick: f });
    this.canvas = el('canvas', { class: 'grid', tabindex: '0' });
    this.palette = el('div', { class: 'palette' });
    this.props = el('div', { class: 'props' });
    this.checks = el('ul', { class: 'checks' });
    this.status = el('div', { class: 'status' });
    this.savedNote = el('span', { class: 'saved', 'aria-live': 'polite' });
    this.root = el('div', { id: 'editor', hidden: '' },
      el('div', { class: 'bar' },
        el('div', { class: 'group' },
          btn('Close', () => this.close()), btn('New', () => this.askNew()), btn('Open…', () => this.openMenu()),
          btn('Import…', () => this.importMenu(), 'A level from a file, or its text'), btn('Export…', () => this.exportMenu(), 'This level as a file, to keep or pass on'),
          btn('Test play', () => this.testPlay(), 'Play it in the game'),
          this.uploadButton = btn('Upload', () => this.upload(), 'Send it to be played by everyone (beaten in Test Play first)')),
        el('div', { class: 'group' }, btn('Undo', () => this.doUndo(), 'Undo (Ctrl+Z)'), btn('Redo', () => this.doRedo(), 'Redo (Ctrl+Y)'),
          btn('Cut', () => this.cut(), 'Cut (Ctrl+X)'), btn('Copy', () => this.copy(), 'Copy (Ctrl+C)'), btn('Paste', () => this.paste(), 'Paste (Ctrl+V)')),
        el('div', { class: 'group' }, ...this.toolButtons),
        el('label', { class: 'group' }, 'Size ', this.sizeInput, this.sizeLabel),
        el('label', { class: 'group' }, this.roundBox, ' Round'),
        el('label', { class: 'group' }, this.filledBox, ' Filled'),
        this.savedNote),
      el('div', { class: 'body' }, this.palette, el('div', { class: 'view' }, this.canvas, this.status), this.props));
    document.body.append(this.root);
    // (saved as the page is put away or left, whatever was being done)
    const away = () => { if (!this.root.hidden || this.testing) this.save(); };
    window.addEventListener('pagehide', away);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away(); });
    this.buildPalette();
    this.wire();
  }
  setTool(t) {
    this.tool = t;
    if (t !== 'select' && this.floating) this.floating = null;
    for (const b of this.toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    this.draw();
  }
  choose(paint, button) {
    this.paint = paint;
    if (this.tool === 'pick' || this.tool === 'select' || this.tool === 'erase') this.setTool('brush');
    for (const b of this.palette.querySelectorAll('.swatch')) b.setAttribute('aria-pressed', String(b === button));
    this.renderProps();
  }

  // (a plan's picture, as the game's plans bar shows it: small, for Plans in hand)
  planIcon(k) {
    this.planIcons = this.planIcons || {};
    if (this.planIcons[k] !== undefined) return this.planIcons[k];
    const cls = KINDS.vehicle.includes(k) ? 'vehicle' : 'building';
    let url = null;
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    if (this.fitImage(c.getContext('2d'), cls + '.' + k + '.plan', 0, 0, 40, 0.02)) url = c.toDataURL();
    this.planIcons[k] = url;
    return url;
  }
  // (a ground's swatch: its tile as the game draws it, the block and what stands on it)
  groundSwatch(g, ch, s) {
    if (TERRAIN[ch] === 'hole') {
      // (no block: the top of one, dark)
      const face = this.iso.face();
      if (!face) return;
      const t = this.tinted(face.canvas, '#1e1e28');
      const k = Math.min(s / t.width, s / t.height) * 1.2;
      g.drawImage(t, (s - t.width * k) / 2, (s - t.height * k) / 2 + s * 0.15, t.width * k, t.height * k);
      return;
    }
    const m = this.iso.member(groundMember(ch)) || this.iso.member('terrain.normal');
    const src = m && this.rt.renderer.inked(m, { member: m, ink: 36, blend: 100, foreColor: 255, backColor: 0 });
    if (!src) { this.drawGround(g, ch, 0, 0, s); return; }
    const k = Math.min(s / src.width, s / src.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(src, (s - src.width * k) / 2, (s - src.height * k) / 2, src.width * k, src.height * k);
  }
  buildPalette() {
    const sw = (title, draw, paint) => {
      const c = el('canvas', { width: '30', height: '30' });
      const b = el('button', { type: 'button', class: 'swatch', title, 'aria-label': title }, c);
      b.addEventListener('click', () => this.choose(paint(), b));
      this.later.push(() => { const g = c.getContext('2d'); g.clearRect(0, 0, 30, 30); draw(g, 30); });
      return b;
    };
    this.later = [];
    const section = (title, ...kids) => el('section', null, el('h4', { text: title }), el('div', { class: 'swatches' }, ...kids));
    const parts = [];
    for (const [group, chars] of GROUND) {
      parts.push(section(group, ...chars.map((ch) => sw(NAMES[TERRAIN[ch]] || TERRAIN[ch].replace(/street(\d+)/, 'Street $1'), (g, s) => this.groundSwatch(g, ch, s), () => ({ kind: 'ground', ch })))));
    }
    const unit = (cls, kind) => sw(kind.replace(/_/g, ' '), (g, s) => this.drawItem(g, { t: 'unit', cls, kind }, 0, 0, s), () => ({ kind: 'item', item: { t: 'unit', cls, kind } }));
    parts.push(section('Vehicles', ...KINDS.vehicle.map((k) => unit('vehicle', k))));
    parts.push(section('Buildings', ...KINDS.building.map((k) => unit('building', k))));
    parts.push(section('Monsters', ...KINDS.monster.map((k) => unit('monster', k))));
    parts.push(section('Items',
      sw('Bricks', (g, s) => this.drawItem(g, { t: 'pile', bricks: { red: 10 } }, 0, 0, s), () => ({ kind: 'item', item: { t: 'pile', bricks: { red: 10 } } })),
      sw('Plan', (g, s) => this.drawItem(g, { t: 'plan', what: 'buggy', n: 1 }, 0, 0, s), () => ({ kind: 'item', item: { t: 'plan', what: 'buggy', n: 1 } })),
      sw('Goal', (g, s) => this.drawItem(g, { t: 'goal', want: 'anything' }, 0, 0, s), () => ({ kind: 'item', item: { t: 'goal', want: 'anything' } })),
      sw('Bonus goal', (g, s) => this.drawItem(g, { t: 'bonus', want: 'anything' }, 0, 0, s), () => ({ kind: 'item', item: { t: 'bonus', want: 'anything' } })),
      sw('Whirlpool', (g, s) => this.drawItem(g, { t: 'whirl', id: 1 }, 0, 0, s), () => ({ kind: 'item', item: { t: 'whirl', id: 1 } }))));
    this.palette.replaceChildren(...parts);
  }

  // The properties: the level's, and those of the item to be painted (or the one picked).
  renderProps() {
    // (made anew at each change: where it was scrolled to, and the box being changed, kept)
    const scrolled = this.props ? this.props.scrollTop : 0;
    const active = document.activeElement;
    const focusKey = this.props && active && this.props.contains(active) ? active.dataset.key : null;
    const field = (label, input) => { if (input.dataset && !input.dataset.key) input.dataset.key = label; return el('label', { class: 'field' }, el('span', { text: label }), input); };
    const num = (value, min, max, f) => { const i = el('input', { type: 'number', min: String(min), max: String(max), value: String(value) }); i.addEventListener('change', () => { const n = Math.max(min, Math.min(max, Math.round(Number(i.value) || min))); i.value = n; f(n); }); return i; };
    const select = (value, options, f) => { const s = el('select', null, ...options.map(([v, t]) => el('option', { value: v, text: t, selected: v === value ? '' : undefined }))); s.addEventListener('change', () => f(s.value)); return s; };
    const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: this.name || '' });
    name.addEventListener('change', () => { this.remember(); this.name = cleanText(name.value) || 'NEW LEVEL'; name.value = this.name; this.refresh(); });
    const sky = select(String(this.sky), SKIES.map((s, i) => [String(i + 1), s]), (v) => { this.remember(); this.sky = Number(v); this.refresh(); });
    const grow = (side) => el('span', { class: 'grow' }, el('button', { type: 'button', text: '+', title: 'A row or column more, ' + side, onclick: () => this.grow(side, 1) }),
      el('button', { type: 'button', text: '−', title: 'A row or column less, ' + side, onclick: () => this.grow(side, -1) }));
    const parts = [el('h4', { text: 'Level' }), field('Name', name), field('Sky', sky),
      el('div', { class: 'field' }, el('span', { text: this.W + ' × ' + this.H }), el('span', { class: 'grows' }, 'Top', grow('top'), 'Bottom', grow('bottom'), 'Left', grow('left'), 'Right', grow('right')))];
    // plans in hand
    const plannable = KINDS.vehicle.concat(KINDS.building);
    const inv = el('div', { class: 'inv' });
    for (const k of plannable) {
      const n = this.inventory[k] || 0;
      const box = num(n, 0, LIMITS.inHand, (v) => { this.remember(); if (v) this.inventory[k] = v; else delete this.inventory[k]; this.refresh(); });
      box.dataset.key = k;
      const icon = this.planIcon(k);
      inv.append(el('label', { class: 'field plan' }, icon ? el('img', { src: icon, alt: '', class: 'icon' }) : el('span', { class: 'icon' }), el('span', { text: k.replace(/_/g, ' ') }), box));
    }
    // (kept open, or shut, as it was left: the panel is made anew at each change)
    const plans = el('details', { open: this.plansOpen ? '' : null }, el('summary', { text: 'Plans in hand (' + Object.values(this.inventory).reduce((a, n) => a + n, 0) + ')' }), inv);
    plans.addEventListener('toggle', () => { this.plansOpen = plans.open; });
    parts.push(plans);
    // what is painted
    const p = this.paint;
    if (p.kind === 'item') {
      const it = p.item;
      parts.push(el('h4', { text: 'Painting: ' + (it.t === 'unit' ? it.kind.replace(/_/g, ' ') : { pile: 'bricks', plan: 'a plan', goal: 'the goal', bonus: 'the bonus goal', whirl: 'a whirlpool' }[it.t]) }));
      if (it.t === 'pile') for (const b of BRICKS) parts.push(field(b, num(it.bricks[b] || 0, 0, LIMITS.bricks, (v) => { if (v) it.bricks[b] = v; else delete it.bricks[b]; })));
      if (it.t === 'plan') {
        parts.push(field('Plan for', select(it.what, plannable.map((k) => [k, k.replace(/_/g, ' ')]), (v) => { it.what = v; })));
        parts.push(field('How many', num(it.n, 1, LIMITS.planN, (v) => { it.n = v; })));
      }
      if (it.t === 'goal' || it.t === 'bonus') {
        const all = ['anything'].concat(KINDS.vehicle, KINDS.building, KINDS.monster);
        const collect = typeof it.want === 'object';
        parts.push(field('Wants', select(collect ? 'collect' : it.want, all.map((k) => [k, k.replace(/_/g, ' ')]).concat([['collect', 'a number of one kind on its yellow ground']]),
          (v) => { it.want = v === 'collect' ? { collect: 2, kind: 'crab' } : v; this.renderProps(); })));
        if (collect) {
          parts.push(field('How many', num(it.want.collect, 1, 20, (v) => { it.want.collect = v; })));
          parts.push(field('Of', select(it.want.kind, KINDS.vehicle.concat(KINDS.monster).map((k) => [k, k.replace(/_/g, ' ')]), (v) => { it.want.kind = v; })));
        }
      }
      if (it.t === 'whirl') parts.push(field('Number (those of a number go to one another)', num(it.id, 1, LIMITS.whirlIds, (v) => { it.id = v; })));
    }
    parts.push(el('h4', { text: 'Checks' }), this.checks);
    this.props.replaceChildren(...parts);
    this.props.scrollTop = scrolled;
    if (focusKey) {
      const again = [...this.props.querySelectorAll('[data-key]')].find((e) => e.dataset.key === focusKey);
      if (again) again.focus({ preventScroll: true });
    }
    this.renderChecks();
  }
  renderChecks() {
    const errs = validate(this.level());
    const notes = errs.map((e) => el('li', { class: 'bad', text: e }));
    if (!errs.length) notes.push(el('li', { class: 'good', text: this.beaten ? 'Beaten in Test Play: ready to upload' : 'Playable: beat it in Test Play (goal and bonus) to upload it' }));
    const up = this.drafts[this.id] && this.drafts[this.id].uploaded;
    if (up && up.json === JSON.stringify(this.level())) notes.push(el('li', { class: 'good', text: 'Uploaded as C-' + up.id + (up.status === 'pending' ? ': waiting to be looked at' : '') }));
    this.checks.replaceChildren(...notes);
    if (this.uploadMsg) notes.push(el('li', { class: this.uploadMsg.bad ? 'bad' : 'good', text: this.uploadMsg.text }));
    if (this.uploadButton) this.uploadButton.disabled = !!errs.length || !this.beaten || !!this.uploading;
  }

  // ---------- drawing ----------

  // A member's picture, its white made clear (the game draws them on white, or keys it out);
  // `part` for a tile of ground: 'top' its top face only, 'above' what stands on it without
  // the block of ground under it.
  image(name, part) {
    const id = name + '|' + (part || '');
    if (this.images.has(id)) return this.images.get(id);
    const m = this.rt.nameIndex && this.rt.nameIndex.get(name.toLowerCase());
    const src = m && m.drawable ? m.drawable() : null;
    let img = null;
    if (src && src.width) {
      // (the ground's block: its top face is the top 38 of a 75 by 84 tile)
      const h = part === 'top' ? Math.min(src.height, 38) : part === 'above' ? Math.max(20, src.height - 46) : src.height;
      const y0 = part === 'top' ? src.height - 84 : 0;
      const c = document.createElement('canvas');
      c.width = src.width; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(src, 0, -Math.max(0, y0));
      try {
        const d = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) if (d.data[i] > 250 && d.data[i + 1] > 250 && d.data[i + 2] > 250) d.data[i + 3] = 0;
        g.putImageData(d, 0, 0);
      } catch (e) { /* drawn as it is */ }
      img = c;
    }
    this.images.set(id, img);
    return img;
  }
  // (a member's picture fitted into a square, kept to its shape)
  fitImage(g, name, x, y, s, pad = 0.08, part) {
    const img = this.image(name, part);
    if (!img || !img.width) return false;
    const k = Math.min((s * (1 - 2 * pad)) / img.width, (s * (1 - 2 * pad)) / img.height);
    const w = img.width * k, h = img.height * k;
    g.drawImage(img, x + (s - w) / 2, y + (s - h) / 2, w, h);
    return true;
  }
  colorOf(ch) {
    const t = TERRAIN[ch];
    if (!this.colors) this.colors = {};
    if (this.colors[t]) return this.colors[t];
    // (the minimap's colour for the ground, as the game draws it)
    if (t === 'hole') return '#1e1e28';
    let c = { normal: '#3cb43c', normal_undiggable: '#a08c64', goal: '#e6d23c', swamp: '#5a6e3c', hole: '#1e1e28', water: '#2c8ce0', water_undiggable: '#1c5aa8', water_reefs: '#5ab4c8', cement: '#b4b4b4', billboard: '#3cb43c' }[t];
    const img = this.image('minimap.terrain.' + t);
    if (img && img.width) {
      try {
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
        if (d[3]) c = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
      } catch (e) { /* the default */ }
    }
    if (!c) c = /^street/.test(t) ? '#8c8c8c' : WATER.has(ch) ? '#2c8ce0' : '#3cb43c';
    this.colors[t] = c;
    return c;
  }
  drawGround(g, ch, x, y, s) {
    const t = TERRAIN[ch];
    const under = ['tree', 'tree2', 'tree3', 'tree4', 'mountain', 'volcano', 'jungle1', 'jungle2', 'jungle3', 'jungle4', 'billboard', 'roadblock'].includes(t);
    g.fillStyle = this.colorOf(under ? '.' : ch);
    g.fillRect(x, y, s, s);
    if (under) this.fitImage(g, 'terrain.' + t, x, y, s, 0.04, 'above');
    else if (/^street/.test(t) || t === 'normal_undiggable' || t === 'swamp' || t === 'water_reefs' || t === 'cement') this.fitImage(g, 'terrain.' + t, x, y, s, 0, 'top');
  }
  drawItem(g, it, x, y, s) {
    if (it.t === 'unit') {
      const k = it.kind;
      const names = it.cls === 'monster' ? ['monster.' + k + '.down', 'monster.' + k + '.right', 'resource.' + k]
        : [it.cls + '.' + k + '.plan', it.cls + '.' + k.replace(/[23]$/, '') + '.plan', it.cls + '.' + k + '.down', it.cls + '.' + k + '.right'];
      for (const n of names) if (this.fitImage(g, n, x, y, s)) return;
      g.fillStyle = '#fff'; g.font = Math.round(s * 0.4) + 'px sans-serif'; g.fillText(k.slice(0, 3), x + 2, y + s * 0.65);
    } else if (it.t === 'pile') {
      const b = BRICKS.find((c) => it.bricks && it.bricks[c] > 0) || 'red';
      if (!this.fitImage(g, b === 'wheel' || b === 'energy' ? 'resource.' + b : 'resource.' + b + '.2', x, y, s)) { g.fillStyle = '#c33'; g.fillRect(x + s * 0.25, y + s * 0.3, s * 0.5, s * 0.4); }
    } else if (it.t === 'plan') {
      this.fitImage(g, 'plan.generic', x, y, s);
    } else if (it.t === 'goal' || it.t === 'bonus') {
      this.fitImage(g, it.t === 'goal' ? 'goal.goal' : 'goal.bonus', x, y, s);
    } else if (it.t === 'whirl') {
      if (!this.fitImage(g, 'whirlpool.generic', x, y, s)) { g.strokeStyle = '#fff'; g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.3, 0, 6.3); g.stroke(); }
      g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(s * 0.35) + 'px sans-serif'; g.fillText(String(it.id), x + 2, y + s * 0.35);
    }
  }
  // The level as the game draws it (src/online/isoview.js), at the game's own size: drawn anew
  // only when what it shows has changed (a shape being drawn, a paste being placed, shown in it).
  picture2() {
    const grid = this.grid.map((r) => r.slice());
    const items = new Map(this.items);
    const put = (x, y, ch, item, ground) => {
      if (!this.inside(x, y)) return;
      if (ground) grid[y][x] = ch;
      if (item !== undefined) { if (item) items.set(x + ',' + y, item); else items.delete(x + ',' + y); }
    };
    if (this.preview) for (const [x, y, p] of this.preview) put(x, y, p.ch, p.kind === 'item' ? p.item : p.kind === 'erase' ? null : undefined, p.kind === 'ground');
    if (this.floating) {
      const f = this.floating;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) put(f.x + x, f.y + y, f.cells[y][x].ch, f.cells[y][x].item || null, true);
    }
    const key = grid.map((r) => r.join('')).join('/') + '|' + JSON.stringify([...items]);
    if (key !== this.picKey || !this.pic) {
      this.picKey = key;
      this.pic = this.iso.render(grid, items);
    }
    return this.pic;
  }
  fit() {
    if (!this.canvas.clientWidth || !this.grid) return;
    const pic = this.picture2();
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    this.zoom = Math.max(0.15, Math.min(2, Math.min((cw - 30) / pic.canvas.width, (ch - 30) / pic.canvas.height)));
    this.ox = (cw - pic.canvas.width * this.zoom) / 2;
    this.oy = (ch - pic.canvas.height * this.zoom) / 2;
  }
  draw() {
    if (!this.grid || this.root.hidden) return;
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#5a8fd0';
    g.fillRect(0, 0, cw, ch);
    // (the sky the level is played under, as the game's backdrop)
    const sky = this.skyImage();
    if (sky) {
      const f = Math.max(cw / sky.width, ch / sky.height);
      g.imageSmoothingEnabled = true;
      g.drawImage(sky, (cw - sky.width * f) / 2, (ch - sky.height * f) / 2, sky.width * f, sky.height * f);
    }
    const pic = this.picture2();
    g.imageSmoothingEnabled = this.zoom < 1;
    g.imageSmoothingQuality = 'high';
    g.drawImage(pic.canvas, this.ox, this.oy, pic.canvas.width * this.zoom, pic.canvas.height * this.zoom);
    // (marks on tiles: their ground's own shape, tinted)
    const face = this.iso.face();
    const mark = (x, y, color, alpha) => {
      const sp = this.iso.groundOf(x, y);
      if (!sp || !face) return;
      const t = this.tinted(face.canvas, color);
      g.globalAlpha = alpha;
      g.drawImage(t, this.ox + (sp.lx + face.dx - pic.x0) * this.zoom, this.oy + (sp.ly + face.dy - pic.y0) * this.zoom, t.width * this.zoom, t.height * this.zoom);
      g.globalAlpha = 1;
    };
    if (this.showGrid) for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if ((x + y) % 2) mark(x, y, '#000', 0.06);
    if (this.preview) for (const [x, y] of this.preview) mark(x, y, '#ffffff', 0.25);
    const sel = this.selected();
    if (sel) for (let y = sel[1]; y <= sel[3]; y++) for (let x = sel[0]; x <= sel[2]; x++) mark(x, y, '#3a8bff', 0.4);
    if (this.floating) {
      const f = this.floating;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) mark(f.x + x, f.y + y, '#ffd23c', 0.35);
    }
    if (this.hover && this.inside(...this.hover) && !this.floating) {
      const [hx, hy] = this.hover;
      const r = ['brush', 'erase', 'line', 'rect', 'ellipse'].includes(this.tool) ? this.size - 1 : 0, lo = -Math.floor(r / 2);
      for (let y = hy + lo; y <= hy + lo + r; y++) for (let x = hx + lo; x <= hx + lo + r; x++) if (this.inside(x, y)) mark(x, y, '#ffffff', 0.45);
    }
    if (this.center) mark(this.center[0], this.center[1], '#ff3', 0.55);
  }
  // (a tile's top filled with a colour, for marking it)
  tinted(shape, color) {
    this.tints = this.tints || new Map();
    let t = this.tints.get(color);
    if (t) return t;
    t = document.createElement('canvas');
    t.width = shape.width; t.height = shape.height;
    const tg = t.getContext('2d');
    tg.drawImage(shape, 0, 0);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = color;
    tg.fillRect(0, 0, t.width, t.height);
    this.tints.set(color, t);
    return t;
  }
  // The level's sky (its world's backdrop), as the game shows it behind the map.
  skyImage() {
    this.skies = this.skies || {};
    if (this.skies[this.sky] !== undefined) return this.skies[this.sky];
    let img = null;
    for (const name of ['sky' + this.sky]) {
      const m = this.rt.nameIndex && this.rt.nameIndex.get(name);
      if (m && m.drawable) { img = m.drawable(); break; }
    }
    this.skies[this.sky] = img;
    return img;
  }
  refresh() {
    this.save();
    this.renderProps();
    this.draw();
  }

  // ---------- the pointer and the keys ----------

  // The tile under the pointer, as the game finds the tile clicked (its ground's shape); off the
  // map, the place it would be (for a line or a shape dragged past the edge).
  tileAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const pic = this.picture2();
    const px = (e.clientX - r.left - this.ox) / this.zoom, py = (e.clientY - r.top - this.oy) / this.zoom;
    return this.iso.tileAt(px, py) || this.iso.nearest(px, py);
  }
  // Where a tile is on the page (the middle of its ground's top), for the tests.
  screenOf(x, y) {
    const r = this.canvas.getBoundingClientRect();
    const [px, py] = this.iso.middle(x, y);
    return [r.left + this.ox + px * this.zoom, r.top + this.oy + py * this.zoom];
  }
  wire() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      c.setPointerCapture(e.pointerId);
      const [x, y] = this.tileAt(e);
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.space)) { drag = { pan: true, sx: e.clientX, sy: e.clientY, ox: this.ox, oy: this.oy }; return; }
      if (e.button !== 0) return;
      if (this.floating) { this.floating.x = x; this.floating.y = y; this.drop(); return; }
      const t = this.tool;
      if (t === 'pick') { this.pickAt(x, y); return; }
      if (t === 'fill') { this.remember(); this.fill(x, y); this.refresh(); return; }
      if (t === 'select') {
        const s = this.selected();
        if (s && x >= s[0] && x <= s[2] && y >= s[1] && y <= s[3]) {
          // (a selection dragged: lifted, to be put down where it is let go)
          this.copy();
          this.clear();
          this.floating = { x: s[0], y: s[1], w: this.clip.w, h: this.clip.h, cells: this.clip.cells, ox: x - s[0], oy: y - s[1], moving: true };
          drag = { moving: true };
          this.draw();
          return;
        }
        this.sel = { x0: x, y0: y, x1: x, y1: y };
        drag = { select: true };
        this.draw();
        return;
      }
      this.remember();
      if (t === 'brush' || t === 'erase') {
        const paint = t === 'erase' ? { kind: 'erase' } : this.paint;
        this.brush(x, y, (a, b) => this.put(a, b, paint));
        drag = { stroke: true, last: [x, y], paint };
        this.draw();
        return;
      }
      drag = { shape: true, x0: x, y0: y };
      this.preview = [];
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = this.tileAt(e);
      this.hover = [x, y];
      if (this.floating && !drag) { this.floating.x = x; this.floating.y = y; this.draw(); return; }
      if (!drag) { this.draw(); this.showStatus(x, y); return; }
      if (drag.pan) { this.ox = drag.ox + e.clientX - drag.sx; this.oy = drag.oy + e.clientY - drag.sy; this.draw(); return; }
      if (drag.moving) { this.floating.x = x - this.floating.ox; this.floating.y = y - this.floating.oy; this.draw(); return; }
      if (drag.select) { this.sel.x1 = x; this.sel.y1 = y; this.draw(); return; }
      if (drag.stroke) {
        // (a quick stroke leaves no gaps: the tiles between, too)
        this.line(drag.last[0], drag.last[1], x, y, (a, b) => this.brush(a, b, (p, q) => this.put(p, q, drag.paint)));
        drag.last = [x, y];
        this.draw();
        return;
      }
      if (drag.shape) {
        this.preview = [];
        this.shape(drag.x0, drag.y0, x, y, (a, b) => this.preview.push([a, b, this.paint]));
        this.draw();
      }
    });
    const up = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moving) { this.drop(); return; }
      if (d.stroke) { this.refresh(); return; }
      if (d.shape) {
        const [x, y] = this.tileAt(e);
        this.preview = null;
        this.shape(d.x0, d.y0, x, y, (a, b) => this.put(a, b));
        this.refresh();
      }
      this.draw();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => { drag = null; this.preview = null; this.draw(); });
    c.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * 0.0015);
      const z = Math.max(0.25, Math.min(4, this.zoom * k));
      this.ox = mx - (mx - this.ox) * (z / this.zoom);
      this.oy = my - (my - this.oy) * (z / this.zoom);
      this.zoom = z;
      this.draw();
    }, { passive: false });
    window.addEventListener('resize', () => this.draw());
    // the keys, while the editor is open (not in its fields)
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      const typing = e.target instanceof Element && e.target.closest('input, select, textarea');
      if (typing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      let done = true;
      if (ctrl && k === 'z' && !e.shiftKey) this.doUndo();
      else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) this.doRedo();
      else if (ctrl && k === 'c') this.copy();
      else if (ctrl && k === 'x') this.cut();
      else if (ctrl && k === 'v') this.paste();
      else if (ctrl && k === 'a') { this.sel = { x0: 0, y0: 0, x1: this.W - 1, y1: this.H - 1 }; this.setTool('select'); }
      else if (e.key === 'Delete' || e.key === 'Backspace') this.clear();
      else if (e.key === 'Escape') { if (this.floating) this.floating = null; else this.sel = null; this.preview = null; this.draw(); }
      else if (e.key === ' ') { this.space = true; }
      else if (e.key === '[') { this.size = Math.max(1, this.size - 1); this.sizeInput.value = this.size; this.sizeLabel.textContent = this.size; this.draw(); }
      else if (e.key === ']') { this.size = Math.min(9, this.size + 1); this.sizeInput.value = this.size; this.sizeLabel.textContent = this.size; this.draw(); }
      else if (!ctrl && { b: 'brush', l: 'line', r: 'rect', e: 'ellipse', f: 'fill', i: 'pick', x: 'erase', s: 'select' }[k]) this.setTool({ b: 'brush', l: 'line', r: 'rect', e: 'ellipse', f: 'fill', i: 'pick', x: 'erase', s: 'select' }[k]);
      else done = false;
      if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('keyup', (e) => { if (e.key === ' ') this.space = false; }, true);
  }
  // The eyedropper: what is on the tile becomes what is painted (an item rather than its ground).
  pickAt(x, y) {
    if (!this.inside(x, y)) return;
    const it = this.items.get(x + ',' + y);
    this.paint = it ? { kind: 'item', item: JSON.parse(JSON.stringify(it)) } : { kind: 'ground', ch: this.grid[y][x] };
    this.setTool('brush');
    this.renderProps();
  }
  showStatus(x, y) {
    if (!this.inside(x, y)) { this.status.textContent = this.W + ' × ' + this.H; return; }
    const it = this.items.get(x + ',' + y);
    const what = it ? (it.t === 'unit' ? it.kind : it.t === 'pile' ? 'bricks ' + Object.entries(it.bricks).map(([k, n]) => n + ' ' + k).join(', ') : it.t === 'plan' ? 'plan: ' + it.what + ' ×' + it.n : it.t === 'whirl' ? 'whirlpool ' + it.id : it.t + ': ' + (typeof it.want === 'object' ? it.want.collect + ' ' + it.want.kind : it.want)) : '';
    this.status.textContent = x + ', ' + y + ' · ' + (NAMES[TERRAIN[this.grid[y][x]]] || TERRAIN[this.grid[y][x]]) + (what ? ' · ' + what : '');
  }

  // ---------- drafts, opening, test play ----------

  // Saved as it is made, in this browser (offline too): at every change, and as the page is put
  // away or left.  Said so beside the tools, or that it could not be (the browser's room full).
  save() {
    if (!this.grid) return;
    const was = this.drafts[this.id];
    this.drafts[this.id] = { level: this.level(), at: Date.now(), beaten: this.beaten, uploaded: was && was.uploaded };
    const ok = saveDrafts(this.drafts);
    if (this.savedNote) {
      const t = new Date();
      this.savedNote.textContent = ok ? 'Saved in this browser ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
        : 'Not saved: this browser has no more room. Export it to keep it!';
      this.savedNote.classList.toggle('bad', !ok);
    }
  }

  // ---------- import, export ----------

  menu(title, ...rows) {
    for (const m of this.root.querySelectorAll('.openmenu')) m.remove();
    const menu = el('div', { class: 'openmenu', role: 'dialog', 'aria-label': title });
    const close = () => menu.remove();
    menu.append(el('h4', { text: title }), ...rows.map((r) => (typeof r === 'function' ? r(close) : r)),
      el('button', { type: 'button', class: 'close', text: 'Close', onclick: close }));
    menu.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    this.root.append(menu);
    return menu;
  }
  exportMenu() {
    const level = this.level();
    const text = toFile(level, { author: this.ui.settings && this.ui.settings.name });
    const note = el('p', { class: 'note', 'aria-live': 'polite' });
    this.menu('Export ' + level.name,
      el('p', { text: 'The level as a file: to keep (it is saved in this browser as you go, but a browser’s storage can be cleared), to move to another device, or to give to a friend to Import.' }),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'tool', text: 'Save the file', onclick: async () => {
          try {
            const how = await saveFile(text, fileName(level));
            note.textContent = { downloaded: 'Saved as ' + fileName(level) + '.', shared: 'Shared.', copied: 'Copied as text: paste it somewhere to keep it.', cancelled: '' }[how];
          } catch (e) { note.textContent = 'It could not be saved: Copy the text instead.'; }
        } }),
        el('button', { type: 'button', class: 'tool', text: 'Copy the text', onclick: async () => {
          try { await navigator.clipboard.writeText(text); note.textContent = 'Copied: paste it into a message or a note to keep it.'; } catch (e) { note.textContent = 'It could not be copied here.'; }
        } })),
      note);
  }
  importMenu() {
    const note = el('p', { class: 'note', 'aria-live': 'polite' });
    const box = el('textarea', { rows: '5', spellcheck: 'false', 'aria-label': 'A level’s text', placeholder: 'Or paste a level’s text here (an exported file’s, or a map’s as the game writes them)' });
    const take = (text, close) => {
      if (text === null) return;
      try {
        const r = fromText(text);
        this.save();
        this.load(r.level);
        this.save();
        this.renderProps();
        close();
        this.status.textContent = 'Imported ' + r.level.name + (r.author ? ' by ' + r.author : '') + (r.problems.length ? ': not playable yet (see Checks)' : '');
      } catch (e) {
        note.textContent = e.message;
      }
    };
    this.menu('Import a level',
      el('p', { text: 'It comes in as a new level of yours; the one open now stays in Open.' }),
      (close) => el('div', { class: 'row' }, el('button', { type: 'button', class: 'tool', text: 'From a file…', onclick: async () => take(await chooseFile(), close) })),
      box,
      (close) => el('div', { class: 'row' }, el('button', { type: 'button', class: 'tool', text: 'Import the text', onclick: () => take(box.value, close) })),
      note);
  }
  // A level from elsewhere (the custom levels' Edit a Copy): a new one of the player's.
  openCopy(level) {
    this.open();
    this.save();
    this.load(JSON.parse(JSON.stringify(level)));
    this.save();
    this.renderProps();
  }
  askNew() {
    this.save();
    this.load(this.newLevel());
  }
  openMenu() {
    const menu = el('div', { class: 'openmenu' });
    const close = () => menu.remove();
    const mine = Object.entries(this.drafts).sort((a, b) => b[1].at - a[1].at);
    menu.append(el('h4', { text: 'Your levels' }));
    for (const [id, d] of mine) {
      menu.append(el('div', { class: 'row' },
        el('button', { type: 'button', class: 'pick', text: d.level.name, onclick: () => { this.save(); this.load(d.level, id); this.beaten = d.beaten || null; this.renderChecks(); close(); } }),
        el('button', { type: 'button', class: 'del', text: 'Delete', onclick: () => { if (id === this.id) return; delete this.drafts[id]; saveDrafts(this.drafts); close(); this.openMenu(); } })));
    }
    menu.append(el('h4', { text: 'Start from a campaign mission' }));
    // (the campaign's maps as the game's data has them, not as a slot may hold another now)
    const texts = {};
    for (const c of this.rt.data.casts) for (const m of Object.values(c.members)) if (/^map\d\.\d+$/.test(m.name || '') && m.text) texts[m.name] = m.text;
    for (let w = 1; w <= 7; w++) {
      const row = el('div', { class: 'row campaign' }, el('span', { text: SKIES[w - 1] }));
      for (let l = 1; l <= 12; l++) {
        const m = { rec: { text: texts['map' + w + '.' + l] } };
        if (!m.rec.text) continue;
        row.append(el('button', { type: 'button', text: String(l), title: SKIES[w - 1] + ', mission ' + l, onclick: () => {
          const level = parseMap(m.rec.text);
          level.sky = w;
          level.name = cleanText(level.name) || (SKIES[w - 1] + ' ' + l);
          this.save();
          this.load(level);
          close();
        } }));
      }
      menu.append(row);
    }
    menu.append(el('button', { type: 'button', class: 'close', text: 'Close', onclick: close }));
    this.root.append(menu);
  }
  // Test play: the level in the game; back here when it is left.  Beaten (goal and bonus) it may
  // be uploaded: the times are kept with it.
  testPlay() {
    const level = this.level();
    const errs = validate(level);
    if (errs.length) { this.renderChecks(); return; }
    this.save();
    this.testing = { id: this.id, level: JSON.stringify(level) };
    this.root.hidden = true;
    this.ui.enterGame({ map: false });
    const rt = this.rt;
    if (!/^world \d$/.test(rt.labelAt(rt.frame) || '')) { rt.go('world 1'); if (rt.testMode) rt.step(1); }
    const go = () => {
      const problem = this.ui.random.playLevel(level, 'C-DRAFT');
      if (problem) { this.testing = null; this.root.hidden = false; this.status.textContent = problem; return; }
      // (its picture, once the game has laid the map out)
      const json = this.testing.level;
      setTimeout(() => this.shoot(json).catch(() => {}), 1500);
    };
    if (rt.testMode) go(); else setTimeout(go, 100);
  }
  // The level's picture, for the upload: the whole map as the game draws it (src/online/snapshot.js,
  // as the generated missions' are), taken as its Test Play starts; kept with the level it is of.
  async shoot(json) {
    const t = this.testing;
    if (!t || t.level !== json || this.rt.labelAt(this.rt.frame) !== 'play') return;
    const blob = await snapshot(this.rt, 1200, 800);
    if (!blob) return;
    const data = await new Promise((done) => { const r = new FileReader(); r.onload = () => done(r.result); r.onerror = () => done(null); r.readAsDataURL(blob); });
    if (!data) return;
    this.shot = { json, data };
    try { localStorage.setItem(SHOT, JSON.stringify(this.shot)); } catch (e) { /* kept for the visit */ }
  }
  picture(json) {
    let shot = this.shot;
    if (!shot) try { shot = JSON.parse(localStorage.getItem(SHOT) || 'null'); } catch (e) { shot = null; }
    if (!shot || shot.json !== json) return null;
    return fetch(shot.data).then((r) => r.blob());
  }
  // Upload: a level beaten in Test Play (goal and bonus), to be looked at, then played by all.
  async upload() {
    const level = this.level();
    if (validate(level).length || !this.beaten) { this.renderChecks(); return; }
    const customs = this.ui.customs;
    if (!customs) return;
    if (!this.ui.settings.name) { this.say('Your name first: the settings have it.'); this.ui.open(); return; }
    this.uploading = true;
    this.say('Uploading…');
    try {
      const image = await this.picture(JSON.stringify(level));
      if (!image) throw new Error('Its picture is taken in Test Play: play it once more, then Upload.');
      const r = await customs.upload(level, this.beaten, image);
      const d = this.drafts[this.id];
      if (d) { d.uploaded = { id: r.id, status: r.status, json: JSON.stringify(level) }; saveDrafts(this.drafts); }
      this.say(r.status === 'approved' ? 'Uploaded: C-' + r.id + ' is out, in Custom levels.' : 'Uploaded as C-' + r.id + ': it is out once it has been looked at (Custom levels, Your uploads).');
    } catch (e) {
      this.say(e.message, true);
    }
    this.uploading = false;
    this.renderChecks();
  }
  say(text, bad) {
    this.uploadMsg = text ? { text, bad } : null;
    this.renderChecks();
  }
  // (from the scores: a goal reached in Test Play)
  reached(kind, ms) {
    const t = this.testing;
    if (!t) return;
    t[kind] = ms;
  }
  // (the Test Play left: back to the editor, beaten if goal and bonus were reached in it)
  left() {
    const t = this.testing;
    if (!t) return false;
    this.testing = null;
    if (t.goal !== undefined && t.bonus !== undefined && t.level === JSON.stringify(this.level())) {
      this.beaten = { goal: t.goal, bonus: t.bonus };
      this.save();
    }
    this.open();
    return true;
  }

  open() {
    if (this.ui.menu) this.ui.menu.hide();
    this.ui.panel.hidden = true;
    this.root.hidden = false;
    if (!this.grid) {
      const last = Object.entries(this.drafts).sort((a, b) => b[1].at - a[1].at)[0];
      if (last) { this.load(last[1].level, last[0]); this.beaten = last[1].beaten || null; } else this.load(this.newLevel());
    }
    for (const f of this.later) f();
    this.later = [];
    requestAnimationFrame(() => { this.fit(); this.renderProps(); this.draw(); });
    this.canvas.focus();
  }
  close() {
    this.save();
    this.root.hidden = true;
    if (this.ui.menu) this.ui.menu.show();
  }
}

function loadDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFTS) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch (e) {
    return {};
  }
}
function saveDrafts(d) {
  try { localStorage.setItem(DRAFTS, JSON.stringify(d)); return true; } catch (e) { return false; }
}
