# SavePoint polish update

This update is based on the supplied `SavePoint-updated-v4.zip`.

## Changes
- Fixed a transition race: an older delayed close callback could remove the game sheet after a newer game had already opened. The exit timer is now cancellable and guarded by a transition ID.
- Replaced the black, expanding clip-path exit overlay with a short opacity fade on the game sheet, revealing the underlying app screen smoothly.
- Simplified the game-sheet reveal to opacity-only content fading while retaining the Persona 5 red slash wipe.
- Prevented the poster artwork area from sitting above the Track/Overview tab hit area; tabs now have a higher stacking order and larger touch targets.
- Search typing now updates only the results panel instead of rebuilding the entire library screen on every keystroke. This keeps the search background and surrounding layout stationary while typing.
- Bumped the offline shell cache to v3 so the updated app shell is picked up.
- Updated the GitHub Actions Node runtime to Node 22 for the Capacitor 8 project.

## Files changed
- `www/index.html`
- `android/app/src/main/assets/public/index.html` (kept in sync with `www/index.html`)
- `www/sw.js`
- `android/app/src/main/assets/public/sw.js` (kept in sync with `www/sw.js`)
- `.github/workflows/build-apk.yml`

## Important
These are source-level fixes. The APK still needs to be rebuilt and tested on a physical Android device. Transition smoothness can vary by device/GPU, so the updated APK should be checked for repeated game open/close cycles and search keyboard behavior before treating the app as final.
