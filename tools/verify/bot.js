// A player for generated missions, run in the page by tools/verify/puzzles.py in the test mode's
// virtual time: src/online/autoplay.js, the same one Screensaver Mode plays with, its frames
// stepped as fast as they go.  Answers {ok, why, log, errors}.
//   window.__stopAfter = n   stop after step n, the units left in window.__botUnits
//   window.__botLog = 1      the steps' log kept when the mission is won, too
async (code) => {
  const A = await import(new URL('src/online/autoplay.js', location.href).href);
  const rt = window.__rt;
  return A.autoplay(rt, window.__online, code, {
    tick: (n) => { rt.step(n); },
    stopAfter: window.__stopAfter,
    onStop: (units) => { window.__botUnits = units; },
    keepLog: !!window.__botLog,
  });
}
