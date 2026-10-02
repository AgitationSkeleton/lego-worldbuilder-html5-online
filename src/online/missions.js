// Playing a generated mission (src/online/random.js).  The game reads a mission from the
// text member map<world>.<mission> when it starts it, so a generated one is played in its
// template's place: the member's text (and the mission's name) are swapped for the
// generated ones while it is played, and put back when it is left.  A generated mission
// counts for nothing in the campaign: reaching its goal does not mark the template done.

import * as L from '../director/lingo.js';
import { generateMission, parseCode, showCode, randomCode } from './random.js';

export class RandomMissions {
  constructor(rt) {
    this.rt = rt;
    this.active = null;     // the generated mission being played: { code, world, mission, saved }
  }

  // Hooks into the game's scripts, before the runtime binds them (and before the scores'
  // own, so that they see a generated mission's results too).
  install(scripts) {
    const self = this;
    for (const s of scripts) {
      if (s.handlers.quitlevel && s.type === 'movie') {
        const quit = s.handlers.quitlevel;
        s.handlers.quitlevel = function (restartp, ...rest) {
          const r = quit.call(this, restartp, ...rest);
          // (a restart quits and starts again: the generated mission stays)
          if (!L.t(restartp)) self.restore();
          return r;
        };
      }
      if (s.name === 'worlds manager' && s.handlers.reportsuccess) {
        const report = s.handlers.reportsuccess;
        s.handlers.reportsuccess = function (...args) {
          if (self.active) return undefined;
          return report.apply(this, args);
        };
      }
    }
  }

  text(name) {
    const m = this.rt.builtins.member(name);
    return m ? L.gp(m, 'text') : '';
  }

  // The mission a code makes, or null.
  make(code) {
    const c = parseCode(code);
    if (!c) return null;
    const g = generateMission(this.text(`map${c.world}.${c.mission}`), this.text('terrainmap'), this.text('config'), c.code);
    return g ? Object.assign(g, c) : null;
  }

  // A new code that makes a mission, from a world's templates (or any world's).
  newCode(world) {
    for (let i = 0; i < 50; i++) {
      const code = randomCode(world);
      if (this.make(code)) return code;
    }
    return null;
  }

  // Generated missions start from a world map, as the game's own do.
  canPlay() {
    return /^world \d$/.test(this.rt.labelAt(this.rt.frame) || '') && !this.active;
  }

  // Plays a code.  Answers what went wrong, or null.
  play(code) {
    if (!this.canPlay()) return 'A generated mission starts from a world map.';
    const g = this.make(code);
    if (!g) return 'That code makes no mission.';
    const rt = this.rt;
    const glob = rt.globals.glob;
    const member = rt.builtins.member(`map${g.world}.${g.mission}`);
    const names = L.gi(L.gp(glob, 'mission_names'), g.world);
    this.active = {
      code: g.code, world: g.world, mission: g.mission,
      saved: { text: L.gp(member, 'text'), name: L.gi(names, g.mission) },
    };
    L.sp(member, 'text', g.text);
    L.si(names, g.mission, 'Random ' + showCode(g.code));
    const main = rt.movieHandlers.golevel.script;
    rt.call(rt.scriptSelf(main), main, 'golevel', g.world, g.mission);
    return null;
  }

  // The template's own text and name back.
  restore() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const glob = this.rt.globals.glob;
    L.sp(this.rt.builtins.member(`map${a.world}.${a.mission}`), 'text', a.saved.text);
    L.si(L.gi(L.gp(glob, 'mission_names'), a.world), a.mission, a.saved.name);
  }
}
