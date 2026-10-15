# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.js >> Phase 5 accessibility sweep across all views and themes
- Location: tests\e2e\accessibility.spec.js:8:1

# Error details

```
Error: Serious/critical axe findings across all routes and themes

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 17

- Array []
+ Array [
+   Object {
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": Array [
+       Object {
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.12 (foreground color: #ffffff, background color: #ecf2fe, font size: 9.4pt (12.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "target": Array [
+           "a[aria-label=\"Digital Twin 3D\"] > .nav-icon[aria-hidden=\"true\"]",
+         ],
+       },
+     ],
+     "route": "view-city3d",
+     "theme": "light",
+   },
+ ]
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - link "Lewati ke konten utama" [ref=e2] [cursor=pointer]:
    - /url: "#mainContent"
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - link "OmniTRAF home" [ref=e5] [cursor=pointer]:
        - /url: "#dashboard"
        - img "Ikon OmniTRAF SITS Surabaya" [ref=e7]
        - generic [ref=e8]:
          - img "Logo OmniTRAF Adaptive Urban Mobility System" [ref=e9]
          - generic [ref=e10]: Surabaya Command Center
      - button "Ciutkan sidebar" [expanded] [ref=e11] [cursor=pointer]:
        - generic [ref=e14]: Collapse sidebar
      - button "Cari halaman Ctrl K" [ref=e15] [cursor=pointer]:
        - generic [ref=e20]:
          - text: Cari halaman
          - generic [ref=e21]: Ctrl K
      - navigation "Primary navigation" [ref=e22]:
        - region [ref=e23]:
          - heading "Operasi" [level=2] [ref=e24]
          - link "Ikhtisar" [ref=e25] [cursor=pointer]:
            - /url: "#dashboard"
          - link "Peta kota" [ref=e33] [cursor=pointer]:
            - /url: "#map"
          - link "Digital Twin 3D" [ref=e39] [cursor=pointer]:
            - /url: "#city3d"
            - generic [aria-hidden] [ref=e40]: 3D
          - link "Insiden" [ref=e42] [cursor=pointer]:
            - /url: "#incidents"
          - link "Darurat" [ref=e47] [cursor=pointer]:
            - /url: "#emergency"
        - region [ref=e52]:
          - heading "Pemantauan" [level=2] [ref=e53]
          - link "CCTV" [ref=e54] [cursor=pointer]:
            - /url: "#cctv"
          - link "Sinyal" [ref=e61] [cursor=pointer]:
            - /url: "#signals"
          - link "Perangkat" [ref=e69] [cursor=pointer]:
            - /url: "#devices"
        - region [ref=e75]:
          - heading "Analitik & prediksi" [level=2] [ref=e76]
          - link "Analitik" [ref=e77] [cursor=pointer]:
            - /url: "#analytics"
          - link "Prediksi" [ref=e83] [cursor=pointer]:
            - /url: "#prediction"
          - button "Intelijen sinyal" [ref=e89] [cursor=pointer]
          - link "Laporan" [ref=e94] [cursor=pointer]:
            - /url: "#reports"
            - generic [aria-hidden] [ref=e95]: ▤
        - region [ref=e97]:
          - heading "Sistem" [level=2] [ref=e98]
          - link "Integrasi" [ref=e99] [cursor=pointer]:
            - /url: "#integration"
          - link "Pengaturan" [ref=e105] [cursor=pointer]:
            - /url: "#settings"
          - link "Arsitektur sistem" [ref=e109] [cursor=pointer]:
            - /url: "#about-engine"
    - main [ref=e114]:
      - generic "Navigasi halaman" [ref=e115]:
        - generic [ref=e117]:
          - generic [ref=e118]: OMNITRAF · SIMULASI
          - strong [ref=e119]: Pengaturan
        - generic "Aksi utama" [ref=e120]:
          - button "Cari Ctrl K" [ref=e121] [cursor=pointer]:
            - generic [aria-hidden] [ref=e122]: ⌕
            - generic [ref=e123]: Cari
            - generic [ref=e124]: Ctrl K
          - generic "Status prototipe OmniTRAF" [ref=e125]:
            - generic [ref=e126]: Selasa, 13 Okt 2026 | 18.43 WIB
            - strong [ref=e129]: Server Simulasi Tersambung
          - generic [ref=e130]:
            - button "Ganti ke tema gelap" [active] [pressed] [ref=e131] [cursor=pointer]:
              - generic [aria-hidden] [ref=e132]: ☼
            - 'button "Active scenario notifications: 3" [ref=e133] [cursor=pointer]':
              - generic [ref=e137]: "3"
            - group [ref=e138]:
              - generic "Aksi lainnya" [ref=e139] [cursor=pointer]: ···
          - button "Sesi Operator Demo. Kontrol keluar tersedia di navigasi." [ref=e140] [cursor=pointer]:
            - generic [aria-hidden] [ref=e142]: OD
            - generic [ref=e143]:
              - strong [ref=e144]: Operator Demo
              - generic [ref=e145]: Operator
          - button "Keluar" [ref=e146] [cursor=pointer]
      - group "Batas simulasi" [ref=e147]:
        - generic [ref=e148] [cursor=pointer]:
          - strong [ref=e149]: SIMULASI
          - text: Data sintetis · tanpa kendali perangkat lapangan
      - generic [ref=e150]:
        - text: · · · · · · · · · · · ·
        - generic [ref=e151]:
          - article [ref=e152]:
            - generic [ref=e153]:
              - paragraph [ref=e154]: PREFERENSI WORKSPACE
              - heading "Pengaturan Antarmuka & Sistem" [level=2] [ref=e155]
              - paragraph [ref=e156]: Kelola tema tampilan, profil audio interaktif, pintasan aksesibilitas, dan preferensi runtime.
            - generic [ref=e157]: UI PREFERENCES
          - generic [ref=e158]:
            - navigation "Kategori Pengaturan" [ref=e159]:
              - list [ref=e160]:
                - listitem [ref=e161]:
                  - link "Tampilan" [ref=e162] [cursor=pointer]:
                    - /url: "#settings-cat-appearance"
                    - generic [aria-hidden] [ref=e163]: 🎨
                - listitem [ref=e165]:
                  - link "Audio & Notifikasi" [ref=e166] [cursor=pointer]:
                    - /url: "#settings-cat-audio"
                    - generic [aria-hidden] [ref=e167]: 🔊
                - listitem [ref=e169]:
                  - link "Aksesibilitas" [ref=e170] [cursor=pointer]:
                    - /url: "#settings-cat-accessibility"
                    - generic [aria-hidden] [ref=e171]: ♿
                - listitem [ref=e173]:
                  - link "Sistem & Reset" [ref=e174] [cursor=pointer]:
                    - /url: "#settings-cat-system"
                    - generic [aria-hidden] [ref=e175]: ⚙️
            - generic [ref=e177]:
              - generic [ref=e178]:
                - generic [ref=e179]:
                  - heading "🎨 Tampilan & Layout" [level=3] [ref=e180]
                  - paragraph [ref=e181]: Konfigurasi tema warna dan tingkat kepadatan ruang kerja.
                - generic [ref=e182]:
                  - generic [ref=e183]:
                    - generic [ref=e184]:
                      - strong [ref=e185]: Tema Visual
                      - paragraph [ref=e186]: Pilih mode kontras tinggi (Gelap) atau mode terang untuk ruang kontrol.
                    - button "Ganti tema terang atau gelap" [ref=e187] [cursor=pointer]
                  - generic [ref=e188]:
                    - generic [ref=e189]:
                      - strong [ref=e190]: Kepadatan Antarmuka
                      - paragraph [ref=e191]: Sesuaikan jarak vertikal antarelemen (Rapat untuk monitor ringkas, Lapang untuk layar besar).
                    - group "Kepadatan antarmuka" [ref=e192]:
                      - button "Rapat" [pressed] [ref=e193] [cursor=pointer]
                      - button "Lapang" [ref=e194] [cursor=pointer]
              - generic [ref=e195]:
                - generic [ref=e196]:
                  - heading "🔊 Audio & Notifikasi Suara" [level=3] [ref=e197]
                  - paragraph [ref=e198]: Umpan balik audio sintetis dan ambience kota Surabaya.
                - generic [ref=e199]:
                  - generic [ref=e200]:
                    - generic [ref=e201]:
                      - strong [ref=e202]: Suara Interaksi
                      - paragraph [ref=e203]: Umpan balik audio sintetis saat menekan tombol dan filter.
                    - button "Matikan suara" [pressed] [ref=e204] [cursor=pointer]
                  - generic [ref=e206]:
                    - strong [ref=e207]: Volume & Karakter Nada
                    - paragraph [ref=e208]: Atur tingkat desibel klik dan pilih karakteristik synthesizer.
                    - generic [ref=e209]:
                      - generic [ref=e210]: "Volume:"
                      - slider "Volume:" [ref=e211] [cursor=pointer]: "70"
                      - status [ref=e212]: 70%
                      - generic [ref=e213]: "Nada:"
                      - combobox "Tipe audio sintetis" [ref=e214]:
                        - option "Klik mekanis" [selected]
                        - option "Synthesizer digital"
                        - option "Nada retro"
                      - button "Pratinjau nada" [ref=e215] [cursor=pointer]
                    - status [ref=e216]: Pratinjau memakai nada dan volume yang dipilih.
                  - generic [ref=e217]:
                    - generic [ref=e218]:
                      - strong [ref=e219]: Ambience Lalu Lintas Kota
                      - paragraph [ref=e220]: Putar efek suara latar sintetis perkotaan Surabaya secara opsional.
                      - generic [ref=e221]:
                        - generic [ref=e222]: "Volume:"
                        - slider "Volume:" [ref=e223] [cursor=pointer]: "30"
                        - status [ref=e224]: 30%
                    - generic [ref=e225]:
                      - generic [ref=e226] [cursor=pointer]:
                        - checkbox "Nonaktif" [ref=e227]
                        - generic [ref=e228]: Nonaktif
                      - status [ref=e229]: Ambience berhenti sampai diaktifkan.
                  - generic [ref=e230]:
                    - generic [ref=e231]:
                      - strong [ref=e232]: Pembacaan Notifikasi (TTS Voice)
                      - paragraph [ref=e233]: Sintesis suara browser untuk pemberitahuan insiden lalu lintas baru (Opt-in eksplisit).
                    - generic [ref=e234]:
                      - generic [ref=e235] [cursor=pointer]:
                        - checkbox "Nonaktif" [ref=e236]
                        - generic [ref=e237]: Nonaktif
                      - status [ref=e238]: Pembacaan alert nonaktif.
              - generic [ref=e239]:
                - generic [ref=e240]:
                  - heading "♿ Aksesibilitas & Navigasi Keyboard" [level=3] [ref=e241]
                  - paragraph [ref=e242]: Panduan pintasan cepat dan kompatibilitas sistem operasional.
                - generic [ref=e243]:
                  - generic [ref=e244]:
                    - generic [ref=e245]:
                      - strong [ref=e246]: Pintasan Papan Ketik (Keyboard Shortcuts)
                      - paragraph [ref=e247]: Daftar kombinasi tombol pintas untuk operator ruang kendali.
                    - button "Tampilkan panduan pintasan" [ref=e248] [cursor=pointer]
                  - generic [ref=e249]:
                    - generic [ref=e250]:
                      - strong [ref=e251]: Navigasi Cepat Global
                      - paragraph [ref=e252]: "Buka Command Palette kapan saja dengan menekan tombol pintas:"
                    - generic [ref=e253]: Ctrl / Cmd + K
                  - generic [ref=e254]:
                    - generic [ref=e255]:
                      - strong [ref=e256]: Pengurangan Gerak (Reduced Motion)
                      - paragraph [ref=e257]: Animasi antarmuka secara otomatis menghormati preferensi prefers-reduced-motion dari OS Anda.
                    - generic [ref=e258]: OTOMATIS (OS ALIGNED)
              - generic [ref=e259]:
                - generic [ref=e260]:
                  - heading "⚙️ Informasi Sistem & Pemulihan" [level=3] [ref=e261]
                  - paragraph [ref=e262]: Informasi batasan prototipe dan reset preferensi lokal.
                - generic [ref=e263]:
                  - generic [ref=e264]:
                    - generic [ref=e265]:
                      - strong [ref=e266]: Batasan Lingkungan Demo
                      - paragraph [ref=e267]: OmniTRAF pada platform ini beroperasi dalam mode emulasi dan tidak terhubung ke APILL fisik Dishub.
                    - generic [ref=e268]: SIMULASI SAJA
                  - generic [ref=e269]:
                    - generic [ref=e270]:
                      - strong [ref=e271]: Pulihkan Preferensi Antarmuka
                      - paragraph [ref=e272]: Kembalikan tema, kepadatan, volume, dan pengaturan suara ke nilai standar bawaan.
                    - button "Pulihkan preferensi" [ref=e273] [cursor=pointer]
  - dialog [aria-hidden] [ref=e274]:
    - generic [ref=e275]:
      - generic [ref=e276]:
        - generic [ref=e277]: 🔔
        - generic [ref=e278]:
          - heading [level=3] [ref=e279]: Contoh Skenario Insiden
          - paragraph [ref=e280]: Data demo, bukan laporan operasional
      - button [ref=e281] [cursor=pointer]: ×
    - generic [ref=e282]:
      - article [ref=e283]:
        - generic [ref=e284]:
          - generic [ref=e285]: ⚠️ BARU (Open)
          - generic [ref=e286]: 18.38 WIB
        - strong [ref=e287]: Skenario kendaraan mogok - Simpang demo 01
        - paragraph [ref=e288]: Skenario contoh; tidak ada petugas atau unit derek yang ditugaskan.
        - generic [ref=e289]:
          - button [ref=e290] [cursor=pointer]: 📍 Buka di Peta
          - button [ref=e291] [cursor=pointer]: Akui skenario
      - article [ref=e292]:
        - generic [ref=e293]:
          - generic [ref=e294]: ✓ Diakui · menunggu disposisi
          - generic [ref=e295]: 18.28 WIB
        - strong [ref=e296]: Skenario genangan air - Koridor demo 02
        - paragraph [ref=e297]: Skenario contoh genangan; bukan pengukuran atau laporan lapangan.
        - generic [ref=e298]:
          - button [ref=e299] [cursor=pointer]: 📍 Buka di Peta
          - button [ref=e300] [cursor=pointer]: Disposisi simulasi
      - article [ref=e301]:
        - generic [ref=e302]:
          - generic [ref=e303]: ⚠️ BARU (Open)
          - generic [ref=e304]: 18.33 WIB
        - strong [ref=e305]: Skenario antrean panjang - Simpang demo 03
        - paragraph [ref=e306]: Antrean sintetis 180 meter pada skenario simulator.
        - generic [ref=e307]:
          - button [ref=e308] [cursor=pointer]: 📍 Buka di Peta
          - button [ref=e309] [cursor=pointer]: Akui skenario
  - status [ref=e311]: ✓ Notifikasi
  - status:
    - status [ref=e312]:
      - generic [ref=e313]: ✓
      - generic [ref=e314]: Tema diubah ke Gelap (Night Radar).
    - status [ref=e315]:
      - generic [ref=e316]: ⚠
      - generic [ref=e317]: Penundaan koneksi data terdeteksi. Mencoba ulang...
    - status [ref=e318]:
      - generic [ref=e319]: ✓
      - generic [ref=e320]: Tema diubah ke Terang (Day Mode).
```