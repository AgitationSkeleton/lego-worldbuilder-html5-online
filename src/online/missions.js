// Playing a generated mission (src/online/puzzle.js).  The game reads a mission from the
// text member map<world>.<mission> when it starts it, so a generated one is played in the
// place of one of the game's own, from the world whose look (sky, music) it has: the
// member's text (and the mission's name) are swapped for the generated ones while it is
// played, and put back when it is left.  A generated mission counts for nothing in the
// campaign: reaching its goal does not mark the mission it stands in for done.

import * as L from '../director/lingo.js';
import { generatePuzzle, parseCode, showCode, randomCode } from './puzzle.js';

export class RandomMissions {
  constructor(rt) {
    this.rt = rt;
    this.active = null;     // the generated mission being played: { code, world, mission, saved }
    // Told when the game itself leaves a generated mission (its End Mission, its menu's
    // quit), with {code, goal, bonus}: the page offers what next, where the game would go
    // back to the world map whose look the mission had. Leaving it from the page (a race,
    // the main menu) is done quietly.
    this.onLeft = null;
    this.quiet = 0;
  }

  // Hooks into the game's scripts, before the runtime binds them (and before the scores'
  // own, so that they see a generated mission's results too).
  install(scripts) {
    const self = this;
    for (const s of scripts) {
      if (s.handlers.quitlevel && s.type === 'movie') {
        const quit = s.handlers.quitlevel;
        s.handlers.quitlevel = function (restartp, ...rest) {
          const left = self.active;
          const r = quit.call(this, restartp, ...rest);
          // (a restart quits and starts again: the generated mission stays)
          if (!L.t(restartp)) {
            self.restore();
            if (left && !self.quiet && self.onLeft) self.onLeft({ code: left.code, goal: !!left.goal, bonus: !!left.bonus });
          }
          return r;
        };
      }
      if (s.name === 'worlds manager' && s.handlers.reportsuccess) {
        const report = s.handlers.reportsuccess;
        s.handlers.reportsuccess = function (...args) {
          if (self.active) {
            const kind = args[1] instanceof L.LSymbol ? args[1].key.toLowerCase() : '';
            if (kind === 'goal' || kind === 'bonus') self.active[kind] = true;
            return undefined;
          }
          return report.apply(this, args);
        };
      }
    }
  }

  text(name) {
    const m = this.rt.builtins.member(name);
    return m ? L.gp(m, 'text') : '';
  }

  // The mission a code makes, or null: {code, text, slot: [world, mission], solution, ...}.
  make(code) {
    const c = parseCode(code);
    if (!c) return null;
    if (this.made && this.made.code === c.code) return this.made;
    const g = generatePuzzle(this.text('config'), c.code);
    if (g) this.made = g;
    return g;
  }

  // A new code that makes a mission, of a difficulty (1 to 3) and look (A to D), or any.
  newCode(difficulty, look) {
    for (let i = 0; i < 50; i++) {
      const code = randomCode(difficulty, look);
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
    const [world, mission] = g.slot;
    const member = rt.builtins.member(`map${world}.${mission}`);
    const names = L.gi(L.gp(glob, 'mission_names'), world);
    this.active = {
      code: g.code, world, mission, puzzle: g,
      saved: { text: L.gp(member, 'text'), name: L.gi(names, mission) },
    };
    L.sp(member, 'text', g.text);
    L.si(names, mission, 'Random ' + showCode(g.code));
    const main = rt.movieHandlers.golevel.script;
    rt.call(rt.scriptSelf(main), main, 'golevel', world, mission);
    return null;
  }

  // Starts a mission from wherever the game is (a race starts everyone's at once): a
  // campaign one, "6.3", or a generated one, "R-6DK2Q9".  The mission being played, if any,
  // is left first.  Answers what went wrong, or null.
  go(mission) {
    const rt = this.rt;
    const glob = rt.globals.glob;
    const main = rt.movieHandlers.golevel.script;
    const call = (name, ...args) => rt.call(rt.scriptSelf(main), main, name, ...args);
    // (a tutorial under way is ended, so that the race is not played in its layout)
    const tutorial = glob && L.gp(glob, 'tutorial_manager');
    if (tutorial instanceof L.LInstance && L.t(L.gi(glob, L.sym('tutorialMode')))) L.mc(tutorial, 'settutorialmode', 0);
    if (glob && L.gp(glob, 'map_display') !== undefined) this.quietly(() => call('quitlevel'));
    if (!/^world \d$/.test(rt.labelAt(rt.frame) || '')) rt.go('world 1');
    if (mission.startsWith('R-')) return this.play(mission.slice(2));
    const [w, l] = mission.split('.').map(Number);
    call('golevel', w, l);
    return null;
  }

  // Leaves the mission being played without telling onLeft (the page is leaving it).
  quietly(f) {
    this.quiet++;
    try { return f(); } finally { this.quiet--; }
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
