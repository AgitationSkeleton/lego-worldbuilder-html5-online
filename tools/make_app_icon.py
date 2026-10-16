"""The app's icon (client/icon.png): the title picture's blue robot (assets/online/title_art.png)
on a tile in the look of the game's own bubbles, white with a black rounded edge; and the web
app's (assets/icons/, manifest.webmanifest): the same at 192 and 512 pixels, a full-bleed one
for Android to cut to its own shape ("maskable": the robot inside its middle 80%), and an
opaque one for iPhones and iPads, which round its corners themselves; and the Android app's
(mobile/android/), if it is there: its launcher icons at each density (square, round, and the
foreground of the adaptive icon, on its white background) and its splash screens, the title
picture and logo on white."""
import os

from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
S = 1024


def robot(size):
    art = Image.open(os.path.join(ROOT, 'assets', 'online', 'title_art.png')).convert('RGBA')
    r = art.crop((18, 2, 300, 362))
    k = size / max(r.width, r.height)
    return r.resize((round(r.width * k), round(r.height * k)), Image.LANCZOS)


def plain(inner):
    """The robot on white, edge to edge, taking up `inner` of it."""
    out = Image.new('RGBA', (S, S), (255, 255, 255, 255))
    r = robot(round(S * inner))
    out.alpha_composite(r, ((S - r.width) // 2 + 8, (S - r.height) // 2 + 4))
    return out


def main():
    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle((40, 40, S - 40, S - 40), radius=180, fill=(255, 255, 255, 255), outline=(0, 0, 0, 255), width=40)
    art = Image.open(os.path.join(ROOT, 'assets', 'online', 'title_art.png')).convert('RGBA')
    robot = art.crop((18, 2, 300, 362))
    k = 760 / max(robot.width, robot.height)
    robot = robot.resize((round(robot.width * k), round(robot.height * k)), Image.LANCZOS)
    icon.alpha_composite(robot, ((S - robot.width) // 2 + 10, (S - robot.height) // 2 + 6))
    # (inside the edge only)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=180, fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(icon, (0, 0), mask)
    ImageDraw.Draw(out).rounded_rectangle((40, 40, S - 40, S - 40), radius=180, outline=(0, 0, 0, 255), width=40)
    out.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, 'client', 'icon.png'))
    print('client/icon.png')
    icons = os.path.join(ROOT, 'assets', 'icons')
    os.makedirs(icons, exist_ok=True)
    for n in (192, 512):
        out.resize((n, n), Image.LANCZOS).save(os.path.join(icons, 'icon-%d.png' % n))
    plain(0.66).resize((512, 512), Image.LANCZOS).save(os.path.join(icons, 'icon-maskable-512.png'))
    plain(0.8).convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(icons, 'apple-touch-icon.png'))
    print('assets/icons/')
    res = os.path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res')
    if os.path.isdir(res):
        android(res, out)
        print('mobile/android/app/src/main/res/')


DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def android(res, tile):
    from PIL import ImageOps
    for name, k in DENSITIES.items():
        d = os.path.join(res, 'mipmap-' + name)
        n = round(48 * k)
        tile.resize((n, n), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))
        disc = plain(0.72)
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, S, S), fill=255)
        r = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        r.paste(disc, (0, 0), mask)
        r.resize((n, n), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_round.png'))
        # (the adaptive icon's foreground: 108dp, of which the middle 66 always shows)
        f = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        rb = robot(round(S * 0.56))
        f.alpha_composite(rb, ((S - rb.width) // 2 + 6, (S - rb.height) // 2 + 4))
        m = round(108 * k)
        f.resize((m, m), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
    # the splash screens: the title picture under the two logos, on white
    art = Image.open(os.path.join(ROOT, 'assets', 'online', 'title_art.png')).convert('RGBA')
    logo = Image.open(os.path.join(ROOT, 'assets', 'online', 'logo_wb.png')).convert('RGBA')
    for dirpath, _, files in os.walk(res):
        if 'splash.png' not in files or not os.path.basename(dirpath).startswith('drawable'):
            continue
        path = os.path.join(dirpath, 'splash.png')
        w, h = Image.open(path).size
        sp = Image.new('RGB', (w, h), (255, 255, 255))
        aw = round(min(w * 0.8, h * 0.6 * art.width / art.height))
        a = art.resize((aw, round(aw * art.height / art.width)), Image.LANCZOS)
        lw = round(aw * 0.7)
        lg = logo.resize((lw, round(lw * logo.height / logo.width)), Image.LANCZOS)
        top = (h - a.height - lg.height - round(h * 0.03)) // 2
        sp.paste(lg, ((w - lg.width) // 2, top), lg)
        sp.paste(a, ((w - a.width) // 2, top + lg.height + round(h * 0.03)), a)
        sp.save(path)


if __name__ == '__main__':
    main()
