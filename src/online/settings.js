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
};

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
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    // Not kept; it still applies for this visit.
  }
}
