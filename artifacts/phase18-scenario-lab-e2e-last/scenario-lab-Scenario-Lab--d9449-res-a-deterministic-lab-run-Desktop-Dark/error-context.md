# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scenario-lab.spec.js >> Scenario Lab isolated simulation workflow >> builds, replays, compares, exports, and captures a deterministic lab run
- Location: tests\e2e\scenario-lab.spec.js:8:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('#scenarioLabPreview')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('#scenarioLabPreview') with timeout 10000ms
  - waiting for locator('#scenarioLabPreview')

```

```yaml
- link "Lewati ke konten utama":
  - /url: "#mainContent"
- complementary:
  - link "OmniTRAF home":
    - /url: "#dashboard"
    - img "Ikon OmniTRAF SITS Surabaya"
    - img "Logo OmniTRAF Adaptive Urban Mobility System"
    - text: Surabaya Command Center
  - button "Ciutkan sidebar" [expanded]: Collapse sidebar
  - button "Cari halaman Ctrl K"
  - navigation "Primary navigation":
    - region "Operasi":
      - heading "Operasi" [level=2]
      - link "Ikhtisar":
        - /url: "#dashboard"
        - img
        - text: Ikhtisar
      - link "Peta kota":
        - /url: "#map"
        - img
        - text: Peta kota
      - link "Digital Twin 3D":
        - /url: "#city3d"
      - link "Insiden":
        - /url: "#incidents"
        - img
        - text: Insiden
      - link "Darurat":
        - /url: "#emergency"
        - img
        - text: Darurat
    - region "Pemantauan":
      - heading "Pemantauan" [level=2]
      - link "CCTV":
        - /url: "#cctv"
        - img
        - text: CCTV
      - link "Sinyal":
        - /url: "#signals"
        - img
        - text: Sinyal
      - link "Perangkat":
        - /url: "#devices"
        - img
        - text: Perangkat
    - region "Analitik & prediksi":
      - heading "Analitik & prediksi" [level=2]
      - link "Analitik":
        - /url: "#analytics"
        - img
        - text: Analitik
      - link "Prediksi":
        - /url: "#prediction"
        - img
        - text: Prediksi
      - button "Intelijen sinyal"
      - link "Laporan":
        - /url: "#reports"
    - region "Sistem":
      - heading "Sistem" [level=2]
      - link "Integrasi":
        - /url: "#integration"
        - img
        - text: Integrasi
      - link "Pengaturan":
        - /url: "#settings"
        - img
        - text: Pengaturan
      - link "Arsitektur sistem":
        - /url: "#about-engine"
- main:
  - text: OMNITRAF · SIMULASI
  - strong: Peta kota
  - button "Cari Ctrl K"
  - text: Selasa, 13 Okt 2026 | 19.16 WIB
  - strong: Server Simulasi Tersambung
  - button "Ganti ke tema terang"
  - 'button "Active scenario notifications: 3"': "3"
  - group: ···
  - button "Sesi Operator Demo. Kontrol keluar tersedia di navigasi.":
    - strong: Operator Demo
    - text: Operator
  - button "Keluar"
  - group "Batas simulasi":
    - strong: SIMULASI
    - text: Data sintetis · tanpa kendali perangkat lapangan
  - paragraph: OMNITRAF · SIMULASI
  - heading "Peta kota" [level=1]
  - paragraph: Jelajahi simpang, koridor, dan kejadian pada model Surabaya.
  - text: PETA SIMULASI
  - toolbar "Pencarian dan kontrol peta":
    - searchbox
    - button "Buka kontrol lapisan": Lapisan
    - button "Perbesar peta": +
    - button "Perkecil peta": −
    - button "Reset tampilan peta": Reset
    - button "Layar penuh": ⛶
    - link "Mode 3D":
      - /url: "#city3d"
  - region "Peta dan detail entity":
    - application "Peta simulasi kota Surabaya":
      - button "⚠️"
      - button "📷 CCTV A. Yani (Jemursari)"
      - button "🏛️ Pelabuhan Tanjung Perak"
      - button "Cluster berisi 2 aset":
        - img "Cluster berisi 2 aset"
      - button "Cluster berisi 3 aset":
        - img "Cluster berisi 3 aset"
      - button "Cluster berisi 2 aset":
        - img "Cluster berisi 2 aset"
      - button "Simpang A. Yani - Jemursari"
      - button "Cluster berisi 2 aset":
        - img "Cluster berisi 2 aset"
      - button "Cluster berisi 4 aset":
        - img "Cluster berisi 4 aset"
      - link "Leaflet":
        - /url: https://leafletjs.com
      - text: ©
      - link "OpenStreetMap":
        - /url: https://www.openstreetmap.org/copyright
      - text: contributors
- status: ✓ Notifikasi
- status
```