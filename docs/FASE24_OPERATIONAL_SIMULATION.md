# FASE 24 — Audit dan hasil operasi simulasi

Tanggal audit: 14 Oktober 2026. Repository lokal berada pada `ec861fb39e941d76124ed25ed5c30eecd62a90a7`, sama dengan `origin/main` saat pemeriksaan. Working tree sudah berisi pekerjaan lokal FASE sebelumnya; tidak di-reset. Implementasi FASE 24 diterapkan di atas keadaan tersebut.

## Perubahan utama

- `src/modules/trafficModel.js`: tambah evaluasi dampak insiden berbasis baseline tanpa insiden yang sedang dinilai, loss kapasitas berdasarkan severity/penutupan lajur/laporan kapasitas, perbandingan dua rute darurat sintetis, estimasi waktu, hambatan simpang, rekomendasi, dan dampak jaringan dari prioritas green wave. Seed tetap deterministik; horizon dan asumsi model terekspos.
- `src/controllers/incidentController.js`: inspector insiden menampilkan koridor terdampak, perubahan antrean/waktu model, alasan, dan rekomendasi.
- `src/controllers/emergencyController.js` dan `public/components/modals/greenWaveConfirmModal.html`: preview rute sebelum command berisi ETA, alasan, dampak lalu lintas, label SIMULATION_ONLY, dan explicit confirmation; command lewat CommandLayer dan menunggu server acknowledgment.
- `server/services/stateManager.js`: fase prioritas sinyal sintetis memakai yellow clearance, all-red clearance, green terbatas 15–90 detik, lalu recovery clearance; pembatalan dan kedatangan memulihkan fase melalui urutan yang sama. Tidak ada green tanpa batas.
- `test/unit/forecastEngine.test.js`, `test/unit/emergency_signal_clearance.test.js`, `test/integration/state_machine_p14d.test.js`: uji reproduksibilitas, kapasitas lajur, dampak insiden, batas fase, recovery, dan alur/idempotency.
- `tests/e2e/operational.spec.js`: tambah pemeriksaan preview emergency dan screenshot inspector serta dialog.
- `css/components/tables.css`: perbaiki kontras tag status pada Signals.

Fitur memakai state server yang ada untuk progres kendaraan, status insiden, sinyal, Map, CCTV, dan City3D. Tidak ditambahkan simulation engine kedua atau kontrol infrastruktur nyata.

## Hasil simulasi terukur

Replay terkontrol dengan seed 412, jam simulasi 17:00, insiden medium menutup 2 dari 3 lajur A. Yani, dan antrean simpang tetap:

| Ukuran | Hasil model |
| --- | ---: |
| Kehilangan kapasitas A. Yani | 67% |
| Perubahan antrean jaringan akibat insiden | +437.33 kendaraan / horizon 15 menit |
| Perubahan waktu tempuh jaringan akibat insiden | +4.30 menit |
| Rute rekomendasi | MERR Kertajaya → Gubeng → RSUD Dr. Soetomo |
| ETA rute MERR / indeks padat / insiden | 40.11 menit / 71% / 0 |
| ETA rute A. Yani / indeks padat / insiden | 76.27 menit / 80% / 1 |
| Dampak prioritas green wave terhadap antrean jaringan | −6.40 kendaraan / horizon |
| Dampak prioritas green wave terhadap waktu jaringan | −0.42 menit |
| Residual konservasi antrean | 0.000000 kendaraan |

Semua angka adalah estimasi dari model aggregate-flow seeded, bukan waktu perjalanan lapangan. Dampak green wave menggambarkan satu skenario jaringan dan dapat memperburuk pendekatan lain; operator tetap harus meninjau preview.

## Screenshot

Screenshot `before` memakai baseline visual E2E yang sudah ada di repository; screenshot `after` diambil ulang dari browser Desktop-Dark setelah perubahan FASE 24. Dialog emergency terlihat dengan rute, ETA, dampak, label simulasi, serta tombol batal/konfirmasi.

- Before: `artifacts/fase24/before/incident-before.png`, `artifacts/fase24/before/emergency-before.png`
- After: `artifacts/fase24/after/incident-impact-after.png`, `artifacts/fase24/after/emergency-route-preview-after.png`

## Pengujian aktual

- `npm run lint`: lulus, syntax check 209 file JavaScript.
- `npm run build`: lulus; JS awal 272.8 KiB (79.7 KiB gzip), CSS awal 63.6 KiB (12.8 KiB gzip).
- `npm test`: lulus 40/40 file unit dan integration pada run penuh. Setelah koreksi baseline, 23 tes fokus state machine, command contract, emergency clearance, dan traffic model kembali lulus.
- Playwright focused Desktop-Dark untuk inspector insiden dan preview/konfirmasi emergency: 2/2 lulus.
- Playwright focused Mobile emergency: 1/1 lulus.
- Playwright responsive Desktop-Light: 1/1 lulus.
- Axe Playwright Desktop-Dark: 26 pemindaian (13 route × 2 tema) tanpa temuan setelah perbaikan kontras tag Signals.
- Full `npm run test:e2e` pada run awal: 231 lulus, 21 dilewati, 8 gagal. Salah satu kegagalan adalah kontras tag Signals; sudah diperbaiki dan rerun axe terfokus lulus. Sejumlah kegagalan lain berasal dari ENOENT saat Playwright menyalin trace/network artefact pada Windows. Tes CCTV visual juga timeout saat membuka kontrol `<details>` dan belum lulus dalam rerun terfokus. Full matrix belum diulang sesudah perbaikan kontras; sinkronisasi visual CCTV/City3D belum terbukti penuh oleh seluruh matriks E2E.

## Batas model

- Model flow berupa agregat per koridor, bukan jaringan jalan/lajur dengan rute geospasial; penutupan lajur memengaruhi kapasitas secara proporsional.
- ETA berasal dari panjang koridor dan kecepatan model, dengan penalti antrean simpang terbatas; belum dikalibrasi ke data perjalanan teramati.
- Rute alternatif masih dua koridor sintetis tetap. Bila data simpang/rute tidak tersedia, controller mempertahankan fallback yang ada.
- Screenshot before memakai snapshot visual E2E repository sebagai pembanding historis, bukan rekaman produksi langsung.
- Seluruh efek hanya SIMULATION_ONLY. Tidak ada dispatch kendaraan sungguhan maupun perubahan perangkat lampu lalu lintas nyata.

