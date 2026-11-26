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

1. **Pick your app's ID.** Open `mobile/app.json` and change `"bundleIdentifier": "com.example.troonooz"` to something only you would use, such as `com.yourname.troonooz` (letters, numbers, dots, and hyphens).
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

To update the app later, repeat steps 3 and 4 (the build number goes up by itself).

If your troonooz server uses an API token, enter it in the app's Settings. It's kept in the iPhone's Keychain and only sent to that server.

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
