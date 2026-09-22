import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware Header Keamanan HTTP & Content Security Policy (CSP)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.cartocdn.com https://*.arcgisonline.com https://*.tile.openstreetmap.org https://unpkg.com https://*.unpkg.com",
      "connect-src 'self' ws: wss: http: https:"
    ].join('; ')
  );
  next();
});

// Serve static assets and files from the root directory
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

// Body parser middleware for REST APIs
app.use(express.json());

// ============================================================================
// SINGLE SOURCE OF TRUTH — BACKEND STATE MANAGER
// ============================================================================
class BackendStateManager {
  constructor() {
    this.vehiclesCountToday = 128540;
    this.co2SavedKg = 1420;
    this.fuelSavedLiters = 580;

    this.state = {
      timestamp: this._getWibTimeString(),
      networkLoad: 72,
      avgWaitTime: 42,
      congestionIndex: 62,
      co2SavedKg: this.co2SavedKg,
      fuelSavedLiters: this.fuelSavedLiters,
      vehiclesToday: this.vehiclesCountToday,
      sitsUptime: 99.4,
      cctvOnline: 184,
      iotOnline: 312,
      sitsSignal: 94,
      aiScore: 92,
      aiConfidence: 96,
      
      // Control States
      isChaosMode: false,
      chaosLevel: 0,
      greenWaveActive: false,
      greenSplitWonokromo: 35,
      
      // APILL Timers per Intersection
      intersections: [
        { id: "node-wonokromo", name: "Simpang Wonokromo", state: "green", timer: 35, greenSplit: 35, waitTime: 42, status: "Normal" },
        { id: "node-margorejo", name: "Simpang Margorejo", state: "red", timer: 35, greenSplit: 28, waitTime: 36, status: "Lancar" },
        { id: "node-darmo", name: "Simpang Raya Darmo", state: "green", timer: 28, greenSplit: 42, waitTime: 28, status: "Lancar" },
        { id: "node-tunjungan", name: "Simpang Tunjungan", state: "yellow", timer: 3, greenSplit: 30, waitTime: 48, status: "Padat" },
        { id: "node-merr", name: "Simpang MERR Kertajaya", state: "green", timer: 45, greenSplit: 45, waitTime: 22, status: "Lancar" }
      ],

      // Active Emergency Priority Requests
      activeEmergencies: [
        { id: "EMG-101", code: "AMB-01", route: "route-soetomo", vehicle: "Ambulans RSU Dr. Soetomo", status: "PRIORITAS AKTIF", timestamp: this._getWibTimeString() }
      ]
    };

    this.yellowDuration = 3;
    this.redDurationBase = 25;
    this.resolutionInterval = null;
  }

  _getWibTimeString() {
    return new Date().toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour12: false
    }) + ' WIB';
  }

  tick() {
    this.state.timestamp = this._getWibTimeString();

    // Increment metrics naturally
    this.vehiclesCountToday += Math.floor(Math.random() * 5) + 1;
    this.co2SavedKg += Number((Math.random() * 0.2).toFixed(2));
    this.fuelSavedLiters += Number((Math.random() * 0.1).toFixed(2));

    this.state.vehiclesToday = Math.round(this.vehiclesCountToday);
    this.state.co2SavedKg = Math.round(this.co2SavedKg);
    this.state.fuelSavedLiters = Math.round(this.fuelSavedLiters);

    // Chaos mode impact calculations
    if (this.state.isChaosMode) {
      this.state.networkLoad = Math.min(99, Math.max(88, Math.floor(94 + (Math.random() * 6 - 3))));
      this.state.avgWaitTime = Math.min(130, Math.max(95, Math.floor(118 + (Math.random() * 10 - 5))));
      this.state.congestionIndex = Math.min(98, Math.max(85, Math.floor(92 + (Math.random() * 6 - 3))));
      this.state.sitsUptime = 42.5;
      this.state.cctvOnline = 72;
      this.state.iotOnline = 142;
      this.state.sitsSignal = 28;
      this.state.aiScore = 34;
      this.state.aiConfidence = Math.min(60, Math.max(35, Math.floor(45 + (Math.random() * 8 - 4))));
    } else {
      this.state.networkLoad = Math.min(92, Math.max(55, Math.floor(68 + (Math.random() * 8 - 4))));
      this.state.avgWaitTime = Math.min(65, Math.max(28, Math.floor(41 + (Math.random() * 6 - 3))));
      this.state.congestionIndex = Math.min(88, Math.max(45, Math.floor(60 + (Math.random() * 6 - 3))));
      this.state.sitsUptime = 99.4;
      this.state.cctvOnline = 184;
      this.state.iotOnline = 312;
      this.state.sitsSignal = 94;
      this.state.aiScore = 92;
      this.state.aiConfidence = Math.min(99, Math.max(91, Math.floor(96 + (Math.random() * 3 - 1))));
    }

    // Advance APILL Light Timers for all intersections
    this.state.intersections.forEach(node => {
      if (this.state.greenWaveActive && (node.id === "node-wonokromo" || node.id === "node-margorejo" || node.id === "node-darmo")) {
        node.state = "green";
        node.timer = "∞";
        node.status = "Green Wave";
        return;
      }

      if (typeof node.timer === "string") {
        node.timer = node.greenSplit || 35;
      }

      node.timer--;

      if (node.timer <= 0) {
        if (node.state === "green") {
          node.state = "yellow";
          node.timer = this.yellowDuration;
        } else if (node.state === "yellow") {
          node.state = "red";
          node.timer = node.id === "node-wonokromo" ? this.redDurationBase : 25;
        } else {
          node.state = "green";
          node.timer = node.id === "node-wonokromo" ? this.state.greenSplitWonokromo : (node.greenSplit || 30);
        }
      }

      // Update node status based on congestion & state
      if (node.state === "red") {
        node.status = this.state.isChaosMode ? "Macet Total" : "Padat";
      } else if (node.state === "yellow") {
        node.status = "Transisi";
      } else {
        node.status = this.state.isChaosMode ? "Merayap" : "Lancar";
      }
    });

    return this.state;
  }

  toggleChaos(active) {
    this.state.isChaosMode = !!active;
    this.state.chaosLevel = active ? 4 : 0;

    if (active) {
      if (this.resolutionInterval) clearInterval(this.resolutionInterval);
      this.resolutionInterval = setInterval(() => {
        if (this.state.chaosLevel <= 1) {
          this.toggleChaos(false);
          io.emit('system:toast', { message: 'Sistem ATCS Surabaya pulih otomatis dari Mode Keos.', type: 'info' });
          io.emit('traffic:update', this.state);
        } else {
          this.state.chaosLevel--;
          io.emit('traffic:update', this.state);
        }
      }, 5000);
    } else {
      if (this.resolutionInterval) {
        clearInterval(this.resolutionInterval);
        this.resolutionInterval = null;
      }
    }
    return this.state;
  }

  setGreenSplit(value, intersectionId = "node-wonokromo") {
    const val = Math.min(90, Math.max(15, parseInt(value, 10) || 35));
    if (intersectionId === "node-wonokromo") {
      this.state.greenSplitWonokromo = val;
    }
    const node = this.state.intersections.find(n => n.id === intersectionId);
    if (node) {
      node.greenSplit = val;
      if (node.state === "green" && typeof node.timer === "number") {
        node.timer = val;
      }
    }
    return this.state;
  }

  toggleGreenWave(active) {
    this.state.greenWaveActive = !!active;
    if (active) {
      this.state.intersections.forEach(node => {
        if (node.id === "node-wonokromo" || node.id === "node-margorejo" || node.id === "node-darmo") {
          node.state = "green";
          node.timer = "∞";
          node.status = "Green Wave";
        }
      });
    } else {
      const wNode = this.state.intersections.find(n => n.id === "node-wonokromo");
      if (wNode) {
        wNode.state = "green";
        wNode.timer = this.state.greenSplitWonokromo;
      }
    }
    return this.state;
  }

  applyAiRecommendation(intersectionId = "node-wonokromo") {
    const node = this.state.intersections.find(n => n.id === intersectionId) || this.state.intersections[0];
    const optimizedSplit = Math.floor(38 + Math.random() * 12); // e.g. 38-50s
    node.greenSplit = optimizedSplit;
    if (node.id === "node-wonokromo") {
      this.state.greenSplitWonokromo = optimizedSplit;
    }
    this.state.aiScore = Math.min(99, this.state.aiScore + 2);
    this.state.avgWaitTime = Math.max(22, this.state.avgWaitTime - 4);
    return { state: this.state, optimizedSplit, nodeName: node.name };
  }

  signalOverride(intersectionId, duration = 45) {
    const node = this.state.intersections.find(n => n.id === intersectionId) || this.state.intersections[0];
    node.state = "green";
    node.timer = parseInt(duration, 10) || 45;
    node.status = "Manual Override";
    return { state: this.state, nodeName: node.name, duration };
  }

  activateEmergencyPriority(code, route) {
    const emergencyItem = {
      id: `EMG-${Date.now().toString().slice(-4)}`,
      code: code || "AMB-02",
      route: route || "route-soetomo",
      vehicle: "Armada Tanggap Darurat 112 / Ambulans",
      status: "PRIORITAS AKTIF",
      timestamp: this._getWibTimeString()
    };
    this.state.activeEmergencies.unshift(emergencyItem);
    if (this.state.activeEmergencies.length > 5) {
      this.state.activeEmergencies.pop();
    }

    // Force corridor to green
    this.toggleGreenWave(true);
    return { state: this.state, emergencyItem };
  }
}

// ============================================================================
// COMPUTER VISION MOCK ENGINE — SERVER SIDE OBJECT DETECTION STREAMING
// ============================================================================
class ComputerVisionEngine {
  constructor() {
    this.cameras = ['dashCameraCanvas', 'cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4'];
    this.classes = ['car', 'bus', 'truck', 'motorcycle', 'ambulance', 'person'];
    this.vehiclesPerCam = new Map();

    this.cameras.forEach(camId => {
      this.vehiclesPerCam.set(camId, this._generateInitialVehicles(camId));
    });
  }

  _generateInitialVehicles(camId) {
    const count = camId === 'dashCameraCanvas' ? 6 : 4;
    const vehicles = [];
    for (let i = 0; i < count; i++) {
      const cls = i === 0 ? (camId === 'dashCameraCanvas' ? 'ambulance' : 'bus') :
                  i % 3 === 0 ? 'truck' :
                  i % 2 === 0 ? 'motorcycle' : 'car';
      
      const lane = i % 4;
      vehicles.push({
        id: `${camId}-v${i}`,
        lane: lane,
        progress: (i / count) + Math.random() * 0.1,
        speed: 0.008 + Math.random() * 0.006,
        class: cls,
        confidence: Math.floor(91 + Math.random() * 8)
      });
    }
    return vehicles;
  }

  generateFramePayload(isChaosMode) {
    const frameData = {};

    this.cameras.forEach(camId => {
      const vehicles = this.vehiclesPerCam.get(camId) || [];
      const boxes = [];

      vehicles.forEach(v => {
        const effSpeed = isChaosMode ? v.speed * 0.2 : v.speed;
        v.progress += effSpeed;
        if (v.progress > 1.0) {
          v.progress = 0;
          v.lane = Math.floor(Math.random() * 4);
          v.confidence = Math.floor(90 + Math.random() * 9);
        }

        // Perspective Projection calculation (0..1 normalized space)
        const t = v.progress;
        const vx = 0.5; // Vanishing point X
        const vy = 0.28; // Vanishing point Y
        const laneEndpointsX = [0.12, 0.36, 0.64, 0.88];
        const bx = laneEndpointsX[v.lane];
        const by = 1.0;

        const xNorm = vx + (bx - vx) * t;
        const yNorm = vy + (by - vy) * t;

        const scale = 0.15 + t * 0.85;

        let baseW = 0.12, baseH = 0.09;
        if (v.class === 'bus') { baseW = 0.16; baseH = 0.12; }
        else if (v.class === 'truck') { baseW = 0.15; baseH = 0.11; }
        else if (v.class === 'ambulance') { baseW = 0.14; baseH = 0.10; }
        else if (v.class === 'motorcycle') { baseW = 0.07; baseH = 0.07; }
        else if (v.class === 'person') { baseW = 0.04; baseH = 0.08; }

        const wNorm = baseW * scale;
        const hNorm = baseH * scale;

        boxes.push({
          id: v.id,
          class: v.class,
          confidence: v.confidence,
          x: Math.max(0.01, Math.min(0.95, xNorm - wNorm / 2)),
          y: Math.max(0.01, Math.min(0.95, yNorm - hNorm / 2)),
          w: wNorm,
          h: hNorm,
          speedKmh: Math.round((isChaosMode ? 8 : 42) + Math.random() * 6 - 3)
        });
      });

      frameData[camId] = boxes;
    });

    return frameData;
  }
}

// ============================================================================
// PDF REPORT GENERATOR ENGINE (PDF 1.4 FORMATTED BUFFER)
// ============================================================================
function generateSitsPdfBuffer(state) {
  const time = state.timestamp || new Date().toLocaleTimeString('id-ID') + ' WIB';
  const dateStr = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const lines = [
    "OMNITRAF SURABAYA - SISTEM MANAJEMEN LALU LINTAS CERDAS (SITS)",
    "PEMERINTAH KOTA SURABAYA - DINAS PERHUBUNGAN",
    "LAPORAN RESMI RINGKASAN MOBILITAS & ANALITIK SISTEM",
    "================================================================================",
    `Tanggal Dokumen      : ${dateStr}`,
    `Waktu Kompilasi Data : ${time}`,
    `Status Operasional   : ${state.isChaosMode ? 'STATUS DARURAT (MODE KEOS AKTIF)' : 'OPTIMAL / NORMAL (HIJAU)'}`,
    `Beban Jaringan SITS  : ${state.networkLoad}%`,
    `Indeks Kemacetan Kota: ${state.congestionIndex} / 100`,
    `Rata-Rata Waktu Tunggu: ${state.avgWaitTime} detik`,
    `Volume Kendaraan Hari Ini : ${Number(state.vehiclesToday || 128540).toLocaleString('id-ID')} unit`,
    `Reduksi Emisi Karbon CO2 : ${Number(state.co2SavedKg || 1420).toLocaleString('id-ID')} kg`,
    `Estimasi Penghematan BBM : ${Number(state.fuelSavedLiters || 580).toLocaleString('id-ID')} Liter`,
    `Persentase Uptime SITS   : ${state.sitsUptime || 99.4}%`,
    `Node Kamera CCTV Aktif   : ${state.cctvOnline || 184} / 184 Unit`,
    `Sensor IoT Edge Aktif    : ${state.iotOnline || 312} / 312 Node`,
    "--------------------------------------------------------------------------------",
    "STATUS MONITORING PERSIMPANGAN UTAMA (APILL):",
    ...(state.intersections || []).map(n => 
      `  * ${n.name.padEnd(26)} | Fase: ${n.state.toUpperCase().padEnd(6)} | Sisa: ${String(n.timer).padEnd(4)}s | Split: ${n.greenSplit || 35}s | ${n.status}`
    ),
    "--------------------------------------------------------------------------------",
    "CATATAN KECERDASAN BUATAN & REKOMENDASI ADAPTIF:",
    "  1. Algoritma Edge AI Computer Vision mempertahankan akurasi deteksi 96.4%.",
    "  2. Gelombang Hijau Koridor Darmo-Wonokromo siap diaktifkan saat lonjakan komuter.",
    "  3. Sistem Preemption Kendaraan Darurat 112 dalam status siaga terintegrasi.",
    "================================================================================",
    "Diterbitkan secara otomatis oleh SITS Smart City Gateway Kernel Surabaya."
  ];

  let streamText = "BT\n/F1 13 Tf\n40 800 Td\n(" + lines[0] + ") Tj\n";
  streamText += "/F1 10 Tf\n0 -16 Td\n(" + lines[1] + ") Tj\n";
  streamText += "/F1 9 Tf\n0 -14 Td\n(" + lines[2] + ") Tj\n";
  streamText += "/F2 8 Tf\n";
  for (let i = 3; i < lines.length; i++) {
    const escaped = lines[i].replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    streamText += `0 -12 Td\n(${escaped}) Tj\n`;
  }
  streamText += "ET\n";

  const streamLen = Buffer.byteLength(streamText, 'utf-8');

  const pdfBody = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /MediaBox [0 0 595.28 841.89] /Contents 6 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>
endobj
6 0 obj
<< /Length ${streamLen} >>
stream
${streamText}endstream
endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000325 00000 n 
0000000402 00000 n 
trailer
<< /Size 7 /Root 1 0 R >>
startxref
${470 + streamLen}
%%EOF`;

  return Buffer.from(pdfBody, 'utf-8');
}

// Instantiate Backend Engines
const backendState = new BackendStateManager();
const cvEngine = new ComputerVisionEngine();

// ============================================================================
// REAL-TIME SOCKET.IO EVENT ROUTING & BROADCAST LOOPS
// ============================================================================

// 1. Core Telemetry & APILL Ticker Loop (1000ms)
setInterval(() => {
  const updatedState = backendState.tick();
  io.emit('traffic:update', updatedState);
}, 1000);

// 2. High-Efficiency Computer Vision Detection Bounding Box Stream (300ms)
setInterval(() => {
  const isChaos = backendState.state.isChaosMode;
  const visionPayload = cvEngine.generateFramePayload(isChaos);
  io.emit('cctv:vision-update', visionPayload);
}, 300);

// Socket.io Connection & Event Listeners
io.on('connection', (socket) => {
  console.log(`🔌 [Socket.io] Client terhubung: ${socket.id}`);

  // Send initial full state immediately upon connection
  socket.emit('traffic:init', backendState.state);
  socket.emit('cctv:vision-update', cvEngine.generateFramePayload(backendState.state.isChaosMode));

  // 1. Toggle Chaos Mode
  socket.on('chaos:toggle', (data) => {
    const targetActive = data ? data.active : !backendState.state.isChaosMode;
    const newState = backendState.toggleChaos(targetActive);
    io.emit('traffic:update', newState);
    io.emit('system:toast', {
      message: targetActive ? '🔥 MODE KEOS DIAKTIFKAN SERVER: Lonjakan beban jaringan SITS & gridlock!' : 'Sistem ATCS Surabaya pulih dari kondisi darurat.',
      type: targetActive ? 'danger' : 'success'
    });
  });

  // 2. Terapkan Rekomendasi AI SITS
  socket.on('ai:apply-recommendation', (data) => {
    const intersectionId = data ? data.intersectionId : "node-wonokromo";
    const res = backendState.applyAiRecommendation(intersectionId);
    io.emit('traffic:update', res.state);
    io.emit('system:toast', {
      message: `✨ Rekomendasi AI Diterapkan: Green Split ${res.nodeName} dioptimalkan ke ${res.optimizedSplit}s!`,
      type: 'success'
    });
  });

  // 3. Manual Override Sinyal APILL
  socket.on('signal:override', (data) => {
    const intersectionId = data ? data.intersectionId : "node-wonokromo";
    const duration = data ? data.duration : 45;
    const res = backendState.signalOverride(intersectionId, duration);
    io.emit('traffic:update', res.state);
    io.emit('system:toast', {
      message: `🛠️ Manual Override Aktif: Durasi ${res.nodeName} dikunci ${res.duration}s!`,
      type: 'warning'
    });
  });

  // 4. Aktifkan Sinyal Prioritas (Ambulans/PMK)
  socket.on('emergency:activate', (data) => {
    const code = data ? data.code : "AMB-02";
    const route = data ? data.route : "route-soetomo";
    const res = backendState.activateEmergencyPriority(code, route);
    io.emit('traffic:update', res.state);
    io.emit('emergency:dispatch-alert', res.emergencyItem);
    io.emit('system:toast', {
      message: `🚨 Prioritas Darurat Aktif: ${code} menuju RSU Dr. Soetomo (Green Wave locked).`,
      type: 'alert'
    });
  });

  // 5. Update Green Split Slider
  socket.on('green-split:update', (data) => {
    if (!data) return;
    const newState = backendState.setGreenSplit(data.value, data.intersectionId);
    io.emit('traffic:update', newState);
  });

  // 6. Toggle Emergency Green Wave
  socket.on('green-wave:toggle', (data) => {
    const active = data ? data.active : false;
    const newState = backendState.toggleGreenWave(active);
    io.emit('traffic:update', newState);
    io.emit('system:toast', {
      message: active ? '🚨 Emergency Green Wave Aktif! Sinyal A. Yani - Darmo dikunci Hijau.' : 'Green Wave Dinonaktifkan. Sinyal SITS kembali ke mode otomatis.',
      type: active ? 'alert' : 'info'
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ [Socket.io] Client terputus: ${socket.id}`);
  });
});

// ============================================================================
// REST API ENDPOINTS FOR SMART CITY SYSTEM INTEGRATION
// ============================================================================

// 1. PDF Report Download REST API
app.get('/api/reports/download', (req, res) => {
  try {
    const pdfBuffer = generateSitsPdfBuffer(backendState.state);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `OmniTRAF-SITS-Surabaya-Mobility-Report-${dateStamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('❌ [API Report] Gagal men-generate PDF buffer:', err);
    res.status(500).json({
      status: "error",
      message: "Gagal menghasilkan dokumen laporan PDF mobilitas SITS.",
      error: err.message
    });
  }
});

// 2. Dynamic AI Prediction Endpoint (Mathematical Diurnal Traffic Modeling)
app.get('/api/prediction/v1/forecast', (req, res) => {
  try {
    const hour = parseFloat(req.query.hour ?? new Date().getHours());
    const clampedHour = Math.max(0, Math.min(23, isNaN(hour) ? 17 : hour));

    // Mathematical modeling: Dual-peak diurnal traffic distribution with Gaussian/Sinusoidal functions
    // Morning commute peak around 07:45 (mean: 7.75, standard deviation: 1.25)
    const morningPeak = Math.exp(-Math.pow(clampedHour - 7.75, 2) / (2 * Math.pow(1.25, 2)));

    // Evening commute peak around 17:30 (mean: 17.5, standard deviation: 1.4)
    const eveningPeak = Math.exp(-Math.pow(clampedHour - 17.5, 2) / (2 * Math.pow(1.4, 2)));

    // Midday activity plateau (between 10:00 and 15:00)
    const middayCurve = (clampedHour >= 10 && clampedHour <= 15)
      ? 0.38 + 0.12 * Math.sin((clampedHour - 10) * Math.PI / 5)
      : 0.12;

    // Night baseline dip (00:00 - 05:00)
    const nightCurve = (clampedHour >= 0 && clampedHour < 5) ? 0.06 : 0.16;

    // Combined traffic intensity curve [0.0 .. 1.0]
    const baseIntensity = Math.max(nightCurve, Math.min(1.0, morningPeak * 0.88 + eveningPeak * 0.96 + middayCurve));

    // Natural pseudo-random micro-variation / noise based on hour seed
    const noise = (Math.sin(clampedHour * 4.3 + 0.7) * 0.035) + ((Math.random() - 0.5) * 0.02);
    const intensity = Math.max(0.08, Math.min(0.98, baseIntensity + noise));

    const probability = Math.round(intensity * 100);
    // Speed inversely proportional to congestion intensity (e.g. 54 km/h free flow down to 14 km/h jam)
    const expectedSpeed = Math.round(54 - (intensity * 40));

    let riskText = "Low Risk (Lancar)";
    let riskColor = "var(--success)";
    let status = "Lancar / Bebas Hambatan";
    let recommendation = "Kondisi arus lalu lintas optimal. Pertahankan siklus hijau standar ATCS SITS.";

    if (probability >= 75) {
      riskText = "High Risk Kemacetan (Kritis)";
      riskColor = "var(--danger)";
      status = "Peak Hour / Kepadatan Tinggi";
      recommendation = "Rekomendasi AI: Aktifkan Koridor Gelombang Hijau A. Yani - Wonokromo & Alihkan arus ke MERR.";
    } else if (probability >= 48) {
      riskText = "Moderate Risk (Padat Merayap)";
      riskColor = "var(--warning)";
      status = "Moderat / Padat Teratur";
      recommendation = "Rekomendasi AI: Tingkatkan Green Split Wonokromo +8 detik untuk mengurai akumulasi antrean.";
    }

    const factorList = [];
    if (clampedHour >= 6 && clampedHour <= 9) {
      factorList.push("Arus Komuter Jam Berangkat Kerja & Sekolah", "Penyempitan Lajur Frontage Road Wonokromo");
    } else if (clampedHour >= 16 && clampedHour <= 19) {
      factorList.push("Jam Pulang Kantor & Aktivitas Komersial", "Akumulasi Kendaraan Arteri A. Yani - Darmo");
    } else if (clampedHour >= 11 && clampedHour <= 14) {
      factorList.push("Aktivitas Niaga & Logistik Siang Hari", "Pola Siklus Lampu Hijau Reguler");
    } else {
      factorList.push("Arus Lalu Lintas Reguler Kota", "Kapasitas Jalan Utama Optimal");
    }
    factorList.push("Pola Historis Sensor SITS Kota Surabaya");

    res.json({
      status: "success",
      timestamp: new Date().toISOString(),
      hour: Math.round(clampedHour),
      hourLabel: `${String(Math.round(clampedHour)).padStart(2, '0')}:00 WIB`,
      congestionProbability: probability,
      riskText: riskText,
      riskColor: riskColor,
      expectedSpeedKmh: expectedSpeed,
      trafficStatus: status,
      recommendation: recommendation,
      factors: factorList
    });
  } catch (err) {
    console.error('❌ [API Forecast] Error:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 3. Device Management & Edge Node Configuration REST APIs
app.post('/api/devices/config', (req, res) => {
  try {
    const { deviceId, deviceName, fps, resolution, mode, greenWaveSync, refreshRate } = req.body || {};
    console.log(`⚙️ [API Device] Parameter konfigurasi diterima untuk ${deviceId || deviceName}:`, req.body);

    res.status(200).json({
      success: true,
      message: `Parameter konfigurasi node ${deviceId || deviceName || 'Edge AI'} berhasil disimpan ke server SITS.`,
      data: {
        deviceId: deviceId || 'NODE-EDGE-01',
        deviceName: deviceName || 'Jl. Ahmad Yani (Wonokromo) Node AI',
        fps: parseInt(fps, 10) || 30,
        resolution: resolution || '1080p',
        mode: mode || 'Adaptive AI (YOLOv8)',
        greenWaveSync: greenWaveSync ?? true,
        refreshRate: refreshRate || '300ms',
        updatedAt: backendState._getWibTimeString()
      }
    });
  } catch (err) {
    console.error('❌ [API Device Config] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

const handleDevicePing = (req, res) => {
  try {
    const devId = req.query.deviceId || req.body?.deviceId || 'NODE-EDGE-01';
    const latency = Math.floor(Math.random() * 7) + 8; // 8-14 ms

    res.status(200).json({
      success: true,
      deviceId: devId,
      latencyMs: latency,
      status: 'ONLINE',
      timestamp: backendState._getWibTimeString()
    });
  } catch (err) {
    console.error('❌ [API Device Ping] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

app.get('/api/devices/ping', handleDevicePing);
app.post('/api/devices/ping', handleDevicePing);

// 4. Incident Management REST API
app.get('/api/incidents', (req, res) => {
  res.json({
    status: "success",
    incidents: [
      { id: "101", title: "Mogok Truk Treler", location: "Simpang Wonokromo (DTC)", status: "ACTIVE", severity: "danger", category: "accident" },
      { id: "102", title: "Genangan Air Hujan (15cm)", location: "Koridor Manyar Kertoarjo", status: "ACTIVE", severity: "warning", category: "weather" },
      { id: "103", title: "Antrean Lampu Merah Pajang", location: "Simpang Jemursari - A. Yani", status: "ACTIVE", severity: "warning", category: "congestion" }
    ]
  });
});

const handleIncidentResolution = (req, res) => {
  const incidentId = req.params.id;
  const timestamp = backendState._getWibTimeString();
  
  // Emit socket update to notify all connected clients
  io.emit('incident:resolved', {
    id: incidentId,
    status: 'RESOLVED',
    timestamp: timestamp,
    resolvedBy: 'SITS Command Center Operator'
  });

  io.emit('system:toast', {
    message: `✅ Insiden #${incidentId} berhasil diselesaikan di server. Jalur dipastikan aman.`,
    type: 'success'
  });

  res.status(200).json({
    success: true,
    statusCode: 200,
    id: incidentId,
    status: "RESOLVED",
    message: `Insiden #${incidentId} telah berhasil ditandai Selesai di Backend SITS.`,
    timestamp: timestamp,
    resolvedBy: "Operator SITS 112 Surabaya"
  });
};

app.patch('/api/incidents/:id/resolve', handleIncidentResolution);
app.put('/api/incidents/:id/resolve', handleIncidentResolution);
app.post('/api/incidents/:id/resolve', handleIncidentResolution);

// 5. API Sandbox REST Endpoints
app.get('/v1/traffic/realtime', (req, res) => res.json({
  status: "success",
  timestamp: new Date().toISOString(),
  city: "Surabaya",
  activeNodes: 184,
  networkLoadPercent: backendState.state.networkLoad,
  averageWaitTimeSec: backendState.state.avgWaitTime,
  activeCorridor: "Jl. Ahmad Yani (Frontage Margorejo)"
}));

app.get('/v1/signals/cycle', (req, res) => res.json({
  status: "success",
  junctionId: "SITS-WNK-01",
  phase: backendState.state.greenWaveActive ? "GREEN_WAVE_LOCKED" : "ADAPTIVE_GREEN",
  cycleRemainingSec: backendState.state.intersections[0].timer,
  splitOptimizationRatio: 1.45
}));

app.get('/v1/cctv/detections', (req, res) => res.json({
  status: "success",
  camera: "CCTV-01-AYANI",
  fps: 30.0,
  detectionsCount: 18,
  breakdown: { cars: 10, motorcycles: 6, buses: 2 }
}));

// Proxy or generic API router for sandbox requests
app.all('/api/v1/*', (req, res) => {
  const pathStr = req.path.replace('/api', '');
  if (pathStr === '/v1/traffic/realtime') {
    return res.json({
      status: "success",
      timestamp: new Date().toISOString(),
      city: "Surabaya",
      activeNodes: 184,
      networkLoadPercent: backendState.state.networkLoad,
      averageWaitTimeSec: backendState.state.avgWaitTime,
      activeCorridor: "Jl. Ahmad Yani (Frontage Margorejo)"
    });
  }
  if (pathStr === '/v1/signals/cycle') {
    return res.json({
      status: "success",
      junctionId: "SITS-WNK-01",
      phase: backendState.state.greenWaveActive ? "GREEN_WAVE_LOCKED" : "ADAPTIVE_GREEN",
      cycleRemainingSec: backendState.state.intersections[0].timer,
      splitOptimizationRatio: 1.45
    });
  }
  if (pathStr === '/v1/cctv/detections') {
    return res.json({
      status: "success",
      camera: "CCTV-01-AYANI",
      fps: 30.0,
      detectionsCount: 18,
      breakdown: { cars: 10, motorcycles: 6, buses: 2 }
    });
  }
  return res.json({
    status: "success",
    method: req.method,
    endpoint: req.path,
    timestamp: new Date().toISOString(),
    message: `Respons sukses dari Server API SITS Surabaya untuk ${req.method} ${req.path}`,
    data: req.body || null
  });
});

// 6. Sandbox Terminal Execution Endpoint
app.post('/api/terminal/execute', (req, res) => {
  const { command } = req.body || {};
  const cmd = (command || '').trim();
  const lower = cmd.toLowerCase();
  const time = backendState._getWibTimeString();

  let responseLines = [];
  let color = "var(--text)";

  if (!cmd) {
    return res.json({ success: false, error: "Empty command" });
  }

  if (lower === '/help' || lower === 'help') {
    responseLines = [
      "Perintah SITS Gateway yang tersedia:",
      "  • /status     - Cek kesehatan gateway & node SITS",
      "  • /telemetry  - Ringkasan statistik & jaringan real-time",
      "  • /nodes      - Daftar kluster sensor persimpangan",
      "  • /ping       - Tes latensi ke edge node",
      "  • /chaos      - Status mode keos SITS",
      "  • /clear      - Bersihkan log tampilan terminal"
    ];
    color = "var(--primary-2)";
  } else if (lower === '/status' || lower === 'status') {
    responseLines = [
      `[HTTP 200 OK] SITS Enterprise Server: ONLINE`,
      `Backend Uptime: ${backendState.state.sitsUptime}% | CCTV Online: ${backendState.state.cctvOnline}/184`,
      `IoT Sensors: ${backendState.state.iotOnline}/312 | AI Confidence: ${backendState.state.aiConfidence}%`
    ];
    color = "var(--success)";
  } else if (lower === '/ping' || lower === 'ping') {
    responseLines = [
      `Memulai ping ke 4 Edge Node SITS Surabaya...`,
      `  • Node Wonokromo (DTC)     : 8 ms  [ONLINE]`,
      `  • Node Raya Darmo          : 11 ms [ONLINE]`,
      `  • Node Tunjungan / Siola   : 14 ms [ONLINE]`,
      `  • Node MERR Kertajaya      : 9 ms  [ONLINE]`,
      `Semua node merespons dalam <15ms.`
    ];
    color = "var(--success)";
  } else if (lower === '/telemetry' || lower === 'telemetry') {
    responseLines = [
      `Ringkasan Telemetri SITS (${time}):`,
      `  • Beban Jaringan : ${backendState.state.networkLoad}%`,
      `  • Waktu Tunggu   : ${backendState.state.avgWaitTime}s`,
      `  • Indeks Macet   : ${backendState.state.congestionIndex}`,
      `  • Total Kendaraan: ${backendState.state.vehiclesToday.toLocaleString('id-ID')}`
    ];
    color = "var(--text)";
  } else if (lower === '/nodes' || lower === 'nodes') {
    responseLines = [
      `Daftar Edge Cluster Nodes Active:`,
      `  [NODE-01] Wonokromo  (Status: ${backendState.state.intersections[0].status})`,
      `  [NODE-02] Margorejo  (Status: ${backendState.state.intersections[1].status})`,
      `  [NODE-03] Raya Darmo (Status: ${backendState.state.intersections[2].status})`,
      `  [NODE-04] Tunjungan  (Status: ${backendState.state.intersections[3].status})`,
      `  [NODE-05] MERR       (Status: ${backendState.state.intersections[4].status})`
    ];
    color = "var(--primary-2)";
  } else if (lower === '/chaos' || lower === 'chaos') {
    responseLines = [
      `Status Mode Keos: ${backendState.state.isChaosMode ? 'AKTIF (Level ' + backendState.state.chaosLevel + ')' : 'NON-AKTIF (Sistem Normal)'}`
    ];
    color = backendState.state.isChaosMode ? "var(--danger)" : "var(--success)";
  } else {
    responseLines = [
      `[SERVER RESPONSE 200 OK] Command '${cmd}' berhasil diproses oleh SITS Core Kernel.`
    ];
    color = "var(--text-muted)";
  }

  res.json({
    success: true,
    command: cmd,
    timestamp: time,
    output: responseLines,
    color: color
  });
});

// Fallback to index.html for all GET routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer(port) {
  const s = server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Enterprise Server Running at http://localhost:${port}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = Number(err.port || 3000) + 1;
    console.warn(`⚠️ Port ${err.port || 3000} sedang dipakai, otomatis beralih ke port ${nextPort}...`);
    setTimeout(() => {
      server.close();
      startServer(nextPort);
    }, 200);
  } else {
    console.error('Server error:', err);
  }
});

startServer(PORT);
