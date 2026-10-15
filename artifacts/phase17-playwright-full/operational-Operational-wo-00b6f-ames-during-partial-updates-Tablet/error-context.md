# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: operational.spec.js >> Operational workspace interactions >> 3D consumes the same CCTV detections and preserves camera frames during partial updates
- Location: tests\e2e\operational.spec.js:54:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "cctvCanvas1-v-sync"
Received string:    "cctvCanvas1-v1,cctvCanvas1-v2,cctvCanvas1-v4,cctvCanvas1-v5,cctvCanvas1-v6,cctvCanvas1-v8,cctvCanvas2-v3,cctvCanvas2-v5,cctvCanvas2-v7,cctvCanvas2-v8,cctvCanvas3-v2,cctvCanvas3-v6,cctvCanvas3-v7,cctvCanvas3-v8,cctvCanvas3-v9,cctvCanvas3-v11,cctvCanvas4-v1,cctvCanvas4-v4,cctvCanvas4-v5,cctvCanvas4-v8,cctvCanvas4-v9,cctvCanvas4-v11,cctvCanvas2-v1,cctvCanvas2-v6,cctvCanvas3-v3,cctvCanvas3-v4,cctvCanvas1-v0,cctvCanvas1-v3,cctvCanvas1-v10,cctvCanvas2-v0,cctvCanvas2-v9,cctvCanvas2-v10,cctvCanvas3-v0,cctvCanvas3-v5,cctvCanvas4-v0,cctvCanvas4-v6,cctvCanvas1-v7,cctvCanvas1-v11,cctvCanvas2-v2,cctvCanvas2-v11,cctvCanvas4-v3,cctvCanvas4-v7,cctvCanvas1-v9,cctvCanvas2-v4,cctvCanvas3-v1,cctvCanvas3-v10,cctvCanvas4-v2,cctvCanvas4-v10"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Lewati ke konten utama" [ref=e2] [cursor=pointer]:
    - /url: "#mainContent"
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - button "Tutup menu" [ref=e5] [cursor=pointer]: ×
      - link "OmniTRAF home" [ref=e6] [cursor=pointer]:
        - /url: "#dashboard"
        - img "Ikon OmniTRAF SITS Surabaya" [ref=e8]
        - generic [ref=e9]:
          - img "Logo OmniTRAF Adaptive Urban Mobility System" [ref=e10]
          - generic [ref=e11]: Surabaya Command Center
      - button "Cari halaman Ctrl K" [ref=e12] [cursor=pointer]:
        - generic [ref=e17]:
          - text: Cari halaman
          - generic [ref=e18]: Ctrl K
      - navigation "Primary navigation" [ref=e19]:
        - region [ref=e20]:
          - heading "Operasi" [level=2] [ref=e21]
          - link "Ikhtisar" [ref=e22] [cursor=pointer]:
            - /url: "#dashboard"
          - link "Peta kota" [ref=e30] [cursor=pointer]:
            - /url: "#map"
          - link "Digital Twin 3D" [ref=e36] [cursor=pointer]:
            - /url: "#city3d"
            - generic [aria-hidden] [ref=e37]: 3D
          - link "Insiden" [ref=e39] [cursor=pointer]:
            - /url: "#incidents"
          - link "Darurat" [ref=e44] [cursor=pointer]:
            - /url: "#emergency"
        - region [ref=e49]:
          - heading "Pemantauan" [level=2] [ref=e50]
          - link "CCTV" [ref=e51] [cursor=pointer]:
            - /url: "#cctv"
          - link "Sinyal" [ref=e58] [cursor=pointer]:
            - /url: "#signals"
          - link "Perangkat" [ref=e66] [cursor=pointer]:
            - /url: "#devices"
        - region [ref=e72]:
          - heading "Analitik & prediksi" [level=2] [ref=e73]
          - link "Analitik" [ref=e74] [cursor=pointer]:
            - /url: "#analytics"
          - link "Prediksi" [ref=e80] [cursor=pointer]:
            - /url: "#prediction"
          - button "Intelijen sinyal" [ref=e86] [cursor=pointer]
          - link "Laporan" [ref=e91] [cursor=pointer]:
            - /url: "#reports"
            - generic [aria-hidden] [ref=e92]: ▤
        - region [ref=e94]:
          - heading "Sistem" [level=2] [ref=e95]
          - link "Integrasi" [ref=e96] [cursor=pointer]:
            - /url: "#integration"
          - link "Pengaturan" [ref=e102] [cursor=pointer]:
            - /url: "#settings"
          - link "Arsitektur sistem" [ref=e106] [cursor=pointer]:
            - /url: "#about-engine"
          - button "Demo Coordination Chat" [ref=e111] [cursor=pointer]
    - main [ref=e116]:
      - generic "Navigasi halaman" [ref=e117]:
        - generic [ref=e118]:
          - button "Buka menu" [ref=e119] [cursor=pointer]
          - generic [ref=e123]:
            - generic [ref=e124]: OMNITRAF · SIMULASI
            - strong [ref=e125]: Digital Twin 3D
        - generic "Aksi utama" [ref=e126]:
          - button "Cari Ctrl K" [ref=e127] [cursor=pointer]:
            - generic [aria-hidden] [ref=e128]: ⌕
            - generic [ref=e129]: Cari
            - generic [ref=e130]: Ctrl K
          - generic "Status prototipe OmniTRAF" [ref=e131]:
            - strong [ref=e134]: Server Simulasi Tersambung
          - generic [ref=e135]:
            - button "Ganti ke tema terang" [ref=e136] [cursor=pointer]:
              - generic [aria-hidden] [ref=e137]: ☾
            - 'button "Active scenario notifications: 3" [ref=e138] [cursor=pointer]':
              - generic [ref=e142]: "3"
            - group [ref=e143]:
              - generic "Aksi lainnya" [ref=e144] [cursor=pointer]: ···
          - button "Sesi Operator Demo. Kontrol keluar tersedia di navigasi." [ref=e145] [cursor=pointer]:
            - generic [aria-hidden] [ref=e147]: OD
          - button "Keluar" [ref=e148] [cursor=pointer]
      - group "Batas simulasi" [ref=e149]:
        - generic [ref=e150] [cursor=pointer]:
          - strong [ref=e151]: SIMULASI
          - text: Data sintetis · tanpa kendali perangkat lapangan
      - generic [ref=e153]:
        - generic [ref=e154]:
          - generic [ref=e155]:
            - paragraph [ref=e156]: OMNITRAF · DIGITAL TWIN SIMULASI
            - heading "Digital Twin 3D" [level=1] [ref=e157]
            - paragraph [ref=e158]: Representasi kota sintetis yang mengikuti state TrafficModel, sinyal, perangkat, dan insiden.
          - generic [ref=e159]: VISUAL SINTETIS · BUKAN REKONSTRUKSI PRESISI
        - region "Visualisasi kota 3D dan detail entity" [ref=e160]:
          - generic [ref=e161]:
            - toolbar "Kontrol visualisasi 3D":
              - group "Sudut pandang kamera" [ref=e162]:
                - button "Atas" [ref=e163] [cursor=pointer]
                - button "Isometrik" [ref=e164] [cursor=pointer]
                - button "Jalan" [ref=e165] [cursor=pointer]
              - generic [ref=e166]:
                - generic [ref=e167]: Virtual camera
                - combobox "Pilih sudut pandang virtual kamera" [ref=e168]:
                  - option "Tidak ada kamera" [selected]
                  - option "CAM-01 · SIMPANG WONOKROMO"
                  - option "CAM-02 · KORIDOR RAYA DARMO"
                  - option "CAM-03 · BUNDARAN WARU"
                  - option "CAM-04 · SIMPANG JEMURSARI"
                - generic [ref=e169]: Kualitas
                - combobox "Kualitas render kota 3D" [ref=e170]:
                  - option "Low"
                  - option "Balanced" [selected]
                  - option "High"
                - button "Reset" [ref=e171] [cursor=pointer]
                - link "Peta 2D" [ref=e172] [cursor=pointer]:
                  - /url: "#map"
                - group [ref=e173]:
                  - generic "Lapisan" [ref=e174] [cursor=pointer]
            - application "Kota simulasi 3D. Seret untuk orbit, geser dengan tombol kanan atau Shift, gulir untuk zoom, klik entity untuk detail." [ref=e175]
            - generic:
              - strong: Virtual camera preview
              - generic: Pilih kamera sintetis untuk mengubah titik pandang scene.
            - generic:
              - generic: SIMULATED · ACTIVE
              - generic: — FPS
              - generic "8216 triangles · balanced · render scale 0.75 · geometry/texture counts": CPU 0.8ms · GPU n/a · 33 draw · 33g/1t
              - generic: SIMULATED · frame 523 · 48 agen · 18.45.16
              - generic: AGEN VISUAL SINTETIS
        - generic [ref=e177]:
          - generic [ref=e178]: Arus lancar
          - generic [ref=e180]: Padat / antrean
          - generic [ref=e182]: Insiden / fase merah
          - generic [ref=e184]: Simpang dan kamera
          - generic [ref=e186]: "Drag: orbit · Shift + drag: pan · Wheel: zoom"
  - dialog [aria-hidden] [ref=e187]:
    - generic [ref=e188]:
      - generic [ref=e189]:
        - generic [ref=e190]: 🔔
        - generic [ref=e191]:
          - heading [level=3] [ref=e192]: Contoh Skenario Insiden
          - paragraph [ref=e193]: Data demo, bukan laporan operasional
      - button [ref=e194] [cursor=pointer]: ×
    - generic [ref=e195]:
      - article [ref=e196]:
        - strong [ref=e197]: Skenario kendaraan mogok
        - paragraph [ref=e198]: Simpang demo 01 · ACTIVE
        - paragraph [ref=e199]: Skenario contoh; tidak ada petugas atau unit derek yang ditugaskan.
        - link [ref=e200] [cursor=pointer]:
          - /url: "#incidents"
          - text: Buka daftar insiden
      - article [ref=e201]:
        - strong [ref=e202]: Skenario genangan air
        - paragraph [ref=e203]: Koridor demo 02 · ACKNOWLEDGED
        - paragraph [ref=e204]: Skenario contoh genangan; bukan pengukuran atau laporan lapangan.
        - link [ref=e205] [cursor=pointer]:
          - /url: "#incidents"
          - text: Buka daftar insiden
      - article [ref=e206]:
        - strong [ref=e207]: Skenario antrean panjang
        - paragraph [ref=e208]: Simpang demo 03 · ACTIVE
        - paragraph [ref=e209]: Antrean sintetis 180 meter pada skenario simulator.
        - link [ref=e210] [cursor=pointer]:
          - /url: "#incidents"
          - text: Buka daftar insiden
  - status [ref=e212]: ✓ Notifikasi
  - status
```