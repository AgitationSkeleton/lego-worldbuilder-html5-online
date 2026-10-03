// The online game's main menu, as CrystAlien Conflict Online has one: the first thing seen,
// in place of a "click to play" button (its first click is also what lets the browser play
// sound).  From it: the campaign (the world maps), a random mission, a race, the score
// tables and the settings.  The settings' "Main menu" comes back to it.
//
// Drawn like the game's own bubbles: white, a black rounded edge, green buttons in 04b_08,
// over a blurred copy of the title's picture.

import { el } from './dom.js';

const ART = 'assets/online/';

export class MainMenu {
  constructor(ui) {
    this.ui = ui;
    this.ready = false;
    this.build();
  }

  build() {
    // (the game's own interface sounds: the rollover's as the mouse comes onto a button or
    // the keys move to one, the click's as one is pressed)
    const button = (text, cls, f) => {
      const b = el('button', { type: 'button', class: 'btn ' + cls, text, disabled: '', onclick: () => this.choose(f) });
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !b.disabled) this.sfx('sfx_interface_rollover'); });
      b.addEventListener('focus', () => { if (!this.quiet && b.matches(':focus-visible')) this.sfx('sfx_interface_rollover'); });
      return b;
    };
    this.buttons = [
      button('Campaign', 'primary', () => this.ui.enterGame()),
      button('Random mission', '', () => this.ui.openRandom()),
      button('Race', '', () => this.ui.races && this.ui.races.open()),
      button('Score tables', '', () => this.ui.openTables()),
      button('Settings', '', () => this.ui.open()),
    ];
    this.status = el('p', { class: 'status', 'aria-live': 'polite', text: 'Loading…' });
    this.root = el('div', { id: 'menu', role: 'dialog', 'aria-label': 'LEGO World Builder Online' },
      el('div', { class: 'backdrop', style: `background-image: url(${ART}title_art.png)` }),
      el('div', { class: 'bubble' },
        el('div', { class: 'logos' },
          el('img', { class: 'logo1', src: ART + 'logo_wb.png', alt: 'LEGO World Builder' }),
          el('img', { class: 'logo2', src: ART + 'logo_wb2.png', alt: 'LEGO World Builder 2' }),
          el('span', { class: 'online', text: 'Online' })),
        el('div', { class: 'body' },
          el('nav', null, ...this.buttons, this.status),
          el('img', { class: 'art', src: ART + 'title_art.png', alt: '' })),
        el('p', { class: 'footnote', text: 'LEGO World Builder and LEGO World Builder 2 were made by Gamelab for The LEGO Group. LEGO is a trademark of the LEGO Group, which does not sponsor, authorise or endorse this unofficial, non-commercial port.' })));
    document.body.append(this.root);
  }

  // How far the game has loaded (0 to 1), until it is ready.
  progress(p) {
    if (!this.ready) this.status.textContent = 'Loading… ' + Math.round(p * 100) + '%';
  }

  setReady() {
    this.ready = true;
    this.status.textContent = '';
    for (const b of this.buttons) b.removeAttribute('disabled');
    this.focusFirst();
  }

  // (focused without a sound: the menu shown, not the keys moving)
  focusFirst() {
    this.quiet = true;
    this.buttons[0].focus();
    this.quiet = false;
  }

  sfx(name) {
    if (this.ui.controls) this.ui.controls.sfx(name);
  }

  choose(f) {
    // (the first click: sound may start now)
    this.ui.rt.sound.resume();
    this.sfx('sfx_interface_click_button');
    f();
  }

  get shown() { return !this.root.hidden; }
  show() {
    this.root.hidden = false;
    if (this.ready) this.focusFirst();
  }
  hide() { this.root.hidden = true; }
}
