// The Android app (mobile/, Capacitor): its version, and whether a newer one is out on the
// repository's GitHub Releases (.github/workflows/app.yml puts each version's .apk there).  An
// app from outside a store cannot update itself: the settings and a notice say a new one is
// out, and its link opens in the phone's browser, which downloads it for the player to install.

export const RELEASES_API = 'https://api.github.com/repos/AgitationSkeleton/lego-worldbuilder-html5-online/releases/latest';

export const android = {
  version: null,        // this app's, once known
  update: null,         // {version, url} of a newer one
  listeners: [],
  changed() { for (const f of this.listeners) f(); },
};

export function isAndroidApp() {
  const C = window.Capacitor;
  return !!(C && C.isNativePlatform && C.isNativePlatform() && C.getPlatform && C.getPlatform() === 'android');
}

// Is version a newer than b?  ("1.0.12" > "1.0.9")
export function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

export async function checkAndroid() {
  if (!isAndroidApp()) return;
  try {
    const info = await window.Capacitor.Plugins.App.getInfo();
    android.version = info.version;
    android.changed();
    const r = await fetch(RELEASES_API, { cache: 'no-store' });
    if (!r.ok) return;
    const rel = await r.json();
    const v = String(rel.tag_name || '').replace(/^v/, '');
    const apk = (rel.assets || []).find((a) => /\.apk$/.test(a.name));
    if (apk && newer(v, android.version)) {
      android.update = { version: v, url: apk.browser_download_url };
      android.changed();
    }
  } catch (e) {
    // (offline, or no answer: asked again next time)
  }
}

// The screen's way round, by the setting Screen (settings.js, ORIENTATIONS): landscape (as
// AndroidManifest.xml starts it) or portrait, each either way up, or turned with the phone
// (MainActivity.java).
export function applyOrientation(orientation) {
  const screen = isAndroidApp() && window.WorldBuilderAndroid;
  if (screen) screen.setOrientation(String(orientation || 'landscape'));
}

// A page outside the game, in the phone's browser (the app's own window keeps to the game).
export function openOutside(url) {
  location.href = url;
}
