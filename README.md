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
