# iOS (Capacitor) — build & integration

Architecture: packaged web UI (`www/`, built by `scripts/build-web.mjs`) +
remote HTTPS backend API. The iOS app never depends on a dev server and no
`server.url` is used in production. Business logic stays server-side.

## Build
```bash
npm install
GLYTH_API_BASE=https://YOUR-HTTPS-BACKEND node scripts/build-web.mjs
npx cap sync ios
# then open ios/App/App.xcworkspace in Xcode (Apple Developer account required)
```
`cap add ios` (once) generates `ios/`; do not hand-edit generated files that
sync overwrites. Custom Swift lives in `ios-native/GlythNative/` — add that
folder to the App target and merge `ios-native/Info-additions.plist` keys and
`ios-native/Glyth.entitlements` into the target (replace YOUR-DOMAIN).

## Native plugin registration
`GlythNativePlugin` (jsName `GlythNative`) implements HealthKit (sleep, HRV,
resting heart rate, workouts; anchored incremental sync, on-device anchors,
background delivery for those types), EventKit (iOS 17 full/write-only access
APIs, 14-day window sync, no notes/attendees uploaded beyond counts), Keychain
secure storage, and capability reporting. `BackgroundSync.swift` provides the
BGAppRefreshTask + durable offline queue (`app.glyth.refresh`).

## Rules
- Health data is PRIVATE_HEALTH; messages PRIVATE_CONVERSATION. Neither ever
  enters employer aggregates.
- Calendar writes only ever follow: proposal -> user confirmation -> native
  mutation -> canonical update -> plan reassembly. Fixed events never move.
- Session tokens that must persist on device belong in Keychain via the
  SecureStorage bridge, never localStorage/Preferences.
- Universal Links: Associated Domains `applinks:YOUR-DOMAIN`; serve the
  apple-app-site-association from that domain. Routes handled: /today,
  /insights, /messages/{thread}, /connect/callback, plus the `glyth` scheme
  for controlled OAuth callbacks.
- ATS: HTTPS only. No global ATS weakening; a localhost exception, if ever
  added for development, must not ship.

## Real-device acceptance (not runnable in CI/sandbox)
Install -> authenticate -> cold restart (session restored) -> Connect Apple
Health -> grant selected types -> sync sleep/HRV/workout -> verify canonical
signals (provenance apple_healthkit) -> Connect Apple Calendar -> sync ->
verify plan -> orchestrate -> push arrives -> deep link opens content ->
Unipile connect -> receive message -> webhook persists -> push -> open
thread -> reply -> provider receives it.
