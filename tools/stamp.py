"""Names each file the page loads by what is in it, in index.html.

GitHub Pages lets a browser keep a file for ten minutes. A page deployed in that time could
run with some of its files new and some kept from before (the plans bar's layout old, its
scripts new, say), which looks like a bug of the new page. So index.html gives each file
as its address with ?v= and its contents' hash: the import map, every module under src/;
its stylesheets' links and its first script; and window.__files, what the scripts fetch
(the movie's data and media, the font, the main menu's pictures: src/files.js). A file
changed has a new address and is fetched; one not changed is still kept.

The hashes are git's, of the files as they are staged: tools/hooks/pre-commit runs this
before each commit and stages index.html, and tools/hooks/post-merge after a pull (the
hooks are on with `git config core.hooksPath tools/hooks`).

    python tools/stamp.py           write index.html
    python tools/stamp.py --check   say whether it is up to date (exit 1 if not)
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FETCHED = ['data/merged.json', 'assets/merged/bitmaps.bin', 'assets/merged/sounds.bin',
           'assets/fonts/04b08.otf', 'assets/online/logo_wb.png', 'assets/online/logo_wb2.png',
           'assets/online/title_art.png']
STYLES = ['src/page.css', 'src/online/ui.css']
ENTRY = 'src/main.js'
START, END = '<!-- stamp: tools/stamp.py -->', '<!-- /stamp -->'


def staged():
    out = subprocess.run(['git', 'ls-files', '-s'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    blobs = {}
    for line in out.splitlines():
        meta, path = line.split('\t', 1)
        blobs[path] = meta.split()[1][:10]
    return blobs


def stamped(html, blobs):
    modules = sorted(p for p in blobs if p.startswith('src/') and p.endswith('.js'))
    imports = {'./' + p: './' + p + '?v=' + blobs[p] for p in modules}
    files = {p: blobs[p] for p in FETCHED if p in blobs}
    block = '\n'.join([
        START,
        '<script type="importmap">' + json.dumps({'imports': imports}, separators=(',', ':')) + '</script>',
        '<script>window.__files = ' + json.dumps(files, separators=(',', ':')) + ';</script>',
        END])
    if START in html:
        html = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda m: block, html, flags=re.S)
    else:
        # (in the head, before the stylesheets: the import map before any module)
        html = html.replace('<link rel="stylesheet"', block + '\n<link rel="stylesheet"', 1)
    for p in STYLES + [ENTRY]:
        html = re.sub(r'(["\'])' + re.escape(p) + r'(\?v=[0-9a-f]*)?\1', lambda m: m.group(1) + p + '?v=' + blobs[p] + m.group(1), html)
    return html


def main():
    path = os.path.join(ROOT, 'index.html')
    html = open(path, encoding='utf-8').read()
    new = stamped(html, staged())
    if '--check' in sys.argv:
        print('index.html is up to date' if new == html else 'index.html needs tools/stamp.py')
        return 0 if new == html else 1
    if new != html:
        open(path, 'w', encoding='utf-8', newline='\n').write(new)
        print('index.html stamped')
    return 0


if __name__ == '__main__':
    sys.exit(main())
