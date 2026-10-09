"""The app's icon (client/icon.png): the title picture's blue robot (assets/online/title_art.png)
on a tile in the look of the game's own bubbles, white with a black rounded edge."""
import os

from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
S = 1024


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


if __name__ == '__main__':
    main()
