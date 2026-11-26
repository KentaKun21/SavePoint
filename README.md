# SavePoint

Mobile-first game library & tracker (Capacitor Android + offline-first web).

## Build the Android APK (GitHub)

1. Push this repo to GitHub.
2. Open **Actions** → **Build Android APK** → **Run workflow**.
3. When finished, download the **SavePoint-debug** artifact (the `.apk`).
4. Install on your phone (enable install from unknown sources if needed).

Local build (optional):

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### Fixes included in this package

- **Screen scaling**: layout uses full phone width, text wraps, no horizontal cut-off, safe-area padding.
- **Gray swipe bars removed**: system / WebView scrollbars hidden.
- **Bottom tabs**: stay above the system navigation / home indicator; content padding adjusted.
- **Android back button**: goes to previous in-app screen / previous tab instead of immediately exiting the app.
- **Opening splash animation removed** (black instant launch).
- **App icon**: the custom gamepad icon you provided is set as the launcher icon (all densities) and PWA icons.
- **Google sign-in**: `getRedirectResult` recovery added for the “missing initial state” error after redirect. Popup is still tried first. If sign-in still fails on some phones, add a `google-services.json` from Firebase (Android app with package `com.kentakun21.savepoint`) into `android/app/`, or use a Capacitor Google Auth plugin later.

### Config

Edit `www/config.js` (and the copy under `android/app/src/main/assets/public/` if you skip `cap sync`) for Worker URL and Firebase web config.

---

## Online game catalogue (multi-source)

The `worker/` folder contains the Cloudflare Worker. It combines RAWG, Steam, TheGamesDB, and SteamGridDB. Store all provider keys as Cloudflare Worker **Secrets**: `RAWG_API_KEY`, `THEGAMESDB_API_KEY`, and `STEAMGRIDDB_API_KEY`.

1. In Cloudflare, open **Workers & Pages** and select `savepoint-api`.
2. Open **Edit code** and replace the Worker code with `worker/index.js`.
3. Save and deploy the Worker.
4. In **Settings → Variables and Secrets**, ensure `RAWG_API_KEY` is stored as a **Secret**, not a plain text Variable.
5. Open `https://YOUR-WORKER.workers.dev/health`. It should return `ok: true` and a provider value listing the connected catalogue/artwork sources.
6. Test `https://YOUR-WORKER.workers.dev/search?q=zelda`.
7. `config.js` already points to the current SavePoint Worker URL. If you create a different Worker, update `SAVEPOINT.API`.

### Search and discovery

- Title search with relevance ranking, common aliases/abbreviations, initials and typo tolerance.
- Developer and publisher searches (for example, Atlus) in the same search bar; company matching is case-insensitive and requires a whole company-name match to avoid hijacking game-title searches.
- Latest Hits uses a rolling 365-day release window and ranks recent releases using RAWG activity/rating signals, so old evergreen games do not crowd out new releases.
- Coming Soon lists future-dated releases.
- TheGamesDB adds older console/retro titles and platform metadata; SteamGridDB is used for portrait artwork where a better cover is unavailable. No provider guarantees every game; keep the app's manual **ADD ANYWAY** option for missing titles.

The Worker routes are `/health`, `/search?q=...`, `/game?id=...`, `/hot`, `/upcoming`, and `/similar`. All provider API keys stay on the Worker and are never placed in browser code.

## Google sign-in and cloud sync (optional)

1. Create a project in the Firebase console.
2. Enable Google under **Authentication → Sign-in method**.
3. Create a Firestore database.
4. Publish the supplied `firestore.rules`.
5. Register a Firebase web app and copy its `apiKey`, `authDomain`, `projectId`, and `appId` into `config.js`.

## Run locally

From the project folder, run a static server, for example:

```bash
npx serve .
```

Then open the local address printed by the server (previously `http://localhost:3000/#home`).

## Deploy the app

Upload `index.html`, `config.js`, `manifest.json`, `sw.js`, and the icons to Cloudflare Pages or another static host. For a public site, set the Worker `ALLOW_ORIGIN` variable to the site's origin instead of `*`.

## Notes

- Keep API keys private. Do not put `RAWG_API_KEY` in `config.js`, source control, screenshots, or browser code.
- RAWG's catalogue and metadata can be incomplete. Cover priority is TheGamesDB front box art, Steam portrait library art, SteamGridDB portrait art, then available RAWG imagery.
- `worker/index.js` is the source of truth for the deployed multi-source Worker. Keep the local copy in sync with Cloudflare before publishing the project.


## Multi-source search and artwork update

The Worker now searches RAWG and Steam in parallel. Steam is a secondary source
for Steam-distributed PC games that RAWG may miss. When Steam provides its
portrait library artwork, SavePoint prefers that over RAWG's landscape
background screenshot. If no portrait art exists, the available RAWG/Steam
image is used as a fallback.

This does not mean every game in existence is guaranteed: Steam only covers
games listed on Steam, and RAWG/Steam may both lack some mobile, console,
delisted, or obscure titles. A future source such as IGDB or a licensed
mobile-game catalogue can expand coverage further.


### Provider behavior and limitations

- RAWG supplies broad game metadata and current release/activity discovery.
- Steam supplements PC catalogue results and can supply portrait library covers.
- TheGamesDB supplements console and retro catalogue coverage and supplies front box-art URLs and platform names when available.
- SteamGridDB is an artwork-only fallback. It matches the exact normalized game title before using a 600×900 static grid image.
- Search combines results in the same universal search bar. TheGamesDB and SteamGridDB are optional at runtime; if a secret is absent or a provider request fails, the other sources can still return results.
- TheGamesDB results use `tgdb-` IDs and Steam-only results use `steam-` IDs; the `/game` route supports both.
- Coverage and artwork depend on each provider's database, API limits, title matching, and available submissions. No provider can guarantee every region, edition, platform, or niche release.

After updating this project, replace the Cloudflare Worker code with `worker/index.js` and deploy it. Keep the three API keys in Cloudflare Worker Secrets only.


## SavePoint notes (updated)

- Fresh installs start with an empty library. SavePoint never deletes or replaces games you added, including any that came from the old sample set.
- Search has a platform filter. Game pages open on an Overview, and TRACK holds your own status, rating and remarks.
- OpenCritic, critic scores and critic reviews were removed. The Worker no longer needs `OPENCRITIC_API_KEY` (you can delete that secret). The Similar Games tab was removed from the game page. The Home "For you" picks still use the Worker's `/similar` route.
- **Developer names** are cleaned up in the Worker and in the app: duplicates and company suffixes ("Co., Ltd.") are merged, and ATLUS studios (P-Studio, Studio Zero, Atlus West/USA) and first-party ATLUS series (Persona, Shin Megami Tensei, Metaphor, Catherine and similar) are shown as ATLUS.
- **Official links** are shown only for developers listed in `VERIFIED` inside `index.html`. Each entry must be copied from the developer's own website. For ATLUS these are the accounts that atlus.com links to (X @Atlus_West, Instagram atlus_west, YouTube /c/atlus, Facebook AtlusWest, Twitch atlus_west). Developers not on that list show no links. Nothing is guessed from web searches.
- **Missing covers and developers** for games already in your library are filled in automatically after the app opens (up to 40 games per visit). Settings, Refresh artwork & developers, runs it again on demand.
- **Release countdowns** read "OUT IN 86 DAYS", "OUT TOMORROW" or "OUT TODAY" and appear only for games that are not released yet.

Worker routes: `/health`, `/search`, `/game`, `/hot`, `/upcoming`, `/similar`. Required secrets: `RAWG_API_KEY`, `THEGAMESDB_API_KEY`, `STEAMGRIDDB_API_KEY`. Keep all keys in Cloudflare Worker Secrets.


---

## Android app (GitHub Actions) and Google sign-in

**Build the APK:** push this folder to GitHub, open the **Actions** tab, run **Build Android APK**, then download `SavePoint-debug` from the run. Install `app-debug.apk` on your phone.

**Why sign-in failed before:** the Firebase web sign-in (popup and redirect) cannot work inside an Android WebView. It needs browser storage and a cross-site page that the WebView blocks, which gives the "missing initial state" error. The APK now uses Google's own native sign-in (the `@capacitor-firebase/authentication` plugin) and passes the result to the Firebase web SDK, so your account, cloud sync and Firestore data stay exactly the same. In a normal browser the web sign-in is still used.

**One-time Firebase step (required):** every APK must be signed with the same key, or Google rejects sign-in. This project includes a fixed key (`android/app/debug.keystore`) that every build uses. Add its fingerprints to Firebase:

1. Firebase console, Project settings, **Your apps**, the Android app `com.kentakun21.savepoint`, **Add fingerprint**.
2. Add both:
   - SHA-1: `6C:68:8F:1A:4E:37:28:96:F0:6E:22:22:D6:92:1E:10:E4:4C:AA:E8`
   - SHA-256: `5B:80:AA:07:99:CF:A3:3D:A4:44:6D:6B:1C:3D:FB:7B:27:39:3B:2B:1A:50:F4:06:78:CB:41:32:D8:5C:41:0F`
3. Download the new `google-services.json` and replace `android/app/google-services.json`.
4. Commit, run the workflow again, and install the new APK.

Also confirm Authentication, Sign-in method, **Google** is enabled. The Worker setting `ALLOW_ORIGIN` must allow `https://localhost` (or be `*`), because that is the app's address inside the APK.

**Back button and reopening:** Back closes menus, then the game page, then goes to the previous tab. On Home, the first press shows "Press back again to leave SavePoint", and the second sends the app to the background (it is not closed). When you reopen the app, it returns to the tab you were last on.
