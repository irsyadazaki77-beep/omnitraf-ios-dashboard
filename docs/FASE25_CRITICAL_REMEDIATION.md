# FASE 25 — Critical Remediation and Integrity Audit

Tanggal: 14 Oktober 2026

## Baseline dan kondisi checkout

- HEAD lokal dan `origin/HEAD` saat audit: `ec861fb39e941d76124ed25ed5c30eecd62a90a7` (`feat: implement City3D digital twin, operator experience improvements, and Phase 10 audit`). `git ls-remote origin HEAD` mengonfirmasi SHA yang sama.
- Checkout sudah berisi perubahan lokal FASE sebelumnya sebelum pekerjaan ini dimulai. Perubahan tersebut tidak di-reset; screenshot historis dan baseline visual tidak diperbarui.
- Screenshot City3D hitam dari Phase 15 dipertahankan sebagai bukti before. Screenshot after diambil dari Chromium/WebGL2 pada source final.

## P0 — City3D graphics integrity

### Temuan dan penyebab

`artifacts/phase15-city3d-after.png` memperlihatkan poligon hitam lebar pada scene. Penyebab yang dilaporkan—`InstancedMesh` berkapasitas 180 tetapi count menjadi 184—merupakan pelanggaran batas buffer yang dapat membuat renderer membaca transform instance di luar alokasi. Pada source yang tersedia di checkout saat audit, loop gedung sudah memiliki guard, sehingga nilai 184 tidak dapat direproduksi langsung dari HEAD/working tree. Menjalankan kembali rumus grid dan seed yang sama menghasilkan 246 kandidat; alokasi saat ini tetap dibatasi ke 180 instance aktif. Karena guard telah hadir sebelum FASE 25, bukti yang ada tidak cukup untuk mengisolasi penyebab historis poligon hitam secara eksklusif ke overflow.

Scene sebelumnya juga membentuk koneksi antar simpang dari dua tetangga terdekat. Itu bisa menggambar hubungan jalan sintetis yang tidak ada di topologi data; hubungan palsu ini diganti dengan daftar edge eksplisit, tervalidasi, dan terhubung.

### Perbaikan dan bukti

- Guard gedung memakai kapasitas `instanceMatrix.count`; nilai `buildings.count` dibatasi ulang sebelum render.
- `validateCity3DScene` memeriksa seluruh geometri: atribut buffer finite, indeks vertex, draw range, material/color, kapasitas `InstancedMesh`, instance color, dan setiap elemen transform aktif. Transform kendaraan juga divalidasi setiap frame CCTV baru.
- Lifecycle context loss menghentikan RAF, menampilkan fallback, lalu saat pulih menandai ulang atribut/material, mengukur ulang viewport, dan melanjutkan render. Disposal deduplikasi geometri/material dan membersihkan query GPU.
- Regression test membuktikan count 184 ditolak pada kapasitas 180, serta transform NaN, indeks di luar buffer, draw range invalid, dan topologi tidak valid ditolak.
- Regression test memastikan feed Waru memakai koordinat/anchor eksplisit, bukan implicit simpang pertama.
- Browser Chromium: screenshot before memperlihatkan poligon hitam; screenshot after tidak memperlihatkannya. `WebGL2=true`, `gl.getError()=NO_ERROR`, tidak ada `pageerror`/console error; kehilangan dan pemulihan context lulus.

| Bukti visual | File |
| --- | --- |
| City3D before, screenshot historis Phase 15 | [`city3d-phase15.png`](../artifacts/fase25/before/city3d-phase15.png) |
| City3D after, Chromium/WebGL2 | [`city3d.png`](../artifacts/fase25/after/city3d.png) |
| Map 2D after, empat kamera dari registry CCTV bersama | [`map-cameras.png`](../artifacts/fase25/after/map-cameras.png) |

## P1 — Simulasi, lokasi, dan adaptive quality

- **Sumber kendaraan:** CCTV tetap memakai `TrafficVehicleSimulation` bersama. City3D mengonsumsi detection IDs, progress, direction, speed, sequence, dan timestamp dari frame CCTV; tidak ada simulation engine kedua. `visionEngine` memakai simulation clock dan tick tetap 0,3 detik. `performance.now()` di City3D sekarang hanya mengukur waktu submission CPU, bukan keputusan gerak.
- **Tick vs render:** state kendaraan disimulasikan di tick server; City3D hanya menginterpolasi pose saat render. Ini menjaga render FPS tidak menentukan jarak tempuh simulasi.
- **Kendaraan terdekat:** car-following mengelompokkan kendaraan aktif menurut lajur/arah dan mengurutkannya sekali per kamera/tick, mengganti pencarian leader berulang O(N²) dengan O(N log N).
- **Signal, incident, weather, emergency:** frame CCTV dan City3D membaca snapshot state yang sama. Cuaca mengubah visual dan state jalan; insiden memengaruhi kecepatan/lajur kendaraan dan marker; fase sinyal yang dipakai kendaraan/lamps juga merupakan state yang sama. Emergency menggunakan signal preemption yang sudah ada. Tidak dibuat engine baru.
- **Jaringan jalan:** `city3dTopology.js` mengganti sambungan simpang terdekat dengan edge ID eksplisit. Validator menolak endpoint tak dikenal, self-link, duplikasi, dan node yang tidak tersambung.
- **Identitas kamera lintas workspace:** Map 2D sebelumnya mengambil empat kamera GeoJSON statis dan menebak ID feed lewat pencocokan substring nama. CCTV memakai `cctvCanvas1`–`cctvCanvas4`, sehingga sebagian marker tidak terkait feed dan beberapa kamera berada di lokasi berbeda. Koordinat empat feed sekarang menjadi metadata `CAMERA_DEFINITIONS`; Map 2D membangun fitur dari ID dan koordinat itu langsung. Popup tidak menampilkan kecepatan angka statis yang tidak dihitung.
- **CCTV Waru:** audit akhir menemukan feed tanpa `nodeId` jatuh ke simpang pertama di City3D. Feed sekarang memakai koordinat kamera Waru yang eksplisit dan anchor rute Jemursari; marker camera ID berasal dari registry virtual CCTV yang sama, tanpa fallback ke node pertama.
- **Lokasi entity:** insiden/perangkat tanpa koordinat valid, alias lokasi yang dikenali, atau node ID tidak lagi dipindah ke simpang pertama. Marker tersebut ditahan dan status “lokasi belum dipetakan” terlihat pada City3D. Koordinat dan entity yang dikenali tetap memakai proyeksi Surabaya yang sama.
- **Adaptive quality:** resolusi turun saat FPS/kerja render melewati budget. Pemulihan kualitas membandingkan CPU/GPU submission time dan FPS target; p95 frame-time yang selalu setidaknya sebesar frame limiter 30 FPS tidak lagi menjadi syarat pemulihan yang mustahil.
- **Layout:** kolom inspector tidak lagi dibiarkan kosong ketika inspector hidden. Perilaku keyboard dan responsive workspace tercakup dalam full E2E.

### Benchmark browser

Capture Chromium mencatat p95 frame-time, waktu submission CPU, renderer draw/memory counters, FPS, dan heap. Timer GPU tidak tersedia di browser/driver ini. Full E2E berjalan saat beberapa proses browser dan test lain juga aktif, sehingga nilai ini adalah observasi host tersebut, bukan benchmark hardware terisolasi.

| Ukuran | Hasil FASE 25 |
| --- | ---: |
| FPS pada City3D E2E (project viewport yang tersedia) | 9–15 FPS |
| p95 frame-time | 83,3–100,0 ms |
| CPU render submission | 0,7–1,2 ms/frame |
| GPU timer | tidak tersedia |
| draw calls / geometri / tekstur | 31–35 / 32–35 / 1–3 |
| JS heap setelah forced GC, full E2E | 7,71–7,82 MB |
| Siklus Map↔City3D setelah warm-up | 3; geometri/tekstur renderer stabil 34/1 |
| Heap forced-GC sebelum/sesudah 3 siklus | 8,97 → 9,37 MB (+0,39 MB) |

Angka siklus adalah sampel pendek dan masih menunjukkan sekitar 455 KB retained JS heap setelah tiga pergantian route; tidak cukup untuk menyatakan tidak ada kebocoran atau menghitung tren jangka panjang. GPU utilization/memory tidak tersedia. Observasi FPS 8–15 juga belum memenuhi target visual 30 FPS pada host ini, meskipun jalur adaptive quality dapat memulihkan skala berdasarkan test logika. Pembanding FASE 23 mencatat 9 FPS/p95 100 ms dalam software-rendered browser yang juga sibuk; skenario/viewport tidak identik, jadi tidak diklaim sebagai peningkatan terukur.

Benchmark mentah: [`benchmark-browser.json`](../artifacts/fase25/benchmark-browser.json), [`benchmark-lifecycle.json`](../artifacts/fase25/benchmark-lifecycle.json).

## P2 — Workspace dan analytics

- Screenshot CCTV after tersedia di [`cctv.png`](../artifacts/fase25/after/cctv.png); before historis ada di [`cctv-phase23.png`](../artifacts/fase25/before/cctv-phase23.png). Screenshot Map 2D setelah sinkronisasi kamera ada di [`map-cameras.png`](../artifacts/fase25/after/map-cameras.png).
- Regression test memastikan empat marker Map 2D memakai ID serta koordinat feed CCTV yang sama, termasuk kamera Waru.
- Full responsive E2E untuk Desktop-Dark, Desktop-Light, Tablet, Mobile, dan FullHD lulus pemeriksaan seluruh workspace dan navigasi. Screenshot snapshot City3D lama berbeda setelah topologi/layout berubah; snapshot sengaja tidak diperbarui sesuai aturan FASE 25.
- Prediction/Scenario Lab yang sudah ada menjelaskan bahwa hasil adalah model agregat deterministik, bukan prediksi dunia nyata. Forecast memakai `SIMULATED`; confidence/completeness yang belum tersedia tetap `null`. ScenarioRegistry/Runner mempertahankan seed, start time, horizon/duration, payload terurut, checkpoint, pause/reset, dan provenance. Tidak dibuat Scenario Lab kedua dan tidak diubah formula/seed/horizon dalam audit ini.

## Backend dan keamanan

Tidak ada perubahan backend/security pada delta FASE 25. Audit test lokal mencakup hydration fail-closed, recovery/checkpoint, ordering/reconnect, idempotency, RBAC, JWT issuer/audience/signature/expiry/revocation, serta command state machine; semuanya lulus pada `npm test`. PostgreSQL dan Redis tetap menjadi konfigurasi target; tidak ada perubahan pada `SIMULATION_ONLY`.

## File yang diubah untuk remediasi FASE 25

- `src/modules/city3dScene.js`
- `src/modules/city3dValidation.js`
- `src/modules/city3dTopology.js`
- `src/modules/city3dController.js`
- `src/modules/cctv/cameraRegistry.js`
- `src/modules/mapManager.js`
- `shared/trafficVehicleSimulation.js`
- `public/views/city3dView.html`
- `css/views/city3d.css`
- `test/unit/city3d_integrity.test.js`
- `tests/e2e/city3d-integrity.spec.js`
- `docs/FASE25_CRITICAL_REMEDIATION.md`
- Bukti: `artifacts/fase25/before/`, `artifacts/fase25/after/`, dan file benchmark JSON.

Perubahan lokal yang sudah ada sebelum audit—termasuk `server/services/visionEngine.js`, `src/modules/trafficModel.js`, state manager, CCTV, dan test FASE sebelumnya—dipertahankan dan diperiksa melalui test; daftar ini tidak mengklaim ulang perubahan terdahulu sebagai pekerjaan FASE 25.

## Hasil validasi

| Perintah | Hasil |
| --- | --- |
| `npm run lint` | **PASS** — syntax check 213 file JavaScript |
| `npm run lint:css` | **PASS** — 25 stylesheet |
| `npm run build` | **PASS** — Vite production build; initial JS 272,8 KiB / 79,7 KiB gzip; CSS 63,6 KiB / 12,8 KiB gzip |
| `npm run validate` | **PASS** — 46 hashed asset files, 5 feature chunks |
| `npm test` | **PASS** — 41 unit/integration test files |
| `npm run test:e2e` | **FAIL, 239 PASS / 25 SKIPPED / 1 FAIL dari 265**; dijalankan sesudah perbaikan mapping kamera final |
| Focused City3D WebGL2/context-loss E2E | **PASS** — 1/1; mencakup pemulihan context, screenshot Map/City3D/CCTV, dan 3 siklus route |
| `npm run test:postgres` | **SKIPPED / NOT VERIFIED** — `DATABASE_URL` tidak tersedia |
| `npm run test:cluster` | **SKIPPED / NOT VERIFIED** — `DATABASE_URL` dan `REDIS_URL` tidak tersedia |
| `git diff --check` | **PASS** — tidak ada whitespace error |

Full E2E menyisakan satu kegagalan yang tidak disembunyikan:

1. Visual snapshot suite melaporkan diff 19% pada `view-city3d-light-desktop.png` karena scene/topologi dan lebar stage berubah. Snapshot tidak diperbarui; capture after baru tersedia terpisah.

CCTV visual suite yang sebelumnya timeout pada run lama lulus pada full E2E final (3 menit). Perubahan screenshot evidence Map setelah full suite diuji lagi dengan focused E2E yang lulus.

## Risiko dan blocker tersisa

- Poligon hitam historis tidak dapat direproduksi pada checkout HEAD karena guard kapasitas sudah ada sebelum remediasi ini. Setelah perubahan, browser proof bersih, tetapi atribusi eksklusif penyebab historis tetap belum terverifikasi.
- FPS di browser host masih 8–15 dengan GPU timer n/a; target 30 FPS belum terbukti pada perangkat GPU nyata.
- Heap forced-GC bertambah sekitar 395 KB pada tiga route cycle setelah warm-up; perlu benchmark lebih panjang untuk mengukur tren retensi.
- Integrasi PostgreSQL/Redis belum dapat diverifikasi tanpa endpoint/service environment yang sesuai.
- Satu kegagalan snapshot visual full E2E tetap tercatat dan tidak diklaim lulus.

## Tindak lanjut remediasi audit — 16 Oktober 2026

Catatan ini memperbarui status implementasi dan verifikasi lokal setelah rencana remediasi keamanan, kualitas aplikasi, dan rilis. Riwayat hasil FASE 25 di atas dipertahankan sebagai catatan pada saat pengujian tersebut.

| Temuan | Status saat ini | Bukti lokal | Tindak lanjut |
| --- | --- | --- | --- |
| Kredensial demo dan konfigurasi produksi | Ditutup pada source | Startup tanpa `NODE_ENV` memakai validasi produksi; konfigurasi/user produksi tidak valid ditolak; tes keamanan lulus. | Tidak ada untuk perubahan ini; masukkan ke gerbang CI. |
| Audit login/logout | Ditutup pada source | Login berhasil hanya setelah audit durable tersimpan; kegagalan simpan menolak login; logout tetap mencabut sesi bila audit gagal. Tidak menyimpan password/token. | Verifikasi perilaku yang sama terhadap PostgreSQL pada CI. |
| CSP terlalu luas dan inline style | Ditutup pada source | Inline style element/attribute dilarang; `connect-src` hanya self dan origin WebSocket terkonfigurasi; tile map tetap pada `img-src`; lint sumber memastikan template runtime tanpa style attribute; 13 smoke test workspace lulus setelah CSP diperketat. | Tambahkan bukti header dari deployment produksi saat tersedia. |
| Offline memberi kesan operasi berjalan | Ditutup pada source/dokumentasi | Offline dijelaskan sebagai app shell/aset lokal saja; API, state, tile eksternal, monitoring, dan command memerlukan koneksi. | Uji pemulihan koneksi pada perangkat fisik. |
| Aksesibilitas workspace | Ditutup untuk sweep otomatis | Axe memeriksa 13 workspace pada tema gelap/terang: 0 pelanggaran; E2E interaksi keyboard/modal dan fokus lulus. | Lengkapi VoiceOver dan TalkBack manual di perangkat nyata. |
| Overflow/responsivitas | Ditutup untuk profil browser teruji | Semua E2E aktif lulus pada Desktop-Dark, Desktop-Light, Tablet, Mobile, dan FullHD; tabel analitik dibatasi ke scroller lokal. | Uji Safari iOS dan Chrome Android fisik. |
| Performa grafis | Belum terbukti pada perangkat nyata | Playwright software renderer mencatat 13–18 FPS, p95 66,7–99,9 ms, GPU n/a. Angka ini bukan bukti performa perangkat. | Jalankan benchmark 30 detik terpisah pada GPU desktop, iOS Safari, Android Chrome dan catat perangkat/browser/FPS/p95. |
| Payload logo/PDF laporan | Ditutup pada source | Template cetak memakai aset logo yang lebih kecil; PDF tetap lazy-loaded saat ekspor. | Pantau build size di CI. |
| Lint, build, dependensi, E2E | Ditutup pada verifikasi lokal | `npm run lint`, `npm run lint:css`, `npm run build`, `npm run validate`, `npm audit`, `npm test`, dan full `npm run test:e2e` lulus. E2E: 246 lulus, 29 skip yang dinyatakan per project, 0 gagal. | Pertahankan hasil job CI sebagai bukti rilis. |
| PostgreSQL/Redis dan failover | Menunggu layanan CI | Port lokal 5432/6379 tidak tersedia. Workflow CI menyediakan PostgreSQL 16 dan Redis 7 serta menjalankan `test:postgres` dan `test:cluster` dengan tes wajib. | Periksa hasil workflow CI sebelum menutup gerbang rilis ini. |

Audit implementasi lokal tidak memiliki kegagalan tes aktif yang tersisa. Kesiapan perangkat dan layanan berstatus terbuka dengan bukti serta tindak lanjut di atas; hasil browser/software renderer tidak dianggap sebagai pengganti gerbang tersebut.
