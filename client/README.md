# LEGO World Builder Online, the app

The website's game as a program of its own (Electron), for Windows, macOS and Linux. It
carries the game's files (`index.html`, `src/`, `data/`, `assets/` from the repository) and
shows them in a window of its own, served as `app://game/`, so it plays with no connection.
The score tables, races and the random missions' log use the same server as the website
(wbserver.viosarcade.xyz), whose `ALLOWED_ORIGINS` lets `app://game` in. Links to share (a
random mission's, a race's) are the website's. On starting it looks for a newer version on
this repository's GitHub Releases, fetches it, and installs it when the app is closed; the
settings show its version (in a browser, they link to the latest release).

## Running it from the repository

```
cd client
npm install
npm start                       # the game from the repository's own files
npm start -- --server=http://127.0.0.1:8787    # with a local server (server/: npx wrangler dev)
```

(If `electron` starts as plain Node, the environment has `ELECTRON_RUN_AS_NODE` set, as code
editors built on Electron do: unset it.) `tools/verify/app.py` starts the app, drives its window
and plays a random mission through; `--exe` tests a built one.

## Releases

The **App** workflow (`.github/workflows/app.yml`) builds the Windows installer, the macOS
disk image (and the zip its updates use) and the Linux AppImage, and publishes them as a
release with its own tag:

- on every push to `main` that changes the game or the app, as
  `<major.minor of package.json>.<the workflow's run number>` (1.0.7, say), so that the app
  stays the same as the website;
- on a version tag pushed by hand, as that version:

  ```
  git tag v1.2.0
  git push origin v1.2.0
  ```

  (and `package.json` put at 1.2.0 too, so that the builds after it count on from 1.2).

Apps already installed update themselves from the latest release. `npm run dist` builds for
this computer only, into `dist/`.

## Signing

The builds are not signed. Windows shows "Windows protected your PC" the first time (More info,
Run anyway), and macOS wants a right-click and Open. Windows and Linux update themselves all the
same; macOS only updates a signed app, so a Mac player downloads new versions by hand until the
app is signed (an Apple Developer ID, set as the workflow's `CSC_LINK` and `CSC_KEY_PASSWORD`
secrets).
