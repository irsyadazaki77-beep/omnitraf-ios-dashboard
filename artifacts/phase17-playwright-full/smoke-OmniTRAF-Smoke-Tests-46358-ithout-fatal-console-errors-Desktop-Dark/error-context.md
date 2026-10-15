# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.js >> OmniTRAF Smoke Tests - All 12 Views >> loads view Analitik (#analytics) without fatal console errors
- Location: tests\e2e\smoke.spec.js:12:5

# Error details

```
Error: page.waitForFunction: Timeout 15000ms exceeded.
Page errors: []
Console errors: ["Failed to load resource: the server responded with a status of 404 (Not Found)","Refused to apply style from 'http://127.0.0.1:4191/assets/index-CXPJA-_M.css' because its MIME type ('text/html') is not a supported stylesheet MIME type, and strict MIME checking is enabled.","Failed to load resource: the server responded with a status of 404 (Not Found)","Failed to load resource: the server responded with a status of 404 (Not Found)","Failed to load resource: the server responded with a status of 404 (Not Found)","Failed to load resource: the server responded with a status of 404 (Not Found)","Failed to load resource: the server responded with a status of 404 (Not Found)"]
Failed requests: ["GET http://127.0.0.1:4191/assets/index-Cl8OEMRX.js: net::ERR_ABORTED","GET http://127.0.0.1:4191/assets/index-CXPJA-_M.css: net::ERR_ABORTED","GET http://127.0.0.1:4191/assets/rolldown-runtime-hePW80VL.js: net::ERR_ABORTED","GET http://127.0.0.1:4191/assets/stateStore-BrYj4hjA.js: net::ERR_ABORTED","GET http://127.0.0.1:4191/assets/soundManager-ByFyMJlH.js: net::ERR_ABORTED"]
Bad responses: ["404 http://127.0.0.1:4191/assets/index-Cl8OEMRX.js","404 http://127.0.0.1:4191/assets/rolldown-runtime-hePW80VL.js","404 http://127.0.0.1:4191/assets/stateStore-BrYj4hjA.js","404 http://127.0.0.1:4191/assets/soundManager-ByFyMJlH.js","404 http://127.0.0.1:4191/assets/omnitraf-icon-209ea380.png","404 http://127.0.0.1:4191/assets/omnitraf-logo-c2cbcf3b.png"]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Lewati ke konten utama" [ref=e2] [cursor=pointer]:
    - /url: "#mainContent"
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - button "Tutup menu" [ref=e5]: ×
      - link "OmniTRAF home" [ref=e6] [cursor=pointer]:
        - /url: "#dashboard"
        - img "Ikon OmniTRAF SITS Surabaya" [ref=e8]
        - generic [ref=e9]:
          - img "Logo OmniTRAF Adaptive Urban Mobility System" [ref=e10]
          - text: Surabaya Command Center
      - button "Collapse sidebar" [expanded] [ref=e11]
      - button "Cari halaman Ctrl K" [ref=e14]
      - navigation "Primary navigation" [ref=e20]:
        - region [ref=e21]:
          - heading "Operasi" [level=2] [ref=e22]
          - link "Ikhtisar" [ref=e23] [cursor=pointer]:
            - /url: "#dashboard"
          - link "Peta kota" [ref=e30] [cursor=pointer]:
            - /url: "#map"
          - link "Digital Twin 3D" [ref=e35] [cursor=pointer]:
            - /url: "#city3d"
            - text: 3DDigital Twin 3D
          - link "Insiden" [ref=e36] [cursor=pointer]:
            - /url: "#incidents"
          - link "Prioritas darurat" [ref=e40] [cursor=pointer]:
            - /url: "#emergency"
            - text: Darurat
        - region [ref=e44]:
          - heading "Pemantauan" [level=2] [ref=e45]
          - link "CCTV" [ref=e46] [cursor=pointer]:
            - /url: "#cctv"
          - link "Sinyal lalu lintas" [ref=e52] [cursor=pointer]:
            - /url: "#signals"
            - text: Sinyal
          - link "Perangkat" [ref=e59] [cursor=pointer]:
            - /url: "#devices"
        - region [ref=e64]:
          - heading "Analitik & prediksi" [level=2] [ref=e65]
          - link "Analitik" [ref=e66] [cursor=pointer]:
            - /url: "#analytics"
          - link "Prediksi" [ref=e71] [cursor=pointer]:
            - /url: "#prediction"
          - button "Intelijen sinyal" [ref=e76]
          - link "Laporan" [ref=e80] [cursor=pointer]:
            - /url: "#reports"
            - text: ▤ Laporan
        - region [ref=e81]:
          - heading "Sistem" [level=2] [ref=e82]
          - link "Integrasi" [ref=e83] [cursor=pointer]:
            - /url: "#integration"
          - link "Pengaturan" [ref=e88] [cursor=pointer]:
            - /url: "#settings"
          - link "System Architecture" [ref=e91] [cursor=pointer]:
            - /url: "#about-engine"
            - text: Arsitektur sistem
          - button "Demo Coordination Chat" [ref=e95]
    - main [ref=e99]:
      - generic [ref=e101]:
        - generic [ref=e102]:
          - text: 🚨
          - strong [ref=e103]: "PRIORITAS SIMULASI AKTIF:"
          - text: SIMULASI
        - generic [ref=e104]: "Rute A. Yani ➔ Raya Darmo: HIJAU | Simpang Tegak Lurus: MERAH"
        - button "🔄 Kembalikan ke Normal" [ref=e105]
      - generic "Navigasi halaman" [ref=e106]:
        - generic [ref=e107]:
          - button "Buka menu" [ref=e108]
          - generic [ref=e109]:
            - text: OMNITRAF · SIMULASI
            - strong [ref=e110]: Ikhtisar
        - generic "Aksi utama" [ref=e111]:
          - button "CariCtrl K" [ref=e112]: ⌕CariCtrl K
          - generic "Status prototipe OmniTRAF" [ref=e113]:
            - text: "--.-- WIB"
            - strong [ref=e115]: Server simulasi
          - alert [ref=e116]:
            - text: 🚨
            - generic [ref=e117]:
              - text: System Alert
              - strong [ref=e118]: Mode Keos Aktif
            - text: "1"
            - button "Mute Siren" [ref=e119]: 🔊
          - generic [ref=e120]:
            - button "Ganti tema warna" [ref=e121]: ☾
            - button "Notifikasi insiden" [ref=e122]
            - group [ref=e126]:
              - generic "Aksi lainnya" [ref=e127]: ···
          - generic "Profil sesi simulasi" [ref=e128]:
            - generic [aria-hidden] [ref=e130]: D
            - generic [ref=e131]:
              - strong [ref=e132]: Demo operator
              - text: Sesi simulasi
      - group "Batas simulasi" [ref=e133]:
        - generic [ref=e134]:
          - strong [ref=e135]: SIMULASI
          - text: Data sintetis · tanpa kendali perangkat lapangan
      - status [ref=e136]:
        - generic [ref=e137]:
          - text: 📡
          - generic [ref=e138]:
            - strong [ref=e139]: Stream simulasi tidak tersedia
            - text: — Data terakhir mungkin sudah tidak baru.
        - button "Masuk" [ref=e140]
        - button "Tutup pemberitahuan offline" [ref=e141]: ×
  - status
```