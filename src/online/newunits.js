// Units the game never finished, made whole: the Bluebird and the Cargo Copter, whose scripts the
// game has (vehicle.bluebird parent, vehicle.cargo_copter parent) but no pictures, and the Cargo
// Copter no config either; and the Airport, a building that recharges them, of which the game has
// the script (building.airport parent) and nothing else.  The two fly: over land and water, as the
// Bluebird's own config in the game has it, drawn hovering over a shadow.  Their pictures were
// rendered from JappaWakka's recreations of them (the Airport from our own models, after LEGO set
// 4028's airport, the set the Cargo Copter comes from) with the
// World Builder sprite renderer (github.com/AgitationSkeleton/legoworldbuilder_renderer), as the
// game's own were made: the four directions on the map, the info panel's portrait, the plans bar's
// icon.
//
// assets/online/units/units.json says what there is: {bitmaps: [{name, file, regX, regY}],
// texts: [{name, text: [[part, style], ...]}], config: {part: "lines"}, kinds}.  Before the runtime
// is made, the movie's data gets the config's lines (each in its part: [vehicle], [building]), the
// description texts and a record for each picture (addNewUnits); once it is loaded, each
// picture's pixels (loadNewUnitPictures).

import { decodePNG } from '../director/png.js';
import { fileUrl } from '../files.js';

const DIR = 'assets/online/units/';

// The description's look, as the game's own (vehicle.duck.description): styles 0..7, the
// paragraphs' spacing, the text's box.
const DESC_TEMPLATE = 'vehicle.duck.description';

let manifest = null;

// The config's text with new lines at the end of each of its parts: lines {part: "lines"} (a part's
// lines are read as that part's kind: [vehicle], [building] ...).
export function withNewConfig(text, lines) {
  if (typeof lines === 'string') lines = { vehicle: lines };
  for (const [part, add] of Object.entries(lines)) {
    // (the end of the part: where the next part begins)
    const start = text.search(new RegExp('\\[' + part + '\\]', 'i'));
    if (start < 0) continue;
    const next = text.slice(start + 1).search(/\r\[[a-z]+\]/i);
    const at = next < 0 ? text.length : start + 1 + next;
    text = text.slice(0, at) + '\r' + add.split('\n').join('\r') + '\r' + text.slice(at);
  }
  return text;
}

export async function addNewUnits(data, root) {
  try {
    const r = await fetch(fileUrl(DIR + 'units.json', root));
    if (!r.ok) return;
    manifest = await r.json();
  } catch (e) {
    return;
  }
  const cast = data.casts[0];
  let next = Math.max(...Object.keys(cast.members).map(Number)) + 1;
  const byName = new Map();
  for (const c of data.casts) for (const m of Object.values(c.members)) if (m.name && !byName.has(m.name)) byName.set(m.name, m);
  // the config: the new units' lines, each at the end of its part
  const config = byName.get('config');
  if (config && manifest.config) config.text = withNewConfig(config.text, manifest.config);
  // the descriptions, styled as the game's
  const tpl = byName.get(DESC_TEMPLATE);
  for (const t of manifest.texts || []) {
    if (byName.has(t.name) || !tpl) continue;
    let text = '';
    const runs = [];
    for (const [part, style] of t.text) {
      runs.push([text.length, style]);
      text += part;
    }
    // (the paragraphs laid out as the template's: the description in its own, the first line of the
    // facts roomy, the rest close -- the duck's has them so; all roomy, they ran off the panel)
    const facts = text.indexOf('\r') + 1;
    const second = facts > 0 ? text.indexOf('\r', facts) + 1 : 0;
    const paraRuns = facts > 0 && second > 0 ? [[0, 1], [facts, 3], [second, 2], [text.length, 0]] : [[0, 1]];
    const rec = Object.assign(JSON.parse(JSON.stringify(tpl)), { name: t.name, text, runs, paraRuns });
    // (a box as tall as the freighter's, the longest the game has: the copter's facts run as long)
    if (rec.rect) rec.rect = Object.assign({}, rec.rect, { bottom: Math.max(rec.rect.bottom, rec.rect.top + 165) });
    cast.members[String(next++)] = rec;
    byName.set(t.name, rec);
  }
  // the pictures: records now, pixels once loaded
  for (const b of manifest.bitmaps || []) {
    if (byName.has(b.name)) continue;
    const rec = { type: 'bitmap', name: b.name, width: b.width, height: b.height, regX: b.regX, regY: b.regY, depth: 32, alpha: true, newUnit: b.file };
    cast.members[String(next++)] = rec;
    byName.set(b.name, rec);
  }
}

export async function loadNewUnitPictures(rt, root) {
  if (!manifest) return;
  await Promise.all((manifest.bitmaps || []).map(async (b) => {
    const m = rt.member(b.name);
    if (!m || !m.rec || !m.rec.newUnit) return;
    try {
      const r = await fetch(fileUrl(DIR + b.file, root));
      const im = decodePNG(new Uint8Array(await r.arrayBuffer()));
      m._pixels = { data: im.data, width: im.width, height: im.height };
      m.w = im.width;
      m.h = im.height;
    } catch (e) {
      console.warn('could not load ' + b.file, e);
    }
  }));
}

// The Consistent Info Panel Portraits setting (src/online/settings.js): the game's portraits of the
// buggy and the dirtbuggy are of other builds than their map models, and its freighter's is the
// tugboat's; on, those members show portraits rendered from the map's own models instead (each in
// the box of the one it replaces, so its registration point still holds), off, the game's again.
const consistentCache = new Map();

export async function setConsistentPortraits(rt, root, on) {
  if (!manifest || !manifest.consistent) return;
  await Promise.all(manifest.consistent.map(async (c) => {
    const m = rt.member(c.name);
    if (!m || typeof m.pixels !== 'function') return;
    if (on) {
      let px = consistentCache.get(c.name);
      if (!px) {
        try {
          const r = await fetch(fileUrl(DIR + c.file, root));
          px = decodePNG(new Uint8Array(await r.arrayBuffer()));
        } catch (e) {
          console.warn('could not load ' + c.file, e);
          return;
        }
        // (only a picture the member's own size: its registration point placed within that box)
        if (px.width !== m.w || px.height !== m.h) { console.warn(c.file + ': not ' + m.w + 'x' + m.h); return; }
        consistentCache.set(c.name, px);
      }
      if (!m._wbGame) m._wbGame = { source: m.source, pixels: m._pixels, image: m._image, depth: m.depth };
      m._pixels = { data: px.data, width: px.width, height: px.height };
      m.source = null;
      m._image = null;
      m.depth = 32;
    } else if (m._wbGame) {
      m.source = m._wbGame.source;
      m._pixels = m._wbGame.pixels;
      m._image = m._wbGame.image;
      m.depth = m._wbGame.depth;
      m._wbGame = null;
    } else {
      return;
    }
    m.changed();
  }));
}

// A flyer's sprite on the map (not its portrait, nor its plan icon): its shadow ({w, h, dy}: the
// ellipse's size, and how far below the sprite's registration point -- the ground under it -- it
// lies) and how many pixels it sways, as the goal arrow does (src/online/layout.js); else null.
export function flyerOf(memberName) {
  if (!manifest || !manifest.flyers || !memberName) return null;
  const m = /^(.*)\.(right|left|up|down)$/.exec(memberName);
  return m ? manifest.flyers[m[1]] || null : null;
}

// The new units' kinds, for the level editor and the generator (src/online/levelformat.js).
export function newUnitKinds() {
  return manifest ? manifest.kinds || [] : [];
}
