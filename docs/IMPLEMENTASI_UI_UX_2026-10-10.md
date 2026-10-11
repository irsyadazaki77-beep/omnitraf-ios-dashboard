# Hasil perbaikan UI/UX OmniTRAF — 10 Oktober 2026

Perbaikan diterapkan langsung pada workspace. Dokumen audit awal tetap disimpan sebagai rekaman temuan, bukan gambaran kondisi sesudah perbaikan. Tidak dilakukan deployment.

## Perubahan utama

- Sesi: dialog masuk, validasi form, status izin, tombol keluar, dan penanganan kegagalan logout server. Kebutuhan autentikasi dibedakan dari koneksi server yang terputus.
- Navigasi: skip link menuju konten; pencarian menghitung hasil halaman dan entitas; menu ponsel bisa berpindah halaman setelah backdrop dipindah ke konteks lapisan sidebar. Halaman belum dapat dioperasikan selama controller masih dimuat.
- Analitik: pilihan koridor mengubah grafik numerik, volume total, kecepatan dan jam puncak. Grafik 24 jam memiliki sumbu, satuan, tooltip serta tabel data. Semua panel model menggunakan satu snapshot client. Histori 7/30 hari dinonaktifkan karena dataset histori belum tersedia.
- Prediksi/ESG: indeks risiko tidak diklaim sebagai probabilitas terkalibrasi. Nilai penghematan yang tidak tersedia tetap kosong; nol terukur tetap nol. Target ESG disimpan lokal.
- Sinyal: kelima simpang memiliki kartu. Slider dan override menggunakan ID simpang, menampilkan durasi saat ini serta durasi terjadwal. Dialog eksperimen +8 detik memakai durasi aktual; penghematan dan arus jenuh yang belum diukur tidak ditampilkan sebagai hasil.
- Darurat: tombol awal membuka konfirmasi tanpa kehilangan listener akibat perpindahan halaman. Kode armada mengikuti kontrak server, pilihan rute hanya memuat rute yang tersedia. Tipe kendaraan pilihan diteruskan ke server. HUD tidak lagi menawarkan hitung mundur lokal sebagai jaminan keselamatan.
- Ikhtisar/insiden/notifikasi: ranking koridor dihitung dari volume terhadap kapasitas; kronologi dan drawer menggunakan insiden sesi; detail menampilkan catatan, status, sumber dan waktu yang tersedia. Abaikan menyembunyikan rekomendasi untuk sesi.
- Laporan: pratinjau, cetak dan PDF memakai snapshot tetap dengan ID dan waktu. PDF dapat diunduh di browser, mendukung beberapa halaman, dan tidak memotong judul simpang dari detailnya. Riwayat dicatat setelah file dibuat. CSV menyertakan konteks snapshot.
- CCTV/chat: placeholder gangguan palsu dihapus; efek visual diberi konteks simulasi; attachment menghasilkan gambar canvas lokal. Peta lengkap memiliki satu kelompok kontrol, legenda mobile membungkus, dan tile OSM menyesuaikan tema gelap.
- Pengaturan: preferensi suara dipulihkan saat startup; reset tema, kepadatan, sidebar, volume, nada, ambience, dan alert langsung menyelaraskan tampilan dan state controller. Pratinjau nada mengikuti pilihan audio. Terminal /ping menguji HTTP endpoint server simulator dan melaporkan kegagalan autentikasi/jaringan.
- Aksesibilitas/perangkat: dialog yang dimuat bersama view dinamis kini dipantau, background dibuat inert, fokus awal/trap/fokus kembali berfungsi, Escape menutup drawer. Drawer perangkat menjadi overlay dengan tombol tutup yang terlihat. Baris contoh statis dihapus agar tidak disalahartikan sebagai hasil nyata sebelum data masuk; metrik null ditampilkan sebagai tidak tersedia.
- Bahasa dan istilah: navigasi dan pengaturan serta label status perangkat diselaraskan ke Bahasa Indonesia. Nilai beban dan indeks kemacetan dipisahkan secara eksplisit sebagai metrik model.

## Pelacakan 35 temuan audit

“Diperbaiki” berarti perilaku yang ditemukan telah diubah; bukan sertifikasi bebas cacat. “Sebagian” mencatat penyempurnaan yang memerlukan pekerjaan produk tambahan.

| No. | Temuan | Status hasil |
| --- | --- | --- |
| 1 | Tidak ada login | Diperbaiki: form sesi tersedia |
| 2 | Autentikasi dianggap koneksi rusak | Diperbaiki: status dan tindakan masuk berbeda |
| 3 | Unduhan PDF gagal | Diperbaiki: PDF browser dari snapshot |
| 4 | Abaikan tidak bekerja | Diperbaiki: kartu disembunyikan dalam sesi |
| 5 | Filter analitik kosmetik | Diperbaiki: seri dan KPI per koridor |
| 6 | Makna probabilitas/volume berlebihan | Diperbaiki: indeks risiko dan satuan model |
| 7 | ESG menggunakan angka fallback | Diperbaiki: nilai tidak diketahui bukan hasil teramati |
| 8 | Skip link menjadi rute | Diperbaiki: fokus konten utama |
| 9 | Peringatan berulang | Diperbaiki: batas simulasi diringkas dan bisa diperluas |
| 10 | Hirarki visual datar | Disempurnakan: strip prioritas, KPI, dan aksi utama mendapat urutan jelas; evaluasi operator tetap diperlukan |
| 11 | Bahasa/satuan | Disempurnakan: navigasi, metrik dan pengaturan memakai Bahasa Indonesia; singkatan/proper noun teknis dipertahankan |
| 12 | Ikon sukses untuk galat | Diperbaiki: warna, ikon dan pengumuman sesuai jenis pesan |
| 13 | Hitungan palette | Diperbaiki: entitas ikut dihitung |
| 14 | Style tersebar | Sebagian: komponen yang disentuh memakai token dan style responsif terpusat; legacy inline style masih tersebar |
| 15 | Metrik/ranking ikhtisar | Diperbaiki dalam model demo: ranking volume/kapasitas, indeks 0–100, dan beban model memiliki label serta definisi terpisah; belum mewakili metrik lapangan |
| 16 | Kontrol peta menumpuk | Diperbaiki: kontrol ganda peta lengkap dihapus; deck dapat ditutup |
| 17 | Legenda mobile melampaui layar | Diperbaiki: pembungkusan pada layar kecil |
| 18 | Konteks CCTV | Diperbaiki untuk demo: provenance dan efek sintetis diberi label; feed CCTV lapangan belum terhubung |
| 19 | Kartu simpang tidak lengkap | Diperbaiki: semua simpang tersedia |
| 20 | Enum kepadatan | Diperbaiki: high/moderate/low konsisten |
| 21 | Alur darurat gagal | Diperbaiki: konfirmasi, rute valid, identitas valid, tipe kendaraan, pembatalan |
| 22 | Detail/waktu insiden | Diperbaiki: data record aktual dan waktu WIB yang tersedia |
| 23 | Grafik tidak cukup informatif | Diperbaiki: sumbu/satuan/data numerik 24 jam |
| 24 | Jam model vs besok | Diperbaiki: konteks jam simulasi diperjelas |
| 25 | Riwayat sebenarnya pratinjau | Diperbaiki: pencatatan setelah file dibuat |
| 26 | Snapshot PDF berbeda | Diperbaiki: snapshot tetap untuk seluruh format laporan |
| 27 | Tabel cetak salah | Diperbaiki: penulisan ke tbody |
| 28 | Perangkat desktop/mobile | Diperbaiki: state awal tidak menampilkan baris hardware palsu, kartu responsif punya aksi eksplisit, drawer detail menjadi overlay, nilai unknown tidak tampil sebagai nol |
| 29 | Sandbox bukan bukti API | Diperbaiki dalam lingkup demo: contoh lokal tetap diberi label; /ping memeriksa server nyata lokal |
| 30 | Preferensi tersebar | Diperbaiki: reset menyeluruh, pratinjau nada, startup restore, status sakelar dan state controller tersinkron |
| 31 | Attachment hanya teks | Diperbaiki: gambar canvas menjadi attachment lokal |
| 32 | Fokus dialog/notifikasi/tour | Diperbaiki pada modal dan drawer yang tersedia: view dinamis terdaftar, background inert, fokus terperangkap/dikembalikan, Escape aktif, tour berorientasi tugas dan memiliki aksi tujuan |
| 33 | Suite berhenti karena fixture | Diperbaiki: fixture DOM dan pipeline pengujian lengkap |
| 34 | Build bukan bukti UX | Sebagian: seluruh 31 berkas suite lulus dan smoke browser mencakup halaman utama, drawer, tour, reset preferensi, responsif, serta alur domain; otomatisasi E2E/visual regression lintas browser masih belum dibuat |
| 35 | Lifecycle analitik | Diperbaiki: invalidasi, pembatasan active view, debounce, satu sumber snapshot |

## Bukti pengujian

- Suite npm test: 31 file unit/integrasi, termasuk pengujian koridor, unknown/zero, snapshot/CSV/PDF, tipe kendaraan/rute/pembatalan, dan respons ping server.
- Lint JavaScript: 168 file; lint CSS: 24 stylesheet. Build dan validasi frontend production/PWA dijalankan.
- Browser desktop: ikhtisar, peta, CCTV, sinyal, perangkat, insiden, analitik, prediksi, laporan, integrasi dan pengaturan dapat dibuka. Pemeriksaan galat console pada lintasan sembilan halaman tidak menemukan error. Pengujian drawer membuktikan overlay, fokus tombol tutup, inert background, Escape, dan pengembalian fokus. Tour terpusat dan seluruh enam tahapan memiliki tujuan yang dapat dibuka.
- Browser 390 × 844: menu menuju darurat/peta bekerja; legenda peta tidak melewati layar. Viewport override dipulihkan sesudah pengujian.
- Darurat: AMB-QA-08 menggunakan MERR; UNIT-QA-11 dipilih sebagai Pemadam, server menampilkan PMK, lalu pembatalan langsung dikonfirmasi dan prioritas aktif menjadi nol.
- Rekomendasi: Wonokromo 35 menjadi target 43 detik di dialog dan perintah server; hasil penghematan tidak dibuat-buat.
- Analitik: A. Yani dan MERR menghasilkan volume berbeda, label koridor berubah, 24 nilai per jam tersedia; tema terang diperiksa setelah halaman siap.
- PDF unduhan browser diperiksa teksnya terhadap ID/waktu/metrik pratinjau. PDF QA berisi 30 simpang dirender menjadi empat halaman; judul dan detail simpang tetap bersama, nilai nol tetap nol.
- Reset preferensi: tema terang, kepadatan lapang, dan kepadatan/tema tersimpan diuji melalui UI; tombol reset mengembalikan tema gelap, kepadatan rapat, output audio, ambience, dan status pembacaan tanpa toast tema tambahan.
- Screenshot: output/qa/dashboard-dark.jpg, output/qa/analytics-light.jpg, output/qa/map-mobile.jpg. PDF QA: output/pdf/report-qa.pdf.

Pengujian mutasi browser menggunakan server simulator port 3001 dengan DB_PATH menunjuk database sementara terpisah. Ini tidak menguji infrastruktur APILL, CCTV, GPS, layanan 112, PostgreSQL atau Redis produksi. Perubahan awal workspace yang sudah ada dipertahankan.

## Penyempurnaan yang masih memerlukan keputusan/data

Histori nyata, validasi model prediksi, pengukuran manfaat optimasi, dan integrasi lapangan memerlukan dataset serta akses layanan yang belum tersedia di workspace. Metrik operasional lapangan harus disepakati pemilik produk/operator sebelum dibandingkan dengan hasil nyata. Riset kegunaan memerlukan partisipan operator; E2E/visual regression otomatis lintas browser dan refaktor seluruh style lama masih menjadi pekerjaan engineering lanjutan. Fitur demo diberi batas yang jelas dan kontrol untuk data yang belum tersedia dinonaktifkan.
