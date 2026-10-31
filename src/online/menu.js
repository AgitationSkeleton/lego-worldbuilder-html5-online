// The online game's main menu, as CrystAlien Conflict Online has one: the first thing seen,
// in place of a "click to play" button (its first click is also what lets the browser play
// sound).  From it: the campaign (the world maps), a random mission, a race, the score
// tables and the settings.  The settings' "Main menu" comes back to it.
//
// Drawn like the game's own bubbles: white, a black rounded edge, green buttons in 04b_08,
// over a blurred copy of the title's picture.

import { el } from './dom.js';
import { fileUrl } from '../files.js';

// (its pictures by their contents, as the page names them: src/files.js)
const art = (name) => fileUrl('assets/online/' + name, document.baseURI);

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
      // (levels made here, src/online/editor.js)
      button('Level editor', '', () => this.ui.editor && this.ui.editor.open()),
      // (generated missions played by the computer, to watch: src/online/screensaver.js)
      button('Screensaver mode', '', () => this.ui.screensaver && this.ui.screensaver.start()),
      button('Settings', '', () => this.ui.open()),
    ];
    this.status = el('p', { class: 'status', 'aria-live': 'polite', text: 'Loading…' });
    this.root = el('div', { id: 'menu', role: 'dialog', 'aria-label': 'LEGO World Builder Online' },
      // (each picture twice: as the game has it, and for the dark interface, its white taken
      // out: tools/merge.py, dark_menu_art; the stylesheet shows the one wanted)
      el('div', { class: 'backdrop', style: `--art: url(${art('title_art.png')}); --art-dark: url(${art('title_art_dark.png')})` }),
      el('div', { class: 'bubble' },
        el('div', { class: 'logos' },
          el('img', { class: 'logo1 light', src: art('logo_wb.png'), alt: 'LEGO World Builder' }),
          el('img', { class: 'logo1 dark', src: art('logo_wb_dark.png'), alt: 'LEGO World Builder', loading: 'lazy' }),
          el('img', { class: 'logo2 light', src: art('logo_wb2.png'), alt: 'LEGO World Builder 2' }),
          el('img', { class: 'logo2 dark', src: art('logo_wb2_dark.png'), alt: 'LEGO World Builder 2', loading: 'lazy' }),
          el('span', { class: 'online', text: 'Online' })),
        el('div', { class: 'body' },
          el('nav', null, ...this.buttons, this.status),
          el('img', { class: 'art light', src: art('title_art.png'), alt: '' }),
          el('img', { class: 'art dark', src: art('title_art_dark.png'), alt: '', loading: 'lazy' })),
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
