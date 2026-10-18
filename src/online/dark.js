// The dark interface (the setting Dark Interface): the game's own white interface on the play
// screen, and the world maps' white header, drawn dark gray, as the page's panels are (ui.css,
// html.dark), through the renderer's paint hook (layout.paint, src/director/render.js).
//
// - Surfaces (the frames round the map, the side panel, the plans bar, the bubbles) and the
//   text on them: their grays turned round, white to DARK and black to LIGHT, every shade
//   between along a curve (turn), and coloured pixels left as they are (a gray only a little
//   coloured moved only a little).  Every pixel goes over smoothly, the soft edges too, so no
//   light fringe is left where a picture's white met its outline.
// - Text on a button (a green, cyan or orange one) is left black, as it is.
// - Other pictures on the interface (buttons, icons, bricks, a unit's pictures): the white they
//   were drawn on, where it is still in them (all of it with a Copy ink, a JPEG's almost white
//   noise round a unit's large picture), made the dark gray, and their edges on it smoothed
//   into that, so that no white box or fuzz shows round them.
// - The minimap: its white only.
// - The world maps: their header's white band, and the logo on it (worldPaintOf).

import * as L from '../director/lingo.js';
import { BitmapMember, ShapeMember, TextMember } from '../director/members.js';

export const DARK = 46;      // what white becomes (#2e2e2e)
export const LIGHT = 226;    // what black becomes (#e2e2e2)

// A gray turned round: v (0 to 255) to the dark interface's, along a curve that keeps the middle
// grays (the game's gray titles and counts) as far from the dark gray as they were from white.
export const turn = (v) => DARK + (LIGHT - DARK) * Math.pow(Math.max(0, 255 - v) / 255, 0.65);

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
// how gray a pixel is: 1 gray, 0 coloured
function grayness(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx ? (mx - mn) / mx : 0;
  return sat <= 0.12 ? 1 : sat >= 0.3 ? 0 : (0.3 - sat) / 0.18;
}

function surfacePixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const w = grayness(r, g, b);
    if (!w) continue;
    const l = lum(r, g, b);
    const shift = (turn(l) - l) * w;
    d[i] = r + shift; d[i + 1] = g + shift; d[i + 2] = b + shift;
  }
}

// The white a picture was drawn on, where it is left: in a unit's large picture, an almost
// white pixel (a JPEG's noise on white, kept by an ink that takes out pure white only); in
// another, white itself (a Copy ink's whole backdrop).
const BACK_LUM = 222;
function backdropish(d, i, photo) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  if (!photo) return mn >= 250;
  return mn >= 200 && mx - mn <= 40 && lum(r, g, b) >= BACK_LUM;
}

// photo: a unit's large picture, whose ink took out its pure white only: the almost white left
// round it is the backdrop too, and its edges are smoothed into that a long way.  Other
// pictures with transparency already have no backdrop left in them.  In those, and in a Copy
// ink's, only the edge pixels nearly white are darkened (as much as they were smoothed into
// the white), not a light gray of the picture's own: a white brick's top.
function backdropPixels(d, width, height, photo) {
  const n = width * height;
  const back = new Uint8Array(n);       // 1 the backdrop, 2 already transparent
  const queue = new Int32Array(n);
  let qt = 0, clear = false;
  for (let p = 0; p < n; p++) if (!d[p * 4 + 3]) { back[p] = 2; clear = true; if (photo) queue[qt++] = p; }
  const flood = photo || !clear;
  if (flood) {
    for (let p = 0; p < n; p++) {
      const x = p % width, y = (p / width) | 0;
      if (!back[p] && (x === 0 || y === 0 || x === width - 1 || y === height - 1) && backdropish(d, p * 4, photo)) { back[p] = 1; queue[qt++] = p; }
    }
  }
  // the backdrop: the almost white reached from the picture's edges and its transparency
  for (let qh = 0; qh < qt; qh++) {
    const p = queue[qh], x = p % width;
    for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (q < 0 || q >= n || back[q] || !backdropish(d, q * 4, photo)) continue;
      back[q] = 1;
      queue[qt++] = q;
    }
  }
  const out = new Uint8ClampedArray(d);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (back[p] === 1) { out[i] = out[i + 1] = out[i + 2] = DARK; continue; }
    if (back[p]) continue;
    // the picture's edge on it: smoothed into the white, as much of it taken as was white
    const x = p % width, y = (p / width) | 0;
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && back[yy * width + xx]) { edge = true; break; }
      }
    }
    if (!edge) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], l = lum(r, g, b);
    const k = grayness(r, g, b) * Math.max(0, Math.min(1, photo ? (l - 110) / (BACK_LUM - 110) : (l - 225) / 30));
    if (!k) continue;
    out[i] = r + (DARK - r) * k; out[i + 1] = g + (DARK - g) * k; out[i + 2] = b + (DARK - b) * k;
  }
  d.set(out);
}

function whitesPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (!d[i + 3] || Math.min(r, g, b) < 236) continue;
    d[i] = d[i + 1] = d[i + 2] = DARK;
  }
}

// A logo drawn on white (WB1's on the world maps): every pixel but the LEGO badge's (inside its
// red) unmixed from white and laid on the dark gray, its letters' insides as well as round
// them (as tools/merge.py's dark_menu_art makes the main menu's).
function logoPixels(d, width, height) {
  let x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) {
      const x = p % width, y = (p / width) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  for (let p = 0; p < width * height; p++) {
    const x = p % width, y = (p / width) | 0, i = p * 4;
    if (!d[i + 3] || (x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1)) continue;
    // (as much of it white as its lightest channel says: that white made the dark gray)
    const white = 1 - Math.max(255 - d[i], 255 - d[i + 1], 255 - d[i + 2]) / 255;
    for (let c = 0; c < 3; c++) d[i + c] -= white * (255 - DARK);
  }
}

// WB2's logo: its dark brown letters made as light, the same brown's hue, and their gray drop
// shadow black (tools/merge.py's dark_menu_art makes the main menu's so).
function hls(r, g, b) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const R = r / 255, G = g / 255, B = b / 255;
  let h = mx === R ? (G - B) / dd + (G < B ? 6 : 0) : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4;
  return [h / 6, l, s];
}
function rgbOf(h, l, s) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
function bannerPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a) continue;
    const [h, l, s] = hls(d[i], d[i + 1], d[i + 2]);
    if (s > 0.3 && l < 0.35 && h > 0.02 && h < 0.12) {
      const [r, g, b] = rgbOf(h, 1 - l, s);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    } else if (s < 0.08 && l * 255 >= 50 && l * 255 <= 90 && a < 255) {
      d[i] = d[i + 1] = d[i + 2] = 0;
    }
  }
}

// A picture painted one of the ways, kept by its key for the next time; or, fresh, painted
// again each time (the minimap, a Lingo image drawn on as the game goes: its canvas is the same
// one, its pixels new), into the same canvas.
function painter(fn, fresh = false) {
  const kept = new WeakMap();
  return (src, key) => {
    let c = kept.get(key);
    const same = c && c.width === src.width && c.height === src.height;
    if (same && !fresh) return c;
    if (!src.width || !src.height) return src;
    if (!same) c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, c.width, c.height);
    fn(img.data, c.width, c.height);
    g.putImageData(img, 0, 0);
    kept.set(key, c);
    return c;
  };
}

export const surface = painter(surfacePixels);
surface.rgb = (rgb) => {
  const w = grayness(rgb[0], rgb[1], rgb[2]);
  if (!w) return rgb;
  const l = lum(rgb[0], rgb[1], rgb[2]), shift = (turn(l) - l) * w;
  return rgb.map((v) => Math.round(Math.max(0, Math.min(255, v + shift))));
};
export const backdrop = painter((d, w, h) => backdropPixels(d, w, h, false));
export const photo = painter((d, w, h) => backdropPixels(d, w, h, true));
export const whites = painter(whitesPixels, true);
surface.label = 'surface';
backdrop.label = 'backdrop';
photo.label = 'photo';
whites.label = 'whites';
export const logo = painter(logoPixels);
export const banner = painter(bannerPixels);

// The interface's own surfaces, by their members' names.
const SURFACE = /border|panel|framing|bubble|rollover|separators|dialog|tutorial_box|plan_name|white rect/i;
// Pictures of the map, not of the interface, whatever channel they are in.
const MAP = /^(terrain\.|sky|object\.highlight|spike|resource\.|monster\.|vehicle\.(?!.*\.(plan|hero)$)|building\.(?!.*\.(plan|hero)$)|build_cloud|take_apart_cloud|whirl|cursor|damage\.|build outline|action_arrow|icon\.build|plan\.|goal\.shadow)/i;

// How a sprite of the play screen is painted: a painter, or null.
export function paintOf(rt, s, mapChannels) {
  const m = s.member;
  if (!m) return null;
  const name = m.name || '';
  // (above the map: only the tutorial's bubble, its text, its buttons and arrows, and the
  // shapes it lays over the interface)
  if (s.channel >= mapChannels && !/tutorial|^tut_/i.test(name) && !(/button/i.test(name) && tutorialOn(rt))) return null;
  if (m instanceof ShapeMember) return surface;
  if (m instanceof TextMember) return onButton(rt, s) ? null : surface;
  if (!(m instanceof BitmapMember) || MAP.test(name)) return null;
  if (name === 'minimap') return whites;
  if (SURFACE.test(name) && !/button/i.test(name)) return surface;
  return /\.hero$/i.test(name) ? photo : backdrop;
}

function tutorialOn(rt) {
  const glob = rt.globals.glob;
  return !!(glob && L.t(L.gi(glob, L.sym('tutorialMode'))));
}

// Is a text sprite on a button (a picture named so, under its middle)?
function onButton(rt, s) {
  const cx = s.locH - s.member.regX + s.member.width / 2;
  const cy = s.locV - s.member.regY + (s.member.height || 10) / 2;
  for (let c = s.channel - 1; c > 0; c--) {
    const t = rt.sprites[c];
    if (!t || !t.visible || !(t.member instanceof BitmapMember)) continue;
    if (cx < t.left || cy < t.top || cx >= t.left + t.width || cy >= t.top + t.height) continue;
    return /button/i.test(t.member.name || '');
  }
  return false;
}

// How a sprite of a world map is painted: its header only (the white band, the logo on it); the
// map's own pictures, and its challenge worlds' panes, are the scene's, left as they are.
export function worldPaintOf(s) {
  const m = s.member;
  const name = (m && m.name) || '';
  if (m instanceof ShapeMember && /white rect/i.test(name)) return surface;
  if (!(m instanceof BitmapMember)) return null;
  if (name === 'worldbuilder_title' || name === 'title_logo') return logo;
  if (name === 'wb2_title_banner') return banner;
  return null;
}
