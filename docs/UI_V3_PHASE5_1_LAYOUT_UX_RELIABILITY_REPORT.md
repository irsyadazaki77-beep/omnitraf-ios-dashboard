# OMNITRAF UI REBUILD V3
## PHASE 5.1 — LAYOUT & UX RELIABILITY REPORT

**Branch:** `main`  
**Latest commit analyzed:** `b7d92ff545be221b784dcc6330b2b794013bb41b`  
**Reference audit:** `b7d92ff545be221b784dcc6330b2b794013bb41b`  
**Delivery state:** local working tree only; no commit or push was requested.

## Executive summary

Phase 5.1 verified the existing V3 views and repaired the contracts between lazy view mounting, CSS display modes, route changes, entity focus, and browser tests. The main runtime defect was a duplicate transition on contextual navigation: changing the hash and directly invoking the view switch could start two transitions, allowing a later transition to take focus from the entity that had just been selected. A modal visibility check also used `aria-hidden` as both input and output, which could leave a newly opened confirmation dialog hidden from assistive technology and inert.

The ViewLoader now changes active state and the `hidden`/`inert`/`aria-hidden` properties without inline `display`. Browser evidence shows the Dashboard computes to `grid`, inactive panes compute to `none`, and there are no stale inline display declarations. A Windows Chromium Playwright gate now runs route, interaction, layout, visual, and accessibility checks against a temporary SQL.js database.

## Phase verification and starting state

The inspected commit was `b7d92ff`, which is later than the earlier `c531cd1` audit. V3 Phase 1 shell/dashboard work, Phase 2 operational workspaces, Phase 3 intelligence/system workspaces, and Phase 4 Playwright infrastructure were present in the starting source. Phase 4 was incomplete at the start: route smoke tests and setup existed, but coverage did not exercise the updated Dashboard selectors, comprehensive interactions, responsive layout, screenshots, or axe checks. This phase filled those gaps rather than replacing the framework.

## Confirmed issues, reproduction, and disposition

| Finding and reproduction | Root cause / affected source | Technical fix | Regression evidence | Final status |
|---|---|---|---|---|
| Open Dashboard and inspect its computed display; navigate away and inspect the hidden pane. The mounted Dashboard could be forced to `block`, overriding its authored grid. | ViewLoader wrote inline `display:block/none` while `css/views/dashboard.css` owns the grid. `src/core/viewLoader.js`, `css/base.css`, `css/views/dashboard.css`. | Use `.active` plus `hidden`, `inert`, and `aria-hidden`; CSS `[hidden]` owns inactive display and the active view keeps its authored Grid/Flex mode. Lazy CSS is awaited before activation and a navigation token rejects stale async mounts. | `tests/e2e/dashboard.spec.js`, `tests/e2e/lifecycle.spec.js`, and the 168 responsive/theme layout measurements in `tests/e2e/visual.spec.js`. Computed Dashboard `display:grid`; inactive panes `display:none`; `inlineViewDisplay:[]`. | PASS |
| Select a contextual Dashboard entity and navigate to its workspace; under a timing race, a later route transition could move focus away from the selected entity. | Contextual link handler set the hash and also called `switchView`, while `hashchange` independently started a second transition. `src/controllers/navigationController.js`, `src/app.js`. | Let `hashchange` be the only transition trigger when the destination hash changes; call `switchView` directly only for a same-route entity selection. Preserve the canonical pending entity request through activation. | Rapid-route lifecycle test; incident/signal/device/emergency interaction tests; emergency test asserts exact selected entity and focus. Full suite caught this race in Desktop Light; the fix then passed Desktop Dark, Desktop Light, Tablet, Mobile, and FullHD. | PASS |
| Open the emergency confirmation after the modal was initialized closed. It could look open while remaining `aria-hidden` and inert. | `isDialogVisible()` rejected `aria-hidden=true` before `syncDialogs()` could update that same attribute. `src/app.js`. | Determine visibility from actual open/display state, then synchronize hidden/inert/ARIA attributes and focus lifecycle. | `tests/e2e/operational.spec.js` asserts the confirmation is exposed, interactive, closes after confirm, and restores focus to the form. | PASS |
| Load Map CSS and return to Dashboard; map widget styles could affect matching Dashboard elements. | Legacy Map selectors escaped the Map view scope. `css/views/map.css`, `css/views/dashboard.css`. | Scope map selectors to the Map view or explicit map widget roots. Preserve targeted Leaflet overrides where library specificity requires them. | Dashboard Map stylesheet contract test, direct Map entry/lazy CSS lifecycle test, plus screenshot sweep. | PASS for covered selectors; manual overlap geometry between every optional overlay remains PARTIAL. |
| Run Dashboard page-object assertions against V3 markup and collapse the sidebar. | Dashboard locator still queried `.metric-card/.kpi-card`; sidebar state was read from the wrong element. | Use `.dashboard-kpi` and stable IDs; read collapsed state from `.app-shell.sidebar-collapsed` and check actual grid geometry/persistence. | `tests/e2e/pages/dashboard.page.js`, `tests/e2e/pages/appShell.page.js`, Dashboard and navigation specs. | PASS |
| Test screenshots after pausing and after prior route/camera interactions. The viewport could be inherited, and a paused-simulation freshness alert could appear between screenshots and shift map geometry. | Shared simulation state and persistent Leaflet instances made screenshot capture order-sensitive. | Use an isolated temporary backend; pause the simulation, wait for the expected stale-data notice, set Dashboard/Map to the documented Surabaya center and zoom, wait for animation frames, then capture. The notice remains visible because it is part of this explicit paused state. | Reviewed 36 Windows Chromium baselines; visual spec passed without snapshot-update mode. | PASS for deterministic local fixture; before/after phase-5.1 paired archive is NOT VERIFIED. |
| Run Playwright CI. | Existing workflow did not run browser tests. | Add a dedicated `windows-latest` Chromium quality-gate job with Node setup, `npm ci`, build, browser installation, isolated SQL.js backend, smoke/interaction/visual/axe runs, and failure artifact upload. | Workflow source inspected; equivalent local full Playwright run passed. | Workflow implemented; remote GitHub Actions execution NOT VERIFIED. |

## Implementation details

### 1. Latest commit and source areas

The starting revision was confirmed with `git rev-parse HEAD`: `b7d92ff545be221b784dcc6330b2b794013bb41b`. Source changes are concentrated in:

- **Lifecycle/navigation:** `src/core/viewLoader.js`, `src/app.js`, `src/controllers/navigationController.js`, `src/controllers/emergencyController.js`.
- **Dashboard/map/runtime:** `src/modules/trafficEngine.js`, `src/modules/mapManager.js`, `public/views/dashboardView.html`, `css/views/dashboard.css`, `css/views/map.css`, and scoped shared/layout styles.
- **CSS consolidation and themes:** `css/base.css`, `css/tokens.css`, `css/shell.css`, `css/experience.css`, `css/components/*`, and affected `css/views/*` modules.
- **Browser infrastructure:** `playwright.config.js`, `scripts/start-e2e-server.mjs`, `server.js` (E2E-only rate limit boundary), page objects and fixtures in `tests/e2e/`, plus `.github/workflows/ci.yml`.
- **Evidence:** 36 reviewed platform-specific screenshots in `tests/e2e/__snapshots__/visual.spec.js-snapshots/`, test output under ignored `test-results/`, and this report.

The test backend stores data in an OS temporary directory and cleans it up on exit. Browser authentication calls the backend login endpoint, verifies the HttpOnly session cookie and `/api/auth/me` role, and then seeds only the display profile. Local browser checks therefore do not treat localStorage as proof of authentication.

### 2. ViewLoader before/after

| State | Before | After |
|---|---|---|
| Activate | `.active` plus inline `display:block` | `.active`, `hidden=false`, `inert=false`, `aria-hidden=false`; stylesheet owns layout |
| Deactivate | Inline `display:none` | `hidden=true`, `inert=true`, `aria-hidden=true`; `[hidden]` computes to `display:none` |
| Async lazy navigation | Existing token guard could still have competing route invocations | Latest navigation token gates style load, mount, activation, and stale completion |
| Dashboard computed style | Could be overwritten to `block` | `grid` in the browser at each tested viewport/theme |

Evidence is emitted in the ignored `phase5-after/layout-metrics.json` artifact: Dashboard uses `grid`, inactive panes use `display:none`, exactly one route pane is active, and `inlineViewDisplay` is empty.

### 3. Dashboard and CSS layout contracts

The Dashboard retains a concise header, conditional critical strip, four KPIs, dominant map with priority queue, activity, and progressive disclosure for advanced controls/search. CSS controls the Dashboard grid; no JavaScript display override is used. Screenshot fixture tests restore the map to `[-7.2756, 112.7424]` at zoom `13` after resizing or previous map interactions. The responsive sweep checks document width, shell bounds, active panes, hidden overlay inertness, and the Map workspace grid.

Map CSS selectors that affected the Dashboard were scoped. The Map stylesheet measured **1,117 lines / 53 `!important` before → 1,089 lines / 51 after** this refinement. Remaining overrides are retained only where Leaflet/library-owned styles need to be controlled; this is not presented as a runtime performance improvement. `css/experience.css` no longer carries the removed view-specific rules; it remains a small adapter for truly shared/dynamic cross-view elements.

### 4. Contextual navigation and interaction coverage

Dashboard priority entities now carry canonical kind/ID metadata. Existing route/hash state carries the pending entity request to the target controller; Emergency also focuses the exact matching canonical `vehicleId`/entity ID and warns if it is no longer present. The race fix prevents duplicate transition and focus-stealing behavior. No new router or state-management system was added.

Playwright coverage now includes:

- All 12 route smoke checks in dark desktop, light desktop, tablet, mobile, and FullHD projects.
- Rapid route selections and direct route entry with lazy CSS and inactive-pane assertions.
- Dashboard KPI count, state, map layout, priority/critical strip, search/filter disclosure, advanced controls, refresh, and map stylesheet isolation.
- Backend invalid/valid login, HttpOnly role verification, Viewer mutation denial, Operator/Admin simulation authorization, and logout invalidation.
- Command palette keyboard search/selection/Escape focus restoration; shell collapse persistence/theme/mobile drawer; operational inspector selection and focus return; Emergency exact entity continuity; Map layer drawer keyboard dismissal; Analytics period action and report CSV export; Settings navigation.
- Axe scans across all 12 pages in both themes. These are automated initial-state checks, not a manual screen-reader certification.

Per-domain browser mutation coverage is intentionally incomplete: every signal override, incident transition, device configuration, integration request, all notification workflows, and session expiry are not individually exercised. Existing unit/integration tests cover backend command contracts and state machines.

### 5. Visual regression and responsive results

`tests/e2e/visual.spec.js` captures all 12 pages in desktop dark and light modes and a dark 390×844 mobile view, for **36 screenshots**. It then measures every route in both themes at **1920×1080, 1440×900, 1366×768, 1280×800, 1024×768, 768×1024, and 390×844** (**168 page/theme/viewport records**). The screenshot fixture uses Chromium with fixed locale/timezone, disabled CSS motion, loaded fonts, isolated seeded simulation, a paused/stale-banner state, and a fixed Map viewport. Baselines were visually reviewed; they are not automatically rewritten on failure.

No global horizontal overflow or shell extending beyond the viewport was found. Dashboard Grid, inactive pane display, duplicate overlay count, and hidden/inert state are asserted. The checks are layout contracts, not a universal rectangle-intersection scanner. Optional inspector-vs-control overlap in every simultaneous overlay combination is therefore **PARTIAL**, not claimed as exhaustively verified.

The original baseline comparison failure exposed two sources of nondeterminism (inherited map center and the pause-state freshness notice). The map fixture was fixed and the screenshots were re-reviewed before the updated images were accepted. No threshold was raised to make the tests pass.

### 6. Map and CSS disposition

The Map retains its Leaflet layer groups, marker clusters, simulation layers, and responsive container. Test coverage opens/closes the full Map layer drawer with keyboard and restores trigger focus, and verifies the Dashboard disclosure is unaffected after Map CSS loads. A complete overlap audit of every open combination of inspector, legend/layer deck, popup, and toolbar at every mobile size is **NOT VERIFIED**; screenshots cover the default closed state and targeted drawer interaction.

`design-v2.css` was already absent at the starting commit and was not recreated. Shared rules were moved from the cross-view experience layer into shell, component, Map, and Dashboard modules. Production bundle measurement after the changes: **Initial CSS 63.4 KiB / 12.7 KiB gzip; Initial JS 255.3 KiB / 74.5 KiB gzip**. This is a build-size measurement only; no route timing, map initialization, CCTV frame time, memory, or layout-shift comparison baseline was available.

### 7. Accessibility and authentication

The axe pass reported no violations for the tested 24 route/theme combinations in the latest browser run. Tests additionally exercise palette keyboard selection and Escape, shell navigation, drawer dismissal, confirmation dialog semantics/focus return, and inspector focus return. Automated axe does not prove all WCAG requirements; touch-target measurement at every breakpoint, manual screen-reader use, and session expiry are outstanding.

Viewer mutation denial and Operator/Admin authorization were exercised against the isolated backend. Authentication uses test-only credentials and no production database; all simulator commands remain on the existing `SIMULATION_ONLY` boundary. PostgreSQL/Redis production integration behavior was not invoked from this local browser environment.

### 8. CI and remaining verification

The new `browser-tests` job is wired to run `npm run test:e2e -- --project=Desktop-Dark` after install/build/Chromium setup. It uploads `test-results/` and `playwright-report/` when a job fails. The existing Linux CI job continues its PostgreSQL and Redis service-backed checks. The workflow definition was inspected locally; it has not been executed by GitHub Actions in this task.

## Required evidence table

| Check | Before | After | Evidence |
|---|---|---|---|
| Dashboard Grid | Inline `display:block` could override Grid | `display:grid` | Computed style in `tests/e2e/visual.spec.js` layout metrics; Dashboard E2E |
| Route lifecycle | Async style/mount transitions could overlap | Latest request token wins; one active pane | `tests/e2e/lifecycle.spec.js`; rapid route test |
| Sidebar state | Page object inspected the wrong element | `.app-shell.sidebar-collapsed` plus real grid/persistence assertions | `tests/e2e/pages/appShell.page.js`, `tests/e2e/navigation.spec.js` |
| Visual regression | Partial/missing baseline coverage | 36 screenshots, reviewed; responsive assertions across 168 records | `tests/e2e/visual.spec.js`, `tests/e2e/__snapshots__/visual.spec.js-snapshots/` |
| Map overlays | Legacy selectors / geometry not consistently verified | Scoped Map CSS; keyboard layer drawer works; all optional overlap combinations remain partial | `tests/e2e/operational.spec.js`, screenshots and layout metrics |
| CI E2E | No browser job | Windows Chromium job with temporary SQL.js server and failure artifacts | `.github/workflows/ci.yml`; local equivalent passed, remote job NOT VERIFIED |

## Validation results

| Command | Result |
|---|---|
| `npm ci` | PASS; completed earlier in this task, no package/lock changes afterward. npm emitted the environment's esbuild postinstall approval warning. |
| `npm run lint` | PASS — syntax checked 186 JavaScript files. |
| `npm run lint:css` | PASS — parsed 24 stylesheets, no exact duplicate declarations. |
| `npm run build` | PASS — Vite production build, 39 hashed assets; 5 feature chunks. |
| `npm run validate` | PASS — production/PWA validation, 39 hashed asset files and 5 feature chunks. |
| `npm test` | PASS — all 31 unit/integration test files. Expected injected-failure tests print error diagnostics while asserting safe failure behavior. |
| `npm run test:e2e` | PASS — 182 passed, 13 intentionally skipped, 0 failed (4.5 min). Skips are redundant project-specific audits or controls that do not apply at that viewport; the designated Desktop Dark project performs cross-theme/cross-breakpoint audits. |
| `npm run test:e2e:smoke` | PASS — 60/60 route checks across five Playwright projects. |
| `npm run test:e2e:visual` | PASS — 1 cross-theme/cross-viewport test passed on Desktop Dark; 4 duplicate project runs skipped by design. |
| `git diff --check` | PASS — only expected Windows LF-to-CRLF working-copy notices were printed. |

### Remaining issues / next phase

- GitHub Actions remote execution and the PostgreSQL/Redis service-backed CI jobs are **NOT VERIFIED** locally.
- Session-expiry behavior, complete per-domain mutation paths, and manual screen-reader review remain open.
- Optional Map overlay overlap combinations and mobile popups are only partially exercised.
- No browser performance baseline exists; no runtime performance improvement is claimed.
- Before/after screenshot pair captured directly from the clean baseline commit was not archived for Phase 5.1. The prior screenshot baselines are reviewed and current snapshots are checked in.

**Recommended next phase:** run the added browser job on GitHub, add a targeted Map overlay geometry test and remaining authorized domain workflows, and collect a repeatable route/map/CCTV performance baseline before making performance claims.
