# LEGO World Builder Online, the Android app

The website's game as an Android app (Capacitor), from GitHub Releases. It carries the game's
files (the repository's `index.html`, `src/`, `data/` and the online game's `assets/`), so it
plays with no connection, on the whole screen. Its page is `https://localhost/`, which the
score server's `ALLOWED_ORIGINS` lets in: the score tables, races and the random missions' log
are the website's. Links to share are the website's.

An app from outside a store cannot update itself. On starting, it asks GitHub for the latest
release: when that is newer than itself, a notice says so and the settings' App section links
to its `.apk`, which opens in the phone's browser to download and install over the app (it is
signed with the same key, so the app's settings and best times are kept).

The website itself also installs as an app on Android and iPhones (see the main README), which
updates itself; this app is for those who would rather have an `.apk`.

## Building it

Needs Node 20 or later, JDK 21 and the Android SDK (platform 36, build-tools 36; the
command-line tools are enough, `android sdk install platforms/android-36 build-tools/36.0.0`).

```
cd mobile
npm install
npm run sync                     # the game's files into android/ (web.mjs, then cap sync)
cd android
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # signed if WB_KEYSTORE etc. are set (below)
```

`tools/make_app_icon.py` draws its launcher icons and splash screens. `tools/verify/android.py`
installs a debug build on an emulator or a phone `adb` sees and plays a random mission in it;
the **Android test** workflow (`.github/workflows/android-test.yml`) runs it in an emulator on
every change to the app.

## Releases

The **App** workflow (`.github/workflows/app.yml`) builds the release APK with the other apps,
as `LEGO-World-Builder-Online-<version>-android.apk` in the same release, its version the
release's and its version code the workflow's run number (always higher than the last).

It is signed with the release key, whose four parts are the repository's Actions secrets:
`WB_KEYSTORE_BASE64` (the keystore, base64), `WB_KEYSTORE_PASSWORD`, `WB_KEY_ALIAS` and
`WB_KEY_PASSWORD`; gradle reads them from `WB_KEYSTORE` (the keystore's path) and the others.
The keystore itself is kept outside the repository. **An update signed with another key will not
install over the app**: lose the key and every player has to uninstall and install afresh.

## No store, and no iOS app

The game is LEGO's, so it is not offered on Google Play or the App Store. An iPhone or iPad
plays the website installed from Safari (Share, Add to Home Screen), which plays offline too.
