# LEGO World Builder Online: roadmap

This repository starts as a copy of the 1:1 port
([lego-worldbuilder-html5](https://github.com/AgitationSkeleton/lego-worldbuilder-html5),
served at wb.viosarcade.xyz), which stays faithful to the two Shockwave originals.
Everything that changes the games happens here, served at wbonline.viosarcade.xyz.

## Requirements

1. **One game.** World Builder and World Builder 2 merged into one campaign: World
   Builder's worlds first (World One to Three, then the Ocean and Prehistoric challenge
   worlds), then World Builder 2's two worlds appended as worlds six and seven. World
   One, Ocean, Prehistoric and World Builder 2's first world are open from the start, as
   in the 3DS port.
2. **The window's shape and size.** The game fills the window: a bigger window shows
   more of the map rather than enlarging it, and the interface (the plans bar, the
   right-hand panel, the popups) is laid out along the edges at a chosen size.
3. **Phones and tablets**, upright and on their side: touch controls for everything the
   mouse and keyboard did.
4. **A scores server**: times and results per mission, on a table everyone sees.
5. **A level randomizer**: new missions generated from a seed, playable and shareable.
6. **Some multiplayer.**
7. Later, as in the CrystAlien Conflict online version: settings kept in the browser, an
   offline client for Windows, macOS and Linux, smooth drawing at the screen's refresh
   rate.

## How the games are built, where it matters here

Both games are the same engine: a Director 8 movie whose Lingo, translated, lives in
`src/games/<game>/scripts.js`. The parts these plans touch:

| Part | Script (World Builder 2's numbering) | What it does |
|---|---|---|
| Startup | `_main` (movie script) | globals in `glob`, `startlevel`, `quitlevel`, `golevel`, the arrow keys and the space bar |
| Progress | `worlds manager` | reads the `worlds` text (who unlocks what), keeps `pWorlds`, saves with `setPref("gmlbLegoWB2")` |
| A mission | `map display manager` | parses the map text (`map<w>.<l>`), owns the 12 × 9 tile view and a pool of sprites in channels 200–1000, scrolling, the minimap, pathfinding (A*) |
| Units | `object.generic`, `vehicle.generic`, `monster.generic`, `building.generic` and one parent script per kind | movement, carrying, building, energy, combat |
| Goals | `goal.goal`, `goal.bonus` | what wins a mission; `reportSuccess` tells the worlds manager |
| Plans | `plan manager` | the plans bar and building from plans |
| Interface | behaviors on the score's sprites in the `play` frame | right-hand panel, goal and menu popups, buttons |
| Clock | `game clock beh` | the mission's elapsed time, shown in `clock text` |
| Tutorial | `tutorial manager` (tutorial cast) | World One's first mission |

A mission is a text member in the game's own format: a `[map]` section of terrain
characters (the `terrainmap` member gives their meaning), `[mapitems]` placing units,
piles of bricks, plans, goals and monsters by letter, and `[inventory]`. Goals are
`goal,<what>` and `bonusgoal,<what>`; World Builder 2 adds `goal,collect,<n>,<monster>`.
The `config` text gives every unit, building and monster: recipe, speed, terrain, energy,
attack.

World Builder 2's engine is a superset of World Builder's: none of World Builder's 118
scripts is missing from it, its `config` only adds (streets to every terrain list, the
white bricks, the Freezebot, the lion, the house, factory, windmill, garage and nursery)
and leaves every shared recipe as it was, and its `terrainmap` knows every terrain
character World Builder's maps use. Where the shared scripts differ, World Builder 2's
add to them (the collect goal, more tree and street types).

## 1. One game

*Done, except importing the originals' progress.* The two licences are two screens for
now: World Builder's after World Three, World Builder 2's after World Seven.

Built on World Builder 2's movie, with what only World Builder has added to it:

- **Art.** 105 bitmaps exist only in World Builder: the T. rex and the scorpion (all their
  walking and attacking frames), the world maps of worlds Two, Three, Ocean and
  Prehistoric and their titles, the challenge world buttons, and World Builder's license
  cards. A merge tool (`tools/merge.py`) adds World Builder's casts as further cast
  libraries, so anything World Builder 2 has by the same name is World Builder 2's, and
  the rest is found by name in World Builder's.
- **Maps.** World Builder's `map1.1`–`map5.12` keep their names; World Builder 2's
  `map1.1`–`map2.12` become `map6.1`–`map7.12`, and their skies `sky1`, `sky2` become
  `sky6`, `sky7`. The `level names` texts are joined the same way, and `golevel`,
  `startlevel` and the map display manager's `sky` & `worldnum` follow the numbers.
- **The world maps.** The score gets World Builder's five world frames and World Builder
  2's two (labels `world 1` … `world 7`), with their sprites' members and behaviors
  pointed at the merged casts. Each world's arrows go to the next and the last; World
  Three's "complete all missions" arrow leads on to World Six, and World Six and Seven
  get a button back to the challenge worlds.
- **Unlocks.** The `worlds` text is World Builder's followed by World Builder 2's, its
  world numbers moved up by five, so World Three's last mission still opens World Four's
  first and so on. `worlds manager.readWorlds` opens the first mission of worlds 1, 4, 5
  and 6 (World Builder opened 1, 4 and 5; World Builder 2 only 1).
- **Progress** is one pref, `gmlbLegoWBOnline`. On first run it is made from the two
  originals' prefs if the browser has them (the 1:1 port's localStorage on the same
  site is not the same origin, so a one-time import page links the two), moving World
  Builder 2's lines up five worlds.
- **The licence.** Each game ends with a builder's licence of three or four classes. The
  merged game shows World Builder's licence for worlds 1–5 and World Builder 2's for 6–7,
  on the licence screen side by side.
- **Title.** One splash for both: World Builder's picture and logo, since the campaign
  starts in its worlds, with World Builder 2's logo under it, World Builder's loading bar
  along its logo's line, and one Start; then World Builder 2's slideshow of the units.

Worth checking once it runs: World Builder's missions on World Builder 2's engine. The
config and terrain table say they behave the same, and the soak test
(`tools/verify/soak.py`) plays every one of the 84 missions with random input to catch
any that do not.

## 2. The window's shape and size

*Done.* The 1:1 port scales the 610 × 440 stage to fit the window. Here the stage takes
the window's size, in stage pixels after the interface size (`src/online/layout.js`):

- **Interface size**: how far the game is enlarged before a bigger window shows more map
  instead: Small (1.5 ×), Medium (2 ×, the default), Large (2.5 ×) or Fill window, on the
  settings page (the button in the window's bottom right corner, `src/online/ui.js`),
  kept in the browser. `?ui=<factor>` overrides it for a visit.
- **The map view grows.** `map display manager` fixed the view at `pDisplayTileSize = [12,
  9]` tiles of 50 × 50, skewed by 25. The merge tool patches it to `viewTileSize()` (a
  movie handler in `src/lingo/movie - layout.ls`, from the stage size), moves the grid's
  origin left by the extra rows' skew, lets the sprite pool use channels 200–4000, and
  centres the sky on the stage. A `relayout` handler added to the manager lays the view
  out again when the window changes size mid-mission. The scroll limits and the
  `AUTOSCROLL BORDER` shape follow the view; the sky is drawn large enough to cover it.
- **The interface is anchored.** The play frame's interface sprites are given anchors by
  channel when the score places them: the right-hand panel (minimap, unit display,
  actions, menu button) to the right edge, the plans bar and its counters to the bottom,
  the scroll arrows to the middles of the edges, and the popups (goal, menu, unit info)
  to the middle. Scripts that place sprites relative to their score positions keep
  working, since the anchors move the score positions. The map's frame is drawn
  nine-sliced to the view's size, and the panel's white and its rule run the stage's
  height.
- **Other frames** (title, world maps, licences) are pictures 610 × 440; they are drawn
  that size in the middle, over a blurred, enlarged copy of their own background.
- **The tutorial** points its arrows at the original layout, so while it runs the stage
  is 610 × 440, scaled to fit. The tutorial's two entry points set `tutorialMode` before
  the mission is built, so the map is built at that size; when the tutorial ends or is
  skipped, the mission is laid out again for the window.

## 3. Phones and tablets

The games are played with the mouse alone, plus the arrow keys and the space bar. On a
touch screen (`src/online/touch.js`, tested by `tools/verify/touch.py` on emulated phones
both ways up and on a tablet):

- *Done:* **on the interface** a touch is the mouse, down when the finger lands and up
  when it lifts, so buttons work and holding a scroll arrow scrolls. **On the map** a tap
  is a click; a **drag** moves the map with the finger, pixel by pixel (the map display
  manager already had a pixel scroll, which its own scrolling never used); a **long
  press** shows what hovering there would (a goal's wants, a pile's bricks) without
  clicking. The pointer stays where the finger was, so what hovering showed stays shown
  until the next touch.
- *Done:* two fingers **pinch** the interface smaller (more map) or bigger, for the visit,
  from half size to as big as fits; whatever the first finger had pressed is let go
  without a click.
- *To do:* **upright**, the game is drawn at 0.64 × on a phone, too small to tap well:
  the right-hand panel should move below the map and the plans bar shrink to a
  scrolling strip.
- The space bar is the selected unit's action button's shortcut, and that button is
  already on screen, so it needs nothing more.

## 4. Scores

*Done, except checking times.* Neither game kept scores, but each
mission has a clock (`game clock beh`, shown in the right-hand panel) and a bonus goal, which
opens once the goal is reached.

- **Recording** (`src/online/scores.js`): the scores client wraps two of the game's handlers
  as the scripts load, leaving their Lingo as it is: `startlevel` starts an attempt (a
  restart, `restartlevel`, calls it again), and the worlds manager's `reportSuccess`, which
  `goal.goal` and `goal.bonus` already call, ends it with the time by the game's clock. The
  tutorial is not timed. The player's best times are kept in the browser.
- **Sending** is the player's choice in the settings: ask each time (the default; the first
  time, a name is asked for), always, or never. After a time is sent, its place on the
  table shows, and a link opens the tables.
- **Server** (`server/`): a Cloudflare Worker with a D1 database, like CrystAlien
  Conflict's, at `wbserver.viosarcade.xyz`: `POST /scores`, `GET /scores?mission=6.3` (the
  fastest to the goal and to the bonus, each name's best) and `GET /scores/overall`
  (missions with the goal reached, with the bonus, and their goal times added up). Names
  go through CrystAlien Conflict's profanity filter. Deployed 2026-10-02.
- **Honesty**, *to do*: the server checks only that a time is possible at all (3 seconds to
  6 hours) and limits how many come from one address. Next: a least time per mission (the
  time a unit needs to drive the shortest route at its speed), then replays: the runtime's
  test mode already runs the game on a virtual clock with seeded random numbers, so a run's
  inputs, frame by frame, replay to the same result.

## 5. A level randomizer

*Done.* Generated missions are puzzles made from the game's own rules, each with a
solution that is played through before the mission is given (`src/online/puzzle.js`).
They are in the game's own map format and are played in the place of one of the game's
own missions, from the world whose look (sky, music) they have, with that mission's map
and name swapped while it is played (`src/online/missions.js`). So the engine needs no
change to play them.

- **What a mission is**: land regions, left to right, joined by gates that only the right
  unit gets through. Rocky ground lets through a dirtbuggy or a dumptruck, but not the
  buggy, forklift or steamshovel. A water channel is crossed when a steamshovel digs dirt
  out of the ground nearby and fills the channel with it. A tree wall is cleared when a
  treebot uproots its trees and plants them somewhere else. The player starts with a
  carrier (a buggy or a forklift) and plans. The bricks for each gate's unit lie in two to
  four piles in the region before it, each pile a trip's worth or more for the carrier, so
  they have to be hauled to a site by the gate. The unit is built there (bricks within a
  tile of the site count, as in the game), the gate is dealt with, and so on to the goal
  in the last region. Units only recharge beside some buildings, so every route is planned
  against their energy.
- **Difficulty**: one gate (easy), two gates of different kinds (harder), or two gates with
  more piles (hardest). From the harder ones on, the last gate's plan is not in hand but
  lies somewhere in its region to be fetched, and a pile of bricks nothing needs lies off
  to one side. A bonus goal asks for the first carrier to be brought into the last region,
  when it can get there.
- **Navigable**: walls of trees, mountains and rocks are grown into each region a tile at a
  time, and a tile is kept only if every place the solution needs in the region can still
  be reached from the others. The routes therefore wind round them.
- **Beatable**: the solution is a list of steps as the game's controls do them (haul,
  build, dig, fill, uproot, plant, go). Before a mission is given, the steps are played
  through a model of the rules: paths over each unit's own ground, what each carries, the
  energy each move costs (with a reserve kept, since the game's own routes are sometimes
  longer than the shortest), and the ground dug, filled and cleared. A mission whose
  solution does not play through is not given.
- **Checked in the game**: `tools/verify/puzzles.py` starts generated missions as a player
  would and plays each solution in the game itself through its own handlers (a unit's
  menuclick and mapclick, the plan icon's doBuild, gotoPos), with `tools/verify/bot.js`.
  It checks each step did what it should and that the goal and bonus goal are reached.
  `tools/verify/puzzle.mjs` checks the generator on its own over many codes.
- **Codes**: a mission is its code: its difficulty, its look (A grassland, B prehistoric,
  C jungle, D city) and a seed, like `2C-K2Q9`. The random-mission panel makes, types,
  plays and copies a link to one; `?random=2C-K2Q9` offers it.
- **Scores**: a generated mission is timed like the others, under `R-` and its code, on a
  table of its own. It does not count on the overall table.
- *To do*: more kinds of gate and goal: boats and whirlpools, pushing boulders, monsters
  with defenders or a freezebot, buildings as goals.

## 6. Multiplayer

World Builder is a single-player puzzle about building, so the multiplayer that fits
it is, in order of effort:

1. **Races**, *done*: the same mission (a campaign one or a generated one)
   for two to six players, each in their own game (`src/online/race.js`,
   `server/src/race.js`). One player makes a race and shares its code or a link
   (`?race=CODE`); the host picks the mission and starts it; every game counts down and
   starts the mission at once. Each game tells the race when its player starts, reaches
   the goal and the bonus (with the game's clock's time) or leaves the mission, which is
   giving up; a box in the corner shows everyone's progress, and the fastest to the goal
   wins. Each game also sends where its player's units are, five times a second, and
   draws the other players' units on its own map as **ghosts**: see-through, washed in
   each player's colour, at the right depth among the map's own, gliding between
   messages; pointing at one (or resting a finger on it) shows whose it is, in a tag like
   the game's own. Only these messages travel, and the ghosts are only pictures, so
   there is nothing to keep in step. A player who loses their connection has 30 seconds
   to come back as themselves. *To do*: more progress in the corner (plans found, units
   built) and the others on the minimap.
2. **Co-op**: two players in one world, each with their own units, sharing the bricks,
   the plans and the inventory. The game's state lives in the map display manager and
   the units; to share it, both browsers run the same game in deterministic lockstep, as
   CrystAlien Conflict Online does: only clicks travel, applied on the same frame
   everywhere. The runtime's test mode is most of what that needs (a virtual clock in
   place of `the milliSeconds`, seeded `random`, which the pathfinder uses to break
   ties); what is left is making the game's input go through orders rather than
   straight to `mapclick`, and giving each unit an owner.
3. **Versus**: monsters controlled by the other player, against a builder. Only if 1 and
   2 show there is an appetite for it.

The server is the scores server's Worker, with a Durable Object per race (and later per
co-op room), as for CrystAlien Conflict Online.

## Order

Each step builds on the ones before it.

1. **One game** (1). Everything else is easier with one movie to change. *Done.*
2. **The window and the interface** (2), with the settings page (7). *Done.*
3. **Touch** (3), which needs the anchored interface of step 2. *Done, but for an upright layout.*
4. **Scores** (4), with the server. *Done.*
5. **The randomizer** (5), which scores can rank once it is in. *Done.*
6. **Races** (6.1), on the scores server's rooms *(done)*; then **co-op** (6.2).
7. **The offline client and smooth drawing** (7).

## How

As with CrystAlien Conflict Online, this evolves the 1:1 port rather than replacing it:
the same Director runtime and the same translated Lingo. The merged game is made by
`tools/merge.py` from the two games' Lingo, with its changes kept as small patches to
the Lingo (`PATCHES`, each with its reason) and new scripts written in Lingo
(`src/lingo/`), so it can be made again whenever the translator improves.
`src/games/merged/scripts.js` is its output and is not edited by hand. The runtime is
shared code: fixes to it go to the 1:1 port first and are pulled from there
(`git pull html5 main`); what only the online game needs is a hook the runtime calls
when it has one (`rt.layout`) and lives in `src/online/`.

The games' feel and numbers stay as they are (no rebalancing): unit speeds, recipes,
energy and monsters are the original's.

## Open questions

- Does the merged campaign keep the two licences, or make one with seven worlds' worth
  of classes?
- World Builder 2's first mission starts the same tutorial as World Builder's (its
  `tutorial_sequence` is word for word World Builder's). In the merged game, World Six's
  first mission is better played without it; does anything then introduce the white
  bricks, the factory and the streets?
- Should randomizer missions count towards the licence, or only towards their own table?
- Co-op inventory: one shared pool, or each player's own with trading?
