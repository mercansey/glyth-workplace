# Apple native bridge — contract (scaffold, no native target in this repo)

This repository is a web application. It cannot access HealthKit or EventKit.
Do not fake that access from the browser. When an iOS target is added, it must
implement `native/ios/ProviderContracts.swift` as follows:

## HealthKit (device-mediated, never server OAuth)
1. Request authorization contextually (only sleep, HRV, resting heart rate,
   workouts) via `HKHealthStore` when the user connects Apple Health.
2. Initial sync: limited history import (28 days) of sleep-analysis samples.
3. Incremental sync: `HKObserverQuery` + `HKAnchoredObjectQuery`; persist the
   returned anchor in on-device storage (never on the server); apply added and
   deleted samples.
4. Normalise on device to the canonical sample shape and POST batches to
   `POST /api/ingest/health` with the user's session token. A sleep session's
   `night_date` is the waking day in the user's timezone (server re-derives).
5. The server deduplicates on provider + `source_external_id` and never
   requires Apple credentials.

## EventKit
Request the least access needed (read/full for syncing commitments,
write-only where only writing). Read a rolling window, normalise locally
(title, start, end, attendee count — not private notes/attachments), POST to
`POST /api/ingest/calendar`, resync on `EKEventStoreChanged`.

## Status vocabulary shared with settings UI
Connected / Syncing / Last synced / Permission required / Disconnected / Error,
sourced from `provider_connections` (`state.connections` in the runtime store).
