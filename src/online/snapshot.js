// A picture of the mission being played, its whole map as the game draws it, for the log of
// generated missions (src/online/scores.js, announce). The map display shows only the
// places in view, so each place's ground is drawn here from its own member, where the
// game's postoloc puts it (in a row, a tile is 50 pixels on; each row is 50 down and half a
// tile left); over them, in the game's order (locZ), what is on the map: the units,
// monsters, bricks, plans and the goal, whose sprites (the map display's, channels 200 to
// 4000) the game keeps where they are on the map, in view or not.

import * as L from '../director/lingo.js';
import { BitmapMember } from '../director/members.js';

const POOL_FROM = 200, POOL_TO = 4000;   // the map display's sprites (its getASprite)
const PAD = 12;

// The picture as a JPEG, at most maxW by maxH pixels; null if there is no map.
export function snapshot(rt, maxW = 1600, maxH = 1000) {
  const glob = rt.globals.glob;
  const md = glob && L.gp(glob, 'map_display');
  if (!(md instanceof L.LInstance)) return Promise.resolve(null);
  const items = [];
  // the ground, each place's own
  const tiles = new Set();
  const shown = L.gp(md, 'pmapsprites');
  let tpl = null;
  for (let j = 1; j <= L.count(shown); j++) {
    for (let i = 1; i <= L.count(L.gi(shown, j)); i++) {
      const s = L.gi(L.gi(shown, j), i);
      tiles.add(s);
      tpl = tpl || s;
    }
  }
  if (!tpl) return Promise.resolve(null);
  const rows = L.gp(L.gp(md, 'pmap'), 'terrain');
  for (let j = 1; j <= L.count(rows); j++) {
    const row = L.gi(rows, j);
    for (let i = 1; i <= L.count(row); i++) {
      const m = rt.builtins.member(L.gp(L.gi(row, i), 'member'));
      if (!(m instanceof BitmapMember) || m.width <= 0 || m.height <= 0) continue;
      const p = L.mc(md, 'postoloc', new L.LPoint(i, j));
      items.push({
        member: m, ink: tpl.ink, blend: 100,
        foreColor: tpl.foreColor, backColor: tpl.backColor, foreRGB: tpl.foreRGB, backRGB: tpl.backRGB,
        left: p.h - m.regX, top: p.v - m.regY, width: m.width, height: m.height,
        locZ: L.mc(md, 'postolocz', new L.LPoint(i, j)), channel: 0,
      });
    }
  }
  // and what is on it
  for (let c = POOL_FROM; c <= POOL_TO; c++) {
    const s = rt.sprites[c];
    if (!s || !s.member || !s.visible || tiles.has(s)) continue;
    if (rt.layout && rt.layout.parked && rt.layout.parked(s)) continue;
    if (s.width <= 0 || s.height <= 0 || s.blend <= 0) continue;
    items.push(s);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of items) {
    x0 = Math.min(x0, s.left);
    y0 = Math.min(y0, s.top);
    x1 = Math.max(x1, s.left + s.width);
    y1 = Math.max(y1, s.top + s.height);
  }
  x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
  const k = Math.min(1, maxW / (x1 - x0), maxH / (y1 - y0));
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0) * k);
  c.height = Math.ceil((y1 - y0) * k);
  const ctx = c.getContext('2d');
  // round it, the stage's backdrop (the sea or the sky the map stands in), spread to fill
  ctx.fillStyle = 'rgb(' + rt.stage.color.join(',') + ')';
  ctx.fillRect(0, 0, c.width, c.height);
  const back = rt.sprites[1];
  if (back && back.member instanceof BitmapMember && back.member.width > 0) {
    const src = back.member.drawable();
    const f = Math.max(c.width / src.width, c.height / src.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, (c.width - src.width * f) / 2, (c.height - src.height * f) / 2, src.width * f, src.height * f);
  }
  ctx.imageSmoothingEnabled = k < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  items.sort((a, b) => (a.locZ - b.locZ) || (a.channel - b.channel));
  for (const s of items) rt.renderer.drawSprite(ctx, s);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return new Promise((done) => c.toBlob((b) => done(b), 'image/jpeg', 0.86));
}
