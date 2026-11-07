"""The new units' pictures and data for the game (src/online/newunits.js): each unit's rendered
sprites (the World Builder sprite renderer's out/<unit>/ folders) copied into
assets/online/units/, and assets/online/units/units.json written from tools/new_units.json.

    python tools/new_units.py PATH/TO/legoworldbuilder_renderer/out

A picture's registration point is its middle, as the game's unit sprites have it."""
import json
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'online', 'units')


def game_member(name):
    """A member of the game's own (data/merged.json), or None."""
    d = json.load(open(os.path.join(ROOT, 'data', 'merged.json'), encoding='utf-8'))
    for c in d['casts']:
        for m in c['members'].values():
            if m.get('name') == name:
                return m
    return None


def main():
    src = sys.argv[1]
    spec = json.load(open(os.path.join(ROOT, 'tools', 'new_units.json'), encoding='utf-8'))
    os.makedirs(OUT, exist_ok=True)
    bitmaps, texts, config, kinds, flyers = [], [], {}, [], {}
    for kind, u in spec['units'].items():
        folder = os.path.join(src, u.get('folder', kind))
        names = [u['sprite'] + ('.' + s if s else '') for s in u.get('pictures', ('right', 'left', 'up', 'down', 'hero', 'plan'))]
        # (registration points other than the middle: a flyer's ground is under it)
        regs = {}
        if os.path.exists(os.path.join(folder, 'sprites.json')):
            regs = json.load(open(os.path.join(folder, 'sprites.json')))
        missing = [n for n in names if not os.path.exists(os.path.join(folder, n + '.png'))]
        if missing:
            print('%s: missing %s' % (kind, ', '.join(missing)))
            continue
        for n in names:
            p = os.path.join(folder, n + '.png')
            im = Image.open(p)
            # (the game's PNG reader takes 8-bit RGBA only: the portraits, opaque RGB, made RGBA)
            if im.mode != 'RGBA':
                im.convert('RGBA').save(os.path.join(OUT, n + '.png'))
            else:
                shutil.copyfile(p, os.path.join(OUT, n + '.png'))
            reg = regs.get(n, {'regX': im.width // 2, 'regY': im.height // 2})
            # (a building stands on its tile by the registration point the game gives its own: the one it
            # is framed as, the same height above the sprite's foot, as far in across)
            if u.get('reg_like') and n == u['sprite']:
                g = game_member(u['reg_like'])
                if g:
                    reg = {'regX': round(g['regX'] * im.width / g['width']), 'regY': im.height - (g['height'] - g['regY'])}
            bitmaps.append({'name': n, 'file': n + '.png', 'width': im.width, 'height': im.height, 'regX': reg['regX'], 'regY': reg['regY']})
        texts.append({'name': u['sprite'] + '.description', 'text': u['description']})
        # (a flyer: its shadow, drawn under it by the game, and how it sways over it -- layout.js)
        if regs.get('_shadow'):
            flyers[u['sprite']] = dict(regs['_shadow'], sway=u.get('sway', 2))
        for part, line in (u.get('config') or {}).items():
            config.setdefault(part, []).append(line)
        kinds.append(kind)
    # the consistent portraits: the game's own members' pictures, swapped in by a setting
    # (src/online/newunits.js, setConsistentPortraits)
    consistent = []
    os.makedirs(os.path.join(OUT, 'consistent'), exist_ok=True)
    for name, rel in (spec.get('consistent') or {}).items():
        if name.startswith('_'):
            continue
        p = os.path.join(src, rel)
        if not os.path.exists(p):
            print('consistent %s: missing %s' % (name, rel))
            continue
        Image.open(p).convert('RGBA').save(os.path.join(OUT, 'consistent', name + '.png'))
        consistent.append({'name': name, 'file': 'consistent/' + name + '.png'})
    json.dump({'bitmaps': bitmaps, 'texts': texts, 'config': {k: '\n'.join(v) for k, v in config.items()}, 'kinds': kinds,
               'consistent': consistent, 'flyers': flyers},
              open(os.path.join(OUT, 'units.json'), 'w', encoding='utf-8'), indent=1)
    print('%d pictures of %s in assets/online/units, %d consistent portraits' % (len(bitmaps), ', '.join(kinds), len(consistent)))


if __name__ == '__main__':
    main()
