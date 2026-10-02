# Phase 9: performance and PWA audit

## Baseline and evidence

This environment provided repository access and Node.js tooling, but no browser performance trace, Lighthouse run, heap snapshot, or live session against a representative data stream. No timing, memory, FPS, DOM-count, or network-volume numbers are claimed here. Findings below come from direct source and request-path inspection; run the manual scenarios in a browser before setting numeric budgets.

## Findings and changes

- `index.html` linked `css/main.css`, and `style.css` imported it again. The import was removed while preserving the two stylesheet links and their cascade order. Each stylesheet now has one request path.
- Startup awaited a shell loader that fetched its 16 independent templates serially, then fetched the initial view. Shell template requests now run concurrently, mount order is preserved, and the initial view request runs alongside shell loading.
- The browser probe exposed a critical startup failure: the CCTV adapter imported room constants from `/server/sockets/eventRegistry.js`, which the server intentionally blocks from static access. The constants now live in `shared/realtimeRooms.js`; the server registry re-exports the same object to preserve its existing import contract. A browser smoke check then confirmed the app module bridge and dashboard view mount, along with the map preview and offline provenance banner.
- The previous service worker cached most successful GET responses using stale-while-revalidate, with a finite list of API exceptions. That could retain an unlisted API response. Version 7 now handles same-origin `/api/`, `/socket.io/`, non-GET, and authenticated requests network-only. It precaches only the public app shell in a separate cache; same-origin static JS/CSS/image/font files use a bounded runtime cache (120 entries), so eviction cannot remove the offline shell. Map tiles and third-party CDN resources are network-only.
- Offline navigation can display the cached app shell. The shell explicitly reports that operational live data is unavailable. No API response or command is replayed from cache.
- Service worker activation removes prior `omnitraf-sits-*` caches. The v9 cache version is the deployment invalidation mechanism; changing the service worker triggers the browser update check.
- The old `build` script only printed “Build complete.” It now runs real PWA/static validation and explicitly produces no bundle. `npm run lint` remains a Node syntax check, not a full linter.
- Long-task diagnostics now use `PerformanceObserver` only when explicitly enabled with `?diagnostics=1`; count and maximum duration stay local in the diagnostics snapshot and reset/disconnect with diagnostics lifecycle.
- Existing runtime architecture already lazy-mounts views and calls controller `init`/`activate`/`deactivate`; the map and CCTV modules have dedicated animation/lifecycle paths. This audit did not establish their actual frame cost or memory retention in a browser.

## Audited hotspots not changed

- `StateStore.getState()` deep-clones and deep-freezes the complete state. `setState()` clones previous state and emits a snapshot. `subscribeSelector()` serializes selected values with `JSON.stringify` for each state event. These are code-level cost risks, but changing snapshot or selector semantics without profiling could break consumers. Profile representative traffic before replacing them with structural sharing or a comparator contract.
- `src/app.js` statically imports analytics, reporting, map, and CCTV controllers. View HTML and controller activation are lazy, while their JavaScript module graph is not. Splitting the graph needs a cold-load network trace and browser regression coverage.
- `index.html` synchronously loads Leaflet, MarkerCluster, Socket.io, and Google Fonts. Actual blocking and transfer cost were not measured here.
- The existing performance diagnostics report application counters, but this pass did not add FPS or long-task telemetry. Browser support and usefulness should be validated before exposing additional runtime diagnostics.

## Cache and offline contract

Only the application shell and public same-origin static files may be cached. API data, credentials, Socket.io traffic, mutations, map tiles, and third-party responses are not cached. Offline operation provides the shell only; freshness and command availability require a live connection. Reconnect and simulation behavior remain governed by the existing socket and simulation contracts.

## Verification

`npm run validate` / `npm run build` validates the manifest, required shell files, CSS entrypoint uniqueness, and service worker version policy. `npm run lint` checks syntax for its listed modules. `npm test` now runs the existing unit/integration sequence with an isolated SQLite file under the OS temp directory and removes that file afterward. The added Phase 9 unit tests check the cache/CSS policy and concurrent shell template loading. None of these substitutes for the following browser scenarios: cold start, five-minute dashboard session, map/CCTV/analytics switching, repeated reconnect, background/foreground, offline/online, and PWA update. Capture DevTools Performance and Memory traces to establish numeric budgets and compare before/after.
