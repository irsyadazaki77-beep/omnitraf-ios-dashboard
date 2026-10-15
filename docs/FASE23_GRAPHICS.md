# Fase 23 — Next-Generation Graphics and Visual Realism

## Audit and scope

- Audited repository HEAD on 2026-10-14. Local `HEAD` and `origin/HEAD` both resolve to `ec861fb39e941d76124ed25ed5c30eecd62a90a7`.
- The checkout already contained uncommitted Fase 21/22 implementation and artifacts. They were retained; Fase 23 changes build on the checked-out state, so this is not a clean-commit-only comparison.
- Existing Fase 22 work was reviewed in `docs/FASE22_PERFORMANCE.md`: CCTV vehicles still come from the authoritative simulation frame, City3D keeps instanced city/traffic meshes, view lifecycle cleanup, LOD/quality profiles, and GPU timer cleanup. No second traffic engine was introduced.

## Visual work

- City3D traffic now uses instanced low-poly vehicle parts (body, cabin/glazing, wheels, lights, and contact shadow) keyed from the existing CCTV detection IDs. Buildings receive deterministic facade-window detail; roads, lane markings, crosswalks, street furniture, trees, and intersections receive more shape and material detail while retaining instancing.
- Low/Balanced/High profiles control render scale and fine detail. Adaptive quality uses measured frame cadence and rolling p95 with a four-second hysteresis interval. These presentation settings do not change simulation inputs or outputs.
- CCTV gained restrained wet-road glints under tracked vehicles, night light beams, subtle sensor texture/compression blocks, and consistent exposure/color treatment. Camera-specific synthetic scenes remain in place for Wonokromo, Darmo, Waru, and Jemursari; no static video assets were added.
- `visualEnvironment` carries presentation time-of-day and weather through the shared state store. CCTV controls and simulation rain state update it; CCTV and City3D both read it to set their lighting, rain, and wet-road materials. Traffic, signal, incident, and vehicle track state remain authoritative in the existing simulation store.
- CCTV controls wrap responsively. Its display options occupy a dedicated row so they do not cover the primary camera view.

## Screenshots

Before screenshots were captured from the existing app before Fase 23 edits; after screenshots come from the Fase 23 E2E captures. The scene is synthetic and deliberately low-poly, not a photoreal reconstruction.

| View | Before | After |
| --- | --- | --- |
| CCTV | [`before/cctv.png`](../artifacts/phase23/before/cctv.png) | [`after/cctv.png`](../artifacts/phase23/after/cctv.png) |
| Digital Twin 3D | [`before/city3d.png`](../artifacts/phase23/before/city3d.png) | [`after/city3d.png`](../artifacts/phase23/after/city3d.png) |

Weather proof: [`CCTV night / heavy rain`](../artifacts/phase23/e2e-cctv-capture/camera-04-night-rain.png), [`CCTV evening / light rain`](../artifacts/phase23/e2e-cctv-capture/camera-04-evening-light-rain.png). Per-camera images and raw metrics are in `artifacts/phase23/e2e-cctv-capture/`.

## Measured results and limits

- Playwright CCTV capture under concurrent browser/E2E load: the displayed renderer cadence was 3 FPS for both one-camera and 2×2 captures. Canvas render submissions were 2.2–3.0 ms (single) / p95 4.5–18.7 ms, and 1.8–2.9 ms per canvas (2×2) / p95 3.7–10.1 ms. Backing sizes were 647×363 (single) and 307×172 (each grid tile). A Chromium DevTools Protocol forced-GC sample reported 5,234,220 bytes V8 heap used (6,168,576 bytes heap capacity). This is JavaScript heap only; it excludes GPU allocations and does not describe total process memory. The page's `performance.memory` field was constant at 10,000,000 bytes and was excluded.
- A concurrent City3D UI capture reported 9 FPS, CPU submission time 1.0 ms, frame p95 100.0 ms, 35 draw calls, and GPU timing `n/a`. Chromium DevTools Protocol reported 7,618,352 bytes V8 heap used after forced GC (9,052,160 bytes heap capacity); the page's `performance.memory` value was constant at 14,300,000 bytes and excluded. Browser logs identified SwiftShader software WebGL and the host had other Playwright suites active. These observations show a stressed software-rendering run; they do not establish a hardware-GPU baseline or a speed improvement.
- GPU utilization and GPU memory were unavailable. The current benchmark does not establish adaptive-quality convergence on physical devices; it verifies that quality presets can be switched and reports the measured cadence in the UI.

## Verification

- `npm run lint`: passed, syntax checked 216 JavaScript files.
- `npm run lint:css`: passed, 25 stylesheets.
- `npm run build`: passed. Initial JS 272.7 KiB / 79.7 KiB gzip; initial CSS 63.6 KiB / 12.8 KiB gzip. The previous Fase 22 report lists 268.4 KiB / 78.4 KiB for initial JS; this graphics work adds about 4.3 KiB raw (1.3 KiB gzip) to the initial JS bundle in this build.
- `npm test`: all 40 unit/integration test files passed.
- Focused City3D operational E2E: 3 passed (camera controls / Map return, shared CCTV frame IDs / partial update, WebGL fallback). This was run before the final screenshot-output path change; the path-only change is covered by the next E2E run.
- Focused CCTV E2E: passed (1/1) on 2026-10-14. It covers four camera feeds, single/grid view, overlay-off feed visibility, shared environment changes, night/heavy rain and evening/light rain captures, pause/resume, snapshot download, and fullscreen close.
- Focused City3D operational E2E: in progress. It covers the four time-of-day × four weather combinations, Low/Balanced/High selection, virtual camera, shared CCTV track IDs/partial frames, fallback, Map return, screenshot capture, and forced-GC heap measurement.
- Full Playwright matrix was not run to completion in this phase. Other long-running Playwright suites were already active on the machine and caused load contention; all phase-specific browser runs used their own ports and result directories.

## SIMULATION_ONLY boundary

All visual vehicles, weather, time-of-day, signals, incidents, and camera detections remain simulation-derived. Added lighting and rain treatment change pixels only. No operational device command path or external feed was added.
