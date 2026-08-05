# SeaBirds

SeaBirds is an offline-first dive log for Android, Windows and the web. It uses the dedicated `seabirds-threecats-lsp` Firebase project and stores user data at `users/{uid}/seabirds/state`.

## Current features

- Local dive log, statistics, search and unit preferences
- Manual dive entry and UDDF import
- JSON backup export
- Google sign-in and Firestore cross-device synchronization
- Interactive dive profile graph adapted from LSP+ (zoom, pan, crosshair and tooltip)
- Shearwater BLE discovery for Perdix, Perdix AI/2, Teric and related computers
- Installable web app and Capacitor Android project

## Android

Requirements: JDK 21 and Android SDK. Then run:

```powershell
npm install
npm run android:add
npm run android:debug
```

Native Google sign-in also requires the Firebase Android app `com.threecats.seabirds` and its generated `google-services.json` in `android/app/`.

## Website

Publish the folder over HTTPS under `threecats-lsp.com/seabirds/`. Add that domain to Firebase Authentication's authorized domains.

## Shearwater protocol status

BLE discovery uses Shearwater service UUID `FE25C237-0ECE-443C-B0AA-E02033E7029D`. Production log transfer and binary parsing should be provided by a native `libdivecomputer` bridge (LGPL 2.1+) on Android/Windows. The transport is intentionally isolated from the logbook data model so imported profiles use the same UI and sync path.
