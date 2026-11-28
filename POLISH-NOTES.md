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


## Final requested update

- Home custom-list tiles now open a dedicated Persona 5-styled overlay without navigating to Library.
- Custom lists support an explicit play order with move-up/move-down controls and per-game MAIN GAME / SPIN-OFF flags. Membership and order are stored with the existing local library data.
- Added 3DS to the owned-platform chips in the game editor.
- Hardened horizontal carousel touch behavior (including Last Played) with native horizontal panning, momentum scrolling, and contained overscroll.
- Locked the Library's red decorative slash in place while searching by disabling its float animation and translate movement in the Library tab.
- Suppressed the repeated game-opening slash reveal during rapid successive opens to avoid the recurring transition flicker.
- Android back now closes the Home custom-list window before leaving the Home screen.
- Bumped the offline shell cache to v5 and kept the Android bundled web assets synchronized.

These are source-level changes. The Android APK still needs to be rebuilt and tested on the target device for physical touch latency and GPU-specific rendering behavior.


## Follow-up navigation correction

- Home list tiles now use a dedicated `data-home-list` action, separate from the Library's generic list controls. This prevents the Home tile click from falling through to Library navigation.
- List lookup and game membership checks normalize IDs to strings, so older numeric IDs and newer string IDs both resolve correctly.
- Opening a game from the Home list overlay releases the background scroll lock.
- Bumped the offline shell cache to v6 so browsers and installed web shells fetch the corrected navigation code.
- Kept `www/index.html` and the Android bundled `public/index.html` byte-for-byte synchronized.


## Final list-type separation and touch polish
- Added an explicit list type choice when creating a list: Normal List or Play Order.
- Normal Lists are simple alphabetical collections and do not show ordering controls or Main Game / Spin-off labels.
- Play Order lists retain manual move-up/down ordering and per-game Main Game / Spin-off labels.
- Existing lists without a type are treated as Normal Lists to avoid unexpectedly imposing ordering controls.
- Updated touch interaction and native scrolling polish, including reduced-motion support.
- Bumped the service-worker shell cache to v7 and synchronized web and Android assets.
