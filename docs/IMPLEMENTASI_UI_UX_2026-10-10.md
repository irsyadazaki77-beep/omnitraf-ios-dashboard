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
- Pengaturan: preferensi suara dipulihkan saat startup; suara dan tema dapat diakses dari halaman pengaturan. Alert suara tetap berdasarkan pilihan pengguna. Terminal /ping menguji HTTP endpoint server simulator dan melaporkan kegagalan autentikasi/jaringan.

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
| 10 | Hirarki visual datar | Disempurnakan: kontrol dan status lebih ringkas; tetap perlu evaluasi pengguna |
| 11 | Bahasa/satuan | Disempurnakan: alur utama memakai label Indonesia; istilah teknis masih ada |
| 12 | Ikon sukses untuk galat | Diperbaiki: warna, ikon dan pengumuman sesuai jenis pesan |
| 13 | Hitungan palette | Diperbaiki: entitas ikut dihitung |
| 14 | Style tersebar | Sebagian: warna dinamis memakai token; refaktor seluruh CSS/inline belum selesai |
| 15 | Metrik/ranking ikhtisar | Sebagian: ranking dinamis; definisi metrik beban vs kepadatan masih perlu spesifikasi produk |
| 16 | Kontrol peta menumpuk | Diperbaiki: kontrol ganda peta lengkap dihapus; deck dapat ditutup |
| 17 | Legenda mobile melampaui layar | Diperbaiki: pembungkusan pada layar kecil |
| 18 | Konteks CCTV | Disempurnakan: sumber dan efek simulasi diperjelas |
| 19 | Kartu simpang tidak lengkap | Diperbaiki: semua simpang tersedia |
| 20 | Enum kepadatan | Diperbaiki: high/moderate/low konsisten |
| 21 | Alur darurat gagal | Diperbaiki: konfirmasi, rute valid, identitas valid, tipe kendaraan, pembatalan |
| 22 | Detail/waktu insiden | Diperbaiki: data record aktual dan waktu WIB yang tersedia |
| 23 | Grafik tidak cukup informatif | Diperbaiki: sumbu/satuan/data numerik 24 jam |
| 24 | Jam model vs besok | Diperbaiki: konteks jam simulasi diperjelas |
| 25 | Riwayat sebenarnya pratinjau | Diperbaiki: pencatatan setelah file dibuat |
| 26 | Snapshot PDF berbeda | Diperbaiki: snapshot tetap untuk seluruh format laporan |
| 27 | Tabel cetak salah | Diperbaiki: penulisan ke tbody |
| 28 | Perangkat desktop/mobile | Sebagian: aksi detail/keyboard dan scroll tabel tersedia; desain kartu mobile khusus belum dibuat |
| 29 | Sandbox bukan bukti API | Diperbaiki dalam lingkup demo: contoh lokal tetap diberi label; /ping memeriksa server nyata lokal |
| 30 | Preferensi tersebar | Sebagian: tema/suara terpusat dan startup restore; reset menyeluruh belum dibuat |
| 31 | Attachment hanya teks | Diperbaiki: gambar canvas menjadi attachment lokal |
| 32 | Fokus dialog/notifikasi/tour | Sebagian: fokus, Escape, inert dan data diperbaiki; tour berorientasi tugas belum ditulis ulang |
| 33 | Suite berhenti karena fixture | Diperbaiki: fixture DOM dan pipeline pengujian lengkap |
| 34 | Build bukan bukti UX | Sebagian: pemeriksaan browser dan test regresi ditambahkan; suite E2E/visual regression otomatis belum dibuat |
| 35 | Lifecycle analitik | Diperbaiki: invalidasi, pembatasan active view, debounce, satu sumber snapshot |

## Bukti pengujian

- Suite npm test: 31 file unit/integrasi, termasuk pengujian koridor, unknown/zero, snapshot/CSV/PDF, tipe kendaraan/rute/pembatalan, dan respons ping server.
- Lint JavaScript: 168 file; lint CSS: 24 stylesheet. Build dan validasi frontend production/PWA dijalankan.
- Browser desktop: ikhtisar, peta, CCTV, sinyal, perangkat, insiden, analitik, prediksi, laporan, integrasi dan pengaturan dapat dibuka. Pemeriksaan galat console pada lintasan sembilan halaman tidak menemukan error.
- Browser 390 × 844: menu menuju darurat/peta bekerja; legenda peta tidak melewati layar. Viewport override dipulihkan sesudah pengujian.
- Darurat: AMB-QA-08 menggunakan MERR; UNIT-QA-11 dipilih sebagai Pemadam, server menampilkan PMK, lalu pembatalan langsung dikonfirmasi dan prioritas aktif menjadi nol.
- Rekomendasi: Wonokromo 35 menjadi target 43 detik di dialog dan perintah server; hasil penghematan tidak dibuat-buat.
- Analitik: A. Yani dan MERR menghasilkan volume berbeda, label koridor berubah, 24 nilai per jam tersedia; tema terang diperiksa setelah halaman siap.
- PDF unduhan browser diperiksa teksnya terhadap ID/waktu/metrik pratinjau. PDF QA berisi 30 simpang dirender menjadi empat halaman; judul dan detail simpang tetap bersama, nilai nol tetap nol.
- Screenshot: output/qa/dashboard-dark.jpg, output/qa/analytics-light.jpg, output/qa/map-mobile.jpg. PDF QA: output/pdf/report-qa.pdf.

Pengujian mutasi browser menggunakan server simulator port 3001 dengan DB_PATH menunjuk database sementara terpisah. Ini tidak menguji infrastruktur APILL, CCTV, GPS, layanan 112, PostgreSQL atau Redis produksi. Perubahan awal workspace yang sudah ada dipertahankan.

## Penyempurnaan yang masih memerlukan keputusan/data

Histori nyata, validasi model prediksi, pengukuran manfaat optimasi, integrasi lapangan, definisi metrik operasional, riset kegunaan dengan operator, refaktor style menyeluruh, desain kartu perangkat mobile, reset preferensi, tour berbasis tugas, serta E2E/visual regression otomatis belum dapat dianggap selesai. Fitur demo diberi batas yang jelas dan kontrol untuk data yang belum tersedia dinonaktifkan.
