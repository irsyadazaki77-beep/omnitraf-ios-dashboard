# OmniTRAF Surabaya — Intelligent Transport System Command Center
### Prototipe Simulasi & Showcase

[![Accessibility](https://img.shields.io/badge/Accessibility-Review%20in%20progress-blue?style=for-the-badge&logo=w3c)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![PWA](https://img.shields.io/badge/PWA-App%20shell%20offline-blue?style=for-the-badge&logo=pwa)](https://web.dev/progressive-web-apps/)
[![Simulation](https://img.shields.io/badge/Data-Simulated-yellow?style=for-the-badge)](#status-data--provenance-model)
[![GIS Engine](https://img.shields.io/badge/Leaflet.js-Euclidean%20Vector%20GIS-brightgreen?style=for-the-badge&logo=leaflet)](https://leafletjs.com/)
[![ESG Impact](https://img.shields.io/badge/ESG-IPCC%20Carbon%20Emission%20Model%20(Simulated)-emerald?style=for-the-badge&logo=leaf)](https://www.ipcc.ch/)

---

## 🏙️ Ringkasan Proyek (Executive Summary)

**OmniTRAF** adalah prototipe demonstrasi command center mobilitas perkotaan yang menggunakan lokasi dan skenario Surabaya sebagai konteks simulasi. Data lalu lintas, kamera, sensor, petugas, insiden, armada darurat, emisi, dan hasil optimasi adalah data sintetis/contoh. Aplikasi ini **belum terhubung** ke CCTV/RTSP, gateway atau aktuator SITS, layanan 112, GPS armada, maupun data resmi Pemerintah Kota Surabaya. Tombol perintah hanya mengubah state prototipe.

Antarmuka memakai gaya visual yang terinspirasi dashboard operasional. WCAG 2.1 AA belum diaudit atau dinyatakan terpenuhi; aksesibilitas masih perlu diuji pada browser dan perangkat yang dituju. Mode offline menyediakan app shell, bukan pemantauan atau kendali operasional.

---

## 📐 Arsitektur Sistem (System Architecture)

Sistem mengadopsi arsitektur event-driven terdistribusi yang memadukan komputasi edge dengan sinkronisasi real-time Socket.io serta fallback simulasi offline mandiri:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 DATA CONTOH UNTUK SIMULASI (BUKAN FEED SITS)               │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  184 Node kamera (nilai demo) │  312 Sensor (nilai demo)                     │
└───────────────┬───────────────┴──────────────────────┬──────────────────────┘
                │                                      │
                ▼                                      ▼
┌───────────────────────────────┐      ┌──────────────────────────────────────┐
│     EDGE VISION SIMULATOR     │      │   MOCK GATEWAY (LOCAL SANDBOX)       │
│  • Procedural Traffic Model   │      │   • Skenario fase sinyal             │
│  • Bounding Box Simulasi      │      │   • Status insiden contoh            │
│  • Canvas Browser Render      │      │   • Rute darurat sintetis            │
└───────────────┬───────────────┘      └───────────────┬──────────────────────┘
                │                                      │
                └──────────────────┬───────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 OMNITRAF BACKEND KERNEL (Node.js / Express)                 │
│  • Single Source of Truth Global State Manager                              │
│  • WebSocket Engine (Socket.io) dengan Reconnection Logic Otomatis          │
│  • Dynamic Webster Minimum Delay Optimizer & Mathematical Diurnal Model     │
│  • Mesin Komputasi Reduksi Emisi Karbon (ESG Formula IPCC 2006)            │
│  • PDF Report Generation Engine (Buffer PDF 1.4 Native)                     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │ Socket.io Event Bus (Stream 300ms) │
                 ▼                                   ▼
┌──────────────────────────────────┐ ┌────────────────────────────────────────┐
│     CLIENT DASHBOARD (FRONTEND)  │ │      OFFLINE RESILIENCY LAYER (PWA)    │
│  • StateStore & Event-Bus (ES6)  │ │  • Public App-Shell Cache Only         │
│  • GIS Leaflet Vector Animation  │ │  • Explicit Live/Offline Provenance    │
│  • Canvas Edge Vision Lerp Render│ │  • Fault Logging & Isolation           │
└──────────────────────────────────┘ └────────────────────────────────────────┘
```

---

## 🌟 Status Data & Provenance Model

Seluruh indikator dan informasi pada dashboard dikategorikan menggunakan badge status berikut. Koneksi Socket.io yang aktif hanya menunjukkan koneksi ke backend prototipe, bukan koneksi ke SITS:
- 🟢 **`LIVE`**: Label provenance ini hanya untuk sumber eksternal nyata yang terhubung dan dapat dibuktikan. Belum ada integrasi semacam itu pada prototipe ini. Clock internal `LIVE` berarti simulasi berjalan mengikuti waktu nyata; itu bukan feed live atau kontrol perangkat.
- 🔵 **`REALTIME-DERIVED`**: Metrik turunan dari stream telemetri yang sedang diterima; pada konfigurasi saat ini stream itu berasal dari simulator.
- 🟡 **`SIMULATED`**: Hasil estimasi model matematika, Webster Optimization, atau prediksi diurnal.
- 🟠 **`STALE`**: Data telemetri yang belum diperbarui dalam kurun waktu ambang batas.
- 🔴 **`OFFLINE`**: Status perangkat atau koneksi yang terputus dengan fallback otomatis.
- 🟣 **`USER-TRIGGERED`**: Aksi pengguna pada state simulasi (Green Wave, Signal Override, Dispatch 112); tidak mengendalikan perangkat lapangan.

Seluruh angka perangkat dan KPI default adalah nilai demo, bukan inventaris atau pengukuran Pemerintah Kota Surabaya. Dokumen PDF/CSV yang dihasilkan adalah keluaran prototipe dan bukan dokumen kedinasan resmi.

### Batas keselamatan operasi

OmniTRAF saat ini terkunci pada `SIMULATION_ONLY`: semua perintah hanya memutasi state simulasi, tidak ada hardware adapter, dan interlock keselamatan belum diverifikasi. Gateway perintah memakai allowlist fail-closed; aksi yang belum diklasifikasikan sebagai simulasi-only ditolak sebelum domain lookup, persistence, audit, atau broadcast. Metadata batas ini disertakan pada hasil perintah, snapshot state, dan stream awal agar integrasi klien tidak menyimpulkan kendali perangkat nyata.

## Simulation lifecycle dan determinisme

Backend menjalankan `BackendStateManager.tick()` melalui `DeterministicSimulationEngine`. Engine memajukan `UnifiedClock`, mengambil stream RNG berdasarkan nama domain, mengeksekusi domain dengan urutan prioritas lalu nama domain, dan menyampaikan event jadwal kepada handler. State manager menjalankan domain dengan urutan: bootstrap clock/sequence, device dan traffic telemetry, emergency response, signal cycle, lalu finalize metadata. Fase memakai domain object yang ada, dengan batas engine dan error isolation per fase.

`SimulationScheduler` menerima waktu absolut pada simulation clock. Event yang jatuh tempo dijalankan satu kali dalam urutan `(at, sequence)`, termasuk saat beberapa event memiliki timestamp sama. `ScenarioRegistry` dan `ScenarioRunner` menyediakan validasi definition, start, pause, resume, completion, event scheduling, dan reset ke checkpoint awal. Belum ada definisi skenario operasional di repo; registry baru kosong kecuali caller mendaftarkan definisi, dan tidak ada tombol/command start scenario. Pause menghentikan tick biasa tanpa mengonsumsi RNG; command `simulation:control` dengan operasi `step` tetap menjalankan satu tick eksplisit. Reset engine memulihkan clock, RNG, queue, sequence dan baseline state manager yang ditangkap setelah database hydration; reset ini mengubah runtime memory, bukan menghapus persistence durable. Emisi dari fase tick masuk ke event buffer lalu dikirim setelah engine selesai, menjaga pemisahan domain simulation dan Socket.io.

Fallback lokal traffic dan CCTV menggunakan seeded RNG tersendiri dan memberi data simulasi hanya ketika koneksi realtime tidak tersedia. Keduanya memajukan logical timestamp dengan delta tetap dari timestamp state terakhir; wall clock hanya dipakai untuk bootstrap bila timestamp state tidak tersedia. Animasi Canvas, timer UI, freshness/reconnect, timestamp transport, audit, dan metadata produksi tetap memakai wall/monotonic time karena bukan sumber kemajuan domain simulation. Efek flicker Canvas masih memakai random visual. Rekaman audit yang tidak memiliki command/correlation ID dan ID report tertentu masih memakai wall-clock/random.

Restart server tidak memulihkan checkpoint simulation. Runtime clock, RNG stream, antrean event, dan progres emergency tidak disimpan sebagai checkpoint; database tetap menyimpan record domain/audit sesuai jalur persistence yang ada. Startup membangun runtime baru, incident durable dimuat dari database, dan dispatch emergency aktif ditandai `CANCELLED_UPON_RESTART` oleh recovery guard yang sudah ada. Seed default engine adalah 42 kecuali caller memberi seed lain.

Jaminan deterministik yang diuji mencakup output handler untuk seed dan jadwal yang sama, urutan event scheduler, pause/resume, reset engine, serta transisi state manager, emergency, dan CCTV backend yang sebelumnya sudah tercakup. Ini bukan klaim bahwa seluruh dashboard atau seluruh event envelope identik lintas restart: metadata wall-clock, command yang dibuat operator, timer UI, dan beberapa metadata realtime memang bergantung pada waktu aktual. Model traffic/vision adalah simulasi/prototipe; dokumentasi ini tidak mengklaim model lalu lintas fisik tervalidasi atau akurasi prediksi.

---

## 💻 Tech Stack & Kepatuhan Standar

| Lapisan / Komponen | Teknologi yang Digunakan | Standar & Kepatuhan |
| :--- | :--- | :--- |
| **Frontend Core** | HTML5 Semantik, Vanilla ES6 Modules | Belum divalidasi lintas browser |
| **Styling & Motion** | Modern CSS, Custom Design System | `prefers-reduced-motion` tersedia; WCAG 2.1 AA belum diaudit |
| **Geospatial GIS** | Leaflet.js 1.9.4, MarkerCluster | CartoDB Dark Matter / Positron |
| **Edge Vision HUD** | HTML5 Canvas API (2D Context) | Lerp Bounding Box Rendering |
| **Offline & PWA** | Service Worker v9 (App shell + bounded public assets) | API, auth, commands, tiles, and third-party resources are network-only |
| **Performance Engine**| `content-visibility`, Tabular Nums, LERP Canvas | Bounded Memory & CPU Optimization |
| **Backend Runtime** | Node.js (ESM), Express.js | REST API Level 2, Strict CSP Headers |
| **Real-Time Engine**| Socket.io v4.8 | Low-latency WebSockets |
| **Security & Auth** | JWT (HS256), HttpOnly Cookies, RBAC | Implementasi tersedia; belum diaudit independen (lihat [SECURITY.md](SECURITY.md)) |

---

## 🚀 Menjalankan Project

### Prasyarat
- Node.js versi 20.
- `npm` adalah package manager canonical project ini.

### Development
```bash
npm ci
```

Jalankan backend dan frontend Vite di dua terminal:

```bash
# Terminal 1
npm run dev:server
```

```bash
# Terminal 2
npm run dev:client
```

Buka `http://localhost:5173`. Vite meneruskan `/api` dan `/socket.io` ke backend lokal di port 3000. `OMNITRAF_BACKEND_ORIGIN` dapat dipakai untuk memilih alamat backend lain.

### Production

```bash
npm ci
npm run build
npm start
```

Server Express menyajikan frontend dari `dist/` pada `http://localhost:3000`. Docker membangun `dist/` di build stage sebelum menjalankan server.

### Database dan deployment Docker

Persistence menggunakan SQLite-compatible database melalui `sql.js`. `DB_PATH` memilih file database; path relatif diselesaikan dari root repository, sedangkan production sebaiknya memakai path absolut. Nilai container adalah `/usr/src/app/data/omnitraf.sqlite`, disimpan pada named volume `omnitraf-data` oleh Docker Compose. Volume tetap ada ketika container dibuat ulang; hapus volume secara eksplisit hanya ketika memang ingin membuang datanya.

Perubahan domain ditandai dirty dan digabungkan ke satu asynchronous flush pada satu waktu. File sementara diganti secara atomik, dan shutdown `SIGINT`/`SIGTERM` menunggu final flush dengan batas waktu. `/healthz` mengukur liveness; `/ready` melaporkan readiness, lifecycle, dan metrik persistence tanpa membocorkan path database. Test menggunakan path tersendiri melalui `test/helpers/testDatabasePath.js`.

Repository domain berada di `server/repositories`; `server/db/database.js` menjadi adapter implementasi saat ini. Socket.io Redis adapter hanya membagi koneksi/event realtime. File database tetap lokal ke satu process/volume dan belum aman dipakai sebagai persistence bersama beberapa replica.

Untuk multi-instance, set `OMNITRAF_RUNTIME_MODE=cluster` dan `REDIS_URL`. Setiap instance memakai lease Redis `omnitraf:simulation:leader` (TTL 10 detik, renew tiap 3 detik); hanya leader menjalankan simulation/CCTV loop dan command follower diteruskan ke leader. Followers memuat baseline checkpoint dan snapshot/CCTV terbaru dari Redis sebelum readiness dan Socket.io diaktifkan. Redis outage membuat cluster degraded dan menghentikan loop authoritative. Rate limits dan idempotency command memakai counter/registry Redis; Socket.io adapter tetap menjadi satu jalur broadcast ke client agar custom snapshot pub/sub tidak menggandakan packet realtime.

### Development checks
```bash
npm ci
npm run lint
npm run build
npm run validate
npm test
```

`npm run lint` memeriksa sintaks JavaScript. `npm run build` menghasilkan bundle Vite ber-hash dan mencetak ukuran entry serta chunk fitur. `npm run validate` memeriksa artefak production/PWA, lalu `npm test` menjalankan seluruh unit dan integration test. `npm run preview` menyajikan build Vite pada port 4173 dan meneruskan API/Socket.io ke backend lokal. Rincian baseline dan batas pengukuran Phase 9 ada di [PHASE9_PERFORMANCE.md](PHASE9_PERFORMANCE.md).

---

## 👥 Hak Cipta & Lisensi
SITS Command Center Kota Surabaya — OmniTRAF Prototype &copy; 2026
