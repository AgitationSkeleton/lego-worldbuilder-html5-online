# LEGO World Builder Online

*LEGO World Builder* and *LEGO World Builder 2* made into one game for the browser: both
campaigns in one, a window of any size, phones and tablets, scores, generated missions
and some multiplayer. It is built on the
[1:1 HTML5 port](https://github.com/AgitationSkeleton/lego-worldbuilder-html5) of the
two Shockwave games, which stays unchanged at wb.viosarcade.xyz.

Work in progress. See [ROADMAP.md](ROADMAP.md) for what is planned, in what order, and
how.

## Running it locally

Serve the repository root over HTTP (browsers block `fetch` on `file://`):

```
python -m http.server 8000
```

then open <http://localhost:8000/>.

## What is in so far

- **A main menu**, as CrystAlien Conflict Online has: the campaign, a random mission, a
  race, the score tables and the settings.
- **One game**: World Builder's five worlds, then World Builder 2's two as worlds six and
  seven. World One, Ocean, Prehistoric and World Six are open from the start. Each world
  map has buttons to the others.
- **The window's size**: the game fills the window; a bigger window shows more of the
  map, with the interface along its edges. The settings (the button in the bottom right
  corner) choose how large the interface is drawn, and full screen. The title, world maps
  and licences keep their original size in the middle of the window. The tutorial keeps
  the original layout, since its arrows point at it.
- **Zoom**: the mouse wheel (or two fingers) zooms the map, and the map alone: out until
  its edges would show, in to the game's own scale. The interface keeps its size.
- **Touch**: a tap is a click, a drag moves the map, a long press on the map shows what
  hovering would, and two fingers zoom the map (or, where it already fits, pinch the
  interface smaller or bigger).
- **Scores**: each mission is timed to its goal and its bonus goal. Best times are kept in
  the browser and, if the player chooses, sent to score tables on a small server
  ([server/](server/), at wbserver.viosarcade.xyz).
- **Random missions**: puzzles made from the game's rules, laid out like the games' own
  missions (islands of all shapes and sizes over the sky, coasts, mazes, the ocean's reefs)
  and joined by the game's own obstacles (rocky ground, water to fill, trees, boulders to
  push, rivers and whirlpools for boats, swamp, monsters held by a freezebot), with any of
  its units, buildings and monsters, a goal and a bonus goal. Every mission's own solution,
  goal and bonus, is played through before it is given. A mission is named by a code (like
  `2C-K2Q9X`) that can be shared, from the main menu or `?random=2C-K2Q9X`; the first
  generator (Rando v1, four-character seeds like `2C-K2Q9`) is kept, so that its codes make
  the missions they always made.
- **Races**: two to six players play the same mission, each in their own game, and the
  fastest to the goal wins. The race page is a lobby: the races open to anyone, listed by
  the server, to join; a race to host, listed or by invitation (its code, or a link,
  `?race=CODE`); and in a race, its players, its chat, and the mission the host picks,
  shown as a small map with its name. The other players' units show on your map as ghosts
  in their colours, named when pointed at.

## Checking it

With the repository served at <http://127.0.0.1:8766/>:

```
python tools/verify/soak.py merged --base http://127.0.0.1:8766/ --size 1280x720
python tools/verify/touch.py --size 844x390
python tools/verify/scores.py --server http://127.0.0.1:8787
python tools/verify/race.py --server http://127.0.0.1:8787
python tools/verify/soak.py merged --base http://127.0.0.1:8766/ --random 20
node tools/verify/puzzle.mjs 50 --report
python tools/verify/puzzles.py --count 40
```

The first plays every mission with random clicks and reports script errors; the second
plays one with a finger on an emulated phone and checks that taps, drags and the scroll
arrows do what they should; the third times a mission and sends its results to a local
score server (`server/`: `npm run dev`); the fourth races two browsers through it; the
fifth plays generated missions with random input; the sixth generates puzzles over many
codes, checks each plays through the model of the rules and counts what they have; the last plays generated
missions' solutions in the game itself and checks they reach the goal.

## How the port works

The pipeline and the player are the 1:1 port's; its README describes them.
`tools/extract.py`, `tools/build_library.py` and `tools/transpile.py` build `data/`,
`assets/` and `src/games/` from the original movies. `src/director/` is the
Director-compatible player, shared with the 1:1 port: fixes to it are made there and
pulled from there (the `html5` remote).

## Credits

*LEGO World Builder* and *LEGO World Builder 2* were made by
[Gamelab](https://en.wikipedia.org/wiki/Gamelab) for The LEGO Group. LEGO is a trademark
of The LEGO Group, which does not sponsor, authorise or endorse this project; this is an
unofficial, non-commercial port.
