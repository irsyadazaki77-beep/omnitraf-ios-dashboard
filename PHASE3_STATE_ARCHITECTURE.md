# Phase 3 frontend state architecture

## State ownership and compatibility

`src/core/stateStore.js` remains the compatibility boundary. Existing controllers still read legacy root keys such as `telemetry`, `intersections`, `incidents`, and `devices`; existing `getState`, `setState`, `setNestedState`, `subscribe`, `publish`, and key event names remain available. `getState()` now returns the current stable state reference. Treat it as read-only and make changes through store mutation APIs. In Node development/test mode the state tree is frozen to catch illegal writes; browser production reads do not traverse or clone the whole tree.

Domain mutation entry points (`updateTraffic`, `updateIntersection`, `updateIncident`, `updateEmergency`, `updateSignal`, `updateDevice`, `updateCctv`, and `updateConnection`) validate domain-owned legacy keys and funnel into the same immutable commit path. `canonical` normalized collections remain the indexed model for intersection, incident, device, and emergency lookup. Legacy arrays remain during this transition to keep map and controller contracts stable.

## Update and subscription flow

Socket events are routed by `RealtimeRouter` to domain helper functions, which commit state once and publish legacy semantic events for consumers that still need them. `ResyncManager` continues to apply an authoritative server snapshot in one state commit before replaying buffered events. `StateStore.batch(fn)` groups synchronous mutations and emits one state/selector notification at the end.

State commits shallow-copy the root and changed object branches. Telemetry partial updates copy only the telemetry branch; entity updates retain references to unrelated entities and patch only the matching normalized `byId` entry. Full resync reconciles legacy entity arrays with the current entities so unchanged entity references survive. Normal selectors use `Object.is`; callers returning a fresh shallow object can pass `shallowEqual` (or another comparator). Selectors record root properties they read, so unrelated commits such as CCTV vision updates skip their selector function entirely.

## CCTV and rendering

CCTV vision state stays under the dedicated `cctvVisionData` compatibility key and uses `emitGeneric: false`; it does not emit the generic full-state event. Domain-specific CCTV subscribers still receive the latest frame. `CctvRealtimeAdapter` keeps only the latest pending visual frame until the next animation frame and cancels pending work on disconnect. The dashboard subscribes to its preview camera room, while the CCTV view subscribes to its named camera rooms rather than the aggregate all-camera room.

`smartUpdateDOM` coalesces writes per element until an animation frame. The pending queue is bounded; overflow drops the oldest visual write and records the coalescing count instead of forcing an early synchronous flush. Canonical state update frequency remains independent from visual repaint frequency.

## Diagnostics and validation

`stateStore.getDiagnostics()` reports rolling state updates and selector callbacks per second, mutation duration, active state/event subscriptions, and per-domain versions. The diagnostics report also records DOM batches and coalesced visual updates per second, plus active timers and socket listeners. `test/unit/state_store_engine.test.js` covers structural sharing, selector isolation, batching, normalized delta behavior, CCTV update stress, and a reproducible 1,000-update local microbenchmark. Benchmark output is an observation for the current test environment, not a performance guarantee.

## Consumer audit summary

- **Traffic, signals, map:** traffic/map/signal controllers continue to use legacy root reads and `state:*`/`traffic:update` events. Signals update only one intersection entity and its canonical `byId` entry.
- **Incidents, emergencies, devices:** their controllers keep the compatibility array API; realtime entity helpers preserve unrelated entity objects and update normalized lookup entries.
- **CCTV:** controller and adapter consume the dedicated vision event and camera state. Vision commits skip generic state notifications and visual callbacks are coalesced.
- **Analytics and reports:** existing consumers read telemetry/state snapshots. Selectors can now narrow those consumers without serialization; full-state reads remain for report generation and forecasting that needs several domains.
- **Connection and UI:** lifecycle and navigation fields remain in the legacy root contract with key-specific compatibility events.
- **Socket/resync:** room management, sequence checks, buffered replay, and server payload contracts are unchanged; snapshots remain atomic.

The legacy flat root, EventBus, and `window.stateStore` / `window.commandLayer` bridges are intentionally transitional. Bridge assignments are marked for compatibility; new modules should use imports. Migrating every controller to domain-specific selectors is a follow-on cleanup; this phase provides the engine and preserves current behavior while reducing clone/comparison work on frequent updates.
