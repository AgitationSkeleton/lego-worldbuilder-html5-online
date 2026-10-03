// The player's settings, kept in the browser.  Storage can be missing or refuse (a private
// window, blocked site data); then the settings last for the visit.  The game's own
// progress and its music and sound switches are kept by the game, as prefs.

const KEY = 'lego-wb-online:settings';

// How far the game may be enlarged to fill the window, in CSS pixels to one of the
// original stage's: beyond that a bigger window shows more of the map.  'fill' enlarges
// it all the way, as the 1:1 port does.
export const UI_SCALES = { small: 1.5, medium: 2, large: 2.5, fill: Infinity };

// Whether a time reached is sent to the score tables: asked each time, always, or never.
export const SEND_CHOICES = ['ask', 'always', 'never'];

export const DEFAULTS = {
  size: 'medium',
  name: '',                 // the name on the score tables
  scores: 'ask',            // one of SEND_CHOICES
  // loudness, 0 to 1, of the music, the game's sounds and the interface's (src/online/controls.js)
  music: 0.8,
  sound: 1,
  ui: 1,
  // controls (src/online/controls.js)
  menuPauses: true,         // the game's Menu button holds the game still while its menu is open
  panRight: true,           // the right mouse button drags the map
  panMiddle: true,          // the middle one too
  deselectRight: true,      // a right click puts down the unit chosen
  smoothKeys: true,         // held arrow keys move the map smoothly
};

const VOLUMES = ['music', 'sound', 'ui'];
const SWITCHES = ['menuPauses', 'panRight', 'panMiddle', 'deselectRight', 'smoothKeys'];

export function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {
    saved = null;
  }
  const s = Object.assign({}, DEFAULTS, saved && typeof saved === 'object' ? saved : {});
  if (!(s.size in UI_SCALES)) s.size = DEFAULTS.size;
  if (typeof s.name !== 'string') s.name = DEFAULTS.name;
  s.name = s.name.slice(0, 15);
  if (!SEND_CHOICES.includes(s.scores)) s.scores = DEFAULTS.scores;
  for (const k of VOLUMES) {
    const v = Number(s[k]);
    s[k] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULTS[k];
  }
  for (const k of SWITCHES) if (typeof s[k] !== 'boolean') s[k] = DEFAULTS[k];
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    // Not kept; it still applies for this visit.
  }
}
