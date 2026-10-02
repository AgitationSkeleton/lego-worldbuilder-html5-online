// Starts one of the two games on its page: loads the movie's data, scripts and media,
// then runs it on the Director runtime in src/director/.

import { Runtime } from './director/movie.js';
import { makeLayout } from './online/layout.js';
import { OnlineUI } from './online/ui.js';
import { installTouch } from './online/touch.js';
import { Scores } from './online/scores.js';
import { RandomMissions } from './online/missions.js';
import { Races } from './online/race.js';

const GAMES = {
  wb1: { title: 'LEGO World Builder' },
  wb2: { title: 'LEGO World Builder 2' },
  merged: { title: 'LEGO World Builder Online' },
};

const params = new URLSearchParams(location.search);
const game = document.body.dataset.game;
const root = new URL('../', import.meta.url);
const canvas = document.getElementById('stage');
const status = document.getElementById('status');

function say(text) {
  if (status) { status.textContent = text; status.hidden = !text; }
}

async function loadFonts() {
  const face = new FontFace('WB 04b_08', 'url(' + new URL('assets/fonts/04b08.otf', root) + ')');
  try {
    await face.load();
    document.fonts.add(face);
  } catch (e) {
    console.warn('could not load the 04b_08 font', e);
  }
  // Arial and Arial Black come from the system; make sure they are ready before the first
  // text is measured.
  await Promise.all(['12px Arial', '12px "Arial Black"', '6px "WB 04b_08"'].map(f => document.fonts.load(f).catch(() => {})));
}

async function main() {
  if (!GAMES[game]) throw new Error('unknown game ' + game);
  say('Loading…');
  const [data, scripts] = await Promise.all([
    fetch(new URL('data/' + game + '.json', root)).then(r => { if (!r.ok) throw new Error('data'); return r.json(); }),
    import(new URL('src/games/' + game + '/scripts.js', root).href),
    loadFonts(),
  ]);
  const options = {
    test: params.has('test'),
    seed: params.has('seed') ? parseInt(params.get('seed'), 10) : undefined,
    verbose: params.has('verbose'),
  };
  const rt = new Runtime({ game, data, scripts, canvas, assetBase: new URL('assets/' + game + '/', root).href, options });
  if (game === 'merged') {
    // The online game fills the window (src/online/layout.js), at the interface size its
    // settings ask for (src/online/ui.js).
    const ui = new OnlineUI(rt, canvas);
    rt.layout = makeLayout(rt, { maxScale: () => ui.maxScale() });
    // and a finger does what the mouse did (src/online/touch.js)
    installTouch(rt, canvas);
    // generated missions (src/online/missions.js), and missions timed for the score tables
    // (src/online/scores.js), whose hooks go on after the generated missions' own
    window.__online = ui;
    ui.random = new RandomMissions(rt);
    ui.random.install(scripts.scripts);
    ui.scores = new Scores(rt, ui, params);
    ui.scores.random = ui.random;
    ui.scores.install(scripts.scripts);
    // races (src/online/race.js): told of each goal reached; leaving a mission is giving up
    ui.races = new Races(rt, ui, params);
    ui.races.install(scripts.scripts);
    ui.scores.listeners.push((kind, ms, mission) => ui.races.reached(kind, ms, mission));
    // ?random=CODE plays that generated mission, from the first world map reached;
    // ?race=CODE joins that race once the game is going
    if (params.get('random')) playWhenReady(rt, ui, params.get('random'));
    if (params.get('race')) {
      const code = params.get('race');
      const timer = setInterval(() => { if (rt.started) { clearInterval(timer); ui.races.join(code); } }, 250);
    }
  }
  window.__rt = rt;
  window.__step = (n) => rt.step(n);
  await rt.load((p) => say('Loading… ' + Math.round(p * 100) + '%'));
  say('');
  if (rt.sound.ctx && rt.sound.ctx.state !== 'running' && !options.test) {
    // Browsers keep sound off until the page is clicked; the original started its music at
    // once, so wait for that click before starting.
    await waitForClick(rt);
  }
  rt.run();
  if (options.test) rt.step(0);
  canvas.focus();
}

function playWhenReady(rt, ui, code) {
  const timer = setInterval(() => {
    if (!rt.started || !ui.random.canPlay()) return;
    clearInterval(timer);
    const problem = ui.random.play(code);
    if (problem) console.warn(problem);
  }, 250);
}

function waitForClick(rt) {
  return new Promise((resolve) => {
    const gate = document.getElementById('gate');
    gate.hidden = false;
    const go = () => {
      gate.hidden = true;
      rt.sound.resume();
      resolve();
    };
    gate.addEventListener('click', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
  });
}

main().catch((e) => {
  console.error(e);
  say('The game could not load: ' + (e && e.message || e));
  if (status) status.classList.add('failed');
});
