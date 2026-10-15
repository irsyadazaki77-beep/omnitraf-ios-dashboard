# Fase 22 — Performance and Smoothness

## Scope and baseline

- Audited `HEAD` `ec861fb` on 2026-10-14; `origin/HEAD` resolved to the same commit.
- The checkout already contained extensive uncommitted Fase 21 changes. Those changes were preserved; numbers below compare the working tree before and after this phase's edits.
- Browser run: Playwright Desktop Chrome, 1440×900, headless Windows. WebGL identified itself as ANGLE/Vulkan SwiftShader. This is software rendering, so it is not a proxy for a physical GPU.
- Before values came from a single 3.2-second-per-scenario run. After values came from the same harness, plus signals/analytics, a rush-hour model comparison, and five forced-GC Map↔City3D cycles. RAF p95 is the browser page's frame interval, not City3D's render-only frame time.

| Scenario | Before | After | Reading |
| --- | --- | --- | --- |
| Dashboard idle | 59.4 RAF fps; p95 18.1 ms; max 22.8 ms; 1 long task / 65 ms | 60.3 fps; p95 18.0 ms; max 19.7 ms; no long task in window | Similar cadence; one-run p95 delta is too small to attribute. |
| CCTV, one camera | 60 fps; p95 18.3 ms; Canvas render 0.6 ms / p95 1.0 ms | 60 fps; p95 18.0 ms; Canvas render 1.1 ms / p95 1.1 ms | Visually smooth; render-time noise shows no measured speedup. |
| CCTV, 2×2 | 60 fps; p95 18.0 ms; per-camera render 0.3–0.5 ms | 60 fps; p95 18.3 ms; per-camera render 0.3–0.4 ms | Four cameras remained at 60 fps; render cost is low and roughly unchanged. |
| City3D, isometric | 59.7 page RAF fps; p95 26.5 ms; CPU 0.5 ms; 28 draw calls; 7,064 triangles; GPU timer unavailable | 60 page RAF fps; p95 21.2 ms; City3D reported 23 fps; CPU 0.5 ms; 28 calls; 7,184 triangles; GPU timer unavailable | Page p95 was 20% lower in this run, but one sample cannot establish causality. Software WebGL remained below the 30 fps target. |
| City3D virtual camera | 60 page RAF fps; p95 21.5 ms; CPU 0.8 ms; 25 calls; adaptive scale 0.59 | 60 page RAF fps; p95 18.8 ms; City3D reported 22 fps; CPU 0.6 ms; 25 calls; adaptive scale 0.59 | No GPU-time measurement; do not infer a device-GPU improvement. |
| Signals / Analytics idle | Not measured before | 60 page RAF fps; p95 18.6 / 18.6 ms | Post-change smoke profile only. |
| Rush-hour model comparison | Not measured before | HTTP 200; 20 ms; modeled demand 13,648 → 19,792 veh/h | Scenario Lab comparison workload; it does not mutate live simulation state. |
| Repeated Map↔City3D (five cycles) | Not measured before | 370–404 ms per round trip; retained heap 9.53 → 10.55 MB after forced GC | About +1.02 MB after five cycles; short sample does not show a plateau, so long-session heap growth remains open. |

CDP reported after-run script time of 183 ms over a 3.2-second one-camera window and 346 ms over the 2×2 window. There is no comparable before CDP sample. Playwright's old `performance.memory` field was constant and was excluded; post-run heap values above use Chromium CDP after forced GC.

## Root causes addressed

- The committed City3D implementation used an O(N²) nearest-lead scan, `indexOf` per vehicle, and route filtering on each route completion. The checked-out Fase 21 working tree had already replaced that autonomous stream with CCTV-sourced vehicles and removed the old tick loop. Fase 22 keeps that authoritative shared stream and adds a linear visual interpolation tick; node-to-edge adjacency and ID maps replace repeated scans.
- `syncCctvVehicles()` previously rebuilt all camera vehicle lists and filtered the entire edge list for each camera update. It now processes only changed camera frames, uses cached camera routes, groups vehicles in one pass, reuses Three.js colors, and drops visual state for expired IDs.
- City3D resume could remain stopped because `pause()` left a nonzero RAF handle. It now clears timing/handle state. Quality adaptation uses the selected 30 fps target with hysteresis, and GPU timer queries are cleaned up on disposal.
- CCTV work repeated intersection-map construction, environment reads/sets, locale timestamp formatting, and p95 sorting every render. It now reuses camera/state buffers, updates environment only when it changes, formats the OSD timestamp once per second, reuses vehicle-position records and duration storage, and computes p95 once per second. Rain streaks and signal lamp definitions are cached.
- CCTV's backing scene was already cached and hidden canvases already skipped by the Fase 21 working tree. Fase 22 retains both behaviors.
- The vision engine repeated corridor/intersection searches and active-incident/emergency filtering for each camera. It now builds per-frame lookup tables and filters shared active state once.

## Files changed in Fase 22

- `src/modules/city3dScene.js`
- `src/modules/cctv/canvasRenderer.js`
- `src/modules/cctvController.js`
- `server/services/visionEngine.js`

## Backend and measurement limits

- Local profile environment had no `DATABASE_URL`, `DB_DRIVER`, or `REDIS_URL`; PostgreSQL query latency and Redis overhead could not be measured. The exercised local service used its test backend.
- Socket.IO's configured traffic tick is 1 second and CCTV vision tick is 300 ms (about 3.33 aggregate frames/s). Existing aggregate, per-camera detection, and health channels were retained because removing any without a subscriber-contract change risks breaking CCTV and City3D synchronization. No broadcast reduction is claimed.
- GPU timer extension was unavailable; the browser reported SwiftShader. CPU figures shown in the City3D UI measure JavaScript submission time, not GPU completion.
- The rush-hour run exercised Scenario Lab's isolated deterministic comparison. It did not alter authoritative live state, RBAC, idempotency, or the `SIMULATION_ONLY` boundary.
- No permanent graphics-quality downgrade was introduced. Adaptive resolution stays within the user's selected Low, Balanced, or High ceiling.

## Verification

- `npm run lint`: passed (208 JavaScript files).
- `npm run build`: passed; initial JS 268.4 KiB (78.4 KiB gzip), initial CSS 63.6 KiB (12.8 KiB gzip).
- `npm test`: all 39 unit/integration test files passed, including deterministic simulation, CCTV pipeline, and lifecycle coverage.
- Playwright full matrix: 238 passed, 21 project skips, and one initial failure at the `view-cctv-dark-mobile` visual snapshot while the isolated simulation was paused. The visual audit passed on immediate isolated retry (44 seconds). This was a transient feed/stale-state capture, not a stable pixel regression.
- After the final pause/resume timing reset, the focused City3D operational E2E cases passed (2/2), and lint/build passed again.
- The Fase 22 browser profile passed, including one-camera/grid CCTV, City3D and virtual camera, rush-hour comparison, signals/analytics idle, and five Map↔City3D lifecycle cycles.
