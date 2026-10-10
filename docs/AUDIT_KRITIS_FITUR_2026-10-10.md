# Audit kritis fitur OmniTRAF

Tanggal: 10 Oktober 2026, WIB. Objek: workspace lokal dan browser lokal, bukan deployment publik.

## Kesimpulan

Fitur paling lemah adalah Prediksi dan perbandingan dampak optimasinya. Masalah utama adalah hubungan sebab-akibat: manfaat optimasi dipasang sebagai koefisien tetap dan tidak dihitung dari perubahan durasi sinyal. Secara visual, Ikhtisar paling membutuhkan penyederhanaan. Bug teknis yang perlu didahulukan adalah normalisasi timestamp pada resinkronisasi state.

Produk sudah memiliki identitas visual dan cakupan fitur yang luas. Nilai berikutnya datang dari menyatukan state antarhalaman, memperjelas pertanyaan yang dijawab setiap halaman, dan memastikan angka mengikuti tindakan pengguna.

## Metode dan batas bukti

- Seluruh 12 halaman utama ditinjau pada browser: Ikhtisar, Peta, Insiden, Darurat, CCTV, Sinyal, Perangkat, Analitik, Prediksi, Laporan, Integrasi, Pengaturan.
- Browser menampilkan sesi Operator Demo tersambung ke server simulator. Ini bukan bukti konfigurasi produksi atau keberhasilan alur masuk manual.
- Interaksi yang diperiksa: navigasi halaman, jeda/putar CCTV, filter koridor analitik, pembuatan preview laporan, unduhan PDF, dan layout peta pada 390 × 844. Desktop juga diperiksa pada 1440 × 900.
- Detail controller, model, ekspor, modal, chat, tour, dan PWA ditinjau dari kode. Tidak semua tombol diuji dari ujung ke ujung.
- Tidak menjalankan command yang mengubah sinyal, status insiden, konfigurasi perangkat, atau dispatch darurat pada sesi server yang sudah ada.
- npm test selesai dengan exit code 0: seluruh 31 file unit/integration lolos. Test PostgreSQL/Redis cluster, audit keamanan menyeluruh, screen reader, tema terang, offline penuh, serta profil CPU/memori belum dilakukan dalam pass ini.
- Unduhan PDF berhasil menghasilkan berkas; layout isi PDF tidak dirender ulang dalam pass ini.
- Dokumen audit sebelumnya dipakai untuk menemukan area pemeriksaan, bukan sebagai bukti bahwa semua temuan lama masih berlaku.
- Label BROWSER berarti terlihat pada sesi yang diperiksa; KODE berarti implementasi mendukung temuan; MODEL berarti direproduksi dengan memanggil fungsi murni; DESAIN berarti penilaian pengalaman penggunaan.

## Temuan yang harus didahulukan

### 1. Manfaat optimasi tetap muncul tanpa perubahan konfigurasi — P1, MODEL + KODE

Pada hour=8, input greenSplitWonokromo 15, 35, 75, dan 90 menghasilkan baseline waktu tunggu 78 detik, optimized 56 detik, antrean 291 → 189 meter, speed 15 → 18 km/jam, throughput 1872 → 2209 kend/jam. Semua perubahan manfaat identik.

Kasus paling jelas: input 75 menghasilkan optimizedSplit=75, tetapi tetap mengklaim penurunan waktu tunggu 28%, antrean 35%, dan throughput naik 18%. Pada input 90, optimizedSplit turun ke 75 dengan manfaat sama.

Penyebab: waitTimeBaseline * 0.72, queueBaselineMeters * 0.65, speed * 1.22, throughput * 1.18. Durasi optimizedSplit hanya dimasukkan sebagai field keluaran, tidak digunakan untuk menghitung manfaat.

Lokasi: src/modules/forecastEngine.js:217–250.

Saran: sementara beri label "asumsi manfaat skenario" dan tampilkan koefisien sebagai input. Untuk simulator kausal, jalankan baseline dan kandidat dengan demand, kapasitas, antrean, clock, dan seed sama. Konfigurasi identik harus menghasilkan delta nol. Tampilkan kerugian pada arus lain, bukan hanya manfaat arus utama. Tambahkan uji perilaku untuk delta nol dan perubahan input.

### 2. Timestamp snapshot bisa menggagalkan resync — P1, BROWSER + KODE

Browser mencatat RangeError: Invalid time value dari applyServerSnapshot pada stateStore.js:903. Header sempat tetap menyatakan server simulator tersambung. Ini membuktikan kegagalan jalur resync pada sesi tersebut, bukan bahwa seluruh stream berhenti.

Kode memilih serverState.timestamp lebih dahulu daripada timestampMs. Backend memiliki timestamp teks jam WIB pada state, sementara timestampMs menyimpan nilai numerik. new Date(timestampMs).toISOString() kemudian dapat menerima string jam tanpa tanggal.

Lokasi: src/core/stateStore.js:828, :903; server/services/stateManager.js:225–226.

Saran: kontrak timestamp transport tunggal berupa epoch milliseconds atau ISO lengkap. Pisahkan label jam WIB dari nilai transport. Validasi Number.isFinite dan tanggal sebelum mutasi snapshot. Status "sinkron" hanya setelah snapshot berhasil diterapkan; resync gagal menampilkan state terakhir dan tindakan ulang yang jelas.

### 3. Insiden belum selesai kehilangan pengaruh setelah diakui — P1, MODEL + KODE

Pada hour=12 dengan satu incident, ACTIVE menghasilkan indeks 53, sedangkan ACKNOWLEDGED, DISPATCHED, RESPONDING, dan CONTAINED semuanya menghasilkan 48. Model hanya menghitung status ACTIVE.

Lokasi: src/modules/forecastEngine.js:120.

Saran: gunakan himpunan status belum selesai dari domain canonical. Penurunan dampak mengikuti kondisi jalan, lajur terbuka, kapasitas pulih, atau resolusi insiden; pengakuan operator tidak otomatis membuka jalan. Bedakan status workflow dengan tingkat dampak lalu lintas.

### 4. Peta menampilkan armada contoh ketika daftar darurat kosong — P1/P2, BROWSER + KODE

Darurat dan dashboard menunjukkan tidak ada prioritas aktif, tetapi peta menampilkan Ambulans 02 62 km/j dan Pemadam 04 55 km/j. setupEmergencyVehicleMarkers membuat marker tersebut langsung ketika peta disiapkan, di luar activeEmergencies. Popup kode juga memakai "Kecepatan Real-time" dan "SIAGA DARURAT".

Lokasi: src/modules/mapManager.js:387, :616–680.

Saran: kendaraan aktif berasal dari activeEmergencies. Bila kendaraan contoh tetap diperlukan, tempatkan pada layer "Contoh animasi" yang default mati, dengan label "contoh" pada marker dan popup. Jumlah aktif harus konsisten di dashboard, peta, dan halaman darurat.

### 5. Kualitas input memiliki angka default yang tampak seperti hasil ukur — P2, KODE

calculateDataQuality memakai total kamera 184, completeness 98, base confidence 96, serta telemetryAgeMs 250/15000 berdasarkan koneksi. Angka tersebut tidak dihitung dari kelengkapan dataset dan umur frame aktual.

Lokasi: src/modules/forecastEngine.js:56–106.

Saran: hitung age dari timestamp terakhir, coverage dari registry, completeness dari field yang benar-benar tersedia. Confidence prediksi membutuhkan evaluasi model; jika belum ada, gunakan "belum dinilai". Jangan menyamakan koneksi socket sehat dengan kualitas prediksi.

### 6. Histori audit perangkat mudah kembali ke loading — P2, BROWSER + KODE

Detail node pada browser menampilkan "Memuat histori audit...". Render detail menulis ulang diagLastCommand dengan teks loading pada pembaruan perangkat, tetapi fetch histori hanya dipanggil ketika isInitialSelect atau aksi tertentu. Ini mendukung kemungkinan hasil fetch tertimpa oleh pembaruan berikutnya. Penyebab jaringan saja belum dibuktikan.

Lokasi: src/controllers/deviceController.js:94, :520, :531–532, :599.

Saran: simpan hasil dan status fetch per deviceId; pisahkan render telemetri dari render audit. Loading mempunyai timeout, error, retry, empty state, dan waktu pembaruan. Respons node lama tidak boleh mengisi detail node baru.

## Kritik per halaman

| Halaman | Kritik utama | Saran konkret | Bukti |
|---|---|---|---|
| Ikhtisar | Status, briefing, strip insiden, filter, KPI, peta, kamera, rekomendasi, kontrol sinyal, ranking, kronologi, dan kesehatan berebut perhatian. Network load dan congestion memakai angka berbeda tanpa definisi cepat. | Susun kondisi kota → masalah prioritas → tindakan berikutnya. Sisakan 3–4 KPI dengan unit, periode, dan definisi. Detail sinyal/ESG pindah ke workspace masing-masing. Tautan insiden membuka entitas terpilih. | BROWSER, DESAIN |
| Peta kota | Marker cluster, garis koridor, kendaraan contoh, dan layer membuat konteks aktif sulit dibedakan. Geometri garis demo tidak mengikuti semua ruas jalan. | Satu panel layer; detail aset terpilih; legend kategori dan sumber; kendaraan contoh dipisah. Jelaskan garis sebagai geometri demo. | BROWSER, KODE, DESAIN |
| Insiden | Ringkasan alur tiga langkah tidak mewakili enam status filter. Ruang kosong atas besar. Detail modal hanya lokasi/waktu/deskripsi dan area visual sintetis, belum timeline tindakan. | Ringkasan jumlah per status, daftar padat, detail dengan kronologi, PIC, alasan transisi, bukti, waktu pengakuan/respons/selesai. Tombol mengikuti transisi yang sah. | BROWSER, KODE, DESAIN |
| Darurat | Ada dua pintu menjalankan skenario: hero mulai 112 dan form aktifkan prioritas. Hero rute tetap, form menawarkan beberapa rute. Stop terlihat walau tidak aktif. | Satu alur pilih kendaraan → pilih rute → preview simpang → konfirmasi → progres → selesai/batal. Nonaktifkan stop bila kosong dan gunakan rute terpilih pada judul. | BROWSER, DESAIN |
| CCTV | Toolbar penuh; HUD kecil; nama kamera kecil terpotong; detail objek hanya pada canvas; jeda kurang menonjol pada feed. Adegan empat kamera mirip. | Prioritaskan pilih kamera, pause, snapshot; efek/threshold pada panel lanjutan. Label PAUSED + waktu frame; panel objek numerik; nama lengkap via detail. Bedakan skenario visual tiap lokasi. | BROWSER, DESAIN |
| Sinyal | Lima kartu kontrol besar dan tabel menyajikan informasi berulang. Slider mudah berubah dan detail pergerakan/konflik belum menjadi pusat alur. | Daftar simpang + satu detail terpilih. Pisahkan fase berjalan, sisa fase, konfigurasi dan candidate. Simpan/konfirmasi dengan before/after, pending, acknowledgement, rollback. | BROWSER, DESAIN; command mutasi belum browser-tested |
| Perangkat | Tabel 10 kolom untuk empat node; detail terlalu banyak istilah/angka kesehatan. Heartbeat pada contoh detail lebih tua dari jam layar tetapi status HEALTHY; aturan freshness tidak dijelaskan. | Default tampil exception, last seen, status, dan aksi; kolom teknis opsional. Jelaskan interval heartbeat dan freshness. Detail telemetri tidak menimpa histori audit. | BROWSER, KODE, DESAIN |
| Analitik | Grafik koridor dan KPI sudah mengikuti filter, tetapi panel jaringan, output ESG simulator, kalkulator ESG, dan tabel semua koridor berada dalam satu halaman panjang. Cakupan berbeda membutuhkan membaca catatan. | Pisahkan analisis koridor, skenario jaringan, ESG. Pasang cakupan/jam/periode pada setiap panel. Tooltip grafik yang stabil dan fokus keyboard; tabel alternatif tetap tersedia. | BROWSER, KODE, DESAIN |
| Prediksi | Manfaat model tidak kausal; pembanding besar muncul sebelum kontrol prakiraan. Copy "pilihan koridor/KPI di atas" diwariskan dari analitik walau tidak ada dropdown koridor di halaman ini. Evaluasi 15 skenario adalah uji internal. | Tampilkan jam, koridor, input/asumsi, hasil, alasan, lalu alternatif. Jelaskan uji konsistensi internal. Tambahkan backtest dan uncertainty hanya saat dataset evaluasinya tersedia. | BROWSER, MODEL, KODE |
| Laporan | Download PDF bekerja, tetapi workflow snapshot PDF dan CSV terpisah. CSV selalu mengambil state baru; print bisa memakai snapshot lama dari preview. Format dan cakupan ekspor belum satu konteks. | Satu snapshot aktif dengan waktu/ID → preview → PDF/CSV/JSON/cetak. Tombol jelas untuk refresh snapshot. Pisahkan CSV insiden dari laporan mobilitas. Uji nilai antarformat sama. | BROWSER, KODE, DESAIN |
| Integrasi | Sandbox jujur dan berguna untuk demo developer, tetapi log kunci state memenuhi ruang dengan detail yang tidak membantu operator. Nama endpoint SITS berpotensi membingungkan meski diberi label contoh. | Pisahkan mode developer dari operasi; log kategori/severity/filter; schema request, contoh berhasil/gagal, method dan endpoint yang eksplisit. Tampilkan "respons lokal, tanpa request jaringan". | BROWSER, KODE, DESAIN |
| Pengaturan | Audio memakai banyak ruang; tema dibahas berulang; aksesibilitas sebagian berupa teks penjelasan. Preferensi operasional inti belum dominan. | Urutkan tampilan, aksesibilitas, notifikasi, lalu audio. Satu kontrol tema dengan nilai terpilih. Group alert menurut severity; sediakan reset preferensi dan preview suara. | BROWSER, KODE, DESAIN |

## Fitur pendukung

- **Chat:** quick chips memakai kata Kirim Petugas/Hijau Wonokromo meski hanya percakapan demo. Label Kirim file sebenarnya mengambil cuplikan canvas lokal. Ubah menjadi "Contoh koordinasi" dan "Lampirkan cuplikan demo"; jelaskan penyimpanan/penerima. Jangan menilai chat lintas operator sudah bekerja dari auto-reply lokal. Tidak mengirim pesan pada audit ini.
- **Notifikasi:** pada browser, status ACKNOWLEDGED terlihat sebagai DITANGANI (Dispatched) dalam drawer, sedangkan daftar insiden menyebut Diakui. Gunakan adapter label status sama; akui, dismiss tampilan, disposisi, dan resolve harus berbeda.
- **Pencarian:** kode sudah menggabungkan hitungan hasil entitas; temuan lama "No results bersamaan dengan hasil" tidak diulang. Istilah Incident/Intersection/Device masih perlu diterjemahkan. Verifikasi alur klik hasil menuju detail entitas dan fokus keyboard.
- **Tour dan pintasan:** lima langkah berisi penjelasan fitur, belum memandu pengguna menyelesaikan satu tugas. Jadikan walkthrough berbasis skenario dengan target kontrol dan hasil terlihat, serta tombol lewati. Pintasan tidak boleh aktif ketika sedang mengetik pesan/input.
- **Intelijen sinyal dan modal algoritma:** cocok sebagai penjelasan metodologi. Bedakan mode pendidikan dengan keputusan operator, tampilkan input dan batasan, serta hindari bahasa seolah sudah tervalidasi lapangan.
- **Login/peran:** form login sudah tersedia; peran Operator terlihat dan konfigurasi node Admin diberi penjelasan baca saja. Alur Viewer/Operator/Admin, sesi habis, login gagal, reconnect, dan logout perlu diuji utuh. Tidak perlu menonaktifkan auth untuk memperbaiki UX.
- **PWA:** app shell offline bukan monitoring offline. Tampilkan timestamp state terakhir dan mode data. Instalasi, update SW, cache versi lama, reconnect, serta reload ketika sedang mengedit belum diverifikasi. Copy update PWA masih berbahasa Inggris.
- **Aksesibilitas:** halaman memiliki label/skip link dan beberapa dialog, tetapi canvas bukan tabel data. Perlu audit keyboard fokus, slider, modal, kontras dua tema, reduced motion, serta alternatif data canvas. Tidak mengklaim WCAG sudah lolos.

## Kritik visual lintas fitur

1. Hirarki terlalu datar: terlalu banyak border, badge kecil, warna aksen, dan judul berukuran mirip. Buat satu elemen utama per layar dan kelompok sekunder lebih tenang.
2. Banyak teks penting kecil: label source, waktu, HUD dan status. Gunakan ukuran isi sekitar 14–16 px sebagai starting point lalu uji pada layar target; informasi kritis harus lebih besar dan jelas.
3. Bahasa dan unit bercampur: detik/dtk/s, km/h/km/jam, veh/h, Inspect, realtime-derived, reason codes. Pilih istilah Indonesia dan buka metadata teknis dalam detail.
4. Ruang tidak selalu produktif: halaman Insiden/Laporan mempunyai area kosong besar, sedangkan dashboard terlalu padat. Spacing perlu mengikuti tugas, bukan kartu yang seragam.
5. Tema dinamis berisiko tidak konsisten: controller analitik memuat banyak inline style dan warna literal terang/gelap. Gunakan token semantic dan komponen bersama. Tema terang belum browser-tested dalam audit ini.
6. Mobile peta membaik: legenda 338 px pada viewport 390 px dan tidak ditemukan overflow page-wide pada pemeriksaan ini. Toolbar berupa ikon tanpa label terlihat memerlukan petunjuk dan target sentuh yang nyaman. Ini bukan hasil uji seluruh halaman mobile.

## Hal yang sudah bekerja atau membaik

- Semua rute utama dapat tampil pada sesi yang diperiksa.
- Sumber simulasi ditandai jelas di shell dan sebagian besar halaman.
- Login dialog ada; kontrol role tersedia di kode dan penjelasan akses Admin tampak pada node.
- Filter koridor MERR mengganti KPI menjadi 38.587 kendaraan model/24 jam dan kecepatan 31 km/jam pada snapshot pemeriksaan.
- Histori 7/30 hari dinonaktifkan dengan alasan belum tersedia.
- Grafik analitik memakai seri 24 titik dan memiliki tabel alternatif, bukan hanya SVG preset.
- CCTV pause berubah menjadi Putar dan dapat dilanjutkan.
- Laporan preview selesai dan PDF berhasil diunduh. Riwayat mencatat berkas dibuat setelah jalur PDF.
- ESG unknown/zero memakai nullish coalescing; fallback positif dari audit lama sudah dihapus.
- Unit/integration suite: seluruh 31 file lolos. Ini tidak mencakup pembuktian validitas model atau seluruh UI.

## Urutan perbaikan dan kriteria selesai

### Tahap 1 — kebenaran data dan state

Normalisasi timestamp, manfaat skenario yang kausal/berlabel asumsi, status insiden model, marker darurat, dan histori perangkat.

Selesai bila resync tidak melempar invalid-date, konfigurasi sama memberi delta nol, ACKNOWLEDGED tidak menghilangkan dampak jalan secara otomatis, armada aktif konsisten lintas halaman, dan hasil histori audit tidak tertimpa loading.

### Tahap 2 — alur inti

Sederhanakan dashboard, satukan workflow darurat, ubah sinyal/perangkat menjadi daftar + detail, serta satukan konteks snapshot ekspor.

Selesai bila pengguna dapat menemukan insiden prioritas, memeriksa lokasi/kamera/simpang terkait, mencoba satu tindakan simulasi, melihat hasil dan mengekspor snapshot dengan konteks yang sama.

### Tahap 3 — keterbacaan dan kelengkapan

Standarkan unit/bahasa, perbaiki hierarki dan ukuran teks, tema terang/gelap, keyboard/modal, skenario CCTV, notifikasi, tour dan PWA.

Selesai bila workflow utama diuji pada 390 px dan desktop untuk tiap peran, tanpa kontrol terpotong, fokus hilang, atau status berbeda antarhalaman.

### Tahap 4 — pembuktian kualitas

Tambah uji E2E browser untuk alur sukses/gagal dan profiling pada perangkat target. Untuk prediksi, evaluasi terhadap dataset terpisah dan laporkan error per horizon/koridor; jangan memakai test konsistensi internal sebagai bukti akurasi.

## Perubahan dalam audit ini

Audit menambahkan dokumen ini saja pada source proyek. Pengujian menulis log sementara di direktori TEMP dan browser membuat satu berkas unduhan PDF. Kode fitur tidak diperbaiki, deployment tidak dilakukan, dan proses server milik pengguna tidak dihentikan.

## Pelaksanaan perbaikan setelah audit

Pada sesi tindak lanjut tanggal 10 Oktober 2026, perbaikan berikut diterapkan pada source:

- Snapshot server kini memvalidasi epoch/ISO, mengubah epoch detik menjadi milidetik, dan memakai waktu lokal saat nilai tidak sah sebelum memperbarui state maupun diagnostics.
- Indeks prakiraan ditampilkan sebagai indeks model /100, confidence yang belum dievaluasi dikosongkan, coverage kamera dan umur telemetri tidak lagi memakai angka default, dan provenance selalu menyatakan simulasi. Perbandingan optimasi menghasilkan delta nol bila split tidak berubah; koefisien respons serta batas kalibrasinya ditampilkan sebagai asumsi.
- Status insiden yang diakui tetap memengaruhi indeks sampai status terminal, label ACKNOWLEDGED dibedakan dari disposisi, transisi modal mengikuti workflow, dan status terminal ditangani konsisten di daftar serta peta.
- Marker armada statis yang muncul tanpa state darurat dihapus. Marker aktif memerlukan koordinat dari state dan tidak mengarang kecepatan/lokasi ketika nilainya tidak tersedia.
- Histori audit perangkat disimpan per perangkat, dijaga terhadap respons yang datang terlambat, bertahan saat detail telemetri dirender ulang, dan menyediakan aksi coba lagi saat permintaan gagal.
- Ikhtisar membuang KPI emisi/volume/prediksi/efisiensi yang belum terukur. Alur darurat dimulai dari satu form pemilihan rute dan kendaraan; tombol stop mengikuti state aktif.
- PDF, cetak, CSV insiden, dan JSON memakai ID snapshot sesi yang sama sampai pengguna membuat pratinjau baru. Pratinjau menampilkan waktu snapshot.
- Quick reply chat diberi label contoh simulasi, attachment menyebut cuplikan demo lokal, dan copy update/install PWA diterjemahkan ke Bahasa Indonesia.

Pemeriksaan sintaks `npm run lint` lulus untuk 168 berkas JavaScript. Suite test dan build produksi tidak dijalankan setelah perubahan. Folder `dist` telah berisi artefak sebelum tindak lanjut ini, sehingga build yang mengosongkan folder tersebut tidak dijalankan. Akurasi prakiraan, dampak lalu lintas lapangan, aksesibilitas penuh, serta E2E lintas role tetap memerlukan dataset dan pemeriksaan terpisah; source ini masih prototipe simulasi.
