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
    // A mission played out of the campaign's order (a generated one, or a race's): {mission,
    // race, locked}. Left, the game goes back to its title rather than to the world map the
    // game would go to (that mission's, or the one whose look a generated mission has),
    // where the campaign may not have got to yet; and a race's mission the campaign has not
    // opened yet is not marked done there by its goal.
    this.away = null;
    // Told when the game itself leaves a mission played out of the campaign's order (its
    // End Mission, its menu's quit), with {code, goal, bonus, race}: the page shows its main
    // menu, or offers what next. Leaving it from the page (a race starting, the main menu)
    // is done quietly.
    this.onLeft = null;
    // Told when a generated mission starts, with the mission (src/online/puzzle.js)
    this.onStarted = null;
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
          // (a restart quits and starts again: the mission stays)
          if (!L.t(restartp)) {
            const away = self.away;
            self.away = null;
            self.restore();
            if (away) {
              self.rt.go('splash');
              if (!self.quiet && self.onLeft) {
                self.onLeft({ code: left ? left.code : null, goal: !!away.goal, bonus: !!away.bonus, race: away.race });
              }
            }
          }
          return r;
        };
      }
      if (s.name === 'worlds manager' && s.handlers.reportsuccess) {
        const report = s.handlers.reportsuccess;
        s.handlers.reportsuccess = function (...args) {
          const kind = args[1] instanceof L.LSymbol ? args[1].key.toLowerCase() : '';
          const away = self.away;
          if (away && (kind === 'goal' || kind === 'bonus')) away[kind] = true;
          // (a generated mission counts for nothing in the campaign, nor does a race's that
          // the campaign has not opened yet)
          if (self.active || (away && away.locked)) return undefined;
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

  // A new code that makes a mission, of a difficulty (1 to 3) and look (A to E), or any, by a
  // generator (the newest if not said: src/online/puzzle.js, GENERATORS).
  newCode(difficulty, look, version) {
    for (let i = 0; i < 50; i++) {
      const code = randomCode(difficulty, look, version);
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
    if (!this.away) this.away = { mission: 'R-' + g.code, race: false, locked: false };
    const main = rt.movieHandlers.golevel.script;
    rt.call(rt.scriptSelf(main), main, 'golevel', world, mission);
    if (this.onStarted) this.onStarted(g);
    return null;
  }

  // Starts a mission from wherever the game is (a race starts everyone's at once, `race`
  // true): a campaign one, "6.3", or a generated one, "R-6DK2Q9".  The mission being
  // played, if any, is left first.  Answers what went wrong, or null.
  go(mission, race = false) {
    const rt = this.rt;
    const glob = rt.globals.glob;
    const main = rt.movieHandlers.golevel.script;
    const call = (name, ...args) => rt.call(rt.scriptSelf(main), main, name, ...args);
    // (a tutorial under way is ended, so that the race is not played in its layout)
    const tutorial = glob && L.gp(glob, 'tutorial_manager');
    if (tutorial instanceof L.LInstance && L.t(L.gi(glob, L.sym('tutorialMode')))) L.mc(tutorial, 'settutorialmode', 0);
    if (glob && L.gp(glob, 'map_display') !== undefined) this.quietly(() => call('quitlevel'));
    if (!/^world \d$/.test(rt.labelAt(rt.frame) || '')) rt.go('world 1');
    if (mission.startsWith('R-')) {
      this.away = { mission, race, locked: false };
      const problem = this.play(mission.slice(2));
      if (problem) this.away = null;
      return problem;
    }
    const [w, l] = mission.split('.').map(Number);
    // (where the campaign has got to: -1, a mission not opened yet)
    const worlds = glob && L.gp(glob, 'worlds_manager');
    const state = worlds instanceof L.LInstance ? L.mc(worlds, 'getlevelstate', w, l) : 0;
    this.away = { mission, race, locked: state === -1 };
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
