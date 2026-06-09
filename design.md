# Design: Hybrid WKWebView iOS App

## Goal

Replace the ~3,500-line SwiftUI chat/slot-list UI with a WKWebView shell that renders the existing React frontend, while keeping the four native components that genuinely need native APIs: widgets, share extension, App Intents, and notification/background-refresh infrastructure. The result is a ~400-line Swift app that never diverges from the web frontend again.

---

## Approach

The web frontend at `frontend/` already has a working mobile layout (responsive breakpoints, mobile sidebar, bottom nav). The SwiftUI app reimplements the same chat UI in parallel — a maintenance liability that grows with every feature. The hybrid approach makes the web canonical and the Swift app a thin host.

The WKWebView loads `http://<serverBaseURL>/` directly (same Tailscale URL already in `ServerConfig`). Native bridges handle the six things a web page can't do itself: haptics, push token registration, active-slot tracking for notification suppression, deep-link navigation from widgets/notifications, share sheet invocation, and auth token injection.

One key insight: the frontend's `auth.ts` already has a `?token=X` URL-param bootstrap path that strips the token from the URL bar after reading it into memory. This is the natural injection point — Swift loads the URL with `?token=<value>` appended, and the existing JS handles the rest. No new frontend auth code needed.

---

## What gets deleted vs. kept

### Delete entirely (~3,200 lines)
```
apple/PiDash/PiDash/Views/               ← all 29 .swift files
apple/PiDash/PiDash/ViewModels/ChatViewModel.swift       (615 lines)
apple/PiDash/PiDash/ViewModels/SlotListViewModel.swift   (90 lines)
apple/PiDash/PiDash/Networking/APIClient.swift           (509 lines)
apple/PiDash/PiDash/Networking/WebSocketManager.swift    (377 lines)
apple/PiDash/PiDash/Utilities/MarkdownTheme.swift
apple/PiDash/PiDash/Utilities/HapticManager.swift
apple/PiDash/PiDash/Utilities/SpeechService.swift
apple/PiDash/PiDash/Utilities/HealthKitService.swift
apple/PiDash/PiDash/Utilities/CalendarService.swift
apple/PiDash/PiDash/Utilities/RemindersService.swift
apple/PiDash/PiDash/Utilities/ContactsService.swift
apple/PiDash/PiDash/Utilities/LocationService.swift
apple/PiDash/PiDash/Utilities/ThemeManager.swift
apple/PiDash/PiDash/Models/                              ← ChatSlot, ChatMessage, SlashCommand, etc.
```

### Keep unchanged
```
apple/PiDash/PiDashWidget/               ← home screen widget (native, reads ServerConfig)
apple/PiDash/PiDashShare/               ← share extension (native, posts to server)
apple/PiDash/PiDash/Intents/            ← App Intents + Siri shortcuts (IntentNetworking.swift)
apple/PiDash/PiDash/Utilities/LocalNotificationService.swift
apple/PiDash/PiDash/Utilities/BackgroundRefreshService.swift
apple/PiDash/PiDash/Networking/ServerConfig.swift
apple/PiDash/PiDash/Networking/APIModels.swift           ← only if Intents still reference it
```

### Rewrite (new versions, smaller)

| File | Current | New | Notes |
|---|---|---|---|
| `PiDashApp.swift` | 75 lines | ~60 lines | Remove wsManager, ThemeManager; keep BG register + notification categories |
| `RootView.swift` | 50 lines | ~20 lines | Just hosts `WebView` + connection-lost overlay |
| `AppState.swift` | 328 lines | ~60 lines | Only: ServerConfig, LocalNotificationService, pendingDeepLinkKey |

### New files
```
apple/PiDash/PiDash/Views/WebView.swift          (~120 lines)
apple/PiDash/PiDash/Views/SettingsView.swift     (~80 lines, keeps server URL + token config)
```

---

## Public interface

### New `AppState.swift` (~60 lines)
```swift
@MainActor @Observable
final class AppState {
    var serverConfig: ServerConfig        // URL + token storage
    let notificationService: LocalNotificationService
    var pendingDeepLinkKey: String?       // consumed by WebView on appear/change
    var pendingNotificationAction: NotificationAction?  // consumed by WebView

    enum NotificationAction {
        case navigateToSlot(String)       // from notification tap
        case stopSlot(String)             // from "Stop" action button
        case approveSlot(String)          // from "Approve" action button  
        case rejectSlot(String)           // from "Reject" action button
    }
}
```

`wsManager`, `apiClient`, `slots`, `chatViewModels`, `connectionState`, `selectedSlotKey`, `selectedScrollTarget`, `pendingCommands` — all deleted.

### New `WebView.swift` (~120 lines)
```swift
struct WebView: UIViewRepresentable {
    @Environment(AppState.self) var appState
    func makeUIView(context: Context) -> WKWebView
    func updateUIView(_ webView: WKWebView, context: Context)
    func makeCoordinator() -> Coordinator

    class Coordinator: NSObject,
        WKNavigationDelegate,
        WKScriptMessageHandler,
        WKUIDelegate {
        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage)
    }
}
```

WKWebViewConfiguration:
- `allowsInlineMediaPlayback = true`
- `mediaTypesRequiringUserActionForPlayback = []`
- `limitsNavigationsToAppBoundDomains = false` (server is Tailscale, not a known domain)
- User agent suffix: `PiDash-iOS/1.0` (so frontend can detect `navigator.userAgent.includes('PiDash-iOS')`)

Navigation policy: `decidePolicyFor navigationAction` — allow same-host and `pidash://` scheme, open external URLs in `UIApplication.open` (Safari).

---

## JS ↔ Native bridge

### JS → Native (`WKScriptMessageHandler`)

All messages arrive in `Coordinator.userContentController(_:didReceive:)`. Payload is always a JSON object.

| Handler name | Payload | Swift handler | Frontend sender |
|---|---|---|---|
| `piHaptic` | `{ style: "light" \| "medium" \| "heavy" \| "success" \| "warning" \| "error" }` | `WebView.Coordinator` → `UIImpactFeedbackGenerator` / `UINotificationFeedbackGenerator` | New `usePlatformHaptics()` hook |
| `piSetActiveSlot` | `{ slotKey: string \| null }` | Sets `appState.notificationService.activeSlotKey` | `ChatPage` on slot change via `useEffect` |
| `piOpenShare` | `{ text: string, url?: string }` | Presents `UIActivityViewController` | Long-press share in chat |
| `piOpenInSafari` | `{ url: string }` | `UIApplication.shared.open(url)` | External link taps |
| `piRequestNotificationPermission` | `{}` | `appState.notificationService.requestPermission()` | Settings page or first-run prompt |
| `piReady` | `{}` | Triggers pending deep-link / notification action dispatch | `main.tsx` after React mounts |

### Native → JS (`evaluateJavaScript`)

All messages dispatched as `window.dispatchEvent(new CustomEvent('pi-native', { detail: { type, payload } }))`. Frontend registers a single `window.addEventListener('pi-native', handler)`.

| Event type | Payload | Trigger | Frontend consumer |
|---|---|---|---|
| `navigate-slot` | `{ slotKey: string }` | `appState.pendingDeepLinkKey` set (widget tap, notification tap) | `App.tsx` router — navigate to `/chat?slot=<key>` |
| `stop-slot` | `{ slotKey: string }` | Notification "Stop" action button | Chat store — calls `POST /api/chat/slots/:key/stop` |
| `approve-slot` | `{ slotKey: string }` | Notification "Approve" action button | Chat store |
| `reject-slot` | `{ slotKey: string }` | Notification "Reject" action button | Chat store |
| `token-updated` | `{ token: string, baseURL: string }` | Settings saved new token/URL | `auth.ts` — update `_token`, reload page |

---

## Auth token flow

**Mechanism: URL query param on load** (follows existing `auth.ts` path — zero new frontend code).

1. `WebView.makeUIView` builds the URL: `"\(serverConfig.baseURL)/?token=\(serverConfig.token)"` using `URLComponents`.
2. If `token` is empty, loads without the param (open servers work).
3. `auth.ts` `initToken()` already runs at app start, reads `?token=`, stores in module-level `_token`, strips from URL bar, and monkey-patches `fetch` to inject `Authorization: Bearer <token>` on all `/api/` requests. WebSocket connections use `withToken(url)` which appends `?token=`.
4. When the user changes the token in `SettingsView`, Swift dispatches `token-updated` event via `evaluateJavaScript`. Frontend `auth.ts` updates `_token` and the page reloads (`window.location.reload()`).
5. WKWebView data store: use `.nonPersistent()` — no cookies leaking between sessions, token injected fresh on each cold launch.

**Not using**: cookie injection (fragile with Tailscale hostnames), `localStorage` injection (would require relaxing CSP), URLSchemeHandler (unnecessary complexity).

---

## Frontend mobile fixes

### 1. `SubagentDock.tsx` — fullscreen sheet on mobile

**Current**: `fixed z-40` draggable floating card with pixel-based positioning and resize handles. Unusable on a 390pt screen.

**Fix**: Detect mobile with `const isMobile = window.innerWidth < 768` (or a `useMobile()` hook that's already used elsewhere in the codebase). On mobile, render as a full-screen overlay instead of the positioned `div`:

```tsx
if (isMobile) {
  return agents.length === 0 ? null : (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* header + agent list + log — same content, no drag/resize */}
    </div>
  )
}
// existing desktop draggable render below
```

File: `frontend/src/pages/chat/SubagentDock.tsx`, around line 123.

### 2. `DocumentPanel.tsx` — fullscreen overlay on mobile

**Current**: `flex flex-col border-l border-border bg-bg relative` with `style={{ width }}` — a side panel that takes half the screen on mobile.

**Fix**: Add mobile class toggle at the outermost div:

```tsx
<div
  ref={ref}
  className={`flex flex-col border-l border-border bg-bg relative ${
    isMobile ? 'fixed inset-0 z-30' : ''
  }`}
  style={isMobile ? undefined : { width, minWidth: 300 }}
>
```

The drag-resize handle (`absolute left-[-2px]`) should be hidden on mobile (`hidden md:flex`). Close button already exists (`guardedClose`), so mobile gets a full-screen editor with a close button.

File: `frontend/src/components/DocumentPanel.tsx`, line 157.

### 3. Split view guard — disable on mobile

**Current**: Split pane button is shown on mobile (line 748 has no `hidden md:*` guard). On a 390pt screen it renders two 50% columns — illegible.

**Fix**: In `ChatPage.tsx` line ~748, wrap the split button:
```tsx
<button className={`... hidden md:inline-flex ...`} ...>
```
And add an effect guard so `splitSlot` is cleared when viewport goes below `md`:
```tsx
useEffect(() => {
  const mq = window.matchMedia('(max-width: 767px)')
  const handler = (e: MediaQueryListEvent) => { if (e.matches) setSplitSlot(null) }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}, [])
```

File: `frontend/src/pages/ChatPage.tsx`.

### 4. `is-standalone` padding — scope to Electron only

**Current**: `main.tsx` adds `is-standalone` class when `display-mode: standalone` matches, which will fire inside WKWebView (it matches for installed PWAs and fullscreen webviews). This causes the 80px left-padding (`standalone-pad`) to apply to the topbar inside the iOS app, wasting screen space.

**Fix**: Tighten the `is-standalone` condition in `main.tsx` to Electron-only:
```ts
if (
  navigator.userAgent.includes('Electron') ||
  (window as any).piDash
) {
  document.documentElement.classList.add('is-standalone')
}
```
Remove the `display-mode: standalone` and `navigator.standalone` checks. The WKWebView user agent will contain `PiDash-iOS/1.0` so we can add a separate `is-ios-app` class there if needed for safe-area insets.

File: `frontend/src/main.tsx`, lines 11–17.

---

## Failure modes

- **Server unreachable on load**: WKWebView shows its own error page. `RootView` should observe `webView.isLoading` and `didFailProvisionalNavigation` to show a native "Can't connect — check server URL" overlay with a Settings button.
- **Token wrong/expired**: Server returns 401. The web frontend shows an error; `WebView` coordinator should intercept HTTP 401 responses via `decidePolicyFor navigationResponse` and present the native Settings sheet.
- **Deep link arrives before `piReady`**: `pendingDeepLinkKey` set on `AppState`. `WebView.updateUIView` checks for it after every load completion. If JS hasn't fired `piReady` yet, buffer the action and dispatch on receipt of `piReady`.
- **Notification action on cold launch**: App launches into background, action processed before WebView is initialized. `AppState.pendingNotificationAction` holds the action; `WebView` consumes it in `webView(_:didFinish:)` after first load.
- **Settings URL/token change**: Reload the WKWebView with new URL + token param. Existing WKWebView instance can be reused — call `webView.load(newRequest)`. If the URL changed to a different host, clear WKWebView's non-persistent data store (no state to preserve).
- **Rollback**: The SwiftUI views are deleted but the git history preserves them. If the WebView approach has a critical gap, revert is `git checkout <sha> -- apple/PiDash/PiDash/Views/ apple/PiDash/PiDash/ViewModels/ChatViewModel.swift` etc.

---

## Alternatives considered

### Option A: PWA (no native app)
User adds to Home Screen from Safari. No App Store, no widgets, no share extension, no App Intents. Push notifications work on iOS 16.4+ but require a service worker. No background refresh. Loses the App Store install path.

**Rejected**: Loses widgets (high-value), share extension, Siri shortcuts, and the App Store distribution path. Not a viable option for a daily-driver app.

### Option B: Keep SwiftUI, sync features to web
Continue maintaining both surfaces. Add missing features (workflows tab, etc.) to SwiftUI by hand.

**Rejected**: Already diverged significantly. The web frontend gains features faster (7 mobile commits vs. the iOS app missing the entire workflows tab). The divergence compounds.

### Option C (chosen): WKWebView hybrid shell
Swift app owns: notifications, background refresh, widgets, share extension, App Intents. Web owns: all UI. Bridge is a small well-defined message protocol.

**Preferred**: Eliminates the divergence problem permanently. The bridge surface is small (6 JS→Native handlers, 5 Native→JS events). Frontend already has the mobile layout. Auth already has the `?token=` injection path.

---

## Risks

- **WKWebView keyboard handling**: The iOS software keyboard interacts differently with `contenteditable` and `textarea` in WKWebView vs. a native `UITextField`. The chat input uses `<textarea>` — needs testing for autocorrect, predictive text, and input method (emoji keyboard) behavior.
- **Safe area insets**: The frontend uses `env(safe-area-inset-*)` CSS in a few places (bottom nav, topbar). These work in WKWebView but only if the WKWebView's frame extends under the home indicator. Must set `webView.scrollView.contentInsetAdjustmentBehavior = .never` and let CSS handle it.
- **`is-standalone` detection**: Once we suppress it for WKWebView, any CSS that relied on it being set inside the iOS app breaks. The topbar `standalone-pad` class (80px left padding for macOS traffic lights) must not apply in iOS — this fix is captured in mobile fix #4.
- **IntentNetworking model dependencies**: `IntentNetworking.swift` imports `SlotDTO`, `ChatSlot`, `CreateSlotRequest`, `SendMessageRequest` from `APIModels.swift`. These need to stay even after `APIClient.swift` is deleted. `APIModels.swift` should be kept or its relevant types moved to `Intents/`.
- **WKWebView and local HTTP**: Tailscale IPs/hostnames are HTTP, not HTTPS. iOS 14+ App Transport Security (ATS) blocks plain HTTP by default. The existing `Info.plist` likely has `NSAllowsArbitraryLoads` or a domain exception already (the share extension and background fetch make the same calls). Verify before assuming this works.

---

## Implementation sequence

Order matters — each step must be shippable independently.

1. **Frontend fix #4** (`is-standalone` scoped to Electron) — land first, no native changes, safe to ship.
2. **Frontend fix #3** (split pane hidden on mobile) — standalone, no dependencies.
3. **`WebView.swift`** — new file, `WKWebView` setup, `?token=` auth injection, `piReady` handler, deep-link dispatch. At this point the app works but has no native shell — just the webview.
4. **`AppState.swift` rewrite** — strip everything except `serverConfig`, `notificationService`, `pendingDeepLinkKey`, `pendingNotificationAction`.
5. **`RootView.swift` rewrite** — replace `NavigationSplitView` with `WebView` + connection-lost overlay.
6. **`PiDashApp.swift` cleanup** — remove `wsManager` references, `ThemeManager`.
7. **Delete SwiftUI views + ViewModels** — do this after step 6 compiles clean.
8. **Bridge: `piHaptic`, `piSetActiveSlot`** — add JS calls at send-message and slot-switch points in frontend.
9. **Frontend fix #1** (`SubagentDock` fullscreen on mobile).
10. **Frontend fix #2** (`DocumentPanel` fullscreen on mobile).
11. **Bridge: notification actions** (`stop-slot`, `approve-slot`, `reject-slot`) — wire `LocalNotificationService` response handler to dispatch native→JS events.
12. **`SettingsView.swift` rewrite** — keep server URL + token fields, remove model/thinking pickers (those are in the web UI now).

Steps 1–7 are the load-bearing path. Steps 8–12 are polish.

---

## Open questions

- Does `WKWebView` with `.nonPersistent()` data store persist `localStorage`? If not, theme preference and nav-collapsed state reset on every cold launch. May need `.default` store with careful cookie hygiene instead.
- The `pidash://` deep link scheme is registered in `Info.plist` and handled in `PiDashApp.onOpenURL`. After the rewrite, widget taps still set `pendingDeepLinkKey` on `AppState` — the `WebView` dispatches it. Does the widget's `widgetURL` need any changes? Almost certainly not, but confirm.
- `PiDashShare/ShareViewModel.swift` uses `ServerConfig` and its own `URLSession` — no dependency on deleted files. Confirm `APIModels.swift` types it uses (`SlotDTO`, `CreateSlotRequest`) are retained.
- Should the `SettingsView` live natively or in the web? Native is simpler (already has the fields, no bridge needed for a simple URL+token form). The web settings page has more options (model defaults, theme, etc.) — those can stay in web. Two settings surfaces is slightly awkward but acceptable.
