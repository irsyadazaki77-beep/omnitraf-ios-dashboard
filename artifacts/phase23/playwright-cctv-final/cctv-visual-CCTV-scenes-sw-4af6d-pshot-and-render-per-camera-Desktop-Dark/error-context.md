# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cctv-visual.spec.js >> CCTV scenes switch, remain visible without detections, pause, snapshot and render per camera
- Location: tests\e2e\cctv-visual.spec.js:7:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#cctvTimeOfDay')
Expected: visible
Received: hidden
Timeout:  10000ms

Call log:
  - Expect "toBeVisible" locator('#cctvTimeOfDay') with timeout 10000ms
  - waiting for locator('#cctvTimeOfDay')
    19 × locator resolved to <select id="cctvTimeOfDay">…</select>
       - unexpected value "hidden"

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
      - link "Scenario Lab":
        - /url: "#prediction"
        - img
        - text: Scenario Lab
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
  - strong: Pemantauan CCTV
  - button "Cari Ctrl K"
  - text: Rabu, 14 Okt 2026 | 10.53 WIB
  - strong: Server simulasi lambat
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
  - status:
    - strong: Stream simulator melambat
    - text: — Data mungkin terlambat diperbarui.
    - button "Tutup pemberitahuan offline": ×
  - paragraph: OMNITRAF · FEED VISI SIMULASI
  - heading "Pemantauan CCTV" [level=1]
  - paragraph: Pilih kamera untuk melihat visual dan deteksi sintetis.
  - text: SIMULASI · BUKAN FEED LAPANGAN
  - searchbox "Cari kamera berdasarkan nama atau lokasi"
  - button "⏸ Jeda"
  - button "Perbesar"
  - button "▣ Cuplikan demo"
  - group: Opsi tampilan
  - text: CAM 04
  - heading "Simpang Jemursari" [level=3]
  - button "📸 Cuplikan demo"
  - text: Active
  - complementary "Daftar kamera simulasi":
    - heading "Kamera" [level=2]
    - group "Pilih kamera simulasi":
      - button "01 · Simpang Wonokromo"
      - button "02 · Koridor Raya Darmo"
      - button "03 · Bundaran Waru"
      - button "04 · Simpang Jemursari" [pressed]
    - paragraph: Seluruh visual dan deteksi dibuat oleh simulator lokal.
- status: ✓ Notifikasi
- status:
  - status: ⚠ Penundaan koneksi data terdeteksi. Mencoba ulang...
```