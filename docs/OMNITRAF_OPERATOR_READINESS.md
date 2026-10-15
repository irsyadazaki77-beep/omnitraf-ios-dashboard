# OmniTRAF Operator Readiness

Status diperbarui: 16 Oktober 2026. Dokumen ini menjadi matriks penerimaan lintas workspace untuk simulator latihan operator; ia mencatat batas bukti dan tidak menganggap laporan fase terdahulu sebagai bukti untuk source saat ini.

## Batas produk

- Seluruh input kendaraan, kamera, simpang, insiden, perangkat, cuaca, emisi, dan hasil optimasi adalah sintetis atau keluaran model.
- Semua command tetap berada di `SIMULATION_ONLY`. Tidak ada feed lapangan, aktuator APILL, RTSP, GPS armada, atau layanan 112 nyata.
- Backend merupakan sumber state kanonis. UI hanya menyatakan command sukses setelah acknowledgement; penolakan atau gangguan mempertahankan nilai kanonis terakhir.
- Scenario Lab menggunakan sesi, seed, clock, dan state model terisolasi. Menjalankan, scrub, reset, atau membandingkan skenario tidak mengubah state operasional simulator.
- Perubahan lokal yang belum dikomit adalah bagian dari baseline kerja dan harus dipertahankan saat melanjutkan pekerjaan.

## Matriks 13 workspace

| Workspace | Kriteria penerimaan operator |
|---|---|
| Ikhtisar (`#dashboard`) | Prioritas, KPI dengan satuan/periode, dan aksi ringkas berasal dari state bersama. Memilih prioritas membuka entitas yang sama pada workspace detail. |
| Peta kota (`#map`) | Marker insiden, simpang, kamera, dan armada aktif mengikuti state bersama; layer sintetis diberi provenance; fokus entitas dari workspace lain membuka marker yang sama. |
| City3D (`#city3d`) | Kendaraan dan kamera memakai ID/frame CCTV yang sama; topologi dan koordinat tervalidasi; kehilangan WebGL menampilkan fallback; kualitas render dapat dipilih dan pulih. |
| Insiden (`#incidents`) | Daftar, filter, inspector, kronologi, status, dampak model, serta tautan Peta/CCTV menunjuk ke insiden yang sama. Status workflow tidak menghapus dampak jalan; Operator/Admin mengonfirmasi pemulihan melalui command simulasi terpisah. |
| Darurat (`#emergency`) | Satu alur pilih kendaraan/rute, preview, konfirmasi, progres, lalu selesai/batal; mutasi melalui command server; seluruh efek diberi label simulasi. |
| CCTV (`#cctv`) | Pilihan kamera, jeda, snapshot, overlay, waktu frame, freshness, dan provenance jelas; informasi deteksi penting juga tersedia sebagai teks yang dapat dibaca keyboard. |
| Sinyal (`#signals`) | Nilai kanonis dan usulan terlihat; pending, acknowledgement, penolakan, serta rollback mengikuti hasil command; akses Operator/Admin ditegakkan server. |
| Perangkat (`#devices`) | Status dan freshness dapat dibedakan; histori audit per perangkat memiliki loading/kosong/gagal/retry dan tidak tertimpa refresh telemetri. |
| Analitik (`#analytics`) | Filter koridor/periode memperbarui seri dan total; cakupan, sumber, satuan, asumsi, dan status stale melekat pada hasil. Nilai yang tidak diketahui tetap tidak diketahui. |
| Prediksi & Scenario Lab (`#prediction`) | Baseline dan alternatif memakai kondisi awal, seed, serta horizon sama; kontrol playback/replay/scrub bekerja di sandbox; model menjelaskan asumsi dan tidak mengklaim akurasi lapangan. |
| Laporan (`#reports`) | Pengguna membuat snapshot secara eksplisit; PDF, CSV, JSON, dan cetak memakai ID/waktu/freshness yang sama; ekspor kosong tetap memuat metadata snapshot. |
| Integrasi (`#integration`) | Sandbox hanya merespons dari state lokal dan allowlist; UI menandai bahwa tidak ada request ke API eksternal atau eksekusi shell. |
| Pengaturan (`#settings`) | Preferensi tema, aksesibilitas, suara, dan notifikasi tersimpan tervalidasi; suara/voice bersifat opt-in dan statusnya tampak pada UI. |

Shell bersama mencakup sesi dan role, navigasi/pencarian, notifikasi, chat, tour, tema, status koneksi, serta lifecycle PWA/offline. Tiap elemen interaktif harus berfungsi atau dinonaktifkan dengan alasan yang jelas.

## Gerbang lintas workspace

### Alur operator

1. Dari Ikhtisar, operator memilih insiden prioritas dan melihat ID yang sama pada inspector Insiden.
2. Tindakan Peta/CCTV membuka entity terpilih; konteks tidak berpindah ke marker atau kamera contoh lain.
3. Operator meninjau dampak model, mencoba tindakan simulasi, menerima acknowledgement, dan melihat hasil pada state bersama.
4. Di Scenario Lab, operator menjalankan baseline dan alternatif, mengulang atau scrub timeline, lalu mengekspor hasil tanpa memutasi state utama.
5. Di Laporan, operator membuat snapshot baru secara eksplisit dan memeriksa ID yang sama pada setiap format.

### Uji dan mutu

- Unit/integration memeriksa model deterministik, konservasi metrik, status insiden, kontrak command, RBAC, rollback, dan parity REST/Socket.IO.
- E2E memeriksa 13 workspace, alur lintas entity, alur darurat, Scenario Lab, ekspor laporan, role Viewer/Operator/Admin, tema, serta viewport desktop/tablet/mobile.
- Aksesibilitas diperiksa otomatis dan manual: urutan/fokus keyboard, Escape dan pemulihan fokus modal, label kontrol, kontras, reduced motion, serta alternatif teks untuk canvas/grafik. Targetnya WCAG 2.1 AA pada alur yang didukung.
- Full E2E harus lulus tanpa kegagalan. Kegagalan visual hanya diterima setelah penyebab diselidiki dan baseline diperbarui untuk perubahan yang memang disengaja.
- PostgreSQL/Redis diuji menggunakan layanan nyata di CI atau environment test; hasil `SKIPPED` tidak dihitung lulus.
- City3D/CCTV diukur pada perangkat referensi dengan GPU; hasil SwiftShader dicatat sebagai software rendering dan tidak dipakai sebagai klaim performa perangkat.

## Validasi source saat ini

- `npm test`: 41 file unit/integration lulus setelah perubahan ini.
- `npm run lint`, `npm run lint:css`, `npm run build`, dan `npm run validate`: lulus.
- Full Playwright matrix: 246 lulus, 29 skip pada 5 project. Skip mengikuti batas project yang dinyatakan di tes (audit aksesibilitas/visual hanya dijalankan pada project kanonis; profil CCTV/City3D desktop tidak diulang di semua viewport).
- Audit Axe mencakup 13 workspace pada tema gelap dan terang: tidak ada temuan serius/kritis setelah perbaikan kontras kontrol kecepatan Scenario Lab.
- Visual sweep mencakup 13 workspace, kedua tema, serta desktop/mobile dan 7 breakpoint; kontrol dan status layout lulus. Canvas City3D dimask saat perbandingan screenshot karena scene sintetis terus bergerak; integritas render dan pemulihan konteks tetap diuji terpisah.
- E2E City3D pada software renderer mencatat sekitar 13–19 FPS, CPU 0,5–2,8 ms, p95 frame time 66,7–100 ms, dan heap sesudah GC sekitar 6,8–7,1 MB. Angka ini bukan benchmark GPU fisik dan tidak mewakili target perangkat rilis.
- Port PostgreSQL `5432` dan Redis `6379` tidak tersedia pada environment implementasi ini; tes layanan nyata dan failover cluster belum dijalankan dan tetap menunggu CI/environment yang menyediakannya.
- Performa GPU fisik, sesi panjang, dan pemeriksaan manual screen reader tetap memerlukan perangkat uji yang ditetapkan.

## Validasi manual lintas perangkat

Hasil di bawah harus dicatat terpisah per perangkat dan browser. Uji browser otomatis atau software renderer tidak menggantikan hasil perangkat nyata.

| Platform | Target uji | Pemeriksaan manual |
|---|---|---|
| Desktop | Chromium stabil dengan akselerasi GPU aktif | Jalankan City3D dan CCTV selama 30 detik setelah warm-up; catat FPS rata-rata, p95 frame time, resolusi, GPU, dan status `chrome://gpu`. Jalankan semua alur operator dengan keyboard dan periksa urutan fokus. |
| iOS | Safari/WebKit stabil pada iPhone/iPad referensi | Uji navigasi, login/logout, modal, peta, City3D fallback, CCTV, ekspor laporan, lifecycle offline shell, rotasi, dan VoiceOver. Catat perangkat, versi iOS, versi Safari, FPS, dan p95 frame time. |
| Android | Chrome stabil pada perangkat referensi | Uji alur yang sama, TalkBack, rotasi, drawer responsif, pemulihan koneksi, dan offline shell; catat perangkat, versi OS/browser, FPS, serta p95 frame time. |

Target grafis penerimaan adalah FPS berkelanjutan minimal 60 pada desktop dan 30 pada iOS/Android; p95 frame time masing-masing maksimal 16,7 ms dan 33,3 ms. Jika perangkat referensi tidak mencapai target, temuan harus dicatat sebagai blocker dengan trace dan profil perangkat, bukan disamarkan dengan hasil renderer software.

Offline tetap berarti app shell dan aset lokal. Peta eksternal, API, state, pemantauan, dan command tidak tersedia offline; UI dan dokumentasi harus menyatakan koneksi terputus tanpa memberi kesan operasi tetap berlangsung.

## Status remediasi audit

- Kredensial/config produksi kini default fail-closed dan validasi user produksi memerlukan admin valid; tes konfigurasi tanpa `NODE_ENV` ditambahkan.
- Login dan logout kini diarahkan ke repository audit durable. Login ditolak bila audit gagal; logout tetap mencabut sesi dan melaporkan kegagalan pencatatan ke log server.
- CSP membatasi WebSocket ke origin aplikasi yang dikonfigurasi dan memblokir style element maupun atribut inline. Template memakai kelas stylesheet lokal; nilai lebar/warna dinamis diterapkan melalui CSSOM.
- Ukuran logo pada template cetak diturunkan dengan memakai aset logo yang telah dioptimalkan. PDF sudah dimuat secara dinamis hanya saat ekspor.
- Perangkat fisik desktop/iOS/Android dan layanan PostgreSQL/Redis CI belum diverifikasi pada pekerjaan ini; hasilnya harus ditambahkan sebelum menyatakan gerbang tersebut lulus.

### Verifikasi remediasi lokal — 16 Oktober 2026

- `npm test`: **PASS**, seluruh 42 file unit/integrasi.
- `npm run test:e2e`: **PASS**, 246 kasus lulus, 29 kasus dilewati sesuai pembatasan project, 0 gagal; lima profil Playwright mencakup Desktop-Dark, Desktop-Light, Tablet, Mobile, dan FullHD.
- Axe pada 13 workspace dan dua tema: **0 pelanggaran**. E2E aksesibilitas, alur operator/RBAC, modal/fokus, dan layout responsif lulus pada Chromium.
- `npm run lint`, `npm run lint:css`, `npm run build`, `npm run validate`, dan `npm audit`: **PASS**; audit dependensi melaporkan 0 kerentanan, PWA memvalidasi 46 aset hashed dan 5 feature chunks.
- Benchmark browser masih memakai software renderer: 13–18 FPS, p95 66,7–99,9 ms, GPU `n/a`. Angka ini bersifat diagnostik dan tidak memenuhi bukti target grafis perangkat nyata.
- PostgreSQL/Redis tidak tersedia lokal. Workflow CI telah menyediakan PostgreSQL 16 dan Redis 7 serta menjalankan tes database/failover wajib; hasil run CI belum tersedia pada checkout ini.
- Uji manual Chromium dengan GPU, iOS Safari/WebKit, Android Chrome, VoiceOver, dan TalkBack masih terbuka. Status rilis untuk gerbang perangkat dan layanan nyata tetap **belum terverifikasi**.

Ledger temuan, bukti, status, dan tindak lanjut terperinci ada di [FASE25 Critical Remediation](FASE25_CRITICAL_REMEDIATION.md#tindak-lanjut-remediasi-audit--16-oktober-2026).
