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

- **One game**: World Builder's five worlds, then World Builder 2's two as worlds six and
  seven. World One, Ocean, Prehistoric and World Six are open from the start. Each world
  map has buttons to the others.
- **The window's size**: the game fills the window; a bigger window shows more of the
  map, with the interface along its edges. The settings (the button in the bottom right
  corner) choose how large the interface is drawn, and full screen. The title, world maps
  and licences keep their original size in the middle of the window. The tutorial keeps
  the original layout, since its arrows point at it.
- **Touch**: a tap is a click, a drag moves the map, a long press on the map shows what
  hovering would.

## Checking it

With the repository served at <http://127.0.0.1:8766/>:

```
python tools/verify/soak.py merged --base http://127.0.0.1:8766/ --size 1280x720
python tools/verify/touch.py --size 844x390
```

The first plays every mission with random clicks and reports script errors; the second
plays one with a finger on an emulated phone and checks that taps, drags and the scroll
arrows do what they should.

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
