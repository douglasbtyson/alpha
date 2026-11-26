# troonooz for iPhone

The troonooz app shows your checks as a 3D card deck and a 3D evidence map. It talks to your own troonooz server (the one running on your computer), so set that up first: see **Scan your iPhone screen** in the [main README](../README.md).

It's built with [Expo](https://expo.dev) (React Native). You don't need a Mac: Expo's cloud service (EAS) builds the iPhone app and sends it to TestFlight.

## Try it now with Expo Go (free, no Apple account)

This runs the app from your computer, so it's for trying it out. Back Tap can't open it this way (the Shortcut's `troonooz://` links only work in the installed app), but everything else works.

1. On your iPhone, install **Expo Go** from the App Store.
2. On your computer, in PowerShell, from the troonooz folder:
   ```
   cd mobile
   npm.cmd install
   npx.cmd expo start
   ```
3. With your iPhone on the same Wi-Fi as the computer, scan the QR code with the Camera app. troonooz opens in Expo Go.
4. Tap **Settings** and enter your troonooz address (the `https://….ts.net` address from the Phone page), then **Save and test**.

## Install it on your iPhone with TestFlight

You need:
- An **Apple Developer Program** membership ($99 a year): [developer.apple.com/programs](https://developer.apple.com/programs/). Enrolment can take a day or two.
- A free **Expo account**: [expo.dev/signup](https://expo.dev/signup).

Steps, in PowerShell from the troonooz folder:

1. **Your app's ID** is `com.troonooz.app` (`ios.bundleIdentifier` in `mobile/app.json`), and the Expo project ID is already filled in. Apple ties the app to this ID for good, so change it only before your first build, if at all.
2. **Install and sign in:**
   ```
   cd mobile
   npm.cmd install
   npx.cmd eas-cli@latest login
   ```
3. **Build the app in the cloud:**
   ```
   npx.cmd eas-cli@latest build --platform ios --profile production
   ```
   The first time, it asks to create an EAS project (say yes) and to sign in to your Apple account so it can create the certificates the app needs (let it). The build takes about 10–20 minutes; the command shows a link where you can watch it.
4. **Send it to TestFlight:**
   ```
   npx.cmd eas-cli@latest submit --platform ios --latest
   ```
   This uploads the build to App Store Connect, creating the app there if needed. Apple then processes it (usually 10–30 minutes) and emails you.
5. **Install it:** on your iPhone, install **TestFlight** from the App Store. In [App Store Connect](https://appstoreconnect.apple.com) → your app → **TestFlight**, add yourself under **Internal Testing**. Open the invitation on your iPhone and tap **Install**.
6. **Point your Shortcut at the app:** in the Shortcuts app, open **Check with troonooz**, and in **Get Dictionary Value** change the key from `open_url` to `app_url`. Now Back Tap opens checks in troonooz. The first one also tells the app your server's address.

To update the app later, repeat steps 3 and 4 (the build number goes up by itself), or set up automatic builds below.

If your troonooz server uses an API token, enter it in the app's Settings. It's kept in the iPhone's Keychain and only sent to that server.

## Automatic TestFlight builds

Once the app is on TestFlight, Expo can build and send every new version by itself: when a change to the app (anything in `mobile/`) is pushed to GitHub, Expo builds it in the cloud and sends it to TestFlight, and the TestFlight app on your iPhone offers the update. Changes that only touch the server don't start a build, so they don't use up your builds. The workflow is `.eas/workflows/testflight.yml`.

One-time setup:

1. **App details in the repository:** done. The app ID and the Expo project ID are in `mobile/app.json`, so Expo's builds from GitHub use them too.
2. **Do the first build and submission by hand** (steps 3 and 4 above). This stores the signing certificates, and the App Store Connect API key that `eas submit` offers to create, on Expo's servers, so later builds need nobody at the keyboard. Let `eas submit` create the API key when it asks.
3. **Add the App Store Connect app number.** In [App Store Connect](https://appstoreconnect.apple.com) → your app → **App Information**, copy the **Apple ID** (a number). Ask Claude to add it to `mobile/eas.json` as `ascAppId`, so submissions never need to ask which app.
4. **Connect GitHub to Expo.** On [expo.dev](https://expo.dev) → your project → **Project settings** → **GitHub**, connect the repository, and set the **base directory** to `mobile`.

After that, you don't need to run anything. To build without a change (for example, to retry a failed build), open your project's **Workflows** page on expo.dev and run **Send to TestFlight**, or run `npx.cmd eas-cli@latest workflow:run .eas/workflows/testflight.yml` from the `mobile` folder.

Each run uses one of your plan's iPhone builds (15 a month on Expo's Free plan). If pushes to `mobile/` don't start a build, run it by hand as above and ask Claude to check the workflow's trigger.

## How it's put together

| Path | What it is |
|---|---|
| `src/app/` | Screens (Expo Router): `index.tsx` (home and recent checks), `report/[id].tsx` (progress, then the report), `settings.tsx` |
| `src/components/CardDeck.tsx` | The 3D card carousel |
| `src/components/ReportCards.tsx` | What goes on each card (the verdict card flips over) |
| `src/components/EvidenceMap.tsx` | The 3D evidence map: drag to spin, tap to fly to a finding |
| `src/lib/graph.ts` | Turns a report into the map's nodes and links, and lays them out in 3D |
| `src/lib/projection.ts` | The 3D maths: rotation, perspective, tap hit-testing |
| `src/lib/api.ts`, `useCheck.ts` | Talking to the server; following a check until its report is ready |
| `src/lib/settings.tsx`, `server.ts` | The server address (per-server tokens in the Keychain), view and mode preferences |

The map is drawn with ordinary views and real 3D maths (rotation and perspective projection), not WebGL, so it runs the same everywhere and its labels stay sharp.

A link like `troonooz://report/<id>?server=https://…` opens a check. If the app has no server yet it uses that one; if it already has a different one, it asks before switching, so a link from someone else can't quietly redirect your checks.

```
npm test            # unit tests: 3D maths, map layout (on the server's sample reports), server address handling, progress steps
npm run typecheck
npm run export:web  # a browser build, used for screenshot checks
```
