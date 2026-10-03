// The generated missions this browser has played (the random-mission panel's Seed History),
// the last played first: each one's code, when it was last played, and its best times to
// the goal and to the bonus goal (null until reached), by the game's clock as the scores
// time them (src/online/scores.js). Kept in the browser only.

import { parseCode } from './puzzle.js';

const KEY = 'lego-wb-online:seeds';
const MAX = 50;

function time(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const e of list) {
      const c = e && parseCode(e.code);
      if (!c || out.some((o) => o.code === c.code)) continue;
      out.push({ code: c.code, at: Number(e.at) || 0, goal: time(e.goal), bonus: time(e.bonus), posted: !!e.posted });
    }
    return out.slice(0, MAX);
  } catch (e) {
    return [];
  }
}

export class SeedHistory {
  constructor() {
    this.list = load();
    this.onChange = null;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list));
    } catch (e) {
      // (kept for the visit)
    }
    if (this.onChange) this.onChange();
  }

  find(code) {
    const c = parseCode(code);
    return c ? this.list.find((e) => e.code === c.code) : undefined;
  }

  // A generated mission started: to the top of the list.
  played(code) {
    const c = parseCode(code);
    if (!c) return;
    const old = this.find(c.code);
    this.list = this.list.filter((e) => e !== old);
    this.list.unshift(old ? Object.assign(old, { at: Date.now() }) : { code: c.code, at: Date.now(), goal: null, bonus: null, posted: false });
    this.list.length = Math.min(this.list.length, MAX);
    this.save();
  }

  // Its goal or bonus goal reached, in ms: kept if it is the best yet.
  reached(code, kind, ms) {
    const e = this.find(code);
    if (!e || (kind !== 'goal' && kind !== 'bonus') || !Number.isFinite(ms)) return;
    if (e[kind] === null || ms < e[kind]) {
      e[kind] = Math.round(ms);
      this.save();
    }
  }

  // Its picture has gone to the server's log (src/online/scores.js, announce).
  posted(code) {
    const e = this.find(code);
    if (e && !e.posted) {
      e.posted = true;
      this.save();
    }
  }
}
