# OmniTRAF Surabaya — Intelligent Transport System Command Center
### Competition-Grade Productization & Showcase Edition

[![WCAG 2.1 AA](https://img.shields.io/badge/Accessibility-WCAG%202.1%20AA%20Compliant-success?style=for-the-badge&logo=w3c)](https://www.w3.org/WAI/WCAG21/quickref/)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20Resilient%20%26%20Installable-blue?style=for-the-badge&logo=pwa)](https://web.dev/progressive-web-apps/)
[![Real-Time](https://img.shields.io/badge/Socket.io-Bi--Directional%20Telemetri-orange?style=for-the-badge&logo=socketdotio)](https://socket.io/)
[![GIS Engine](https://img.shields.io/badge/Leaflet.js-Euclidean%20Vector%20GIS-brightgreen?style=for-the-badge&logo=leaflet)](https://leafletjs.com/)
[![ESG Impact](https://img.shields.io/badge/ESG-IPCC%20Carbon%20Emission%20Model%20(Simulated)-emerald?style=for-the-badge&logo=leaf)](https://www.ipcc.ch/)

---

## 🏙️ Ringkasan Proyek (Executive Summary)

**OmniTRAF Surabaya Command Center** adalah platform pemantauan dan pengendalian lalu lintas cerdas perkotaan terintegrasi yang mensimulasikan sistem **Surabaya Intelligent Transport System (SITS)** Dinas Perhubungan Kota Surabaya dengan pipeline **Edge Vision Simulation**, **Optimasi Sinyal Adaptif (Dynamic Green Split)**, **Sistem Preemption Koridor Darurat 112**, serta **Kalkulator Transparan Reduksi Emisi Karbon (ESG Model)**.

Dirancang khusus dengan estetika **Apple Human Interface Guidelines (HIG)** dan standar **WCAG 2.1 AA**, dashboard ini memberikan kejelasan visual superior pada monitor operator Command Center, laptop, mobile PWA, maupun proyektor presentasi.

---

## 📐 Arsitektur Sistem (System Architecture)

Sistem mengadopsi arsitektur event-driven terdistribusi yang memadukan komputasi edge dengan sinkronisasi real-time Socket.io serta fallback simulasi offline mandiri:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 INFRASTRUKTUR SENSOR SITS KOTA SURABAYA                    │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  184 Kamera CCTV RTSP/HLS     │  312 Sensor IoT Induktif & Detektor APILL   │
└───────────────┬───────────────┴──────────────────────┬──────────────────────┘
                │                                      │
                ▼                                      ▼
┌───────────────────────────────┐      ┌──────────────────────────────────────┐
│     EDGE VISION SIMULATION    │      │   GATEWAY ATCS SITS SURABAYA (REST)  │
│  • Model: YOLOv8 / ByteTrack  │      │   • Siklus Lampu Lalu Lintas         │
│  • Bounding Box Inference     │      │   • Status Insiden Command 112       │
│  • Lerp Canvas 60 FPS Render  │      │   • Geofence GPS Armada Darurat      │
└───────────────┬───────────────┘      └───────────────┬──────────────────────┘
                │                                      │
                └──────────────────┬───────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 OMNITRAF BACKEND KERNEL (Node.js / Express)                 │
│  • Single Source of Truth Global State Manager                              │
│  • WebSocket Engine (Socket.io) dengan Reconnection Logic Otomatis          │
│  • Dynamic Webster Minimum Delay Optimizer & Mathematical Diurnal Model     │
│  • Mesin Komputasi Reduksi Emisi Karbon (ESG Formula IPCC 2006)            │
│  • PDF Report Generation Engine (Buffer PDF 1.4 Native)                     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │ Socket.io Event Bus (Stream 300ms) │
                 ▼                                   ▼
┌──────────────────────────────────┐ ┌────────────────────────────────────────┐
│     CLIENT DASHBOARD (FRONTEND)  │ │      OFFLINE RESILIENCY LAYER (PWA)    │
│  • StateStore & Event-Bus (ES6)  │ │  • Service Worker Cache-First CDN      │
│  • GIS Leaflet Vector Animation  │ │  • Local Mock Fallback Simulation      │
│  • Canvas Edge Vision Lerp Render│ │  • Zero Browser Console Error Guard    │
└──────────────────────────────────┘ └────────────────────────────────────────┘
```

---

## 🌟 Status Data & Provenance Model

Seluruh indikator dan informasi pada dashboard dikategorikan secara eksplisit menggunakan badge status berikut:
- 🟢 **`LIVE`**: Data yang disinkronisasi secara real-time via WebSocket/Socket.io backend kernel.
- 🔵 **`REALTIME-DERIVED`**: Metrik hasil kalkulasi otomatis dari stream telemetri aktif.
- 🟡 **`SIMULATED`**: Hasil estimasi model matematika, Webster Optimization, atau prediksi diurnal.
- 🟠 **`STALE`**: Data telemetri yang belum diperbarui dalam kurun waktu ambang batas.
- 🔴 **`OFFLINE`**: Status perangkat atau koneksi yang terputus dengan fallback otomatis.
- 🟣 **`USER-TRIGGERED`**: Aksi intervensi operator (Green Wave, Signal Override, Dispatch 112).

---

## 💻 Tech Stack & Kepatuhan Standar

| Lapisan / Komponen | Teknologi yang Digunakan | Standar & Kepatuhan |
| :--- | :--- | :--- |
| **Frontend Core** | HTML5 Semantik, Vanilla ES6 Modules | W3C Valid, Zero Heavy Frameworks |
| **Styling & Motion** | Modern CSS, Custom Design System | WCAG 2.1 AA, `prefers-reduced-motion` |
| **Geospatial GIS** | Leaflet.js 1.9.4, MarkerCluster | CartoDB Dark Matter / Positron |
| **Edge Vision HUD** | HTML5 Canvas API (2D Context) | Lerp Bounding Box Rendering |
| **Offline & PWA** | Service Worker v5 (Stale-While-Revalidate) | Offline Resilient PWA |
| **Performance Engine**| `content-visibility`, Tabular Nums, LERP Canvas | Bounded Memory & CPU Optimization |
| **Backend Runtime** | Node.js (ESM), Express.js | REST API Level 2, Strict CSP Headers |
| **Real-Time Engine**| Socket.io v4.8 | Low-latency WebSockets |

---

## 🚀 Panduan Menjalankan Project (1-Command Run)

### Prasyarat
- Node.js versi 18 atau lebih baru.

### Langkah Menjalankan
```bash
# 1. Pasang dependensi
npm install

# 2. Jalankan server (Otomatis mendeteksi port 3000 atau port bebas berikutnya)
npm start
```

Buka peramban (browser) di alamat:
**`http://localhost:3000`**

### Menjalankan Lint & Cek Sintaks
```bash
npm run lint
```

---

## 👥 Hak Cipta & Lisensi
SITS Command Center Kota Surabaya — OmniTRAF Prototype &copy; 2026
