// The online game's own controls, outside the game: a settings button in the window's
// corner and the settings it opens, drawn like the game's own bubbles (white, a black
// rounded edge, green buttons in the game's pixel font).

import { UI_SCALES, loadSettings, saveSettings } from './settings.js';

const SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
  ['fill', 'Fill window'],
];

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

export class OnlineUI {
  constructor(rt, canvas) {
    this.rt = rt;
    this.canvas = canvas;
    this.settings = loadSettings();
    // ?ui=1.5 (any factor) overrides the setting for the visit, for testing sizes
    const forced = parseFloat(new URLSearchParams(location.search).get('ui'));
    this.forcedScale = forced > 0 ? forced : 0;
    this.build();
  }
  // How many CSS pixels a stage pixel may take: the layout asks this on every resize.
  maxScale() {
    return this.forcedScale || UI_SCALES[this.settings.size];
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
    const fullRow = document.fullscreenEnabled
      ? el('section', null, el('h3', { text: 'Screen' }), el('div', { class: 'choices' }, this.fullButton))
      : null;
    this.panel = el('div', { id: 'settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title', hidden: '' },
      el('div', { class: 'bubble' },
        el('h2', { id: 'settings-title', text: 'Settings' }),
        el('section', null,
          el('h3', { text: 'Interface size' }),
          el('p', { text: 'How large the game is drawn. In a bigger window, more of the map shows instead.' }),
          el('div', { class: 'choices' }, ...this.sizeButtons)),
        fullRow,
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'done', text: 'Done', onclick: () => this.close() }))));
    this.panel.addEventListener('click', (e) => { if (e.target === this.panel) this.close(); });
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      e.stopPropagation();
    });
    document.addEventListener('fullscreenchange', () => this.render());
    document.body.append(this.gear, this.panel);
    this.render();
  }
  render() {
    const size = this.forcedScale ? null : this.settings.size;
    for (const b of this.sizeButtons) b.setAttribute('aria-pressed', String(b.dataset.key === size));
    this.fullButton.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  }
  apply() {
    saveSettings(this.settings);
    this.render();
    this.rt.renderer.resize();
    this.rt.needsDraw = true;
  }
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  open() {
    this.render();
    this.panel.hidden = false;
    (this.panel.querySelector('button[aria-pressed="true"]') || this.panel.querySelector('button')).focus();
  }
  close() {
    this.panel.hidden = true;
    this.canvas.focus();
  }
}
