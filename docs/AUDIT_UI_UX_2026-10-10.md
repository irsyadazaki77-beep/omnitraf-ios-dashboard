# Audit UI, UX, dan fungsi OmniTRAF

Tanggal: 10 Oktober 2026 (WIB). Audit terhadap isi workspace saat ini, bukan deployment publik.

## Kesimpulan

Masalah terbesar adalah kesenjangan antara tampilan dashboard yang terlihat operasional dan perilaku fitur yang belum konsisten. Ada fungsi yang bekerja sebagai simulasi lokal, fungsi yang membutuhkan sesi backend, dan konten contoh statis dalam satu antarmuka. Pengguna belum mendapat penjelasan singkat yang membantu memilih tindakan dan memulihkan kegagalan.

Tidak semua fitur rusak. Navigasi halaman utama, pemuatan peta, visualisasi CCTV sintetis, daftar insiden, kalkulator ESG, dan pratinjau laporan dapat ditampilkan. Tetapi keberadaan tampilan tersebut belum menjamin alur lengkap, akurasi makna metrik, atau aksesibilitasnya.

## Ruang lingkup dan batas bukti

- Ditinjau: Ikhtisar, Peta kota, Insiden, Darurat, CCTV, Sinyal, Perangkat, Analitik, Prediksi, Laporan, Integrasi, Pengaturan, serta shell/navigasi dan beberapa modal.
- Browser: desktop 1440 × 900 dan pemeriksaan peta pada mobile 390 × 844; juga terlihat layout pada lebar 500 px. Ini bukan matriks seluruh perangkat/browser.
- Dijalankan: lint JS, lint CSS, build, validasi production/PWA, dan npm test.
- Backend audit terpisah menggunakan port 3001 dan database sementara. Backend sebelumnya di port 3000 tidak dihentikan atau diubah. Health backend audit merespons 200; sesi tanpa autentikasi merespons 401.
- Sesi browser adalah sesi demo tanpa login. Mutasi yang memerlukan Operator/Admin belum diuji dari ujung ke ujung; tidak ada formulir login yang tersedia di UI untuk mengakses alur tersebut.
- Tidak dilakukan audit keamanan menyeluruh, pengukuran performa lapangan, pengujian offline penuh, pemeriksaan hasil cetak/PDF secara visual, atau pengujian PostgreSQL/Redis cluster.
- Kode aplikasi tidak diperbaiki dalam audit ini. Build menghasilkan ulang artefak dist.

Label bukti: **Browser** = terlihat atau direproduksi langsung; **Kode** = ditemukan di implementasi, dampak perlu diuji; **Desain** = penilaian dan usulan pengalaman penggunaan.

Prioritas: **P1** = perilaku inti, kepercayaan data, atau akses terhambat; **P2** = masalah penggunaan/konsistensi; **P3** = penyempurnaan.

## Temuan prioritas tinggi

### 1. Tidak ada jalan masuk untuk sesi yang perlu autentikasi — P1, Browser + Kode

UI hanya menampilkan profil Demo session. Backend /api/auth/me mengembalikan 401. AuthManager memiliki login(), tetapi index.html dan shell tidak menyediakan form masuk atau aksi pemulihan sesi. Kontrol sinyal/darurat menyembunyikan aksi berdasarkan peran. Pengguna tidak bisa menyelesaikan alur melalui antarmuka.

Perbaikan: buat halaman/dialog masuk, akses demo baca-saja yang jelas, tampilkan peran dan masa berlaku sesi, serta tombol masuk kembali saat sesi habis. Kontrol yang dibatasi izin harus menjelaskan persyaratan akses. Jangan menyelesaikan ini dengan menonaktifkan autentikasi atau menjadikan auto-login default produksi.

Lokasi: src/core/authManager.js; src/app.js; index.html.

### 2. Kebutuhan login terbaca sebagai gangguan koneksi — P1, Browser + Kode

Browser tetap menampilkan RECONNECTING, Menghubungkan, dan Server simulasi terputus. Server socket membedakan AUTHENTICATION_REQUIRED dengan AUTHENTICATION_FAILED, sedangkan client hanya mengenali string AUTHENTICATION_FAILED; error tanpa token jatuh ke reconnecting. Health backend audit tetap 200.

Perbaikan: cocokkan kode error terstruktur, pisahkan belum login/sesi habis/server tidak tersedia/data usang, dan hentikan retry yang tidak bisa berhasil tanpa tindakan pengguna. Berikan tombol pemulihan sesuai penyebab.

Lokasi: server/sockets/socketServer.js:80; src/core/socketClient.js:386.

### 3. PDF disebut siap, tetapi gagal diunduh — P1, Browser

Reproduksi: Laporan → Buat ringkasan harian → Cetak / Simpan PDF. Pratinjau berhasil, tetapi unduhan menampilkan pesan bahwa token atau sesi terverifikasi wajib disertakan. Header halaman tetap menyatakan Siap Diekspor.

Perbaikan: cek izin sebelum menawarkan unduhan, tampilkan status kesiapan berdasarkan sesi/server/data, dan sediakan masuk kembali. Jika demo lokal memang boleh diekspor, sediakan jalur ekspor yang sesuai batas demo secara eksplisit.

Lokasi: src/controllers/reportController.js:138; public/views/reportsView.html.

### 4. Tombol Abaikan memberi sukses tanpa mengabaikan rekomendasi — P1, Browser + Kode

Reproduksi: Ikhtisar → Abaikan. Toast sukses muncul, tetapi widget tetap terlihat. Handler mencari #ai-rec-card atau .ai-rec-card; kartu aktual adalah #widgetAiRec.

Perbaikan: simpan status dismissal pada state rekomendasi berdasarkan ID/siklus, render dari state, dan berikan opsi pulihkan bila relevan. Pesan sukses hanya diberikan setelah perubahan berhasil.

Lokasi: src/app.js:434; public/views/dashboardView.html:381.

### 5. Filter analitik tidak menyaring dataset/KPI — P1, Browser + Kode

Memilih MERR dan 7 Hari membiarkan Total Kendaraan tetap 150.840. Grafik masih memakai konteks peak pagi/sore. Kode dropdown hanya mengganti SVG path preset; tombol rentang waktu juga hanya mengganti path. Permintaan forecast hanya berisi hour, bukan koridor/rentang tanggal. Filter koridor dan waktu dapat saling menimpa kurva karena tidak memiliki state query bersama.

Perbaikan: satu model query {corridor, start, end, hour, scenario}; kurva, KPI, legenda, tabel, dan ekspor harus berasal dari dataset yang sama. Jangan tawarkan rentang historis yang belum tersedia; tampilkan empty state yang jujur.

Lokasi: src/controllers/analyticsController.js:65, :145, :501.

### 6. Label probabilitas dan volume memberi makna berlebihan — P1, Kode + Browser

Probabilitas Kemacetan berasal dari Math.round(intensity * 100), yaitu skor intensitas model, bukan probabilitas yang terbukti terkalibrasi. Total Kendaraan dihitung dari expectedVolume * 90 tanpa konteks interval pada kartu. Pengguna tidak dapat menghubungkan angka ke periode atau unit agregasinya.

Perbaikan: gunakan label Indeks risiko model sampai tersedia kalibrasi probabilitas; jelaskan unit, interval, area, dan asumsi volume. Definisikan rumus agregasi berdasarkan periode, bukan multiplier tersembunyi.

Lokasi: src/modules/forecastEngine.js:130; src/controllers/analyticsController.js:223.

### 7. ESG memakai angka fallback sebagai nilai teramati — P1, Kode

observedSavings memakai fallback 1420 kg dan 580 liter. Operator || juga mengganti nilai nol yang sah. UI menamai nilai tersebut Teramati di simulator. Ketiadaan data atau hasil nol dapat berubah menjadi penghematan positif.

Perbaikan: gunakan null untuk belum tersedia dan pertahankan nol. Pisahkan hasil model, asumsi skenario, dan pengukuran; setiap angka punya periode, sumber, serta baseline pembanding.

Lokasi: src/modules/forecastEngine.js:314–315.

## Navigasi, shell, dan UI umum

### 8. Skip link dianggap rute halaman — P2, Browser + Kode

Enter pada Lewati ke konten utama mengubah URL ke #mainContent. Delegator router menangkap seluruh a[href^="#"], lalu state currentView menjadi mainContent, yang bukan view terdaftar. ViewLoader menampilkan dashboard sebagai fallback. Skip link semestinya memindahkan fokus tanpa mengganti rute.

Perbaikan: batasi router ke tautan data-view/allowlist rute; biarkan anchor lokal bekerja; fokuskan main dengan tabindex yang sesuai. Tambahkan pengujian dari halaman non-dashboard.

### 9. Status dan peringatan berulang menghabiskan perhatian — P2, Browser + Desain

Shell memiliki status sidebar, topbar, banner offline, banner simulasi; dashboard menambah badge dan penjelasan berulang. Informasi inti bergeser ke bawah, terutama mobile.

Perbaikan: satu strip status yang menunjukkan mode, koneksi, dan pembaruan terakhir; satu penjelasan ringkas simulasi dengan detail yang dapat dibuka. Pertahankan label sumber pada metrik tanpa mengulang paragraf panjang.

### 10. Hirarki visual terlalu datar — P2, Browser + Desain

Banyak kartu memakai bobot visual, border, badge, dan judul serupa. Ada ruang kosong besar pada ringkasan insiden, tetapi detail penting justru memerlukan scroll. Dashboard membuat pengguna membaca banyak panel sebelum tahu tindakan berikutnya.

Perbaikan: tampilkan ringkasan kondisi → insiden prioritas → tindakan yang tersedia → pemantauan pendukung. Gunakan kartu hanya untuk kelompok yang perlu dibedakan; rapikan ritme spacing dan kurangi nesting.

### 11. Bahasa dan satuan tidak konsisten — P2, Browser

Contoh: sec/s/dtk/detik, Inspect, Monitored Intersections, Confidence unavailable, Source: degraded, Simulasi/Simulation. Istilah SITS/ATCS/AI/Webster juga muncul tanpa penjelasan yang cukup.

Perbaikan: Bahasa Indonesia sebagai bahasa utama, detik dan km/jam sebagai satuan konsisten, glosarium kontekstual untuk istilah teknis. Status teknis tetap tersedia di detail diagnostik.

### 12. Pesan gagal tampil dengan ikon sukses — P2, Browser + Kode

Gagal PDF tampil dengan prefix centang sekaligus silang. _showToastNotification hanya memberi ikon peringatan untuk warning/alert; tipe danger jatuh ke ikon centang.

Perbaikan: enum success/info/warning/error dengan ikon, warna, durasi, dan pengumuman aksesibilitas yang konsisten; hindari menambahkan simbol yang sama lagi di isi pesan.

### 13. Search palette menghitung hasil tidak lengkap — P2, Kode

visibleCount hanya menghitung kelompok tujuan halaman, bukan hasil entitas yang dibangun terpisah. Pencarian yang menemukan perangkat/insiden tetapi tidak halaman dapat menyatakan No results bersamaan dengan hasil entitas.

Perbaikan: gabungkan semua hasil terlihat sebelum menghitung count dan empty state, gunakan label Indonesia, dan uji pencarian ID entitas.

Lokasi: src/controllers/navigationController.js:218–232.

### 14. Fondasi tampilan tersebar dan sulit dijaga — P2, Kode

CSS memiliki lapisan shell, token, view, dan design-v2, sementara controller masih membangun HTML dengan style inline dan warna gelap literal. Ini meningkatkan risiko komponen dinamis berbeda dari tema terang dan density pilihan pengguna. Tema terang belum diuji langsung dalam audit ini.

Perbaikan: token semantik untuk warna/status/spacing/typography, kelas komponen yang sama untuk markup statis/dinamis, lalu audit kedua tema. Jangan menambah override CSS terus-menerus tanpa merapikan kepemilikan style.

## Kritik dan penyempurnaan per fitur

### 15. Ikhtisar: satu angka dipresentasikan sebagai konteks berbeda — P2, Browser + Kode

Kepadatan jaringan memakai congestionIndex, sedangkan widget Beban jaringan memakai networkLoad; contoh yang terlihat 63 vs 65, sebelumnya 62 vs 72. Ini bisa sah sebagai dua metrik berbeda, tetapi judul dan penjelasan belum mendefinisikan perbedaannya. Leaderboard/kinerja koridor juga masih berupa persentase contoh statis.

Perbaikan: definisikan masing-masing metrik, gunakan sumber/interval yang sama untuk metrik yang memang identik, dan buat ranking dari data koridor. Lengkapi kartu prioritas dengan alasan prioritas serta tindakan berikutnya. Jangan menampilkan kartu kosong yang tidak membantu.

### 16. Peta: terlalu banyak kontrol lapisan dengan konteks terbatas — P2, Browser + Desain

Peta memiliki toolbar lapisan, kontrol tambahan, legenda, penanda cluster, kondisi jalan, dan overlay kendaraan. Basemap terang dalam shell gelap menambah beban visual; garis lurus koridor demo harus dipahami sebagai representasi model, bukan geometri/rute jalan yang telah divalidasi.

Perbaikan: satu panel layer, pencarian aset, detail pilihan yang konsisten, reset filter, dan legenda yang menjelaskan warna berdasarkan data. Bedakan penanda insiden, kamera, simpang, dan armada secara bentuk/label, bukan warna saja. Pilihan basemap harus selaras tema.

### 17. Legenda peta melampaui lebar mobile — P2, Browser + Kode

Pada viewport 390 px, fullMapLegend memiliki lebar sekitar 539 px, batas kanan sekitar 564 px. Ini bukan bukti page-wide horizontal scroll, tetapi menunjukkan overlay lebih lebar daripada viewport sehingga berisiko terpotong. CSS legend memakai flex dan chip nowrap.

Perbaikan: max-width berbasis container, flex-wrap atau sheet legenda yang dapat dibuka, dan periksa seluruh kontrol agar tidak menutupi peta/attribution.

Lokasi: css/views/map.css:318.

### 18. CCTV: visualisasi tersedia, tetapi konteks pemantauan belum kuat — P2, Browser + Desain

Canvas sintetis dan pilihan kamera termuat. Nama kamera pada panel kecil terpotong dan label HUD kecil. Template awal memuat teks seperti HOST NOT REACHABLE / BUFFER ERROR yang kemudian berubah ketika controller aktif. Pengguna dapat melihat error contoh sebelum status aktual dirender.

Perbaikan: skeleton netral sebelum data siap; metadata kamera berisi nama lengkap, sumber sintetis, waktu frame, status jeda, dan kualitas. Sediakan panel detail/tabel objek sebagai alternatif membaca canvas. Tegaskan bahwa Monokrom/Malam/Termal adalah efek visual simulasi, bukan mode hardware.

### 19. Sinyal: ringkasan kartu belum mewakili seluruh simpang — P2, Browser + Desain

Tabel menampilkan lima simpang, kartu kontrol utama hanya dua. Sesi tanpa peran membuat slider/aksi hilang; pengguna perlu penjelasan yang konsisten tentang akses dan simpang yang sedang dipilih.

Perbaikan: daftar simpang + satu panel detail terpilih, bedakan fase berjalan, durasi hijau konfigurasi, sisa waktu fase, pending command, dan acknowledgement. Pertahankan nilai sebelum command gagal serta tampilkan alasannya.

### 20. Kepadatan sinyal memakai enum yang tidak konsisten — P2, Kode

_renderSignalState menghasilkan density heavy, sedangkan mode grid menerima low/moderate/high. heavy dapat berubah menjadi moderate ketika kelas grid dibentuk.

Perbaikan: gunakan satu enum canonical dan adapter label; uji perpindahan tabel/grid untuk simpang berkepadatan tinggi.

Lokasi: src/controllers/signalsController.js:100, :632.

### 21. Darurat: alur awal belum lengkap untuk dijalankan pengguna — P1/P2, Browser

Sesi demo menampilkan satu skenario dengan ID, ETA, kecepatan, dan lokasi yang belum tersedia; kontrol membutuhkan Operator/Admin. Hero menjelaskan rute Waru → Soetomo, sementara pilihan rute memiliki beberapa variasi. Hubungan skenario hero, form, dan daftar aktif belum jelas.

Perbaikan: pilih skenario → pratinjau rute dan simpang → konfirmasi → progres → pembatalan/selesai → catatan hasil. Tidak ada skenario aktif harus menjadi empty state, bukan kartu aktif yang sebagian besar kosong. Pisahkan skenario contoh dari permintaan aktif.

### 22. Insiden: detail dan waktu kurang membantu — P2, Browser

Daftar dapat ditampilkan dan detail dapat dibuka, tetapi waktu simulasi belum tersedia dan dialog pada sesi ini tidak memberi kronologi yang kaya. Label alur ringkasan hanya Terdeteksi → Ditangani → Selesai, padahal filter menyediakan lebih banyak status.

Perbaikan: satu state machine yang tampil konsisten; timestamp dibuat/diakui/didisposisikan/selesai, sumber, PIC, alasan perubahan, lampiran contoh, dan jejak aktivitas. Beri empty state spesifik ketika hasil filter kosong.

### 23. Analitik: grafik belum cukup untuk menjawab pertanyaan pengguna — P2, Browser + Desain

Kurva tidak menyediakan pembacaan nilai/interval yang memadai. Label peak pagi/sore lebih menonjol daripada sumbu dan unit. Statistik, perbandingan skenario, tabel koridor, dan kalkulator ESG menambah banyak angka dari konteks berbeda.

Perbaikan: chart berdasarkan seri numerik dengan sumbu, tooltip, tabel alternatif, periode, dan baseline. Pisahkan analisis historis, eksplorasi jam model, dan kalkulator asumsi menjadi alur yang jelas.

### 24. Prediksi: jam model dan label besok perlu dibedakan — P2, Browser + Kode

UI memadukan slider 24 jam, proyeksi besok, dan rekomendasi tindakan. Model diurnal belum membuktikan prediksi berbasis tanggal/histori nyata. Tombol Evaluasi 15 skenario model memeriksa perilaku internal model, bukan validasi akurasi lapangan.

Perbaikan: tampilkan tanggal/horizon/asumsi cuaca/skenario, indeks risiko, kualitas input, dan keterbatasan model. Sediakan perubahan asumsi yang dapat ditelusuri; jangan menamai uji fungsi sebagai bukti akurasi prediksi.

### 25. Laporan: riwayat ekspor sebenarnya riwayat pratinjau — P2, Browser + Kode

Membuka pratinjau langsung menambah entry ke Riwayat ekspor, walaupun PDF kemudian gagal. CSV juga tidak menggunakan jalur riwayat yang sama.

Perbaikan: bedakan preview/generated/downloaded/failed; catat format, snapshot ID, waktu, dan status. Riwayat hanya menyatakan ekspor berhasil setelah berkas tersedia.

Lokasi: src/controllers/reportController.js:236, :344.

### 26. Pratinjau dan PDF berpotensi menggunakan snapshot berbeda — P2, Kode

Pratinjau dibuat dari state client, sedangkan unduhan PDF meminta data server kemudian. Tidak ada snapshot ID yang dikirim untuk memastikan nilai tetap sama. Daily/Weekly preview memakai telemetry yang sama; perbedaan cakupan belum diwujudkan sebagai dataset periode.

Perbaikan: freeze satu snapshot untuk preview dan seluruh format ekspor, sertakan periode/sumber/model version. Penamaan harian/mingguan harus sesuai isi, walaupun data tetap sintetis.

### 27. Struktur tabel cetak salah — P2, Kode

#printCorridorRows ditempatkan pada td colspan=5, tetapi _refreshExecutivePrintDocument() menambahkan tr di dalamnya. Struktur seharusnya tbody → tr → td. Hasil cetak belum dirender untuk membuktikan dampak visualnya.

Perbaikan: targetkan tbody dan validasi hasil print/PDF dengan data kosong maupun beberapa baris. Nama Cetak / Simpan PDF juga perlu dibedakan antara membuka print dialog dan unduhan file.

Lokasi: public/views/reportsView.html:184; src/controllers/reportController.js:396.

### 28. Perangkat: tabel terlalu lebar dan pemilihan baris bergantung klik — P2, Browser + Kode

Tabel memiliki sepuluh kolom. _bindTableEvents menggunakan click pada tr; markup row tidak menyediakan tombol detail atau keyboard action setara yang jelas. Pengguna harus menebak bahwa baris dapat dipilih.

Perbaikan: kolom inti nama/status/update/aksi, detail teknis pada drawer, tombol Lihat detail, focus state, navigasi keyboard, dan kartu ringkas pada mobile. Tampilkan permission note dan simpan pending/error konfigurasi dengan jelas.

### 29. Integrasi: sandbox tidak membuktikan koneksi API — P2, Kode + Desain

Kirim ke API Demo menyusun respons dari state client setelah delay lokal; /ping terminal juga mengembalikan pesan contoh. Ini sudah diberi label sandbox, tetapi HTTP method GET dengan request JSON dan status 200 masih bisa disalahartikan sebagai request jaringan sungguhan.

Perbaikan: namai Jalankan contoh lokal, jelaskan payload sebagai input skenario, dan tampilkan endpoint/hasil jaringan nyata hanya ketika memang ada request. Pisahkan explorer API dari simulator respons; berikan validasi schema dan lokasi error JSON.

### 30. Pengaturan: tempat konfigurasi terpecah — P2, Browser + Kode

Pengaturan mengarahkan audio/tema ke topbar. Label checkbox Pembacaan alert memiliki teks tetap Nonaktif walaupun controller mengubah status lain. Preferensi audio diterapkan saat controller pengaturan diinisialisasi, sehingga perlu memeriksa apakah reload di halaman lain memulihkan nilai yang tersimpan.

Perbaikan: kontrol tema/audio juga tersedia di halaman pengaturan, sinkronkan label aktif/nonaktif, terapkan preferensi saat bootstrap, tambahkan preview audio dan reset preferensi. Kurangi prominence ambience dibanding pengaturan alert.

### 31. Chat: attachment tidak benar-benar melampirkan file — P2, Kode

Tombol Kirim file hanya menambah teks Cuplikan Kamera Demo dan memicu balasan otomatis. Pesan hanya berada dalam memory lokal, tanpa komunikasi petugas nyata. UI simulasi perlu menjelaskan perilaku ini tepat pada aksi.

Perbaikan: gunakan Tambahkan contoh cuplikan jika hanya teks; jika menawarkan snapshot, lampirkan gambar canvas yang dapat dibuka. Tampilkan identitas percakapan demo dan status pesan lokal secara konsisten.

### 32. Notifikasi dan bantuan: fokus dan data perlu konsisten — P2, Kode + Desain

Drawer notifikasi role=dialog aria-modal=true ditutup melalui aria-hidden dan CSS, tetapi controller tidak memberi inert atau focus trap setara mobile sidebar. Beberapa modal memakai div + style display manual. Panduan tour menampilkan langkah umum tetapi tidak mengarahkan pengguna menyelesaikan tugas tertentu.

Perbaikan: satu komponen dialog/drawer yang menangani fokus masuk, trap, Escape, inert, dan fokus kembali. Notifikasi harus mengacu insiden sebenarnya dan membedakan menutup pemberitahuan dari menyelesaikan insiden. Tour berorientasi tugas: pilih insiden → lihat peta → inspeksi kamera → tinjau hasil.

## Kualitas pengujian dan arsitektur

### 33. npm test gagal dan menghentikan suite selanjutnya — P1 untuk pipeline kualitas, bukti test

Kegagalan di test/unit/lifecycle.test.js:144: TypeError tbody.closest is not a function, dari src/controllers/deviceController.js:241. Ini menunjukkan stub DOM atau kontrak test perlu diperbaiki; closest tersedia di browser nyata, jadi jangan langsung menganggap perangkat pasti crash di browser.

Runner berhenti pada file pertama yang gagal. Suite unit setelah file ini dan suite integration tidak selesai pada run tersebut. Banyak log error lain berasal dari test stub/injeksi kegagalan, bukan bukti masalah produksi otomatis.

Perbaikan: perbaiki test fixture atau gunakan DOM/browser realistis; tambahkan E2E untuk alur login, override, darurat, PDF, filter analitik, skip link, dan mobile. Test harus memeriksa efek yang terlihat, bukan hanya listener terpasang.

### 34. Lint/build tidak memverifikasi pengalaman pengguna — P2, bukti test

Lint JavaScript memeriksa sintaks, lint CSS memeriksa parse/duplikasi deklarasi, build bundling, validasi PWA memeriksa artefak. Semuanya lolos tetapi tombol Abaikan dan unduhan PDF masih bermasalah.

Perbaikan: tambahkan smoke test browser untuk setiap view dan acceptance test per alur. Visual regression dilakukan untuk desktop/mobile, tema gelap/terang, loading/empty/error, dan modal.

### 35. Lifecycle/request analitik perlu batas yang jelas — P2, Kode

Controller meminta forecast pada input slider dan pembaruan traffic. Token membuang response lama, tetapi deactivate tidak membatalkan request atau menginvalidasi token. Request yang sudah berjalan masih berpotensi memperbarui DOM view yang tidak aktif.

Perbaikan: abort saat deactivation, debounce slider, cache per query, dan render hanya untuk active view/query. Ukur request rate serta latency di browser sebelum mengklaim peningkatan performa.

## Hasil pemeriksaan otomatis

| Pemeriksaan | Hasil | Makna |
| --- | --- | --- |
| npm run lint | Lolos, 163 file JS | Sintaks valid |
| npm run lint:css | Lolos, 23 stylesheet | Parse CSS dan duplikasi deklarasi |
| npm run build | Lolos | Artefak production dapat dibuat |
| npm run validate | Lolos | 37 hashed assets, 5 feature chunks tervalidasi |
| npm test | Gagal di lifecycle.test.js | Run berhenti; bukan semua suite telah dieksekusi |

Build melaporkan initial JS sekitar 221,9 KiB (64,5 KiB gzip), initial CSS 60,6 KiB (12,2 KiB gzip). Ini ukuran artefak, bukan hasil pengukuran kecepatan/konsumsi CPU. Canvas CCTV, peta, dan stream perlu profiling pada perangkat target.

## Rencana perbaikan yang disarankan

### Tahap A — pulihkan alur inti dan kepercayaan data

1. UI login/sesi/peran dan mapping auth error socket.
2. Perbaiki Abaikan, skip link, toast error, serta empty state autentikasi.
3. Samakan kesiapan ekspor, snapshot preview/PDF/CSV, dan riwayat unduhan.
4. Ganti grafik preset dengan dataset bersama; hilangkan filter historis yang belum didukung.
5. Koreksi label probabilitas, volume, dan fallback ESG; nol harus tetap nol.
6. Perbaiki lifecycle test dan jalankan seluruh suite sebelum rilis.

Selesai bila pengguna bisa masuk, memahami mode data, menyelesaikan alur simulasi yang diizinkan, dan mendapat feedback yang sesuai hasil sebenarnya.

### Tahap B — sederhanakan workspace

1. Satukan status global dan ringkas penjelasan simulasi.
2. Jadikan dashboard ringkasan prioritas; detail dipindahkan ke workspace terkait.
3. Satu pola daftar → pilih → detail → aksi → hasil untuk insiden/sinyal/perangkat.
4. Satu toolbar layer peta, overlay mobile yang tidak terpotong, dan konteks aset lintas halaman.
5. Standarkan bahasa, unit, tanggal WIB, badge, ukuran teks, dan komponen status.
6. Rapikan token CSS, style inline, modal, focus management, dan kontras kedua tema.

Selesai bila alur utama dapat dipakai dengan keyboard dan pada mobile tanpa kontrol terpotong atau label ambigu.

### Tahap C — penyempurnaan produk

1. Chart interaktif dengan seri numerik, tooltip, baseline, dan tabel alternatif.
2. Pengelolaan skenario simulasi start/pause/resume/reset yang jelas dan dapat ditelusuri.
3. Timeline insiden/darurat dengan provenance dan hasil command.
4. Snapshot kamera nyata dari canvas, riwayat ekspor konsisten, preferensi pulih saat reload.
5. Browser E2E/visual regression dan profiling CPU/memory/request pada perangkat target.

## Acceptance checklist rilis

- Belum login mendapat tindakan Masuk, bukan loop reconnect tanpa akhir.
- Tidak ada toast sukses untuk operasi gagal atau tidak mengubah state.
- Semua filter mengubah dataset, KPI, grafik, dan ekspor yang sama.
- Zero, unknown, stale, offline, dan simulated dibedakan.
- Preview dan hasil unduhan identik untuk snapshot yang sama.
- Semua aksi penting memiliki status pending/success/error dan jalur pemulihan.
- Peta, tabel, drawer, dan modal berfungsi pada 390 px serta desktop.
- Keyboard bisa membuka detail, menutup modal, dan melanjutkan pekerjaan dengan fokus kembali.
- Seluruh unit/integration yang diwajibkan serta smoke test browser selesai dan lolos.

Prioritas berikutnya sebaiknya Tahap A. Mengubah warna atau menambah animasi sebelum memperbaiki state, sesi, dan kontrak data akan mempertahankan akar masalah.
