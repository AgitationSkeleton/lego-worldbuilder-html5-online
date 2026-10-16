// The game's files for the Android app (mobile/www/, which Capacitor puts in the app): the
// repository's index.html, src/, data/ and assets/, as the website has them.  (Not the web
// app's service worker or manifest: the app has its files already.)
//
//   node web.mjs        (npm run web; npm run sync also copies them into android/)

import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const www = join(here, 'www');
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(join(root, 'index.html'), join(www, 'index.html'));
for (const dir of ['src', 'data']) cpSync(join(root, dir), join(www, dir), { recursive: true });
// (of assets/, what the online game uses: not the two games' own, for the 1:1 port's pages,
// but for World Builder 2's icon)
const assets = join(root, 'assets');
cpSync(assets, join(www, 'assets'), {
  recursive: true,
  filter: (src) => {
    const [top, ...rest] = relative(assets, src).split(sep);
    if (top !== 'wb1' && top !== 'wb2') return true;
    return top === 'wb2' && (rest.length === 0 || rest.join('/') === 'icon.png');
  },
});
console.log("mobile/www: index.html, src/, data/, assets/ (the online game's)");
