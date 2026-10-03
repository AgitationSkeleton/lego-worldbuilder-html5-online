"""World Builder and World Builder 2 made into one movie.

    python tools/merge.py

reads the two games as tools/build_library.py made them (data/wb1.json, data/wb2.json and
assets/wb1/, assets/wb2/) and their Lingo (work/pr/, as tools/extract.py left it), and
writes:

    data/merged.json            the merged movie
    assets/merged/              its bitmaps and sounds
    src/games/merged/scripts.js its scripts, translated

The merged movie is World Builder 2's, whose scripts are a superset of World Builder's,
with World Builder's casts after its own as cast libraries 7 to 12 (only the members the
merged game uses: World Builder's world maps and license, the T. rex and scorpion, its
skies and maps).  World Builder's worlds keep their numbers 1 to 5; World Builder 2's
become 6 and 7 (maps map6.x and map7.x, skies sky6 and sky7, frames "world 6" and
"world 7").  The changes made to the scripts are listed in PATCHES below, each with its
reason.
"""

import copy
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))

from lingo.parse import parse  # noqa: E402
import transpile as T  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work')
WB1_LIB_OFFSET = 6          # World Builder's cast libraries come after World Builder 2's six
ONLINE_LIB = 13             # scripts written for the merged game (src/lingo/)
WB2_WORLD_OFFSET = 5        # World Builder 2's worlds 1 and 2 are the merged game's 6 and 7

RELAYOUT = """
on relayout me
  repeat with row in pMapSprites
    repeat with s in row
      me.returnASprite(s)
    end repeat
  end repeat
  pDisplayTileSize = viewTileSize()
  pDisplayPixelTopLeft = point(22, 19) - point(80 + (25 * (pDisplayTileSize[2] - 9)), 32)
  me.prepareMapSprites()
  me.scrollmap([0, 0])
  me.showmap()
  sprite(1).loc = viewCenter() - (pDisplayTileTopleft * 4)
end
"""

# Script changes, by (game, cast, script name): (old, new) pairs of Lingo text.
PATCHES = {
    # One progress file, with the first mission of World One, both challenge worlds and
    # World Builder 2's first world open from the start.
    ('wb2', 'Internal', 'worlds manager'): [
        ('pPrefName = "gmlbLegoWB2"', 'pPrefName = "gmlbLegoWBOnline"'),
        ('  pWorlds[1][1].state = 0\n',
         '  pWorlds[1][1].state = 0\n  pWorlds[4][1].state = 0\n  pWorlds[5][1].state = 0\n'
         '  pWorlds[6][1].state = 0\n'),
        # World Builder 2 opens its world 2's first mission from the start, as World Builder
        # does its world 2's: both, here.
        ('  if (pWorlds[2][1].state < 0) or voidp(pWorlds[2][1][#state]) then\n'
         '    pWorlds[2][1][#state] = 0\n  end if\n',
         '  if (pWorlds[2][1].state < 0) or voidp(pWorlds[2][1][#state]) then\n'
         '    pWorlds[2][1][#state] = 0\n  end if\n'
         '  if (pWorlds[7][1].state < 0) or voidp(pWorlds[7][1][#state]) then\n'
         '    pWorlds[7][1][#state] = 0\n  end if\n'),
        # Each game's licence counts its own worlds' bonus missions.
        ('on countBonuses me\n  n = 0\n  repeat with w in pWorlds\n',
         'on countBonuses me, firstworld, lastworld\n  n = 0\n  if voidp(firstworld) then\n'
         '    firstworld = 1\n    lastworld = pWorlds.count\n  end if\n'
         '  repeat with wn = firstworld to lastworld\n    w = pWorlds[wn]\n'),
    ],
    # The map view takes the stage's size (src/online/layout.js): its size in tiles comes
    # from the stage, the pool of sprites for it is larger, the sky is centred on the stage,
    # and relayout lays the view out again when the window changes.
    ('wb2', 'Internal', 'map display manager'): [
        ('  pDisplayTileSize = [12, 9]\n', '  pDisplayTileSize = viewTileSize()\n'),
        ('  repeat with i = 200 to 1000\n', '  repeat with i = 200 to 4000\n'),
        # the skewed grid moves right 25 pixels for every row more than the original nine
        ('  pDisplayPixelTopLeft = point(22, 19) - point(80, 32)\n',
         '  pDisplayPixelTopLeft = point(22, 19) - point(80 + (25 * (pDisplayTileSize[2] - 9)), 32)\n'),
        ('  sprite(1).loc = point(305, 220) - (pDisplayTileTopleft * x)\n',
         '  sprite(1).loc = viewCenter() - (pDisplayTileTopleft * x)\n'),
        # A view bigger than the map is held at the map's top left: scrollmap's limit at the
        # far edge would otherwise put it past the near one, and each scroll flip between them.
        ('  pDisplayTileTopleft = newTopLeft\n',
         '  if newTopLeft[1] < -1 then\n    newTopLeft[1] = -1\n  end if\n'
         '  if newTopLeft[2] < -2 then\n    newTopLeft[2] = -2\n  end if\n'
         '  pDisplayTileTopleft = newTopLeft\n'),
        ('', RELAYOUT),
    ],
    # World Builder 2's world map buttons lead to its worlds as numbered here.
    ('wb2', 'title and levels', 'go to world 2 button behavior'): [
        ('worldCompleteP(1)', 'worldCompleteP(6)'), ('go("world 2")', 'go("world 7")')],
    ('wb2', 'title and levels', 'back to world 1 button behavior'): [('go("world 1")', 'go("world 6")')],
    ('wb2', 'title and levels', 'go to license button behavior'): [
        ('worldCompleteP(2)', 'worldCompleteP(7)'), ('go("license")', 'go("license 2")')],
    ('wb2', 'title and levels', 'back from license beh'): [('fromworld = "world 3"', 'fromworld = "world 7"')],
    ('wb2', 'title and levels', 'license switch back label beh'): [('fromworld = "world three"', 'fromworld = "world 7"')],
    ('wb2', 'title and levels', 'license card beh'): [('countBonuses()', 'countBonuses(6, 7)')],
    ('wb1', 'title and levels', 'license card beh'): [('countBonuses()', 'countBonuses(1, 5)')],
    # The tutorial points at the original layout, so the stage is made the original size
    # for it (src/online/layout.js); the flag is set before the mission's map is built, so
    # that the map is built for that size.
    ('wb1', 'title and levels', 'mission icon behavior 2'): [
        ('      golevel(world, mission)\n',
         '      if (world = 1) and (mission = 1) then\n        glob[#tutorialMode] = 1\n      end if\n'
         '      golevel(world, mission)\n')],
    ('wb2', 'tutorial', 'tutorial icon behavior'): [
        ('  golevel(999, 999)\n', '  glob[#tutorialMode] = 1\n  golevel(999, 999)\n')],
}

# The buttons that join the two games' world maps.
JUMP_BUTTONS = {
    'wb1': ('WORLD BUILDER 2', 'world 6'),
    'wb2': ('WORLD BUILDER 1', 'world 1'),
}
JUMP_LOC = (532, 52)


def load(game):
    data = json.load(open(os.path.join(ROOT, 'data', game + '.json'), encoding='utf-8'))
    pack = open(os.path.join(ROOT, 'assets', game, 'bitmaps.bin'), 'rb').read()
    return data, pack


def wb1_keep(wb1, wb2):
    """The World Builder members the merged game uses."""
    names2 = {m['name'] for c in wb2['casts'] for m in c['members'].values() if m['name']}
    frames = [l['frame'] for l in wb1['labels'] if re.fullmatch(r'world [1-5]|license', l['name'])]
    keep = set()
    for f in frames:
        fr = wb1['score'][f - 1]
        for s in fr['sprites'].values():
            keep.add(tuple(s['member']))
    for li, c in enumerate(wb1['casts'], 1):
        for n, m in c['members'].items():
            name = m['name']
            if not name:
                continue
            if name not in names2 or re.fullmatch(r'sky[1-5]', name) or re.fullmatch(r'map[1-5]\.\d+', name):
                keep.add((li, int(n)))
            if c['name'] == 'title and levels' and m['type'] == 'script':
                keep.add((li, int(n)))
            if name.startswith('label.back_to'):
                keep.add((li, int(n)))
    return keep, frames


def merge():
    wb1, pack1 = load('wb1')
    wb2, pack2 = load('wb2')
    out = copy.deepcopy(wb2)
    out['name'] = 'worldbuilder'
    pack = bytearray(pack2)

    # World Builder 2's own: maps, skies and labels renumbered as worlds 6 and 7
    for c in out['casts']:
        for n, m in c['members'].items():
            name = m['name']
            mm = re.fullmatch(r'map([12])\.(\d+)', name)
            if mm:
                m['name'] = 'map%d.%s' % (int(mm.group(1)) + WB2_WORLD_OFFSET, mm.group(2))
            mm = re.fullmatch(r'sky([12])', name)
            if mm:
                m['name'] = 'sky%d' % (int(mm.group(1)) + WB2_WORLD_OFFSET)
            if name == 'label.back_to world 2':
                m['name'] = 'label.back_to world 7'

    # World Builder's casts, after World Builder 2's
    keep, wb1_frames = wb1_keep(wb1, wb2)
    for li, c in enumerate(wb1['casts'], 1):
        members = {}
        for n, m in c['members'].items():
            if (li, int(n)) not in keep:
                continue
            m = copy.deepcopy(m)
            for k in ('png', 'indices'):
                if k in m:
                    off, ln = m[k]
                    m[k] = [len(pack), ln]
                    pack += pack1[off:off + ln]
            members[n] = m
        out['casts'].append(dict(name='wb1 ' + c['name'], members=members))

    # The tables: World Builder's lines, then World Builder 2's with its worlds moved up
    def member(data, name):
        for c in data['casts']:
            for m in c['members'].values():
                if m['name'] == name:
                    return m
    for table in ('worlds', 'level names'):
        t1 = member(wb1, table)['text']
        t2 = member(wb2, table)['text']
        lines = [l for l in t1.split('\r') if l.strip()]
        for l in t2.split('\r'):
            # "<world> <level> ...", the fields apart by spaces or tabs
            w = re.match(r'(\d+)(\s.*)$', l)
            if w:
                lines.append(str(int(w.group(1)) + WB2_WORLD_OFFSET) + w.group(2))
        member(out, table)['text'] = '\r'.join(lines) + '\r'
    # World Builder's copies of the tables are not wanted: World Builder 2's are found first
    # by name in any case.

    # A "back to world six" label for World Builder 2's licence screen, from World Two's
    lab7 = member(out, 'label.back_to world 7')
    if lab7:
        lab6 = copy.deepcopy(lab7)
        lab6['name'] = 'label.back_to world 6'
        lab6['text'] = lab7['text'].replace('TWO', 'ONE').replace('Two', 'One').replace('two', 'one')
        add_member(out, 2, lab6)

    # The score: World Builder 2's, with World Builder's five world frames and its licence
    # in place of World Builder 2's two world frames' first position
    names2 = {}
    for li, c in enumerate(out['casts'][:6], 1):
        for n, m in c['members'].items():
            if m['type'] == 'script':
                names2.setdefault(m['name'], (li, int(n)))
    script_lib1 = {}
    for li, c in enumerate(wb1['casts'], 1):
        for n, m in c['members'].items():
            if m['type'] == 'script':
                script_lib1[(li, int(n))] = (c['name'], m['name'])

    def remap_wb1(ref):
        lib, num = ref[0], ref[1]
        if (lib, num) in script_lib1:
            cast, name = script_lib1[(lib, num)]
            if cast != 'title and levels' and name in names2:
                return list(names2[name])
        return [lib + WB1_LIB_OFFSET, num]

    def wb1_frame(f):
        fr = copy.deepcopy(wb1['score'][f - 1])
        if 'script' in fr:
            lib, num, params = fr['script']
            fr['script'] = remap_wb1([lib, num]) + [params]
        for s in fr['sprites'].values():
            s['member'] = [s['member'][0] + WB1_LIB_OFFSET, s['member'][1]]
            if 'behaviors' in s:
                s['behaviors'] = [remap_wb1(b[:2]) + [b[2]] for b in s['behaviors']]
        for k in ('sound1', 'sound2', 'transition'):
            if k in fr:
                fr[k] = [fr[k][0] + WB1_LIB_OFFSET, fr[k][1]]
        return fr

    def wb2_world_frame(f):
        fr = copy.deepcopy(wb2['score'][f - 1])
        for s in fr['sprites'].values():
            if 'behaviors' in s:
                for b in s['behaviors']:
                    b[2] = re.sub(r'#(world|whichworld): ([12])\b',
                                  lambda mm: '#%s: %d' % (mm.group(1), int(mm.group(2)) + WB2_WORLD_OFFSET), b[2])
        return fr

    labels2 = {l['name']: l['frame'] for l in wb2['labels'] if l['name'] != 'New Marker'}
    labels1 = {l['name']: l['frame'] for l in wb1['labels'] if l['name'] != 'New Marker'}
    frames = []
    labels = []

    def add(fr, label=None):
        frames.append(fr)
        if label:
            labels.append(dict(frame=len(frames), name=label))
    for f in range(1, labels2['world 1']):
        name = next((l['name'] for l in wb2['labels'] if l['frame'] == f), None)
        add(copy.deepcopy(wb2['score'][f - 1]), name)
    for w in range(1, 6):
        add(wb1_frame(labels1['world %d' % w]), 'world %d' % w)
    add(wb2_world_frame(labels2['world 1']), 'world 6')
    add(wb2_world_frame(labels2['world 2']), 'world 7')
    for f in range(labels2['world 2'] + 1, len(wb2['score']) + 1):
        name = next((l['name'] for l in wb2['labels'] if l['frame'] == f), None)
        if name == 'license':
            name = 'license 2'
        add(copy.deepcopy(wb2['score'][f - 1]), name)
    add(wb1_frame(labels1['license']), 'license')
    # after a licence screen the playhead loops there (frameloop); nothing follows it

    # The title, for both games: World Builder's picture and logo (the campaign starts in its
    # worlds), World Builder 2's logo under it, and the loading bar's and Start button's
    # place moved down below the two.  (World Builder 2's own picture has its logo painted
    # in.)  The frames before the world maps are the loading, slideshow and splash frames.
    art, logo, banner = find_ref(out, 'final_title_image'), find_ref(out, 'title_logo'), find_ref(out, 'wb2_title_banner')
    for fr in frames[:labels2['world 1'] - 1]:
        sp = fr['sprites']
        assert '2' not in sp and '4' not in sp, 'title channels taken'
        sp['1'].update(member=art, width=607, height=395)
        sp['2'] = dict(member=logo, ink=0, locH=424, locV=76, width=335, height=57, foreColor=255, backColor=0)
        sp['4'] = dict(member=banner, ink=36, locH=471, locV=115, width=240, height=24, foreColor=255, backColor=0)
        # the loading bar fills along World Builder's logo's line, as it did there
        sp['3'].update(locH=261, locV=97, width=326, foreColor=255, foreRGB=[255, 153, 0])
        for ch in ('5', '6', '7'):
            if ch in sp:
                sp[ch]['locV'] += 47   # (clear of the slideshow's bubble below)

    # The buttons between the two games' world maps
    jump_script = [ONLINE_LIB, sorted(os.listdir(os.path.join(ROOT, 'src', 'lingo'))).index('world jump button beh.ls') + 1]
    for w in range(1, 8):
        game = 'wb1' if w <= 5 else 'wb2'
        text, target = JUMP_BUTTONS[game]
        label_name = 'label.jump_%s' % game
        if not member(out, label_name):
            lab = copy.deepcopy(member(wb2, 'label.next'))
            lab['name'] = label_name
            lab['text'] = text
            add_member(out, 2, lab)
        button = find_ref(out, 'extra_large_green_button')
        label = find_ref(out, label_name)
        fr = frames[next(l['frame'] for l in labels if l['name'] == 'world %d' % w) - 1]
        free = max(int(c) for c in fr['sprites']) + 1
        fr['sprites'][str(free)] = dict(member=button, ink=0, locH=JUMP_LOC[0], locV=JUMP_LOC[1], width=128, height=16,
                                        foreColor=255, backColor=0,
                                        behaviors=[jump_script + ['[#pTarget: "%s"]' % target]])
        fr['sprites'][str(free + 1)] = dict(member=label, ink=36, locH=JUMP_LOC[0], locV=JUMP_LOC[1] - 2, width=92, height=6,
                                            foreColor=255, backColor=0)

    out['score'] = frames
    out['labels'] = labels
    online = {}
    for i, f in enumerate(sorted(os.listdir(os.path.join(ROOT, 'src', 'lingo'))), 1):
        online[str(i)] = dict(type='script', name=f[:-3], scriptType='movie' if f.startswith('movie - ') else 'score')
    out['casts'].append(dict(name='online', members=online))

    os.makedirs(os.path.join(ROOT, 'assets', 'merged'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'merged.json'), 'w', encoding='utf-8') as fp:
        json.dump(out, fp, separators=(',', ':'), ensure_ascii=False)
    open(os.path.join(ROOT, 'assets', 'merged', 'bitmaps.bin'), 'wb').write(pack)
    # the main menu's pictures (src/online/menu.js): the two games' logos and the title's
    # picture, as the movies have them
    online = os.path.join(ROOT, 'assets', 'online')
    os.makedirs(online, exist_ok=True)
    for name, out_name in (('title_logo', 'logo_wb.png'), ('wb2_title_banner', 'logo_wb2.png'),
                           ('final_title_image', 'title_art.png')):
        lib, num = find_ref(out, name)
        off, ln = out['casts'][lib - 1]['members'][str(num)]['png']
        open(os.path.join(online, out_name), 'wb').write(pack[off:off + ln])
    with open(os.path.join(ROOT, 'assets', 'wb2', 'sounds.bin'), 'rb') as fp:
        open(os.path.join(ROOT, 'assets', 'merged', 'sounds.bin'), 'wb').write(fp.read())
    print('merged: %d frames, %d casts, bitmaps %.1f MB' % (len(frames), len(out['casts']), len(pack) / 1e6))
    return out


def add_member(data, lib, rec):
    members = data['casts'][lib - 1]['members']
    n = max(int(k) for k in members) + 1
    members[str(n)] = rec
    return [lib, n]


def find_ref(data, name):
    for li, c in enumerate(data['casts'], 1):
        for n, m in c['members'].items():
            if m['name'] == name:
                return [li, int(n)]
    raise KeyError(name)


def scripts(merged):
    """World Builder 2's scripts, World Builder's title cast as library 8, and the merged
    game's own, translated as one module, with PATCHES applied to the Lingo first."""
    cast_numbers = {c['name']: i + 1 for i, c in enumerate(merged['casts'])}
    entries = []

    def add_game(game, movie, only_cast=None, lib_offset=0):
        base = os.path.join(WORK, 'pr', movie, movie, 'casts')
        for cast in sorted(os.listdir(base)):
            if only_cast and cast != only_cast:
                continue
            d = os.path.join(base, cast)
            for f in sorted(os.listdir(d)):
                if not f.endswith('.ls'):
                    continue
                m = re.match(r'(\w+) (\d+)(?: - (.*))?\.ls$', f)
                kind, num, name = m.group(1), int(m.group(2)), m.group(3) or ''
                text = open(os.path.join(d, f), encoding='latin-1').read().replace('\r\n', '\n')
                lasm = os.path.join(d, f[:-3] + '.lasm')
                if os.path.exists(lasm):
                    text = T.fix_chunk_var_refs(text, open(lasm, encoding='latin-1').read())
                # the 1:1 port's few changes to the games' Lingo first (tools/transpile.py)
                text = T.apply_fixes(movie, cast, name, text)
                for old, new in PATCHES.get((game, cast, name), []):
                    if old == '':
                        text = text.rstrip('\n') + '\n' + new
                        continue
                    if old not in text:
                        raise SystemExit('patch for %s %s does not apply: %r' % (game, name, old))
                    text = text.replace(old, new)
                lib = [i + 1 for i, c in enumerate(['Internal', 'title and levels', 'audio', 'terrain and models',
                                                    'translation', 'tutorial']) if c == cast][0] + lib_offset
                entries.append(dict(cast=cast, lib=lib, number=num, name=name, kind=T.SCRIPT_KINDS.get(kind, kind),
                                    ast=parse(text, f)))
    add_game('wb2', 'worldbuilder2')
    add_game('wb1', 'worldbuilder', only_cast='title and levels', lib_offset=WB1_LIB_OFFSET)
    for i, f in enumerate(sorted(os.listdir(os.path.join(ROOT, 'src', 'lingo'))), 1):
        text = open(os.path.join(ROOT, 'src', 'lingo', f), encoding='utf-8').read()
        kind = 'movie' if f.startswith('movie - ') else 'score'
        entries.append(dict(cast='online', lib=ONLINE_LIB, number=i, name=f[:-3], kind=kind, ast=parse(text, f)))

    movie_handlers = set()
    for s in entries:
        if s['kind'] == 'movie':
            movie_handlers |= {h['name'].lower() for h in s['ast']['handlers']}
    out = ['// Generated by tools/merge.py: World Builder 2\'s Lingo, World Builder\'s title cast and',
           '// the merged game\'s own scripts (src/lingo/), translated by tools/transpile.py.',
           "import * as $L from '../../director/lingo.js';", '', 'let $R, $B, $G;', '']
    syms, floats, bodies, ids = {}, {}, [], []
    for s in entries:
        sid = 'S%d_%d' % (s['lib'], s['number'])
        g = T.Gen(sid, s['ast'], movie_handlers)
        g.syms, g.floats = syms, floats
        hs = ''.join(g.handler(h) for h in s['ast']['handlers'])
        props = json.dumps([p.lower() for p in s['ast']['props']])
        bodies.append('// %s %d: %s (%s)\nconst %s = {\n  castLib: %d, member: %d, name: %s, type: %s,\n  props: %s,\n  handlers: {\n%s  },\n};\n' % (
            s['cast'], s['number'], s['name'], s['kind'], sid, s['lib'], s['number'], json.dumps(s['name']),
            json.dumps(s['kind']), props, hs))
        ids.append(sid)
    for key, (orig, js) in sorted(syms.items()):
        out.append('const %s = $L.sym(%s);' % (js, json.dumps(orig)))
    for v, js in sorted(floats.items(), key=lambda kv: int(kv[1][2:])):
        out.append('const %s = $L.F(%r);' % (js, v))
    out.append('')
    out += bodies
    out.append('export const scripts = [%s];' % ', '.join(ids))
    out += ['', 'export function bind(runtime) {', '  $R = runtime;', '  $B = runtime.builtins;',
            '  $G = runtime.globals;', '}']
    dest = os.path.join(ROOT, 'src', 'games', 'merged')
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, 'scripts.js'), 'w', encoding='utf-8', newline='\n') as fp:
        fp.write('\n'.join(out) + '\n')
    print('merged scripts:', len(entries))


if __name__ == '__main__':
    merged = merge()
    scripts(merged)
