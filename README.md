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

Lapisan database memakai interface `query`, `execute`, `transaction`, `ping`, `close`, dan `getHealth`. `DB_DRIVER=sqljs` tetap menjadi default development/test dan single-instance fallback; `DB_PATH` memilih file lokal dan Docker menyimpannya pada named volume `omnitraf-data`. Adapter PostgreSQL menggunakan `pg` pool dan menjadi durable shared source of truth saat `DB_DRIVER=postgres`. Tidak ada fallback diam-diam ke sql.js bila PostgreSQL gagal.

Development sederhana:

```env
DB_DRIVER=sqljs
OMNITRAF_RUNTIME_MODE=single
```

Production cluster memerlukan database PostgreSQL dan Redis:

```env
DB_DRIVER=postgres
DATABASE_URL=postgresql://user:password@host:5432/omnitraf
OMNITRAF_RUNTIME_MODE=cluster
REDIS_URL=redis://host:6379
```

Jangan gunakan kredensial development Compose untuk deployment. `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, dan `DB_SSL=true` mengatur pool/TLS; TLS memvalidasi sertifikat secara default. Migrasi schema berversi dijalankan saat startup di bawah PostgreSQL advisory lock. `/healthz` mengukur liveness, sedangkan `/ready` mem-ping database aktif dan mengembalikan 503 bila database atau lifecycle belum siap. Shutdown menutup penerimaan traffic, menghentikan runtime, menguras persistence, lalu menutup pool.

Compose tetap sederhana dengan app + sql.js. PostgreSQL development opsional tersedia lewat profile:

```bash
docker compose --profile postgres up -d postgres
```

Gunakan `DATABASE_URL=postgresql://omnitraf:omnitraf-local-dev-only@postgres:5432/omnitraf` dan `DB_DRIVER=postgres` di konfigurasi app Compose untuk menjalankan app pada database tersebut. Service PostgreSQL memiliki volume dan healthcheck; aplikasi tetap melakukan koneksi/retry per query dan readiness ping sendiri. Test biasa memakai database terisolasi per test file melalui `test/helpers/testDatabasePath.js`; PostgreSQL integration test terpisah berjalan dengan `npm run test:postgres` ketika `DATABASE_URL` test disediakan.

Pemindahan database lokal dilakukan secara manual, bukan pada startup normal. Pastikan database target sudah siap, lalu periksa jumlah baris sebelum menulis:

```bash
DATABASE_URL=postgresql://user:password@host:5432/omnitraf npm run db:migrate:sqljs-to-postgres -- --source=./data/omnitraf.sqlite --dry-run
DATABASE_URL=postgresql://user:password@host:5432/omnitraf npm run db:migrate:sqljs-to-postgres -- --source=./data/omnitraf.sqlite
```

### Transaction, audit, dan recovery command

Setiap command yang lolos validasi/RBAC menjalankan perubahan handler, audit sukses, dan command receipt di dalam satu transaksi database. Adapter PostgreSQL memakai koneksi transaksi yang sama untuk repository calls bersarang. SQL.js memakai transaksi serialized dan menyelesaikan flush file sebelum acknowledgement sukses. Event yang dipancarkan handler ditahan sampai transaksi commit; cache command lokal baru diisi sesudah commit. Ini tidak menjadikan Redis, Socket.io, dan memory satu transaksi ACID. Jika publikasi snapshot Redis gagal setelah commit, PostgreSQL receipt menjadi bukti hasil dan retry mengembalikan hasil tersimpan.

Receipt menyimpan actor ID, key idempotensi, fingerprint payload, dan hasil command; tidak menyimpan token autentikasi. Actor dan payload yang berbeda pada key atau command ID sama ditolak sebagai conflict. Receipt command tidak dibersihkan otomatis. Audit durable juga tidak memiliki batas jumlah atau penghapusan otomatis; API repository menyediakan pagination (`limit`, `offset`) serta filter actor, action, command ID, correlation ID, idempotency key, dan waktu. UI recent activity tetap merupakan cache memory terbatas dan bukan arsip audit.

Startup hanya melakukan seed ketika query hydration berhasil dan tabel terkait kosong. Error query membuat hydration gagal sehingga readiness tetap 503; backend tidak mengganti PostgreSQL dengan SQL.js. Setelah koneksi pulih, operasi database berikutnya dapat berhasil lagi, tetapi state manager belum otomatis mengulang hydration yang gagal di startup—restart instance setelah database kembali tersedia adalah recovery yang terjamin. Backup PostgreSQL dan validasi restore tetap menjadi tanggung jawab deployment.

Jalankan PostgreSQL integration suite dengan database uji khusus:

```bash
DATABASE_URL=postgresql://omnitraf_test:test_only_password@localhost:5432/omnitraf_test npm run test:postgres
```

Test membuat schema sementara unik dan menghapusnya saat selesai. Tanpa `DATABASE_URL`, Node test menandai suite PostgreSQL sebagai `SKIP`; CI menyediakan service PostgreSQL dan Redis lalu menjalankan suite cluster sungguhan tanpa skip.

Skrip memvalidasi lima tabel durable, mempertahankan primary key/timestamp, dan memakai upsert agar aman dijalankan ulang.

Repository domain berada di `server/repositories`; adapter driver disimpan di `server/db/adapters`. Redis tetap menangani koordinasi ephemeral (leadership, pub/sub, idempotency dan rate limits), bukan persistence permanen. `DB_DRIVER=sqljs` ditolak pada runtime cluster kecuali override eksplisit development/test `ALLOW_SQLJS_CLUSTER=true`.

Untuk multi-instance, set `OMNITRAF_RUNTIME_MODE=cluster`, `DB_DRIVER=postgres`, dan `REDIS_URL`. Lease Redis tetap mengoordinasikan kandidat leader. PostgreSQL migration v4 menyimpan epoch monotonik dan masa berlaku fence. Setiap command transaksi authoritative memverifikasi instance/epoch PostgreSQL sebelum mutasi dan tepat sebelum commit, sambil memvalidasi ulang lease Redis; transaksi memegang shared advisory fence sampai commit/rollback. Klaim epoch baru memakai advisory lock eksklusif, jadi takeover menunggu transaksi lama selesai dan stale epoch ditolak. Redis/DB outage menghentikan loop leader dan command gagal tertutup. Tidak ada transaksi ACID lintas PostgreSQL, Redis, memory, dan Socket.io; durable receipt menyelesaikan retry setelah commit yang acknowledgement-nya hilang.

Hanya leader menjalankan simulation/CCTV loop. CCTV generator hanya maju dari loop authoritative; client baru menerima latest frame yang sudah tersedia, bukan memajukan simulation saat connect. Snapshot Redis adalah checkpoint runtime sementara dengan schema/session/state version, source instance, timestamp, dan leader epoch; Pub/Sub bukan durable queue. Saat snapshot hilang/kedaluwarsa, node membuat session simulasi baru dari durable PostgreSQL state, bukan mengklaim memulihkan RNG/clock lama. Setiap snapshot adalah baseline lengkap; snapshot dengan versi lebih rendah ditolak. Socket.IO Redis adapter tetap satu jalur broadcast client.

`/healthz` adalah liveness; `/readyz` adalah probe infrastruktur minimal tanpa detail diagnostic; `/ready` menyediakan detail readiness dan tetap dilindungi capability. Readiness 503 saat database/Redis coordination/state sync belum siap atau node sedang draining. Shutdown menghentikan ingress, menunggu antrean command lokal, menghentikan simulation, lalu melepaskan lease dan menutup koneksi.

Jalankan 3 node lokal dengan PostgreSQL dan Redis terisolasi (test credentials saja):

```bash
docker compose -f docker-compose.cluster.yml up -d --build --wait
docker compose -f docker-compose.cluster.yml ps
docker compose -f docker-compose.cluster.yml down -v
```

Volume akan dihapus oleh `down -v`; jalankan hanya untuk lingkungan cluster test. Untuk backup/restore drill, install PostgreSQL client tools (`pg_dump`, `pg_restore`) dan gunakan URL database yang mempunyai izin sesuai. Backup tidak menimpa file lama; restore verifier membuat database scratch unik dan menghapusnya setelah pemeriksaan.

```bash
DATABASE_URL=postgresql://user:password@host:5432/omnitraf npm run backup:postgres
DATABASE_URL=postgresql://restore_operator:password@host:5432/maintenance npm run verify:postgres-backup -- backups/omnitraf-<timestamp>.dump
```

RPO/RTO belum ditetapkan sebagai jaminan; operator harus mengukurnya melalui backup terjadwal dan restore drill pada infrastruktur target. Redis runtime snapshot memiliki TTL 30 detik dan bukan backup. Audit dan command receipts berada di PostgreSQL tanpa penghapusan otomatis; retensi operasional hanya boleh diterapkan melalui prosedur eksplisit yang mempertimbangkan compliance.

### Development checks
```bash
npm ci
npm run lint
npm run build
npm run validate
npm test
npm run test:postgres
npm run test:cluster
```

`npm run lint` memeriksa sintaks JavaScript. `npm run build` menghasilkan bundle Vite ber-hash dan mencetak ukuran entry serta chunk fitur. `npm run validate` memeriksa artefak production/PWA, lalu `npm test` menjalankan seluruh unit dan integration test. `npm run test:cluster` memerlukan PostgreSQL dan Redis aktif; suite menguji election tiga manager dan takeover setelah lease expiry. CI menjalankan keduanya dengan service terisolasi. Rincian baseline dan batas pengukuran Phase 9 ada di [PHASE9_PERFORMANCE.md](PHASE9_PERFORMANCE.md).

---

## 👥 Hak Cipta & Lisensi
SITS Command Center Kota Surabaya — OmniTRAF Prototype &copy; 2026
