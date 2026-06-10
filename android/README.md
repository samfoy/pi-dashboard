# PiDash Android

WebView wrapper for pi-dashboard, optimized for e-ink (Boox Palma 2 Pro).

## Features

- Loads pi-dashboard in a full-screen WebView
- JS bridge shim: translates `window.webkit.messageHandlers.*` calls so the existing frontend works unchanged
- File/photo picking via native Android pickers
- Share sheet integration
- Settings screen (server URL + auth token)
- Volume buttons scroll the page (great for one-handed e-ink use)
- E-ink optimizations:
  - CSS animations/transitions suppressed via injected stylesheet
  - No overscroll glow effects
  - High-contrast black/white theme
  - Window transition animations disabled

## Building

Open in Android Studio (File → Open → `android/`) or build from CLI:

```bash
cd android
./gradlew assembleDebug
```

APK lands at `app/build/outputs/apk/debug/app-debug.apk`.

## Deploying to Palma 2 Pro

Connect via USB and enable ADB:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or sideload via the APK file directly on the device.

## First Launch

Tap the ⋮ overflow menu → **Settings** and enter:
- **Server URL**: `http://samuels-macbook-air-1.taile86245.ts.net:7777` (prefilled)
- **Auth Token**: your token if the server requires one

## JS Bridge

The iOS frontend uses `window.webkit.messageHandlers.piX.postMessage(body)`. On page load, PiDash Android injects a shim that routes these to `window.__PiBridge.postMessage(name, json)` (a `@JavascriptInterface` on `PiBridge.kt`).

Handled on Android:
| Handler | Action |
|---|---|
| `piOpenSettings` | Open settings activity |
| `piOpenShare` | Android share sheet |
| `piOpenInSafari` | Open in system browser |
| `piPickMedia` | Image picker |
| `piPickFile` | File picker |
| `piReady` | Web page ready (no-op in v1) |

Silently ignored: `piHaptic`, `piSpeech*`, `piSpeak*`, `piSetActiveSlot`, `piLiveActivity*`
