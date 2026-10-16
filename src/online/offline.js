// The game as an installed web app that plays offline (sw.js, manifest.webmanifest): the
// service worker registered, told this version's files (the import map's modules, the files
// the page fetches, its stylesheets and pictures), and the browser's offer to install it kept
// for the settings' App section (src/online/ui.js).
//
// Not in the app for Windows, macOS and Linux (client/, app://), the Android app (Capacitor),
// or the tests' runs (?test): they have their files already, or want none kept.

import { fileUrl } from '../files.js';

export const offline = {
  installed: matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true,
  prompt: null,         // the browser's install offer, while it has one
  listeners: [],
  changed() { for (const f of this.listeners) f(); },
  // Asks the browser to install it: answers whether it was.
  async install() {
    if (!this.prompt) return false;
    const p = this.prompt;
    this.prompt = null;
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    this.changed();
    return !!choice && choice.outcome === 'accepted';
  },
};

// An iPhone or iPad's Safari, which installs only from its Share menu.
export const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function native() {
  return location.protocol === 'app:' || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export function installOffline(root, params) {
  if (native() || params.has('test') || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offline.prompt = e;
    offline.changed();
  });
  window.addEventListener('appinstalled', () => {
    offline.installed = true;
    offline.prompt = null;
    offline.changed();
  });
  navigator.serviceWorker.register(new URL('sw.js', root).href, { scope: root.href }).catch((e) => console.warn('no service worker', e));
  navigator.serviceWorker.ready.then((reg) => {
    if (reg.active) reg.active.postMessage({ type: 'keep', files: files(root) });
  });
}

// This version's files, as the page names them.
function files(root) {
  const out = new Set(['manifest.webmanifest', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
    'assets/icons/apple-touch-icon.png', 'assets/wb2/icon.png'].map((p) => new URL(p, root).href));
  const map = document.querySelector('script[type="importmap"]');
  if (map) {
    try {
      for (const u of Object.values(JSON.parse(map.textContent).imports || {})) out.add(new URL(u, document.baseURI).href);
    } catch (e) {
      // (no list of modules: they are kept as they are fetched)
    }
  }
  for (const p of Object.keys(window.__files || {})) out.add(fileUrl(p, root));
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) out.add(l.href);
  for (const s of document.querySelectorAll('script[type="module"][src]')) out.add(s.src);
  return [...out];
}
