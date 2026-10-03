// Small helpers for the online game's own controls (src/online/ui.js, scores.js, race.js).

// An element: el('button', {type: 'button', text: 'Go', onclick: f}, ...children).
// (`text` sets its text, `html` its markup, on... a listener; attributes and children that
// are null are left out.)
export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

const panels = [];

// A panel over the game, drawn like the game's bubbles: closed by Escape (wherever the
// focus is), by a click beside it, or by its Done button.
export function dialog(id, title, onClose, ...body) {
  const panel = el('div', { id, class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-title', hidden: '' },
    el('div', { class: 'bubble' },
      el('h2', { id: id + '-title', text: title }),
      ...body,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'done', text: 'Done', onclick: onClose }))));
  panel.addEventListener('click', (e) => { if (e.target === panel) onClose(); });
  // (keys typed in a panel are not the game's)
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panels.push({ panel, onClose });
  return panel;
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = panels.filter((p) => !p.panel.hidden);
  if (!open.length) return;
  e.preventDefault();
  e.stopPropagation();
  open[open.length - 1].onClose();
}, true);

// A text box focused, ready to type in; but not on a touch screen, where focusing one brings
// up the keyboard over the page unasked (and the page, shorter, is laid out again): there
// `instead` is focused, if given.
export function focusField(input, instead) {
  const touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const target = touch ? instead : input;
  if (target) target.focus();
}
