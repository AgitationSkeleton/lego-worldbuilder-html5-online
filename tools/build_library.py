"""Build the port's data from the unprotected movies that tools/extract.py makes.

For each game this writes:

    data/<game>.json         the movie: stage, casts and their members, score, labels
    assets/<game>/bitmaps.bin  every bitmap as a PNG, one after another
    assets/<game>/sounds.bin   every sound as MP3 (Shockwave Audio) or WAV, likewise

and, shared by both games, the fonts embedded in the movies in assets/fonts/.

    python tools/build_library.py
"""

import io
import json
import os
import struct
import subprocess
import sys
import wave

sys.path.insert(0, os.path.dirname(__file__))

from director.dirfile import DirFile  # noqa: E402
from director.bitmap import (BUILTIN_PALETTES, decode_bitd, decode_jpeg,  # noqa: E402
                             palette_rgb, parse_bitmap_header)
from director.text import parse_text_member  # noqa: E402
from director.fonts import build_otf  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work')
GAMES = {'wb1': 'worldbuilder', 'wb2': 'worldbuilder2'}
SCRIPT_TYPES = {1: 'score', 3: 'movie', 7: 'parent'}
SHAPE_TYPES = {1: 'rect', 2: 'roundRect', 3: 'oval', 4: 'line'}
# The fonts each game embeds, and what the port draws them with.  The PFR1 outlines of
# Arial and Arial Black decode imperfectly, so those two use the real typefaces they were
# made from (see README); 04b_08 is drawn from the movie's own outlines.
EMBEDDED_FONT_FILES = {'04b_08 *': '04b08.otf'}


def font_family(name):
    n = name.rstrip(' *')
    if name == '04b_08 *':
        return 'WB 04b_08'
    return n


class Pack:
    def __init__(self):
        self.buf = bytearray()

    def add(self, data):
        off = len(self.buf)
        self.buf += data
        return [off, len(data)]


def rle_bytes(data):
    """Palette indices, as (count, value) byte pairs."""
    out = bytearray()
    i, n = 0, len(data)
    while i < n:
        v = data[i]
        j = i + 1
        while j < n and data[j] == v and j - i < 255:
            j += 1
        out += bytes((j - i, v))
        i = j
    return bytes(out)


def png_bytes(img):
    b = io.BytesIO()
    img.save(b, 'PNG', optimize=True)
    return b.getvalue()


def snd_to_wav(data):
    """A Mac 'snd ' resource holding plain samples, as WAV."""
    r = io.BytesIO(data)

    def u16():
        return struct.unpack('>H', r.read(2))[0]

    def u32():
        return struct.unpack('>I', r.read(4))[0]
    fmt = u16()
    if fmt == 1:
        n = u16()
        for _ in range(n):
            u16(); u32()
    else:
        u16()
    ncmd = u16()
    for _ in range(ncmd):
        u16(); u16(); u32()
    u32()  # sample pointer
    enc_dep = u32()
    rate = u16()
    u16()
    u32(); u32()
    encode = r.read(1)[0]
    r.read(1)
    if encode == 0:
        channels, nsamp, bits = 1, enc_dep, 8
    else:
        channels = enc_dep
        nsamp = u32()
        r.read(10)
        u32(); u32(); u32()
        bits = u16()
        r.read(14)
    pcm = r.read(nsamp * channels * bits // 8)
    out = io.BytesIO()
    w = wave.open(out, 'wb')
    w.setnchannels(channels)
    w.setsampwidth(bits // 8)
    w.setframerate(rate)
    if bits == 16:
        # Mac samples are big-endian; WAV's are little-endian.
        pcm = b''.join(pcm[i + 1:i + 2] + pcm[i:i + 1] for i in range(0, len(pcm), 2))
    w.writeframes(pcm)
    w.close()
    return out.getvalue()


def swa_to_mp3(data):
    """Shockwave Audio: a header (its own length first), then plain MPEG audio frames.
    The header gives the sample rate and how many samples the sound really has: its MPEG
    frames hold more, the encoder's and decoder's delay before it and padding after."""
    head = struct.unpack('>I', data[:4])[0]
    rate = struct.unpack('>I', data[8:12])[0]
    samples = struct.unpack('>I', data[20:24])[0]
    return data[head + 4:], rate, samples


def convert_fonts(d, game_dir, fonts_out):
    """PFR1 fonts embedded in the movie, through LibreShockwave's parser (pfr1json)."""
    tool = os.path.join(WORK, 'tools', 'pfr1json.exe' if os.name == 'nt' else 'pfr1json')
    made = {}
    for c in d.casts:
        for num, m in c['members'].items():
            if m.get('xtraKind') != 'font':
                continue
            out_name = EMBEDDED_FONT_FILES.get(m['name'])
            if not out_name:
                continue
            out_path = os.path.join(fonts_out, out_name)
            if os.path.exists(out_path) or not os.path.exists(tool):
                made[m['name']] = out_name
                continue
            src = os.path.join(game_dir, 'font_%d.pfr' % num)
            js = os.path.join(game_dir, 'font_%d.json' % num)
            open(src, 'wb').write(d.chunk(m['children']['XMED']))
            subprocess.run([tool, src, js], check=True)
            build_otf(js, font_family(m['name']), out_path)
            made[m['name']] = out_name
    return made


def build(game, movie):
    path = os.path.join(WORK, 'pr', movie, movie + '.dir')
    d = DirFile(path)
    out_assets = os.path.join(ROOT, 'assets', game)
    fonts_out = os.path.join(ROOT, 'assets', 'fonts')
    os.makedirs(out_assets, exist_ok=True)
    os.makedirs(fonts_out, exist_ok=True)
    game_work = os.path.join(WORK, game)
    os.makedirs(game_work, exist_ok=True)
    bitmaps = Pack()
    sounds = Pack()

    # Xtra kinds first: fonts are converted before anything refers to them.
    for c in d.casts:
        for m in c['members'].values():
            if m['type'] == 'xtra':
                s = m['spec']
                n = struct.unpack_from('>I', s, 0)[0]
                m['xtraKind'] = s[4:4 + n].decode('latin-1')
            if m['type'] == 'palette':
                m['rgb'] = palette_rgb(d.chunk(m['children']['CLUT']))
    font_files = convert_fonts(d, game_work, fonts_out)

    def find_palette(h, cast_number):
        if h['palette'] < 0:
            if h['bitDepth'] == 2:
                return None
            return BUILTIN_PALETTES.get(h['palette'], BUILTIN_PALETTES[-102])
        if h['paletteLib'] > 0:
            lib = h['paletteLib']
        elif h['paletteLib'] < 0:
            lib = cast_number
        else:
            # Cast library 0: the first library with a palette at that number.
            lib = next((cc['number'] for cc in d.casts
                        if cc['members'].get(h['palette'], {}).get('type') == 'palette'), cast_number)
        pm = d.casts[lib - 1]['members'].get(h['palette'])
        if pm and pm['type'] == 'palette':
            return pm['rgb']
        return BUILTIN_PALETTES[-102]

    casts = []
    for c in d.casts:
        members = {}
        for num, m in sorted(c['members'].items()):
            rec = dict(type=m['type'], name=m['name'])
            ch = m['children']
            if m['type'] == 'bitmap':
                h = parse_bitmap_header(m['spec'])
                rec.update(width=h['width'], height=h['height'], regX=h['regX'], regY=h['regY'],
                           depth=h['bitDepth'])
                img = None
                if 'BITD' in ch:
                    img, idx = decode_bitd(d.chunk(ch['BITD']), h, find_palette(h, c['number']))
                    if idx is not None:
                        # getPixel on an indexed bitmap answers with the palette index
                        rec['indices'] = bitmaps.add(rle_bytes(idx))
                elif 'ediM' in ch:
                    img = decode_jpeg(d.chunk(ch['ediM']), d.chunk(ch['ALFA']) if 'ALFA' in ch else None, h)
                if img is not None:
                    rec['png'] = bitmaps.add(png_bytes(img))
                    rec['alpha'] = bool(h['updateFlags'] & 0x10) or 'ALFA' in ch
                if h['bitDepth'] == 1:
                    rec['mono'] = True
            elif m['type'] == 'palette':
                rec['colors'] = m['rgb']
            elif m['type'] == 'script':
                st = struct.unpack('>H', m['spec'][:2])[0] if len(m['spec']) >= 2 else 0
                rec['scriptType'] = SCRIPT_TYPES.get(st, str(st))
            elif m['type'] == 'shape':
                s = m['spec']
                stype = struct.unpack_from('>H', s, 0)[0]
                top, left, bottom, right = struct.unpack_from('>hhhh', s, 2)
                rec.update(shapeType=SHAPE_TYPES.get(stype, 'rect'), width=right - left, height=bottom - top,
                           pattern=struct.unpack_from('>H', s, 10)[0], foreColor=s[12], backColor=s[13],
                           filled=s[14], lineSize=s[15], lineDirection=s[16])
            elif m['type'] == 'sound':
                if 'ediM' in ch:
                    mp3, rate, samples = swa_to_mp3(d.chunk(ch['ediM']))
                    rec.update(format='mp3', data=sounds.add(mp3), rate=rate, samples=samples)
                elif 'snd ' in ch:
                    rec.update(format='wav', data=sounds.add(snd_to_wav(d.chunk(ch['snd ']))))
                rec['loop'] = not (m['flags'] & 16)
            elif m['type'] == 'xtra':
                kind = m['xtraKind']
                if kind == 'text':
                    t = parse_text_member(d.chunk(ch['XMED']))
                    for st in t['styles']:
                        st['family'] = font_family(st['font'])
                    rec.update(type='text', **t)
                    # The member's rect around its registration point (info item 12).
                    items = m['infoItems']
                    if len(items) > 12 and len(items[12]) == 16:
                        top, left, bottom, right = struct.unpack('>iiii', items[12])
                        rec['regX'], rec['regY'] = -left, -top
                elif kind == 'font':
                    rec.update(type='font', family=font_family(m['name']), file=font_files.get(m['name']))
                else:
                    rec['xtraKind'] = kind
            elif m['type'] == 'button':
                rec['text'] = ''
                if 'STXT' in ch:
                    st = d.chunk(ch['STXT'])
                    hl, tl = struct.unpack_from('>II', st, 0)
                    rec['text'] = st[hl:hl + tl].decode('mac_roman')
            if m['scriptId'] and m['type'] != 'script':
                rec['hasScript'] = True
            members[num] = rec
        casts.append(dict(name=c['name'], members=members))

    score = d.score()
    frames = []
    for f in score['frames']:
        mc = f['main']
        fr = dict()
        if mc['scriptBehaviors']:
            b = mc['scriptBehaviors'][0]
            fr['script'] = [b['castLib'], b['member'], b['params'].rstrip('\x00')]
        elif mc['script'][1]:
            fr['script'] = [mc['script'][0], mc['script'][1], '']
        if mc['tempo']:
            fr['tempo'] = mc['tempo']
        for k in ('sound1', 'sound2', 'transition'):
            if mc[k][1]:
                fr[k] = list(mc[k])
        if mc['palette'] != (0, 0):
            fr['palette'] = list(mc['palette'])
        sprites = {}
        for ch, s in f['sprites'].items():
            if not s['member']:
                continue
            sp = dict(member=[s['castLib'], s['member']], ink=s['ink'], locH=s['locH'], locV=s['locV'],
                      width=s['width'], height=s['height'], foreColor=s['foreColor'], backColor=s['backColor'])
            if s['blend'] and (s['ink'] == 32 or s['thickness'] & 0x10):
                sp['blend'] = round((255 - s['blend']) * 100 / 255)
            if s['stretch']:
                sp['stretch'] = True
            if s['trails']:
                sp['trails'] = True
            if s['colorcode'] & 0x10:
                sp['foreRGB'] = [s['foreColor'], s['fgG'], s['fgB']]
            if s['colorcode'] & 0x20:
                sp['backRGB'] = [s['backColor'], s['bgG'], s['bgB']]
            if s.get('info'):
                sp['span'] = [s['info']['startFrame'], s['info']['endFrame']]
            beh = [[b['castLib'], b['member'], b['params'].rstrip('\x00')] for b in s.get('behaviors', [])]
            if beh:
                sp['behaviors'] = beh
            sprites[ch] = sp
        fr['sprites'] = sprites
        frames.append(fr)

    movie_json = dict(
        name=movie,
        stage=dict(width=d.stage['width'], height=d.stage['height'], color=list(d.stage_color or (255, 255, 255))),
        systemPalette=BUILTIN_PALETTES[-102],
        frameRate=d.frame_rate,
        channels=score['displayed'],
        casts=casts,
        labels=d.labels(),
        score=frames,
    )
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', game + '.json'), 'w', encoding='utf-8') as fp:
        json.dump(movie_json, fp, separators=(',', ':'), ensure_ascii=False)
    open(os.path.join(out_assets, 'bitmaps.bin'), 'wb').write(bitmaps.buf)
    open(os.path.join(out_assets, 'sounds.bin'), 'wb').write(sounds.buf)
    print(game, 'bitmaps', len(bitmaps.buf), 'sounds', len(sounds.buf))


def picker_art(game):
    """The picker page's pictures: the title screen as the score lays it out, and an icon."""
    from PIL import Image
    data = json.load(open(os.path.join(ROOT, 'data', game + '.json'), encoding='utf-8'))
    pack = open(os.path.join(ROOT, 'assets', game, 'bitmaps.bin'), 'rb').read()

    def bitmap(lib, num):
        rec = data['casts'][lib - 1]['members'].get(str(num))
        if not rec or rec['type'] != 'bitmap' or 'png' not in rec:
            return None, None
        off, ln = rec['png']
        return Image.open(io.BytesIO(pack[off:off + ln])).convert('RGBA'), rec

    splash = next(l['frame'] for l in data['labels'] if l['name'] == 'splash')
    frame = data['score'][splash - 1]
    st = data['stage']
    canvas = Image.new('RGBA', (st['width'], st['height']), tuple(st['color']) + (255,))
    for ch in sorted(frame['sprites'], key=int)[:2]:
        sp = frame['sprites'][ch]
        img, rec = bitmap(*sp['member'])
        if img is None:
            continue
        canvas.alpha_composite(img, (sp['locH'] - rec['regX'], sp['locV'] - rec['regY']))
    canvas.convert('RGB').save(os.path.join(ROOT, 'assets', game, 'title.jpg'), quality=86)
    hero = {'wb1': 'vehicle.buggy.hero', 'wb2': 'vehicle.freezebot.hero'}[game]
    for lib, c in enumerate(data['casts'], 1):
        for num, rec in c['members'].items():
            if rec['name'] == hero:
                img, _ = bitmap(lib, int(num))
                px = img.load()
                for y in range(img.height):
                    for x in range(img.width):
                        if px[x, y][:3] == (255, 255, 255):
                            px[x, y] = (255, 255, 255, 0)
                img.thumbnail((64, 64))
                icon = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
                icon.alpha_composite(img, ((64 - img.width) // 2, (64 - img.height) // 2))
                icon.save(os.path.join(ROOT, 'assets', game, 'icon.png'))


if __name__ == '__main__':
    for game, movie in GAMES.items():
        build(game, movie)
        picker_art(game)
