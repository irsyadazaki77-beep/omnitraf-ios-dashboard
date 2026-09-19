// Core Elements
const clock = document.getElementById("clock");
const navItems = document.querySelectorAll(".nav-item");
const toast = document.getElementById("toast");
const themeToggle = document.getElementById("themeToggle");
const filterChips = document.querySelectorAll(".filter-chip");
const mapBox = document.querySelector(".map-box");
const tableRows = document.querySelectorAll("#intersectionTable tr");
const searchInput = document.getElementById("intersectionSearch");
const greenRange = document.getElementById("greenRange");
const greenValue = document.getElementById("greenValue");
const networkLoad = document.getElementById("networkLoad");

// Global DOM elements & Leaflet variables declared early to prevent TDZ ReferenceErrors on load
let sidebar = document.getElementById("sidebar");
let drawerBackdrop = document.getElementById("drawerBackdrop");
let surabayaMap = null;
let leafletTileLayer = null;
let vehicleAnimInterval = null;

// CCTV simulation and incident variables declared globally to prevent TDZ ReferenceError on load
let simSpeedMultiplier = 1;
let isCctvPaused = false;
let currentIncidentFilter = "all";

// ==================== CHAOS MODE (MODE KEOS) STATE & FUNCTIONS ====================
let isChaosMode = false;
let chaosLevel = 0; // 0 = normal, 4 = max chaos, resolves progressively down to 0
let isSirenMuted = false;
let sirenInterval = null;
let resolutionInterval = null;

const btnToggleChaos = document.getElementById("btnToggleChaos");
const sirenBanner = document.getElementById("sirenBanner");
const btnMuteSiren = document.getElementById("btnMuteSiren");

function updateKpiVal(pText, val, subTextVal = null, metricClass = null) {
  const cards = document.querySelectorAll(".stat-card");
  cards.forEach(card => {
    const p = card.querySelector("p");
    if (p && p.textContent.trim().toLowerCase() === pText.toLowerCase()) {
      const counter = card.querySelector(".counter-val") || card.querySelector("h2");
      if (counter) {
        if (counter.classList.contains("counter-val")) {
          counter.textContent = val;
          counter.dataset.counter = val.toString().replace(/[^0-9.]/g, '');
        } else {
          // If h2 contains sub spans
          const spanVal = counter.querySelector("span:first-child");
          if (spanVal && spanVal.classList.contains("counter-val")) {
            spanVal.textContent = val;
            spanVal.dataset.counter = val.toString().replace(/[^0-9.]/g, '');
          } else {
            // Find just the numeric text node or change innerHTML
            const nodes = Array.from(counter.childNodes);
            const textNode = nodes.find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== "");
            if (textNode) {
              textNode.textContent = val;
            } else {
              counter.innerHTML = `${val}`;
            }
          }
        }
      }
      if (subTextVal) {
        const subSpan = card.querySelector(".metric-up") || card.querySelector(".metric-warn") || card.querySelector(".metric-down") || card.querySelector("span:last-child");
        if (subSpan) {
          subSpan.textContent = subTextVal;
          if (metricClass) {
            subSpan.className = metricClass;
          }
        }
      }
    }
  });
}

function toggleDeviceTableChaos(activate) {
  const rows = document.querySelectorAll("#deviceTableBody tr");
  rows.forEach((row, index) => {
    if (activate) {
      if (index === 0 || index === 2 || index === 3) {
        row.classList.add("device-row-offline");
        const statusDot = row.querySelector(".status-dot");
        if (statusDot) {
          statusDot.className = "status-dot offline";
          statusDot.nextSibling.textContent = " Offline";
        }
        const pingTd = row.querySelector(".device-ping");
        if (pingTd) {
          pingTd.textContent = "999+ ms";
          pingTd.style.color = "var(--danger)";
        }
      }
    } else {
      row.classList.remove("device-row-offline");
      const statusDot = row.querySelector(".status-dot");
      if (statusDot) {
        statusDot.className = "status-dot";
        statusDot.nextSibling.textContent = " Online";
      }
      const pingTd = row.querySelector(".device-ping");
      if (pingTd) {
        const lat = index === 0 ? "12 ms" : index === 1 ? "14 ms" : index === 2 ? "18 ms" : "8 ms";
        pingTd.textContent = lat;
        pingTd.style.color = "";
      }
    }
  });
}

function updateMapTrafficChaos(activate) {
  const svgs = document.querySelectorAll("svg");
  svgs.forEach(svg => {
    const roads = svg.querySelectorAll(".road");
    roads.forEach(road => {
      if (activate) {
        road.className.baseVal = "road road-danger density-high";
      } else {
        if (road.id === "dashRoad1" || road.id === "dashRoad2") {
          road.className.baseVal = "road road-danger density-high";
        } else if (road.id === "dashRoad3") {
          road.className.baseVal = "road road-primary";
        } else if (road.id === "dashRoad4" || road.id === "dashRoad5") {
          road.className.baseVal = "road road-success density-low";
        } else {
          if (road.getAttribute("d") && road.getAttribute("d").includes("C216")) {
            road.className.baseVal = "road road-warning density-moderate";
          } else {
            road.className.baseVal = "road road-success density-low";
          }
        }
      }
    });

    const glows = svg.querySelectorAll(".road-glow");
    glows.forEach(glow => {
      if (activate) {
        glow.className.baseVal = "road-glow road-glow-danger density-high";
      } else {
        if (glow.getAttribute("d") && glow.getAttribute("d").includes("C472")) {
          glow.className.baseVal = "road-glow road-glow-danger density-high";
        } else if (glow.getAttribute("d") && glow.getAttribute("d").includes("M452")) {
          glow.className.baseVal = "road-glow road-glow-warning density-moderate";
        } else if (glow.getAttribute("d") && glow.getAttribute("d").includes("M216")) {
          glow.className.baseVal = "road-glow road-glow-warning density-moderate";
        } else if (glow.getAttribute("d") && (glow.getAttribute("d").includes("M534") || glow.getAttribute("d").includes("M766"))) {
          glow.className.baseVal = "road-glow road-glow-success density-low";
        } else {
          glow.className.baseVal = "road-glow road-glow-primary";
        }
      }
    });

    const nodes = svg.querySelectorAll(".signal-node");
    nodes.forEach(node => {
      if (activate) {
        node.className.baseVal = "signal-node node-danger";
        const parent = node.parentElement;
        if (parent) {
          const rings = parent.querySelectorAll(".signal-ring");
          rings.forEach(ring => {
            ring.className.baseVal = "signal-ring ripple-danger ripple-delay-1";
          });
        }
      } else {
        const cx = parseFloat(node.getAttribute("cx"));
        const cy = parseFloat(node.getAttribute("cy"));
        let nodeClass = "node-warning";
        let ringClass = "ripple-warning";
        if (cx === 452 && cy === 338) { nodeClass = "node-danger"; ringClass = "ripple-danger"; }
        else if (cx === 468 && cy === 154) { nodeClass = "node-success"; ringClass = "ripple-success"; }
        else if (cx === 766 && cy === 182) { nodeClass = "node-success"; ringClass = "ripple-success"; }
        
        node.className.baseVal = `signal-node ${nodeClass}`;
        const parent = node.parentElement;
        if (parent) {
          const rings = parent.querySelectorAll(".signal-ring");
          rings.forEach(ring => {
            ring.className.baseVal = `signal-ring ${ringClass} ripple-delay-1`;
          });
        }
      }
    });
  });
}

function updateCctvChaos(activate) {
  const glitchOverlays = document.querySelectorAll(".cctv-glitch-overlay");
  glitchOverlays.forEach((overlay, idx) => {
    if (activate) {
      if (idx === 0 || idx === 1 || idx === 3 || idx === 4) {
        overlay.classList.add("show");
      }
    } else {
      overlay.classList.remove("show");
    }
  });
}

function updateCctvPills(activate) {
  const cards = document.querySelectorAll(".camera-card");
  cards.forEach((card, idx) => {
    const pill = card.querySelector(".pill");
    if (pill) {
      if (activate && (idx === 0 || idx === 2 || idx === 3)) {
        pill.className = "pill pill-danger";
        pill.textContent = "Offline";
      } else {
        pill.className = "pill pill-live";
        pill.textContent = "Active";
      }
    }
  });
}

function playSirenSound() {
  if (!audioEnabled || isSirenMuted) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sawtooth';
    const now = audioCtx.currentTime;
    
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.5);
    osc.frequency.linearRampToValueAtTime(580, now + 1.0);
    
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    
    osc.start(now);
    osc.stop(now + 1.0);
  } catch (e) {
    console.warn("Siren synthesis error", e);
  }
}

function startSirenLoop() {
  if (sirenInterval) clearInterval(sirenInterval);
  sirenInterval = setInterval(() => {
    if (isChaosMode && !isSirenMuted) {
      playSirenSound();
    }
  }, 1800);
}

function triggerChaosMode() {
  toggleDeviceTableChaos(true);
  updateMapTrafficChaos(true);
  updateCctvChaos(true);
  updateCctvPills(true);
  startSirenLoop();

  // Spike SITS statistics
  updateKpiVal("Indeks Kemacetan", "98", "Kritis! Gridlock Total", "metric-down");
  updateKpiVal("Rata-rata Waktu Tunggu", "118", "+76 dtk (Kritis)", "metric-down");
  updateKpiVal("Reduksi Emisi CO₂", "0", "Penurunan Performa", "metric-down");
  updateKpiVal("Efisiensi Lampu Lampu", "34", "Kegagalan AI Node", "metric-down");
  updateKpiVal("Kendaraan Darurat Aktif", "6", "Tingkat Konflik Tinggi", "metric-down");
  updateKpiVal("Persimpangan Aktif", "82", "44 Node Terputus", "metric-down");

  if (networkLoad) networkLoad.textContent = "99%";
  const latencyValEl = document.getElementById("latencyVal");
  if (latencyValEl) {
    latencyValEl.textContent = "999+ ms";
    latencyValEl.style.color = "var(--danger)";
  }
  const uptimeVal = document.querySelector(".health-item strong[data-counter='99']");
  if (uptimeVal) uptimeVal.textContent = "42.3%";
}

function resetChaosMode() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if (resolutionInterval) {
    clearInterval(resolutionInterval);
    resolutionInterval = null;
  }
  toggleDeviceTableChaos(false);
  updateMapTrafficChaos(false);
  updateCctvChaos(false);
  updateCctvPills(false);

  // Restore SITS statistics to normal
  updateKpiVal("Persimpangan Aktif", "126", "Operasional (SITS)", "metric-up");
  updateKpiVal("Indeks Kemacetan", "68", "Peningkatan Kepadatan", "metric-warn");
  updateKpiVal("Rata-rata Waktu Tunggu", "42", "-6 detik", "metric-up");
  updateKpiVal("Kendaraan Darurat Aktif", "3", "Status prioritas aktif", "metric-down");
  updateKpiVal("Reduksi Emisi CO₂", "18", "Dampak ESG positif", "metric-up");
  updateKpiVal("Efisiensi Sinyal APILL", "92", "Optimalisasi AI", "metric-up");

  if (networkLoad) networkLoad.textContent = "72%";
  const latencyValEl = document.getElementById("latencyVal");
  if (latencyValEl) {
    latencyValEl.textContent = "24ms";
    latencyValEl.style.color = "";
  }
  const uptimeVal = document.querySelector(".health-item strong[data-counter='99']");
  if (uptimeVal) uptimeVal.textContent = "99.7%";
}

function startProgressiveResolution() {
  if (!isChaosMode) return;
  if (resolutionInterval) clearInterval(resolutionInterval);
  
  showToast("🔄 AI RESOLUTION ACTUATING: Merekomendasikan pengaturan fase hijau adaptif...");
  playSound('success');
  
  let step = 0;
  resolutionInterval = setInterval(() => {
    step++;
    if (!isChaosMode) {
      clearInterval(resolutionInterval);
      return;
    }
    
    if (step === 1) {
      chaosLevel = 3;
      recoverNode(0); // NODE-EDGE-01 Wonokromo
      recoverCctv(1); // CCTV-01 Margorejo
      updateKpiVal("Indeks Kemacetan", "82", "Mulai Terurai", "metric-warn");
      updateKpiVal("Persimpangan Aktif", "96", "30 Node Terputus", "metric-warn");
      showToast("AI RESOLUTION (1/4): Node Wonokromo & CCTV-01 Margorejo online.");
      playSound('success');
    } 
    else if (step === 2) {
      chaosLevel = 2;
      recoverNode(2); // NODE-EDGE-03 Tunjungan
      recoverCctv(3); // CCTV-03 Taman Bungkul
      updateKpiVal("Indeks Kemacetan", "64", "Kepadatan Berkurang", "metric-warn");
      updateKpiVal("Rata-rata Waktu Tunggu", "74", "+32 dtk", "metric-warn");
      showToast("AI RESOLUTION (2/4): CCTV Taman Bungkul pulih. Jalur utama lancar.");
      playSound('success');
    }
    else if (step === 3) {
      chaosLevel = 1;
      recoverNode(3); // NODE-CTRL-01 Siemens
      recoverCctv(4); // CCTV-04 Tunjungan
      updateKpiVal("Indeks Kemacetan", "48", "Mendekati Normal", "metric-up");
      updateKpiVal("Efisiensi Lampu Lampu", "78", "AI Stabilizing", "metric-up");
      showToast("AI RESOLUTION (3/4): SITS Controller Wonokromo online. Overrides aktif.");
      playSound('success');
    }
    else if (step === 4) {
      clearInterval(resolutionInterval);
      isChaosMode = false;
      chaosLevel = 0;
      
      if (btnToggleChaos) btnToggleChaos.classList.remove("active");
      document.body.classList.remove("chaos-active");
      if (sirenBanner) sirenBanner.classList.remove("show");
      
      resetChaosMode();
      showToast("AI RESOLUTION (4/4): Seluruh koridor Surabaya dinormalisasi ke status hijau.");
      playSound('success');
    }
  }, 3500);
}

function recoverNode(index) {
  const rows = document.querySelectorAll("#deviceTableBody tr");
  const row = rows[index];
  if (row) {
    row.classList.remove("device-row-offline");
    const statusDot = row.querySelector(".status-dot");
    if (statusDot) {
      statusDot.className = "status-dot";
      statusDot.nextSibling.textContent = " Online";
    }
    const pingTd = row.querySelector(".device-ping");
    if (pingTd) {
      const lat = index === 0 ? "12 ms" : index === 1 ? "14 ms" : index === 2 ? "18 ms" : "8 ms";
      pingTd.textContent = lat;
      pingTd.style.color = "var(--success)";
    }
  }
}

function recoverCctv(num) {
  const glitch = document.getElementById(`cctvGlitch${num}`);
  if (glitch) {
    glitch.classList.remove("show");
  }
  if (num === 1) {
    const mainGlitch = document.getElementById("dashCameraGlitch");
    if (mainGlitch) mainGlitch.classList.remove("show");
  }
  
  const cards = document.querySelectorAll(".camera-card");
  const card = cards[num - 1];
  if (card) {
    const pill = card.querySelector(".pill");
    if (pill) {
      pill.className = "pill pill-live";
      pill.textContent = "Active";
    }
  }
}

// Attach Event Listeners for Chaos Mode Toggle Controls
if (btnToggleChaos) {
  btnToggleChaos.addEventListener("click", () => {
    isChaosMode = !isChaosMode;
    btnToggleChaos.classList.toggle("active", isChaosMode);
    document.body.classList.toggle("chaos-active", isChaosMode);
    
    if (isChaosMode) {
      chaosLevel = 4;
      if (sirenBanner) sirenBanner.classList.add("show");
      showToast("⚠️ WARNING: MODE KEOS DIAKTIFKAN! Gridlock & Device Failures terdeteksi.");
      playSound('warning');
      triggerChaosMode();
      if (typeof triggerChaosChatSequence === "function") triggerChaosChatSequence();
    } else {
      chaosLevel = 0;
      if (sirenBanner) sirenBanner.classList.remove("show");
      showToast("✅ Sistem SITS Surabaya berhasil dinormalisasi.");
      playSound('success');
      resetChaosMode();
      if (typeof triggerNormalChatSequence === "function") triggerNormalChatSequence();
    }
  });
}

if (btnMuteSiren) {
  btnMuteSiren.addEventListener("click", () => {
    isSirenMuted = !isSirenMuted;
    btnMuteSiren.classList.toggle("muted", isSirenMuted);
    btnMuteSiren.textContent = isSirenMuted ? "🔇" : "🔊";
    playSound('click');
  });
}
// ==================================================================================

// Page view headers & text parameters for Surabaya SPA routing context
const routeHeaders = {
  "dashboard": {
    eyebrow: "SURABAYA INTELLIGENT TRANSPORT SYSTEM (SITS)",
    title: "OmniTRAF Command Center",
    desc: "Dashboard lalu lintas adaptif berbasis AI dengan visualisasi real-time Kota Surabaya, integrasi sensor IoT, serta analisis computer vision pada jaringan CCTV eksisting kota secara real-time."
  },
  "map": {
    eyebrow: "GEOSPATIAL SURABAYA TRAFFIC MAP",
    title: "Peta Lalu Lintas Surabaya",
    desc: "Visualisasi spasial real-time jalan raya utama Surabaya: Wonokromo, Darmo, Kertajaya, dan Tunjungan."
  },
  "cctv": {
    eyebrow: "COMPUTER VISION INFERENCE FEED",
    title: "Live Camera AI Analytics Surabaya",
    desc: "Analisis klasifikasi tipe kendaraan dan kepadatan antrean pada koridor Margorejo, Flyover Wonokromo, Taman Bungkul, dan Siola menggunakan computer vision."
  },
  "signals": {
    eyebrow: "SITS SIGNAL PHASE CONTROLLER",
    title: "Traffic Signal Overrides",
    desc: "Visualisasi fase sinyal SITS Surabaya serta kontrol manual durasi siklus hijau persimpangan prioritas."
  },
  "emergency": {
    eyebrow: "EMERGENCY RESPONDER PRIORITY ACTUATOR",
    title: "Emergency Responder Priority",
    desc: "Intervensi fase lampu hijau otomatis (preemption) bagi armada ambulans RSU Dr. Soetomo dan pemadam kebakaran Wonokromo."
  },
  "analytics": {
    eyebrow: "ANALYTICAL HISTORICAL ESG MONITOR",
    title: "Traffic Analytics & ESG Monitor",
    desc: "Statistik volume kendaraan harian, kecepatan rata-rata koridor, serta dampak kelestarian lingkungan emisi CO2 Surabaya."
  },
  "prediction": {
    eyebrow: "PREDICTIVE MACHINE LEARNING MODEL",
    title: "AI Congestion Forecasting",
    desc: "Prediksi tingkat kemacetan koridor utama Surabaya jam-demi-jam untuk hari esok berdasarkan model historis."
  },
  "incidents": {
    eyebrow: "INCIDENT MANAGEMENT & CONTROL",
    title: "Automatic Incident Detection",
    desc: "Deteksi otomatis kecelakaan, jalan berlubang, kemacetan tidak terduga, serta pekerjaan umum jalan raya di Surabaya."
  },
  "reports": {
    eyebrow: "COMPLIANCE & DAILY SNAPSHOTS",
    title: "Mobility Snapshots & PDF Report",
    desc: "Ekstraksi ringkasan performa operasional lalu lintas SITS Surabaya harian atau mingguan untuk laporan analisis dinas."
  },
  "devices": {
    eyebrow: "SITS HARDWARE TELEMETRY & NETWORK",
    title: "Edge AI Nodes & IoT Devices",
    desc: "Manajemen status Jetson Edge AI SITS nodes di berbagai persimpangan jalan Surabaya."
  },
  "integration": {
    eyebrow: "SMART CITY DATA GATEWAY INTEGRATION",
    title: "Smart City Webhook Integrations",
    desc: "Integrasi data API SITS Dishub Surabaya dan Surabaya Smart City Hub secara real-time."
  },
  "settings": {
    eyebrow: "CONTROL ROOM CONFIGURATOR",
    title: "Command Center Configuration",
    desc: "Pengaturan umpan balik audio haptic dan parameter sistem pusat kendali SITS Surabaya."
  }
};

// Interactive Actions Dictionary Surabaya-focused
const messages = {
  "simulate": "Simulasi optimasi lalu lintas SITS Surabaya berhasil diinisialisasi.",
  "export": "Kompilasi laporan mobilitas selesai. Menyiapkan arsip telemetri SITS untuk diekspor.",
  "refresh": "Sinkronisasi telemetry selesai. Kapasitas lalu lintas jalan koridor Surabaya direkalkulasi secara real-time.",
  "apply-ai": "Instruksi optimasi AI berhasil diaktifkan pada sistem traffic controller persimpangan Surabaya.",
  "system-check": "Diagnostik sistem selesai. Seluruh 184 node sensor SITS beroperasi dalam batas parameter normal.",
  "time-range": "Jangkauan visualisasi analitik dikonfigurasi untuk periode operasional hari ini."
};

// 1. Audio Haptics via Web Audio API (Synthesizer)
let audioEnabled = false;
let audioCtx = null;

function playSound(type = 'click') {
  if (!audioEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'click') {
      // Clean mechanical click sound
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1500, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.03);
      gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.03);
    } else if (type === 'hover') {
      // Discrete ultra-high tick sound
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.008, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.02);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.02);
    } else if (type === 'success') {
      // Tech-chime (double peak tone)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.setValueAtTime(900, audioCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.20);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.20);
    } else if (type === 'switch') {
      // Mechanical slide switch toggle
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(180, audioCtx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.015, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.06);
    } else if (type === 'warning') {
      // Low dual-tone buzzer
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.setValueAtTime(180, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    }
  } catch (e) {
    console.warn("Haptic audio initialization blocked by browser policy.", e);
  }
}

// Set up UI Interaction Listeners for Audio Haptics
navItems.forEach(item => {
  item.addEventListener("mouseenter", () => playSound('hover'));
  item.addEventListener("click", () => playSound('click'));
});

filterChips.forEach(chip => {
  chip.addEventListener("mouseenter", () => playSound('hover'));
  chip.addEventListener("click", () => playSound('click'));
});

document.querySelectorAll("[data-action]").forEach(btn => {
  btn.addEventListener("mouseenter", () => playSound('hover'));
});

// Audio Toggle Switch Handler
const audioToggle = document.getElementById("audioToggle");
if (audioToggle) {
  audioToggle.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    audioToggle.querySelector(".audio-icon").textContent = audioEnabled ? "🔊" : "🔇";
    audioToggle.classList.toggle("active", audioEnabled);
    if (audioEnabled) {
      playSound('success');
    }
  });
}

// 2. SPA Workspace Dynamic Router
function switchView(viewId) {
  const panes = document.querySelectorAll(".view-pane");
  const eyebrowEl = document.getElementById("viewEyebrow");
  const titleEl = document.getElementById("viewTitle");
  const descEl = document.getElementById("viewDescription");

  // Toggle visible pane
  panes.forEach(pane => {
    pane.classList.remove("active");
  });
  const activePane = document.getElementById(`view-${viewId}`);
  if (activePane) {
    activePane.classList.add("active");
  }

  // Update headers dynamic context
  const headerData = routeHeaders[viewId] || routeHeaders["dashboard"];
  if (eyebrowEl) eyebrowEl.textContent = headerData.eyebrow;
  if (titleEl) titleEl.textContent = headerData.title;
  if (descEl) descEl.textContent = headerData.desc;

  // Run scroll triggers for visible page entry animations
  window.scrollTo({ top: 0, behavior: "smooth" });
  
  // Custom initializations on view activation
  if (viewId === "map") {
    initLeafletSurabayaMap();
    if (surabayaMap) {
      setTimeout(() => surabayaMap.invalidateSize(), 150);
    }
  }
  if (viewId === "prediction") {
    cloneMaps();
    const slider = document.getElementById("predictionTimeSlider");
    if (slider) updatePredictionMap(parseInt(slider.value));
  }
  if (viewId === "analytics") {
    animateEsgMetrics();
  }
}

// Sidebar & Mobile Tab Bar routing activation
navItems.forEach(item => {
  item.addEventListener("click", (event) => {
    const viewId = item.dataset.view;
    if (!viewId) return;

    event.preventDefault();
    navItems.forEach(nav => nav.classList.remove("active"));
    document.querySelectorAll(`.nav-item[data-view="${viewId}"]`).forEach(n => n.classList.add("active"));

    if (sidebar && sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
      if (drawerBackdrop) drawerBackdrop.classList.remove("show");
    }

    switchView(viewId);
    playSound('click');
  });
});

// Setup hover sound listeners for navigations
navItems.forEach(item => {
  item.addEventListener("mouseenter", () => playSound('hover'));
});

filterChips.forEach(chip => {
  chip.addEventListener("click", () => {
    filterChips.forEach(item => item.classList.remove("active"));
    chip.classList.add("active");
    applyTableFilter();
    showToast(`Filter kepadatan: ${chip.textContent}`);
  });
});

// 3. Map Node Cloner for full page and prediction heatmap
function cloneMaps() {
  const sourceMap = document.querySelector("#dashboardMapBox svg");
  if (!sourceMap) return;

  const placeholder1 = document.getElementById("fullMapPlaceholder");
  const placeholder2 = document.getElementById("predictionMapPlaceholder");

  if (placeholder1 && placeholder1.childElementCount === 0) {
    const clone = sourceMap.cloneNode(true);
    clone.id = "fullMapSvg";
    placeholder1.appendChild(clone);
  }

  if (placeholder2 && placeholder2.childElementCount === 0) {
    const clone = sourceMap.cloneNode(true);
    clone.id = "predictionMapSvg";
    
    // Strip vehicle flows for prediction heatmap simplicity
    const vehicles = clone.querySelector(".vehicle-flow");
    if (vehicles) vehicles.remove();
    
    placeholder2.appendChild(clone);
  }
}

// 4. Bounding Box Object Tracking & Canvas Camera Simulation
class CctvSimulation {
  constructor(canvasId, density = 'moderate') {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.vehicles = [];
    this.density = density;
    
    const card = this.canvas.closest(".camera-box, .camera-card");
    this.boxElements = card ? card.querySelectorAll(".cv-rect") : [];
    
    this.vx = this.canvas.width / 2;
    this.vy = this.canvas.height * 0.25;
    
    this.lanes = [
      { bx: this.canvas.width * 0.15, by: this.canvas.height },
      { bx: this.canvas.width * 0.38, by: this.canvas.height },
      { bx: this.canvas.width * 0.62, by: this.canvas.height },
      { bx: this.canvas.width * 0.85, by: this.canvas.height }
    ];
    
    this.boxElements.forEach((el, idx) => {
      this.spawnVehicle(el, idx);
    });
  }
  
  spawnVehicle(element, index) {
    const laneIdx = index % this.lanes.length;
    const progress = Math.random();
    const type = element.classList.contains("rect-bus") ? "bus" :
                 element.classList.contains("rect-person") ? "person" :
                 element.classList.contains("rect-truck") ? "truck" :
                 element.classList.contains("rect-motorcycle") ? "motorcycle" : "car";
                 
    let baseW = 34, baseH = 26;
    if (type === "bus") { baseW = 44; baseH = 34; }
    else if (type === "truck") { baseW = 40; baseH = 32; }
    else if (type === "motorcycle") { baseW = 20; baseH = 20; }
    else if (type === "person") { baseW = 12; baseH = 22; }
    
    this.vehicles.push({
      element: element,
      lane: laneIdx,
      t: progress,
      speed: 0.002 + Math.random() * 0.003,
      type: type,
      baseW: baseW,
      baseH: baseH,
      color: this.getRandomColor(type)
    });
  }
  
  getRandomColor(type) {
    if (type === "car") return ["#00e5ff", "#0088ff", "#e0e6ed", "#5b768d"][Math.floor(Math.random() * 4)];
    if (type === "bus") return "var(--warning)";
    if (type === "truck") return "#10b981";
    if (type === "motorcycle") return "#8b5cf6";
    return "#ff007c";
  }
  
  update() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    ctx.fillStyle = "#091220";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#02070e";
    ctx.fillRect(0, 0, w, this.vy);
    
    ctx.strokeStyle = "rgba(0, 229, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.vy);
    ctx.lineTo(w, this.vy);
    ctx.stroke();
    
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    this.lanes.forEach(lane => {
      ctx.beginPath();
      ctx.moveTo(this.vx, this.vy);
      ctx.lineTo(lane.bx, lane.by);
      ctx.stroke();
    });
    
    this.vehicles.forEach(v => {
      // Under chaos mode, crawl bumper-to-bumper at 12% speed
      const speedMult = (typeof isCctvPaused !== "undefined" && isCctvPaused) ? 0 : 
                        (typeof simSpeedMultiplier !== "undefined" ? simSpeedMultiplier : 1);
      const effSpeed = (typeof isChaosMode !== "undefined" && isChaosMode ? v.speed * 0.12 : v.speed) * speedMult;
      v.t += effSpeed;
      if (v.t > 1) {
        v.t = 0;
        v.lane = Math.floor(Math.random() * this.lanes.length);
        v.speed = 0.002 + Math.random() * 0.003;
      }
      
      const bx = this.lanes[v.lane].bx;
      const by = this.lanes[v.lane].by;
      
      const x = this.vx + (bx - this.vx) * v.t;
      const y = this.vy + (by - this.vy) * v.t;
      
      const scale = 0.15 + v.t * 0.85;
      const drawW = v.baseW * scale;
      const drawH = v.baseH * scale;
      
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.beginPath();
      ctx.ellipse(x, y + drawH / 2, drawW / 2, drawH / 6, 0, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = v.color;
      ctx.fillRect(x - drawW / 2, y - drawH / 2, drawW, drawH);
      
      ctx.strokeStyle = v.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - drawW / 2 - 2, y - drawH / 2 - 2, drawW + 4, drawH + 4);
      
      if (v.element) {
        if (v.element.classList.contains("hide-boxes")) return;
        const leftPercent = ((x - drawW / 2) / w) * 100;
        const topPercent = ((y - drawH / 2) / h) * 100;
        
        v.element.style.left = `${leftPercent}%`;
        v.element.style.top = `${topPercent}%`;
        v.element.style.width = `${drawW}px`;
        v.element.style.height = `${drawH}px`;
      }
    });
  }
}

const cctvSimulations = [];
function initCctvSimulations() {
  cctvSimulations.push(new CctvSimulation("dashCameraCanvas"));
  cctvSimulations.push(new CctvSimulation("cctvCanvas1"));
  cctvSimulations.push(new CctvSimulation("cctvCanvas2"));
  cctvSimulations.push(new CctvSimulation("cctvCanvas3"));
  cctvSimulations.push(new CctvSimulation("cctvCanvas4"));
  
  function animLoop() {
    cctvSimulations.forEach(sim => {
      const isVisible = sim.canvas && sim.canvas.offsetParent !== null;
      if (isVisible) {
        sim.update();
      }
    });
    requestAnimationFrame(animLoop);
  }
  animLoop();
}
initCctvSimulations();

// Bounding Box toggler button
const btnToggleCVBoxes = document.getElementById("btnToggleCVBoxes");
if (btnToggleCVBoxes) {
  btnToggleCVBoxes.addEventListener("click", () => {
    playSound('click');
    const rects = document.querySelectorAll(".cv-rect");
    const active = rects[0] && rects[0].classList.contains("hide-boxes");
    
    rects.forEach(rect => {
      rect.classList.toggle("hide-boxes", !active);
    });
    
    btnToggleCVBoxes.textContent = active ? "Sembunyikan Overlay AI" : "Tampilkan Overlay AI";
    showToast(active ? "Visualisasi overlay AI diaktifkan." : "Visualisasi overlay AI dinonaktifkan.");
  });
}

// 5. Signal Overrides active cycle ticker countdown
let activeCycles = [38, 28];
function updateSignalCycles() {
  setInterval(() => {
    activeCycles = activeCycles.map((c, i) => {
      let next = c - 1;
      if (next <= 0) {
        next = 45; 
        playSound('success');
        showToast(`Siklus lampu hijau Simpang 0${i+1} Surabaya berganti fase.`);
      }
      const el = document.getElementById(`cycleVal${i+1}`);
      if (el) el.textContent = next;
      return next;
    });
  }, 1000);
}
updateSignalCycles();

// Override buttons listener
document.querySelectorAll(".force-override-btn").forEach((btn, idx) => {
  btn.addEventListener("click", () => {
    playSound('click');
    activeCycles[idx] = 45; 
    const el = document.getElementById(`cycleVal${idx+1}`);
    if (el) el.textContent = 45;
    showToast(`Manual override diaktifkan. Durasi fase hijau Wonokromo diset ke 45 detik.`);
  });
});

// 6. Hour-by-hour Congestion predictor timeline mapping (Surabaya map coordinates)
const predictionSlider = document.getElementById("predictionTimeSlider");
function updatePredictionMap(hour) {
  const mapSvg = document.getElementById("predictionMapSvg");
  const timeLabel = document.getElementById("sliderTimeLabel");
  const riskLabel = document.getElementById("sliderRiskLabel");
  const predTomorrowStatus = document.getElementById("predTomorrowStatus");

  if (timeLabel) {
    timeLabel.textContent = `${String(hour).padStart(2, '0')}:00 WIB`;
  }

  if (!mapSvg) return;
  const roads = mapSvg.querySelectorAll(".road");
  
  let riskText = "Low Risk (Lancar)";
  let riskColor = "var(--success)";
  let densityClass = "success"; 

  // Rush hour bounds
  if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
    riskText = "High Risk Kemacetan (Merah)";
    riskColor = "var(--danger)";
    densityClass = "danger";
  } else if ((hour >= 10 && hour <= 16) || (hour >= 20 && hour <= 22)) {
    riskText = "Moderate Risk (Padat Rayap)";
    riskColor = "var(--warning)";
    densityClass = "warning";
  }

  if (riskLabel) {
    riskLabel.textContent = `Status: ${riskText}`;
    riskLabel.style.color = riskColor;
  }
  
  if (predTomorrowStatus) {
    predTomorrowStatus.textContent = hour >= 7 && hour <= 9 ? "Tinggi" : "Sedang";
    predTomorrowStatus.style.color = hour >= 7 && hour <= 9 ? "var(--danger)" : "var(--warning)";
  }

  // Update map visual path classes to represent risk levels
  roads.forEach((road, idx) => {
    road.className.baseVal = "road";
    if (densityClass === "danger") {
      if (idx % 2 === 0) road.classList.add("road-danger");
      else road.classList.add("road-warning");
    } else if (densityClass === "warning") {
      if (idx % 3 === 0) road.classList.add("road-warning");
      else road.classList.add("road-success");
    } else {
      road.classList.add("road-success");
    }
  });
}

if (predictionSlider) {
  predictionSlider.addEventListener("input", () => {
    updatePredictionMap(parseInt(predictionSlider.value));
    playSound('hover');
  });
}

// 7. Edge AI Node Device pinger simulator
function setupDevicePinger() {
  const pingButtons = document.querySelectorAll(".ping-device-btn");
  pingButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest("tr");
      const pingTd = row.querySelector(".device-ping");
      const originalText = btn.textContent;
      
      playSound('click');
      btn.textContent = "Pinging...";
      btn.disabled = true;
      pingTd.innerHTML = `<div class="ping-loader-bar"><div class="ping-loader-fill"></div></div>`;

      setTimeout(() => {
        const latency = Math.floor(6 + Math.random() * 12); 
        pingTd.innerHTML = `${latency} ms`;
        pingTd.style.color = "var(--success)";
        btn.textContent = originalText;
        btn.disabled = false;
        playSound('success');
      }, 750);
    });
  });

  const pingAllBtn = document.getElementById("btnPingAll");
  if (pingAllBtn) {
    pingAllBtn.addEventListener("click", () => {
      playSound('click');
      pingButtons.forEach(btn => btn.click());
    });
  }
}
setupDevicePinger();

// 8. Smart City integration live logs feed (Surabaya localized)
const terminal = document.getElementById("terminalLogs");
const webhooks = [
  "SITS Dishub Surabaya: API fetch completed (200 OK)",
  "NODE-EDGE-01 (Wonokromo): Bounding boxes broadcasted",
  "NODE-EDGE-02 (Darmo): GPU Temp 63°C, GPU load 42%",
  "NODE-CTRL-02 (Tunjungan): Local traffic phase cycle adjusted automatically",
  "SITS-EMERGENCY: Ambulance 02 (Darmo Route) GPS synced. ETA 1m 45s",
  "SITS-ESG-CALCULATOR: Efisiensi reduksi emisi karbon dioksida terhitung pada 18.2%",
  "Surabaya City Hub: Telemetry push completed successfully",
  "SITS-ALERT: Pekerjaan utilitas kabel koridor Jl. Raya Darmo terdeteksi",
  "SITS Controller: Override signal phase approved (Wonokromo)"
];
const chaosWebhooks = [
  "CRITICAL HEARTBEAT FAILURE: NODE-EDGE-01 (Wonokromo) offline.",
  "SITS METRIC DANGER: Average wait time exceeded 110s at Wonokromo.",
  "REST API GATEWAY TIMEOUT: 504 Gateway Timeout pushing to Surabaya City Hub.",
  "SIEMENS PLC ERROR: Siemens Controller DEV-CTRL-01 heartbeat timeout.",
  "DISHUB ROAD EMERGENCY: Severe gridlock detected on frontage A. Yani.",
  "EMERGENCY ROUTE CONFLICT: Concurrently active route preemption blocked.",
  "CCTV RTSP ERROR: Rtsp transport layer failed on CCTV-04.",
  "JETSON EDGE THERMAL WARN: NODE-EDGE-03 throttle due to temperature spike."
];

function runTerminalLogs() {
  if (!terminal) return;
  setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour12: false });
    
    let logText;
    if (typeof isChaosMode !== "undefined" && isChaosMode) {
      if (Math.random() < 0.75) {
        logText = chaosWebhooks[Math.floor(Math.random() * chaosWebhooks.length)];
      } else {
        logText = webhooks[Math.floor(Math.random() * webhooks.length)];
      }
    } else {
      logText = webhooks[Math.floor(Math.random() * webhooks.length)];
    }
    
    const line = document.createElement("div");
    line.className = "terminal-line";
    
    if (logText.includes("CRITICAL") || logText.includes("FAILURE") || logText.includes("ERROR") || logText.includes("TIMEOUT")) {
      line.style.color = "var(--danger)";
      line.style.fontWeight = "bold";
      line.style.textShadow = "0 0 4px rgba(239, 68, 68, 0.4)";
    } else if (logText.includes("completed") || logText.includes("succeeded") || logText.includes("OK")) {
      line.style.color = "var(--success)";
    } else if (logText.includes("adjusted") || logText.includes("synced")) {
      line.style.color = "var(--warning)";
    } else if (logText.includes("Incident") || logText.includes("ALERT") || logText.includes("DANGER") || logText.includes("WARN")) {
      line.style.color = "var(--danger)";
    }

    line.textContent = `[${timeStr}] ${logText}`;
    terminal.appendChild(line);
    
    while (terminal.childElementCount > 15) {
      terminal.removeChild(terminal.firstChild);
    }
    
    terminal.scrollTop = terminal.scrollHeight;
  }, 3000);
}
runTerminalLogs();

// 9. Incident Resolution Actions
function setupIncidentResolutions() {
  const resolveButtons = document.querySelectorAll(".resolve-btn");
  resolveButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".incident-log-item");
      playSound('click');
      item.style.opacity = 0;
      item.style.transform = "scale(0.95)";
      setTimeout(() => {
        item.remove();
        showToast("Insiden berhasil diselesaikan dan diarsipkan.");
        playSound('success');
      }, 300);
    });
  });
}
setupIncidentResolutions();

// 10. ESG carbon numeric counter animation
function animateEsgMetrics() {
  const co2Val = document.getElementById("co2Saved");
  const fuelVal = document.getElementById("fuelSaved");
  const treesVal = document.getElementById("treesPlanted");

  if (!co2Val || !fuelVal || !treesVal) return;

  const co2Target = 1420;
  const fuelTarget = 580;
  const treesTarget = 71;
  const duration = 1500;
  const startTime = performance.now();

  function step(timestamp) {
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = progress * (2 - progress);

    co2Val.textContent = `${Math.round(easeProgress * co2Target).toLocaleString("id-ID")} kg`;
    fuelVal.textContent = `${Math.round(easeProgress * fuelTarget).toLocaleString("id-ID")} Liter`;
    treesVal.textContent = `${Math.round(easeProgress * treesTarget)} Pohon`;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

// 11. Clock & Timestamp Sync
function updateClock() {
  const now = new Date();
  clock.textContent = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now).replace(":", ".");
}
updateClock();
setInterval(updateClock, 30000);

// CCTV Camera Widget dynamic timestamp
function updateCctvTime() {
  if (typeof isCctvPaused !== "undefined" && isCctvPaused) return;
  const cctvTimes = document.querySelectorAll(".cctv-time");
  const now = new Date();
  const dateFormatted = now.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).replace(/\//g, "-");
  const timeFormatted = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  cctvTimes.forEach(el => {
    el.textContent = `${dateFormatted} ${timeFormatted}`;
  });
}
updateCctvTime();
setInterval(updateCctvTime, 1000);

// Theme Configuration Handler
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("omnitraf-theme", theme);
  const icon = themeToggle ? themeToggle.querySelector(".theme-icon") : null;
  if (icon) icon.textContent = theme === "dark" ? "☀" : "☾";
  if (leafletTileLayer) {
    const darkUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    const lightUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    leafletTileLayer.setUrl(theme === 'dark' ? darkUrl : lightUrl);
  }
}

const savedTheme = localStorage.getItem("omnitraf-theme");
applyTheme(savedTheme || "light");

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  const targetTheme = current === "dark" ? "light" : "dark";
  applyTheme(targetTheme);
  playSound('click');
  if (typeof showStackedToast === "function") {
    showStackedToast("Tema Sistem Diperbarui", `Mengaktifkan visual ${targetTheme === "dark" ? "Mode Gelap (Cyberpunk)" : "Mode Terang (Glassmorphism)"}`, "info");
  } else {
    showToast(`Visual dialihkan ke ${targetTheme === "dark" ? "Mode Gelap" : "Mode Terang"}`);
  }
});

// Mobile Drawer Navigation Toggle
const menuToggle = document.getElementById("menuToggle");
const closeDrawer = document.getElementById("closeDrawer");
sidebar = document.getElementById("sidebar");
drawerBackdrop = document.getElementById("drawerBackdrop");

if (menuToggle && sidebar && drawerBackdrop) {
  menuToggle.addEventListener("click", () => {
    if (window.innerWidth <= 920) {
      sidebar.classList.add("open");
      drawerBackdrop.classList.add("show");
      playSound('click');
    } else {
      const appShell = document.querySelector(".app-shell");
      if (appShell) {
        appShell.classList.toggle("sidebar-collapsed");
        playSound('click');
        // Sync active vertical sliding accent indicator position
        const activeNav = document.querySelector(".nav-item.active");
        const accent = document.getElementById("sidebarAccent");
        if (activeNav && accent) {
          setTimeout(() => {
            const rect = activeNav.getBoundingClientRect();
            const sidebarRect = sidebar.getBoundingClientRect();
            accent.style.transform = `translateY(${rect.top - sidebarRect.top}px)`;
            accent.style.opacity = "1";
          }, 320); // wait for grid transition to complete
        }
      }
    }
  });
}

if (closeDrawer && sidebar && drawerBackdrop) {
  closeDrawer.addEventListener("click", () => {
    sidebar.classList.remove("open");
    drawerBackdrop.classList.remove("show");
    playSound('click');
  });
}

if (drawerBackdrop && sidebar) {
  drawerBackdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    drawerBackdrop.classList.remove("show");
    playSound('click');
  });
}

const mobTabMenu = document.getElementById("mobTabMenu");
if (mobTabMenu && sidebar && drawerBackdrop) {
  mobTabMenu.addEventListener("click", () => {
    sidebar.classList.add("open");
    drawerBackdrop.classList.add("show");
    playSound('click');
  });
}

// 12. Monitored Table Filter & Search Empty State Handlers
function applyTableFilter() {
  const activeFilter = document.querySelector(".filter-chip.active")?.dataset.filter || "all";
  const keyword = searchInput.value.trim().toLowerCase();
  let matchCount = 0;

  tableRows.forEach(row => {
    const density = row.dataset.density;
    const text = row.textContent.toLowerCase();
    const matchDensity = activeFilter === "all" || density === activeFilter;
    const matchSearch = !keyword || text.includes(keyword);
    const visible = matchDensity && matchSearch;

    row.classList.toggle("is-hidden", !visible);
    if (visible) matchCount++;
  });

  const emptyState = document.getElementById("emptyState");
  if (emptyState) {
    emptyState.classList.toggle("is-hidden", matchCount > 0);
  }

  if (mapBox) {
    mapBox.dataset.density = activeFilter;
  }
}

if (searchInput) {
  searchInput.addEventListener("input", applyTableFilter);
}

// 13. Stat Counter Increment Animations
function animateCounters() {
  const counters = document.querySelectorAll("[data-counter]");
  counters.forEach(counter => {
    const target = parseFloat(counter.dataset.counter);
    const duration = 1600;
    const startTime = performance.now();
    const isDecimal = counter.textContent.includes(".") && target < 100;
    const isPercentage = counter.textContent.includes("%");
    const isSpeed = counter.textContent.includes("km/jam");

    function updateCounter(timestamp) {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = progress * (2 - progress); // easeOutQuad
      
      let current = easeProgress * target;
      
      if (isDecimal) {
        counter.innerHTML = `${current.toFixed(1)}%`;
      } else if (isPercentage) {
        counter.textContent = `${Math.round(current)}%`;
      } else if (isSpeed) {
        counter.textContent = `${Math.round(current)} km/jam`;
      } else if (target > 1000) {
        counter.textContent = Math.round(current).toLocaleString("id-ID");
      } else {
        counter.textContent = Math.round(current);
      }

      if (progress < 1) {
        requestAnimationFrame(updateCounter);
      }
    }
    requestAnimationFrame(updateCounter);
  });
}

// 14. AI Recommendation score circle animation
function animateAiScore() {
  const circle = document.getElementById("aiScoreCircle");
  const valueText = document.getElementById("aiScoreVal");
  if (!circle || !valueText) return;

  const targetScore = 92;
  const circumference = 314; 
  
  let start = 0;
  const duration = 1800;
  const startTime = performance.now();

  function step(timestamp) {
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = progress * (2 - progress);
    
    const currentVal = Math.round(easeProgress * targetScore);
    valueText.textContent = currentVal;

    const offset = circumference - (easeProgress * targetScore / 100) * circumference;
    circle.style.strokeDashoffset = offset;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

// Trigger initial counter animations on load
const statGridElement = document.querySelector(".stat-grid");
if (statGridElement) {
  const observerStats = new IntersectionObserver((entries, observerInst) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounters();
        observerInst.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  observerStats.observe(statGridElement);
}

const aiWidget = document.querySelector(".radial-score-svg");
if (aiWidget) {
  const observerAi = new IntersectionObserver((entries, observerInst) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateAiScore();
        observerInst.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  observerAi.observe(aiWidget);
}

// 15. Live Latency Micro-chart updates
const latencyVal = document.getElementById("latencyVal");
const latencyPath = document.getElementById("latencyPath");
let latencyPoints = [25, 20, 22, 18, 24, 15];

function updateLatency() {
  let val;
  if (typeof isChaosMode !== "undefined" && isChaosMode) {
    val = Math.floor(920 + Math.random() * 79);
  } else {
    val = Math.floor(18 + Math.random() * 11);
  }

  if (latencyVal) {
    latencyVal.textContent = typeof isChaosMode !== "undefined" && isChaosMode ? `${val}+ ms` : `${val}ms`;
    if (typeof isChaosMode !== "undefined" && isChaosMode) {
      latencyVal.style.color = "var(--danger)";
    } else {
      latencyVal.style.color = "";
    }
  }

  latencyPoints.shift();
  const minVal = typeof isChaosMode !== "undefined" && isChaosMode ? 900 : 12;
  const maxVal = typeof isChaosMode !== "undefined" && isChaosMode ? 1000 : 30;
  const mappedY = Math.round(30 - ((val - minVal) / (maxVal - minVal)) * 24);
  latencyPoints.push(mappedY);

  let pathStr = `M0,${latencyPoints[0]}`;
  const step = 20; 
  for (let i = 1; i < latencyPoints.length; i++) {
    const prevX = (i - 1) * step;
    const prevY = latencyPoints[i - 1];
    const currX = i * step;
    const currY = latencyPoints[i];
    const midX = (prevX + currX) / 2;
    pathStr += ` Q${midX},${prevY} ${currX},${currY}`;
  }

  if (latencyPath) {
    latencyPath.setAttribute("d", pathStr);
    if (typeof isChaosMode !== "undefined" && isChaosMode) {
      latencyPath.style.stroke = "var(--danger)";
    } else {
      latencyPath.style.stroke = "";
    }
  }
}
setInterval(updateLatency, 3000);

// 16. Traffic Trends interactive chart tooltips
const trendChart = document.getElementById("trendChart");
const hoverLine = document.getElementById("chartHoverLine");
const p1 = document.getElementById("chartHoverPoint1");
const p2 = document.getElementById("chartHoverPoint2");
const p3 = document.getElementById("chartHoverPoint3");
const chartTooltip = document.getElementById("chartTooltip");

const path1 = document.getElementById("chartPathPrimary");
const path2 = document.getElementById("chartPathMuted");
const path3 = document.getElementById("chartPathCyan");

function getYForX(pathElement, targetX) {
  try {
    const pathLength = pathElement.getTotalLength();
    let start = 0;
    let end = pathLength;
    let point = pathElement.getPointAtLength(0);
    
    for (let i = 0; i < 9; i++) {
      const mid = (start + end) / 2;
      point = pathElement.getPointAtLength(mid);
      if (point.x < targetX) {
        start = mid;
      } else {
        end = mid;
      }
    }
    return point.y;
  } catch (e) {
    return 130;
  }
}

if (trendChart && hoverLine && path1 && path2 && path3) {
  trendChart.addEventListener("mousemove", (e) => {
    const rect = trendChart.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const svgX = (mouseX / rect.width) * 760;

    if (svgX >= 0 && svgX <= 760) {
      const y1 = getYForX(path1, svgX);
      const y2 = getYForX(path2, svgX);
      const y3 = getYForX(path3, svgX);

      hoverLine.setAttribute("x1", svgX);
      hoverLine.setAttribute("x2", svgX);
      hoverLine.style.opacity = 1;

      p1.setAttribute("cx", svgX);
      p1.setAttribute("cy", y1);
      p1.style.opacity = 1;

      p2.setAttribute("cx", svgX);
      p2.setAttribute("cy", y2);
      p2.style.opacity = 1;

      p3.setAttribute("cx", svgX);
      p3.setAttribute("cy", y3);
      p3.style.opacity = 1;

      const totalMinutes = Math.round((svgX / 760) * 24 * 60);
      const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const mins = String(Math.floor((totalMinutes % 60) / 10) * 10).padStart(2, '0');

      const val1 = Math.round((260 - y1) * 620);
      const val2 = Math.round((260 - y2) * 510);
      const val3 = Math.round((260 - y3) * 580);

      document.getElementById("tooltipTime").textContent = `${hours}:${mins}`;
      document.getElementById("tooltipVal1").textContent = `Arus Utama: ${(val1/1000).toFixed(1)}k`;
      document.getElementById("tooltipVal2").textContent = `Rata-rata: ${(val2/1000).toFixed(1)}k`;
      document.getElementById("tooltipVal3").textContent = `Lancar: ${(val3/1000).toFixed(1)}k`;

      let tooltipX = mouseX + 15;
      let tooltipY = mouseY - 90;
      if (tooltipX + 160 > rect.width) {
        tooltipX = mouseX - 170;
      }
      if (tooltipY < 0) {
        tooltipY = 15;
      }

      chartTooltip.style.left = `${tooltipX}px`;
      chartTooltip.style.top = `${tooltipY}px`;
      chartTooltip.classList.add("show");

      if (Math.round(svgX) % 35 === 0) {
        playSound('hover');
      }
    }
  });

  trendChart.addEventListener("mouseleave", () => {
    hoverLine.style.opacity = 0;
    p1.style.opacity = 0;
    p2.style.opacity = 0;
    p3.style.opacity = 0;
    chartTooltip.classList.remove("show");
  });
}

// 17. Phase control slider range adjustments
if (greenRange && greenValue) {
  const tooltipSlider = document.getElementById("sliderTooltip");
  greenRange.addEventListener("input", () => {
    const val = greenRange.value;
    activeCycles[0] = parseInt(val); // Sync to running countdown!
    greenValue.textContent = `${val} dtk`;
    if (tooltipSlider) {
      tooltipSlider.textContent = `${val}s`;
      const min = parseFloat(greenRange.min);
      const max = parseFloat(greenRange.max);
      const percent = ((val - min) / (max - min)) * 100;
      tooltipSlider.style.left = `calc(${percent}% + (${8 - percent * 0.16}px))`;
    }
    playSound('hover');
  });
}

// 18. Simulated PDF Report Generation modal loading
const reportModal = document.getElementById("reportModal");
const closeModal = document.getElementById("closeModal");
const modalLoaderCircle = document.getElementById("modalLoaderCircle");
const loaderPercentage = document.getElementById("loaderPercentage");
const loaderStatus = document.getElementById("loaderStatus");
const modalFooter = document.getElementById("modalFooter");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");

const statusMessages = [
  "Mengompilasi telemetri persimpangan SITS...",
  "Mengklasifikasi kluster tingkat kemacetan...",
  "Memproses kalkulasi model prediktif AI...",
  "Menyusun visualisasi spasial arus lalu lintas...",
  "Mengonversi dokumen arsip mobilitas PDF..."
];

function generateReportSimulated() {
  if (!reportModal) return;
  playSound('click');
  reportModal.classList.add("show");
  modalFooter.classList.add("is-hidden");
  
  let progress = 0;
  const circumference = 264; 
  modalLoaderCircle.style.strokeDashoffset = circumference;
  
  const interval = setInterval(() => {
    progress += Math.floor(Math.random() * 9) + 2;
    if (progress >= 100) {
      progress = 100;
      clearInterval(interval);
      modalLoaderCircle.style.strokeDashoffset = 0;
      loaderPercentage.textContent = "100%";
      loaderStatus.textContent = "Laporan ringkasan mobilitas selesai dibuat.";
      modalFooter.classList.remove("is-hidden");
      playSound('success');
    } else {
      loaderPercentage.textContent = `${progress}%`;
      modalLoaderCircle.style.strokeDashoffset = circumference - (progress / 100) * circumference;
      const statusIdx = Math.min(Math.floor(progress / 20), statusMessages.length - 1);
      loaderStatus.textContent = statusMessages[statusIdx];
    }
  }, 120);
}

if (closeModal && reportModal) {
  closeModal.addEventListener("click", () => {
    reportModal.classList.remove("show");
    playSound('click');
  });
}

if (downloadPdfBtn && reportModal) {
  downloadPdfBtn.addEventListener("click", () => {
    reportModal.classList.remove("show");
    playSound('success');
    showToast("Dokumen laporan PDF berhasil diunduh ke direktori penyimpanan lokal.");
    if (typeof addExportHistory === "function") {
      addExportHistory("sits_mobility_snapshot_surabaya.pdf", "pdf");
    }
  });
}

// 19. Actions Trigger Router
function randomizeLoad() {
  const value = Math.floor(64 + Math.random() * 22);
  if (networkLoad) {
    networkLoad.textContent = `${value}%`;
  }
}

document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    playSound('click');
    if (action === "refresh") {
      randomizeLoad();
      showToast(messages[action]);
    } else if (action === "download-report") {
      generateReportSimulated();
    } else if (action === "apply-ai") {
      if (typeof isChaosMode !== "undefined" && isChaosMode) {
        startProgressiveResolution();
      } else {
        showToast(messages[action] || "Aksi dijalankan.");
      }
    } else {
      showToast(messages[action] || "Aksi dijalankan.");
    }
  });
});

// 20. Toast alerts Polish
function showToast(message) {
  if (!toast) return;
  const msgEl = toast.querySelector(".toast-message");
  if (msgEl) {
    msgEl.textContent = message;
  } else {
    toast.textContent = message;
  }
  
  toast.classList.remove("show");
  void toast.offsetWidth; 
  
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

// 21. Cards entry 3D roll animations
const revealCards = document.querySelectorAll(".reveal-card");
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
    }
  });
}, { threshold: .08 });

revealCards.forEach(card => observer.observe(card));

// 22. Vercel-style Mask Spotlight Mouse Tracker
document.querySelectorAll(".glass-panel").forEach(card => {
  card.style.setProperty("--mouse-x", "0px");
  card.style.setProperty("--mouse-y", "0px");
  card.addEventListener("mousemove", e => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty("--mouse-x", `${x}px`);
    card.style.setProperty("--mouse-y", `${y}px`);
  });
});

// 23. Interactive Layer Toggles & PIP Hover CCTV Mockup
const pipCard = document.getElementById("pipCameraCard");
const pipCanvas = document.getElementById("pipCanvas");
const pipNodeName = document.getElementById("pipNodeName");
const pipStatus = document.getElementById("pipStatus");
const pipVolume = document.getElementById("pipVolume");

let pipCtx = null;
let pipAnimationId = null;

function initPipCanvas() {
  if (pipCanvas) {
    pipCtx = pipCanvas.getContext("2d");
  }
}

function startPipAnimation(nodeName, densityClass) {
  if (!pipCtx) return;
  cancelAnimationFrame(pipAnimationId);
  
  let frame = 0;
  let statusText = "Online";
  let volumeVal = "Low";
  
  if (densityClass === "danger") {
    statusText = "Dense Alert";
    volumeVal = "High";
    if (pipStatus) {
      pipStatus.className = "metric-down";
    }
  } else if (densityClass === "warning") {
    statusText = "Slight Delay";
    volumeVal = "Moderate";
    if (pipStatus) {
      pipStatus.className = "metric-warn";
    }
  } else {
    statusText = "Online (Lancar)";
    volumeVal = "Low";
    if (pipStatus) {
      pipStatus.className = "green-text";
    }
  }
  
  if (pipNodeName) pipNodeName.textContent = nodeName;
  if (pipStatus) pipStatus.textContent = statusText;
  if (pipVolume) pipVolume.textContent = volumeVal;
  
  function draw() {
    pipCtx.fillStyle = "#02070e";
    pipCtx.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
    
    // Draw guide lines
    pipCtx.strokeStyle = "rgba(0, 229, 255, 0.15)";
    pipCtx.lineWidth = 0.5;
    pipCtx.strokeRect(10, 10, pipCanvas.width - 20, pipCanvas.height - 20);
    
    // Crosshair
    pipCtx.beginPath();
    pipCtx.moveTo(pipCanvas.width / 2 - 12, pipCanvas.height / 2);
    pipCtx.lineTo(pipCanvas.width / 2 + 12, pipCanvas.height / 2);
    pipCtx.moveTo(pipCanvas.width / 2, pipCanvas.height / 2 - 12);
    pipCtx.lineTo(pipCanvas.width / 2, pipCanvas.height / 2 + 12);
    pipCtx.stroke();
    
    // Moving dots/vehicles on simulated lanes
    pipCtx.fillStyle = densityClass === "danger" ? "var(--danger)" : densityClass === "warning" ? "var(--warning)" : "var(--success)";
    const t1 = (frame * 1.2) % pipCanvas.width;
    pipCtx.beginPath();
    pipCtx.arc(t1, 35, 3.5, 0, Math.PI * 2);
    pipCtx.arc((t1 + 70) % pipCanvas.width, 35, 3.5, 0, Math.PI * 2);
    if (densityClass === "danger") {
      pipCtx.arc((t1 + 35) % pipCanvas.width, 35, 3.5, 0, Math.PI * 2);
    }
    pipCtx.fill();
    
    pipCtx.fillStyle = "rgba(0, 229, 255, 0.8)";
    const t2 = pipCanvas.width - ((frame * 1.8) % pipCanvas.width);
    pipCtx.beginPath();
    pipCtx.arc(t2, 75, 2.5, 0, Math.PI * 2);
    pipCtx.arc((t2 + 90) % pipCanvas.width, 75, 2.5, 0, Math.PI * 2);
    pipCtx.fill();
    
    // Overlay text info
    pipCtx.fillStyle = "rgba(0, 255, 102, 0.75)";
    pipCtx.font = "8px 'Share Tech Mono', monospace";
    pipCtx.fillText(`ISO 400 | F2.0`, 16, 22);
    pipCtx.fillText(`INF: 30 FPS`, 16, 92);
    
    frame++;
    pipAnimationId = requestAnimationFrame(draw);
  }
  draw();
}

function stopPipAnimation() {
  cancelAnimationFrame(pipAnimationId);
}

function setupLayerToggles() {
  document.querySelectorAll(".layer-toggle-checkbox").forEach(chk => {
    chk.addEventListener("change", () => {
      const layerName = chk.dataset.layer;
      const checked = chk.checked;
      playSound('switch');
      
      document.querySelectorAll("svg").forEach(svg => {
        const layerElement = svg.querySelector(`.${layerName}`);
        if (layerElement) {
          layerElement.classList.toggle("layer-hidden", !checked);
        }
      });

      // Real-Time Leaflet Layer Group Toggle
      if (surabayaMap && mapLayerGroups && mapLayerGroups[layerName]) {
        if (checked) {
          if (!surabayaMap.hasLayer(mapLayerGroups[layerName])) {
            surabayaMap.addLayer(mapLayerGroups[layerName]);
          }
        } else {
          if (surabayaMap.hasLayer(mapLayerGroups[layerName])) {
            surabayaMap.removeLayer(mapLayerGroups[layerName]);
          }
        }
      }
      
      // Sync across all layer checkboxes of the same type
      document.querySelectorAll(`.layer-toggle-checkbox[data-layer="${layerName}"]`).forEach(otherChk => {
        otherChk.checked = checked;
      });
      
      showToast(`Lapisan ${chk.nextElementSibling.textContent} ${checked ? "ditampilkan" : "disembunyikan"}.`);
    });
  });
}

function setupPipHoverHandlers() {
  initPipCanvas();
  
  document.addEventListener("mouseover", (e) => {
    const node = e.target.closest(".signal-node");
    if (!node) return;
    
    let nodeName = "Persimpangan SITS";
    let densityClass = "success";
    
    if (node.classList.contains("node-danger")) {
      densityClass = "danger";
    } else if (node.classList.contains("node-warning")) {
      densityClass = "warning";
    }
    
    const cx = parseFloat(node.getAttribute("cx"));
    const cy = parseFloat(node.getAttribute("cy"));
    
    if (cx === 452 && cy === 338) nodeName = "Simpang Wonokromo";
    else if (cx === 468 && cy === 154) nodeName = "Simpang Tunjungan";
    else if (cx === 534 && cy === 172) nodeName = "Simpang Kertajaya";
    else if (cx === 436 && cy === 208) nodeName = "Simpang Darmo";
    else if (cx === 464 && cy === 438) nodeName = "Simpang Jemursari";
    else if (cx === 220 && cy === 268) nodeName = "Simpang Sungkono";
    else if (cx === 766 && cy === 182) nodeName = "Simpang MERR Kertajaya";
    
    playSound('hover');
    startPipAnimation(nodeName, densityClass);
    if (pipCard) {
      pipCard.classList.add("show");
    }
  });
  
  document.addEventListener("mousemove", (e) => {
    if (pipCard && pipCard.classList.contains("show")) {
      pipCard.style.left = `${e.clientX}px`;
      pipCard.style.top = `${e.clientY}px`;
    }
  });
  
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest(".signal-node")) {
      stopPipAnimation();
      if (pipCard) {
        pipCard.classList.remove("show");
      }
    }
  });
}

setupLayerToggles();
setupPipHoverHandlers();

// 24. Emergency Priority Preemption Actuator Simulator
const emergencyForm = document.getElementById("emergencyActuatorForm");
const emergencyListGrid = document.getElementById("emergencyListGrid");
const activePriorityCount = document.getElementById("activePriorityCount");

let activePreemptions = [];

function updatePriorityBadgeCount() {
  const activeCards = activePreemptions.length;
  if (activePriorityCount) {
    activePriorityCount.textContent = `${activeCards} Active priority`;
    activePriorityCount.className = activeCards > 0 ? "pill pill-danger" : "pill pill-live";
  }
  const label = activeCards > 0 ? "Status prioritas aktif" : "Tidak ada prioritas aktif";
  const mClass = activeCards > 0 ? "metric-down" : "metric-up";
  updateKpiVal("Kendaraan Darurat Aktif", activeCards, label, mClass);
}

function runPreemptionTimerTicker() {
  setInterval(() => {
    activePreemptions.forEach((preempt) => {
      preempt.secondsLeft--;
      
      const card = document.getElementById(preempt.cardId);
      if (card) {
        const etaStrong = card.querySelector(".em-meta-row div:first-child strong");
        const min = Math.floor(preempt.secondsLeft / 60);
        const sec = preempt.secondsLeft % 60;
        const etaText = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
        
        if (etaStrong) {
          etaStrong.textContent = etaText;
        }
      }
      
      // Override active cycles in signal overrides tab
      if (preempt.route === "route-yani-darmo") {
        activeCycles[0] = Math.max(15, activeCycles[0]);
        const cycleVal1 = document.getElementById("cycleVal1");
        if (cycleVal1) cycleVal1.textContent = "PREEMPT";
      } else if (preempt.route === "route-tunjungan") {
        activeCycles[1] = Math.max(15, activeCycles[1]);
        const cycleVal2 = document.getElementById("cycleVal2");
        if (cycleVal2) cycleVal2.textContent = "PREEMPT";
      }
      
      if (preempt.secondsLeft <= 0) {
        resolvePreemption(preempt.id);
      }
    });
    
    // Update preemption circular countdown progress ring & emergency route path (Fitur 7 & 16)
    const ringContainer = document.getElementById("preemptCountdownContainer");
    const ringProgress = document.getElementById("preemptProgressCircle");
    const ringText = document.getElementById("preemptCountdownText");
    const emergencyRoutePath = document.getElementById("emergencyRoutePath");
    
    if (activePreemptions.length > 0) {
      const activePre = activePreemptions[0];
      if (ringContainer) ringContainer.classList.remove("is-hidden");
      if (ringText) ringText.textContent = `${activePre.secondsLeft}s`;
      if (ringProgress) {
        const total = activePre.totalDuration || 30;
        const pct = Math.max(0, Math.min(100, (activePre.secondsLeft / total) * 100));
        ringProgress.setAttribute("stroke-dasharray", `${pct}, 100`);
      }
      if (activePre.route === "route-yani-darmo" && emergencyRoutePath) {
        emergencyRoutePath.classList.remove("is-hidden");
      }
    } else {
      if (ringContainer) ringContainer.classList.add("is-hidden");
      if (emergencyRoutePath) emergencyRoutePath.classList.add("is-hidden");
    }
    
    if (typeof updateEmergencyGpsDots === "function") {
      updateEmergencyGpsDots();
    }
  }, 1000);
}

function resolvePreemption(id) {
  const index = activePreemptions.findIndex(p => p.id === id);
  if (index === -1) return;
  
  const preempt = activePreemptions[index];
  
  // Normalize map roads
  document.querySelectorAll("svg").forEach(svg => {
    preempt.roads.forEach(roadSelector => {
      const roadPath = svg.querySelector(roadSelector);
      if (roadPath) {
        roadPath.classList.remove("preemption-active");
      }
    });
  });
  
  // Normalize signal tab displays
  if (preempt.route === "route-yani-darmo") {
    const cycleVal1 = document.getElementById("cycleVal1");
    if (cycleVal1) cycleVal1.textContent = activeCycles[0];
  } else if (preempt.route === "route-tunjungan") {
    const cycleVal2 = document.getElementById("cycleVal2");
    if (cycleVal2) cycleVal2.textContent = activeCycles[1];
  }
  
  // Animate card removal
  const card = document.getElementById(preempt.cardId);
  if (card) {
    card.style.opacity = 0;
    card.style.transform = "scale(0.95)";
    setTimeout(() => {
      card.remove();
      updatePriorityBadgeCount();
    }, 300);
  }
  
  showToast(`Armada ${preempt.name} telah tiba di tujuan. Jalur kembali normal.`);
  playSound('success');
  
  activePreemptions.splice(index, 1);
}

if (emergencyForm && emergencyListGrid) {
  emergencyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    
    const type = document.getElementById("respType").value;
    const routeValue = document.getElementById("respRoute").value;
    const name = document.getElementById("respName").value;
    
    if (!name.trim()) return;
    
    playSound('success');
    
    let routeDesc = "Wonokromo → RSU Dr. Soetomo";
    let speed = "78 km/jam";
    let secondsLeft = 30; // 30 seconds countdown for elegant simulation speed
    let roads = [];
    
    if (routeValue === "route-yani-darmo") {
      routeDesc = "Jl. Ahmad Yani → Jl. Raya Darmo (RSU Dr. Soetomo)";
      speed = "82 km/jam";
      secondsLeft = 35;
      roads = ["#dashRoad1", "#dashRoad2"];
    } else if (routeValue === "route-kertajaya") {
      routeDesc = "Jl. Kertajaya → Dharmawangsa (RS Airlangga)";
      speed = "74 km/jam";
      secondsLeft = 25;
      roads = ["#dashRoad4"];
    } else if (routeValue === "route-tunjungan") {
      routeDesc = "Jl. Tunjungan → Basuki Rahmat (Pusat Kota)";
      speed = "68 km/jam";
      secondsLeft = 20;
      roads = ["#dashRoad3"];
    }
    
    const id = Date.now();
    const cardId = `preempt-card-${id}`;
    
    // Highlight road paths
    document.querySelectorAll("svg").forEach(svg => {
      roads.forEach(roadSelector => {
        const roadPath = svg.querySelector(roadSelector);
        if (roadPath) {
          roadPath.classList.add("preemption-active");
        }
      });
    });
    
    // Create new card
    const card = document.createElement("div");
    card.className = "emergency-card-item pulse-red-border";
    card.id = cardId;
    card.style.opacity = 0;
    card.style.transform = "scale(0.95)";
    card.style.transition = "opacity 0.3s, transform 0.3s";
    card.setAttribute("data-route", routeValue);
    
    const badgeClass = type === "Ambulans" ? "red" : type === "Pemadam" ? "orange" : "blue";
    const badgePrefix = type === "Ambulans" ? "✚" : type === "Pemadam" ? "🚒" : "🚔";
    
    card.innerHTML = `
      <div class="em-header">
        <span class="badge-em ${badgeClass}">${badgePrefix} ${name}</span>
        <strong class="em-status" style="color: var(--danger)">PREEMPTION GRANTED</strong>
      </div>
      <p>Rute: ${routeDesc}</p>
      <div class="em-meta-row">
        <div><small>ETA</small><strong>${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s</strong></div>
        <div><small>Kecepatan</small><strong>${speed}</strong></div>
        <div><small>Signal Overrides</small><strong class="green-text">Active (Preemption Aktif)</strong></div>
      </div>
    `;
    
    emergencyListGrid.insertBefore(card, emergencyListGrid.firstChild);
    
    setTimeout(() => {
      card.style.opacity = 1;
      card.style.transform = "scale(1)";
    }, 50);
    
    activePreemptions.push({
      id: id,
      cardId: cardId,
      name: name,
      route: routeValue,
      roads: roads,
      secondsLeft: secondsLeft,
      totalDuration: secondsLeft
    });
    
    updatePriorityBadgeCount();
    showToast(`Sinyal preemption diaktifkan untuk ${name}. Hijau prioritas terakselerasi.`);
  });
}

// Register static initial responders
function initStaticResponders() {
  // Static Responder 1: Ambulans 02
  const card1 = document.getElementById("staticPreemptCard1");
  if (card1) {
    activePreemptions.push({
      id: 101,
      cardId: "staticPreemptCard1",
      name: "Ambulans 02",
      route: "route-yani-darmo",
      roads: ["#dashRoad1", "#dashRoad2"],
      secondsLeft: 105,
      totalDuration: 105
    });
    
    // Highlight their roads initially
    document.querySelectorAll("svg").forEach(svg => {
      ["#dashRoad1", "#dashRoad2"].forEach(r => {
        const road = svg.querySelector(r);
        if (road) road.classList.add("preemption-active");
      });
    });
  }
  
  // Static Responder 2: Pemadam 04
  const card2 = document.getElementById("staticPreemptCard2");
  if (card2) {
    activePreemptions.push({
      id: 102,
      cardId: "staticPreemptCard2",
      name: "Pemadam 04",
      route: "route-yani-darmo",
      roads: ["#dashRoad1"],
      secondsLeft: 192,
      totalDuration: 192
    });
  }
  
  updatePriorityBadgeCount();
}

initStaticResponders();
runPreemptionTimerTicker();

// 25. REST API Explorer Playground Sandbox Handler
const btnSendApiRequest = document.getElementById("btnSendApiRequest");
const apiEndpoint = document.getElementById("apiEndpoint");
const apiStatusBadge = document.getElementById("apiStatusBadge");
const apiResponseContent = document.getElementById("apiResponseContent");

function colorizeJson(json) {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  }
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
    let cls = 'number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'key';
      } else {
        cls = 'string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'boolean';
    } else if (/null/.test(match)) {
      cls = 'null';
    }
    return '<span class="json-' + cls + '">' + match + '</span>';
  });
}

if (btnSendApiRequest && apiEndpoint && apiResponseContent && apiStatusBadge) {
  btnSendApiRequest.addEventListener("click", () => {
    const endpoint = apiEndpoint.value;
    playSound('click');
    
    apiStatusBadge.textContent = "STATUS: PENDING...";
    apiStatusBadge.style.color = "var(--warning)";
    apiResponseContent.textContent = "// Mengirimkan permintaan HTTP GET ke SITS gateway...";
    
    setTimeout(() => {
      let data = {};
      let isError = false;
      
      if (typeof isChaosMode !== "undefined" && isChaosMode) {
        isError = true;
        data = {
          status: "error",
          code: 504,
          error: "Gateway Timeout",
          message: "NODE-CTRL-01 (Siemens ATCS Controller Wonokromo) heartbeat failed. Network timeout. Connection lost.",
          timestamp: new Date().toISOString()
        };
      } else {
        if (endpoint === "/sits/api/v1/telemetry") {
          data = {
            timestamp: new Date().toISOString(),
            source: "SITS Surabaya API Gateway",
            total_intersections: 126,
            network_load: document.getElementById("networkLoad")?.textContent || "72%",
            latency_ms: parseInt(document.getElementById("latencyVal")?.textContent) || 24,
            intersections: [
              {
                id: "DEV-CTRL-01",
                name: "Simpang Wonokromo (A. Yani)",
                status: "online",
                density: "high",
                active_green_phase_seconds: activeCycles[0] || 38,
                average_wait_seconds: 54
              },
              {
                id: "DEV-CTRL-02",
                name: "Simpang Tunjungan (Siola)",
                status: "online",
                density: "moderate",
                active_green_phase_seconds: activeCycles[1] || 28,
                average_wait_seconds: 31
              },
              {
                id: "DEV-CTRL-03",
                name: "Simpang Darmo (Polisi Istimewa)",
                status: "online",
                density: "moderate",
                active_green_phase_seconds: 38,
                average_wait_seconds: 38
              },
              {
                id: "DEV-CTRL-04",
                name: "Simpang Kertajaya (Dharmawangsa)",
                status: "online",
                density: "low",
                active_green_phase_seconds: 22,
                average_wait_seconds: 22
              }
            ]
          };
        } else if (endpoint === "/sits/api/v1/incidents") {
          data = {
            timestamp: new Date().toISOString(),
            source: "SITS Incident Detection AI",
            alerts_count: 2,
            incidents: [
              {
                type: "ACCIDENT-02",
                location: "Jl. Raya Darmo - Basuki Rahmat",
                severity: "high",
                description: "Tabrakan Ringan di Simpang Darmo - Basra",
                time_ago: "5 menit lalu",
                resolved: false
              },
              {
                type: "ROADBLOCK-01",
                location: "Jl. Raya Darmo (Depan Al-Falah)",
                severity: "moderate",
                description: "Galian Utilitas Kabel di Jl. Raya Darmo",
                time_ago: "15 menit lalu",
                resolved: false
              }
            ]
          };
        } else if (endpoint === "/sits/api/v1/preemption") {
          data = {
            timestamp: new Date().toISOString(),
            source: "Emergency Responder GPS Actuator",
            active_priority_count: activePreemptions.length,
            preemptions: activePreemptions.map(p => ({
              id: p.id,
              name: p.name,
              route: p.route,
              seconds_remaining: p.secondsLeft,
              speed: p.speed,
              preemption_status: "granted"
            }))
          };
        }
      }
      
      if (isError) {
        apiStatusBadge.textContent = "STATUS: 504 GATEWAY TIMEOUT";
        apiStatusBadge.style.color = "var(--danger)";
        apiResponseContent.innerHTML = colorizeJson(data);
        playSound('warning');
      } else {
        apiStatusBadge.textContent = "STATUS: 200 OK";
        apiStatusBadge.style.color = "var(--success)";
        apiResponseContent.innerHTML = colorizeJson(data);
        playSound('success');
      }
    }, 450);
  });
}

// ==================== LIVE SECOND-BY-SECOND TELEMETRY STREAM ====================
let vehiclesTodayVal = 128540;
let co2SavedVal = 1420;
let fuelSavedVal = 580;
let treesPlantedVal = 71;
let esgCo2Target = 2000;

function updateTelemetryTick() {
  // 1. SITS Signal Heartbeat (sitsStatusText)
  const sitsStatus = document.getElementById("sitsStatusText");
  const sitsSignalChip = document.querySelector(".sits-signal-chip");
  
  // 2. System Health metrics
  const uptimeVal = document.getElementById("sitsUptimeVal");
  const cctvCount = document.getElementById("sitsCctvCount");
  const iotCount = document.getElementById("sitsIotCount");
  
  // 3. AI Score Widget & AI Confidence
  const aiScoreCircle = document.getElementById("aiScoreCircle");
  const aiScoreVal = document.getElementById("aiScoreVal");
  const aiConfidenceVal = document.getElementById("aiConfidenceVal");
  const aiConfidenceBar = document.getElementById("aiConfidenceBar");
  const recList = document.getElementById("aiRecommendationList");

  if (typeof isChaosMode !== "undefined" && isChaosMode) {
    // Under Chaos Mode
    const waitVal = Math.floor(115 + Math.random() * 6); // 115 - 120s
    updateKpiVal("Rata-rata Waktu Tunggu", waitVal, `+${waitVal - 42} dtk (Kritis)`, "metric-down");
    
    const jamVal = Math.floor(96 + Math.random() * 3); // 96 - 98
    updateKpiVal("Indeks Kemacetan", jamVal, "Kritis! Gridlock Total", "metric-down");

    // SITS Uptime decreases
    if (uptimeVal) {
      const val = (42.0 + Math.random() * 0.9).toFixed(1);
      uptimeVal.textContent = `${val}%`;
    }
    // CCTV drops
    if (cctvCount) {
      cctvCount.textContent = Math.floor(62 + Math.random() * 13);
    }
    // IoT drops
    if (iotCount) {
      iotCount.textContent = Math.floor(128 + Math.random() * 15);
    }

    // SITS Signal Status in topbar drops
    if (sitsStatus) {
      const sig = Math.floor(15 + Math.random() * 18); // 15-32%
      sitsStatus.textContent = `${sig}%`;
      if (sitsSignalChip) sitsSignalChip.style.color = "var(--danger)";
    }

    // AI score and confidence drop
    const score = Math.floor(20 + Math.random() * 15); // 20-34%
    const circumference = 314;
    const offset = circumference - (score / 100) * circumference;
    if (aiScoreCircle) aiScoreCircle.style.strokeDashoffset = offset;
    if (aiScoreVal) aiScoreVal.textContent = score;

    if (aiConfidenceVal) aiConfidenceVal.textContent = `${score}%`;
    if (aiConfidenceBar) {
      aiConfidenceBar.style.setProperty("--value", `${score}%`);
    }

    // Recommendations in Chaos Mode
    if (recList) {
      const chaosRecs = [
        `<strong style="color: var(--danger)">🚨 KRITIS: Rekayasa Lalu Lintas Wonokromo Aktif!</strong>`,
        `<strong style="color: var(--danger)">⚠️ PERINGATAN: Alihkan arus Jl. Ahmad Yani!</strong>`,
        `<strong style="color: var(--warning)">Sinyal Terputus: Gunakan mode backup lokal</strong>`,
        `Prioritas Darurat: RSU Dr. Soetomo Aktif`
      ];
      recList.innerHTML = chaosRecs.map(r => `<li>${r}</li>`).join("");
    }

    // Vehicles count increments very slowly during gridlock
    vehiclesTodayVal += Math.floor(Math.random() * 2); // 0 to 1
    updateKpiVal("Kendaraan Hari Ini", vehiclesTodayVal.toLocaleString("id-ID"), `+${((vehiclesTodayVal - 128540)/128540 * 100 + 14.8).toFixed(1)}% volume`, "metric-up");
  } else {
    // Normal Mode
    // Fluctuating Congestion Index between 65 and 70
    const jamVal = Math.floor(65 + Math.random() * 6); // 65 - 70
    let currentJamVal = jamVal;
    if (typeof chaosLevel !== "undefined" && chaosLevel > 0) {
      currentJamVal = chaosLevel === 3 ? Math.floor(80 + Math.random() * 4) :
                     chaosLevel === 2 ? Math.floor(62 + Math.random() * 4) :
                     Math.floor(46 + Math.random() * 4);
    }
    const subText = currentJamVal > 80 ? "Mulai Terurai" : currentJamVal > 60 ? "Kepadatan Berkurang" : "Peningkatan Kepadatan";
    const subClass = currentJamVal > 80 ? "metric-warn" : currentJamVal > 60 ? "metric-warn" : "metric-warn";
    updateKpiVal("Indeks Kemacetan", currentJamVal, subText, subClass);

    // Fluctuating wait time between 39 and 43
    const waitVal = Math.floor(39 + Math.random() * 5); // 39 - 43
    let currentWaitVal = waitVal;
    if (typeof chaosLevel !== "undefined" && chaosLevel > 0) {
      currentWaitVal = chaosLevel === 3 ? Math.floor(100 + Math.random() * 5) :
                      chaosLevel === 2 ? Math.floor(72 + Math.random() * 4) :
                      Math.floor(46 + Math.random() * 4);
    }
    const waitSubText = currentWaitVal > 90 ? `+${currentWaitVal - 42} dtk (Padat)` : `-${48 - currentWaitVal} detik`;
    const waitSubClass = currentWaitVal > 90 ? "metric-down" : "metric-up";
    updateKpiVal("Rata-rata Waktu Tunggu", currentWaitVal, waitSubText, waitSubClass);

    // Incrementing vehicles count
    vehiclesTodayVal += Math.floor(Math.random() * 12) + 4; // 4 to 15 vehicles per second!
    updateKpiVal("Kendaraan Hari Ini", vehiclesTodayVal.toLocaleString("id-ID"), `+${((vehiclesTodayVal - 128540)/128540 * 100 + 14.8).toFixed(1)}% volume`, "metric-up");

    // ESG Reduksi Emisi CO₂
    const co2Red = (17.5 + Math.random() * 1.5).toFixed(1);
    updateKpiVal("Reduksi Emisi CO₂", co2Red, "Dampak ESG positif", "metric-up");

    // Efisiensi Sinyal APILL
    const efficiency = Math.floor(90 + Math.random() * 4); // 90 - 93%
    updateKpiVal("Efisiensi Sinyal APILL", efficiency, "Optimalisasi AI", "metric-up");

    // SITS Signal Status in topbar updates
    if (sitsStatus) {
      const sig = Math.floor(96 + Math.random() * 4); // 96-99%
      sitsStatus.textContent = `${sig}%`;
      if (sitsSignalChip) sitsSignalChip.style.color = "";
    }

    // System Health metrics updates
    if (uptimeVal) {
      const val = (99.68 + Math.random() * 0.06).toFixed(2);
      uptimeVal.textContent = `${val}%`;
    }
    if (cctvCount) {
      cctvCount.textContent = Math.floor(182 + Math.random() * 3);
    }
    if (iotCount) {
      iotCount.textContent = Math.floor(309 + Math.random() * 4);
    }

    // AI score and confidence fluctuate
    const score = Math.floor(90 + Math.random() * 5); // 90-94%
    const circumference = 314;
    const offset = circumference - (score / 100) * circumference;
    if (aiScoreCircle) aiScoreCircle.style.strokeDashoffset = offset;
    if (aiScoreVal) aiScoreVal.textContent = score;

    if (aiConfidenceVal) aiConfidenceVal.textContent = `${score}%`;
    if (aiConfidenceBar) {
      aiConfidenceBar.style.setProperty("--value", `${score}%`);
    }

    // AI Recommendations updates
    if (recList) {
      const normRecs = [
        `Tambah hijau Wonokromo +${Math.floor(10 + Math.random() * 6)} detik`,
        `Turunkan cycle Darmo menjadi ${Math.floor(75 + Math.random() * 11)} detik`,
        `Aktifkan prioritas pedestrian Tunjungan`,
        `Reduksi delay frontage A. Yani`
      ];
      recList.innerHTML = normRecs.map(r => `<li>${r}</li>`).join("");
    }

    // Network load in map overview
    if (networkLoad) {
      const load = Math.floor(70 + Math.random() * 6); // 70 - 75%
      networkLoad.textContent = `${load}%`;
    }

    // ESG detail card ticks up!
    co2SavedVal += (0.15 + Math.random() * 0.25);
    fuelSavedVal += (0.08 + Math.random() * 0.12);
    treesPlantedVal = Math.round(co2SavedVal / 20);

    const co2SavedEl = document.getElementById("co2Saved");
    const fuelSavedEl = document.getElementById("fuelSaved");
    const treesPlantedEl = document.getElementById("treesPlanted");
    if (co2SavedEl) co2SavedEl.textContent = `${Math.round(co2SavedVal).toLocaleString("id-ID")} kg`;
    if (fuelSavedEl) fuelSavedEl.textContent = `${Math.round(fuelSavedVal).toLocaleString("id-ID")} Liter`;
    if (treesPlantedEl) treesPlantedEl.textContent = `${treesPlantedVal} Pohon`;
    
    if (typeof updateEsgProgress === "function") {
      updateEsgProgress();
    }
  }

  // 4. Sync dashboard "Green A. Yani (Utara)" and Slider countdown
  const gVal = document.getElementById("greenValue");
  const gRange = document.getElementById("greenRange");
  const tooltipSlider = document.getElementById("sliderTooltip");
  if (gVal) gVal.textContent = `${activeCycles[0]} dtk`;
  if (gRange) {
    gRange.value = activeCycles[0];
    if (tooltipSlider) {
      tooltipSlider.textContent = `${activeCycles[0]}s`;
      const min = parseFloat(gRange.min);
      const max = parseFloat(gRange.max);
      const percent = ((activeCycles[0] - min) / (max - min)) * 100;
      tooltipSlider.style.left = `calc(${percent}% + (${8 - percent * 0.16}px))`;
    }
  }
}

function fluctuateDeviceTable() {
  const rows = document.querySelectorAll("#deviceTableBody tr");
  let activeCount = 0;
  let totalGpu = 0;
  let totalTemp = 0;
  
  rows.forEach((row, index) => {
    const isOffline = row.classList.contains("device-row-offline");
    if (!isOffline) {
      activeCount++;
      let baseGpu = index === 0 ? 32 : index === 1 ? 40 : index === 2 ? 45 : 12;
      let baseTemp = index === 0 ? 52 : index === 1 ? 58 : index === 2 ? 63 : 38;
      
      let gpu = Math.min(99, Math.max(10, baseGpu + Math.floor(Math.random() * 7) - 3));
      let temp = Math.min(95, Math.max(30, baseTemp + Math.floor(Math.random() * 5) - 2));
      
      totalGpu += gpu;
      totalTemp += temp;
      
      const pingTd = row.querySelector(".device-ping");
      if (pingTd) {
        let basePing = index === 0 ? 12 : index === 1 ? 14 : index === 2 ? 18 : 8;
        let delta = Math.floor(Math.random() * 5) - 2;
        let ping = Math.max(4, basePing + delta);
        pingTd.textContent = `${ping} ms`;
        pingTd.style.color = "var(--success)";
      }
      const fpsTd = row.cells[5];
      if (fpsTd && fpsTd.textContent.includes("fps")) {
        let baseFps = index === 0 ? 28 : index === 1 ? 29 : 25;
        let delta = Math.floor(Math.random() * 3) - 1;
        fpsTd.textContent = `${baseFps + delta} fps (CV Stream)`;
      }

      // Animate Sparkline dynamically
      const sparkPath = row.querySelector(".device-ping-spark svg path");
      if (sparkPath) {
        const p1 = Math.floor(4 + Math.random() * 8);
        const p2 = Math.floor(4 + Math.random() * 8);
        const p3 = Math.floor(4 + Math.random() * 8);
        const p4 = Math.floor(4 + Math.random() * 8);
        const p5 = Math.floor(4 + Math.random() * 8);
        sparkPath.setAttribute("d", `M0,${p1} Q10,${p2} 20,${p3} T40,${p4} T50,${p5}`);
        sparkPath.style.stroke = "var(--primary-2)";
      }
    } else {
      // Offline rows flat red sparkline
      const sparkPath = row.querySelector(".device-ping-spark svg path");
      if (sparkPath) {
        sparkPath.setAttribute("d", "M0,13 L50,13");
        sparkPath.style.stroke = "var(--danger)";
      }
    }
  });
  
  const nodeStatus = document.getElementById("nodeStatusSummary");
  const nodeGpu = document.getElementById("nodeGpuSummary");
  const nodeTemp = document.getElementById("nodeTempSummary");
  
  if (nodeStatus) {
    nodeStatus.textContent = `${activeCount} Online`;
    nodeStatus.style.color = activeCount === rows.length ? "var(--success)" : "var(--warning)";
  }
  if (nodeGpu) {
    nodeGpu.textContent = activeCount > 0 ? `${Math.round(totalGpu / activeCount)}% Load` : "0% Load";
  }
  if (nodeTemp) {
    nodeTemp.textContent = activeCount > 0 ? `${Math.round(totalTemp / activeCount)}°C` : "--°C";
  }
}

function fluctuateIntersectionsTable() {
  const table = document.getElementById("intersectionTable");
  if (!table) return;
  const rows = table.querySelectorAll("tr");
  rows.forEach((row, index) => {
    const waitCell = row.cells[3];
    if (waitCell) {
      let baseWait = index === 0 ? 54 : index === 1 ? 38 : index === 2 ? 22 : index === 3 ? 31 : 59;
      if (typeof isChaosMode !== "undefined" && isChaosMode) {
        baseWait = index === 0 ? 114 : index === 1 ? 88 : index === 2 ? 56 : index === 3 ? 92 : 119;
      }
      let delta = Math.floor(Math.random() * 5) - 2; // -2 to +2
      waitCell.textContent = `${Math.max(10, baseWait + delta)} dtk`;
    }
  });
}

function fluctuateCvTags() {
  const tags = document.querySelectorAll(".cv-tag");
  tags.forEach(tag => {
    const text = tag.textContent;
    const match = text.match(/^(.+?)\s+(\d+)%$/);
    if (match) {
      const type = match[1];
      const baseConf = parseInt(match[2]);
      let delta = Math.floor(Math.random() * 3) - 1; // -1 to +1
      let newConf = Math.min(99, Math.max(88, baseConf + delta));
      tag.textContent = `${type} ${newConf}%`;
    }
  });
}

function initLiveTelemetryStream() {
  setInterval(() => {
    updateTelemetryTick();
    fluctuateDeviceTable();
    fluctuateIntersectionsTable();
    fluctuateCvTags();
  }, 1000);
}
initLiveTelemetryStream();

// ==================== EMERGENCY RESPONDER GPS MAP MAPPING ====================
// ==================== EMERGENCY RESPONDER GPS MAP MAPPING ====================
function showEmergencyVehiclePopover(preempt, point, svg) {
  const popover = document.getElementById("mapVehiclePopover");
  if (!popover) return;
  
  const titleEl = document.getElementById("popoverTitle");
  const badgeEl = document.getElementById("popoverBadge");
  const speedEl = document.getElementById("popoverSpeed");
  const routeEl = document.getElementById("popoverRoute");
  const etaEl = document.getElementById("popoverEta");
  
  const isAmbulance = preempt.name.toLowerCase().includes("ambulans") || preempt.name.toLowerCase().includes("amb");
  const isFire = preempt.name.toLowerCase().includes("pemadam") || preempt.name.toLowerCase().includes("pmk");
  
  if (badgeEl) {
    badgeEl.textContent = isAmbulance ? "🚑 AMBULANS MEDIS SITS" : isFire ? "🚒 PEMADAM KEBAKARAN" : "🚨 PATROLI DARURAT";
    badgeEl.style.color = isAmbulance ? "#ef4444" : isFire ? "#f59e0b" : "#00e5ff";
  }
  if (titleEl) titleEl.textContent = preempt.name;
  if (speedEl) speedEl.textContent = `${preempt.speed || (isAmbulance ? 62 : 55)} km/jam`;
  if (routeEl) {
    let routeName = "Koridor Utama SITS Surabaya";
    if (preempt.route === "route-yani-darmo") routeName = "A. Yani → Darmo → Basuki Rahmat";
    else if (preempt.route) routeName = preempt.route.replace(/-/g, " ").toUpperCase();
    routeEl.textContent = routeName;
  }
  if (etaEl) {
    const mins = Math.floor(preempt.secondsLeft / 60);
    const secs = Math.max(1, preempt.secondsLeft % 60);
    etaEl.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs} detik`;
  }
  
  // Position popover relative to wrapper container
  const wrapper = document.getElementById("fullMapContainerWrapper");
  if (wrapper && svg) {
    const wrapperRect = wrapper.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    
    const scaleX = svgRect.width / 980;
    const scaleY = svgRect.height / 560;
    
    let targetX = (svgRect.left - wrapperRect.left) + (point.x * scaleX) + 12;
    let targetY = (svgRect.top - wrapperRect.top) + (point.y * scaleY) - 60;
    
    targetX = Math.max(16, Math.min(wrapperRect.width - 285, targetX));
    targetY = Math.max(16, Math.min(wrapperRect.height - 190, targetY));
    
    popover.style.left = `${targetX}px`;
    popover.style.top = `${targetY}px`;
  }
  
  popover.classList.remove("is-hidden");
  if (typeof playSound === 'function') playSound('click');
}

function updateEmergencyGpsDots() {
  document.querySelectorAll(".emergency-gps-marker-group, .emergency-gps-dot, .emergency-gps-ripple, .emergency-gps-label").forEach(el => el.remove());
  
  activePreemptions.forEach((preempt, pIdx) => {
    if (preempt.secondsLeft <= 0) return;
    
    const duration = preempt.totalDuration || 30;
    const progress = Math.min(0.99, (duration - preempt.secondsLeft) / duration);
    
    const pathCount = preempt.roads.length;
    if (pathCount === 0) return;
    
    const segmentSize = 1 / pathCount;
    const segmentIndex = Math.min(pathCount - 1, Math.floor(progress / segmentSize));
    const segmentProgress = (progress - (segmentIndex * segmentSize)) / segmentSize;
    
    const roadSelector = preempt.roads[segmentIndex];
    
    const svgs = document.querySelectorAll("svg");
    svgs.forEach(svg => {
      const roadPath = svg.querySelector(roadSelector);
      if (roadPath) {
        try {
          const pathLen = roadPath.getTotalLength();
          const point = roadPath.getPointAtLength(segmentProgress * pathLen);
          
          const isAmbulance = preempt.name.toLowerCase().includes("ambulans") || preempt.name.toLowerCase().includes("amb");
          const isFire = preempt.name.toLowerCase().includes("pemadam") || preempt.name.toLowerCase().includes("pmk");
          
          const mainColor = isAmbulance ? "#ef4444" : isFire ? "#f59e0b" : "#00e5ff";
          const icon = isAmbulance ? "🚑" : isFire ? "🚒" : "🚨";
          
          // Anti-Collision Offset Calculation
          // Stagger badges to opposite sides to prevent label collision in dense corridors
          let offsetX = 0;
          let offsetY = 0;
          if (isAmbulance || pIdx % 2 === 0) {
            offsetX = -50;
            offsetY = -16;
          } else {
            offsetX = +50;
            offsetY = +14;
          }
          
          // Outer marker group for click interactivity
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          group.setAttribute("class", "emergency-gps-marker-group");
          group.setAttribute("data-vehicle-id", preempt.id);
          group.style.cursor = "pointer";
          
          // Connector Leader Line
          const leaderLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          leaderLine.setAttribute("x1", point.x);
          leaderLine.setAttribute("y1", point.y);
          leaderLine.setAttribute("x2", point.x + offsetX);
          leaderLine.setAttribute("y2", point.y + offsetY);
          leaderLine.setAttribute("stroke", mainColor);
          leaderLine.setAttribute("stroke-width", "1");
          leaderLine.setAttribute("stroke-dasharray", "2 2");
          leaderLine.setAttribute("opacity", "0.75");
          group.appendChild(leaderLine);
          
          // Pulse Ripple
          const ripple = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          ripple.setAttribute("cx", point.x);
          ripple.setAttribute("cy", point.y);
          ripple.setAttribute("r", "15");
          ripple.setAttribute("class", "emergency-gps-ripple");
          ripple.style.stroke = mainColor;
          group.appendChild(ripple);
          
          // Core Dot
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", point.x);
          dot.setAttribute("cy", point.y);
          dot.setAttribute("r", "6.5");
          dot.setAttribute("class", "emergency-gps-dot");
          dot.style.fill = mainColor;
          dot.style.filter = `drop-shadow(0 0 6px ${mainColor})`;
          group.appendChild(dot);
          
          // Semi-transparent high-contrast Pill Badge
          const labelText = `${icon} ${preempt.name}`;
          const badgeWidth = Math.max(68, labelText.length * 6.6);
          const badgeHeight = 17;
          
          const pillBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          pillBg.setAttribute("x", point.x + offsetX - (badgeWidth / 2));
          pillBg.setAttribute("y", point.y + offsetY - (badgeHeight / 2));
          pillBg.setAttribute("width", badgeWidth);
          pillBg.setAttribute("height", badgeHeight);
          pillBg.setAttribute("rx", "8.5");
          pillBg.setAttribute("ry", "8.5");
          pillBg.setAttribute("class", "emergency-gps-pill-bg");
          pillBg.style.fill = "rgba(12, 18, 32, 0.88)";
          pillBg.style.stroke = mainColor;
          pillBg.style.strokeWidth = "1.2";
          pillBg.style.filter = "drop-shadow(0 2px 5px rgba(0,0,0,0.5))";
          group.appendChild(pillBg);
          
          // Crisp Pill Text
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", point.x + offsetX);
          text.setAttribute("y", point.y + offsetY + 3.2);
          text.setAttribute("class", "emergency-gps-label");
          text.textContent = labelText;
          text.style.fill = "#ffffff";
          text.style.fontSize = "8.2px";
          text.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
          text.style.fontWeight = "700";
          text.style.textAnchor = "middle";
          group.appendChild(text);
          
          // Click Handler to Show Interactive Popover
          group.addEventListener("click", (e) => {
            e.stopPropagation();
            showEmergencyVehiclePopover(preempt, point, svg);
          });
          
          const parent = roadPath.parentElement;
          if (parent) {
            parent.appendChild(group);
          }
        } catch (err) {
          console.warn("GPS point calculation error", err);
        }
      }
    });
  });
}

// ==================== DYNAMIC TRAFFIC INCIDENTS GENERATOR ====================
const incidentPool = [
  {
    type: "KECELAKAAN (ACCIDENT)",
    title: "Tabrakan roda dua di Simpang Wonokromo",
    description: "Dua sepeda motor bersenggolan pada lajur kiri arah Ahmad Yani. Menghambat arus lalu lintas keluar Wonokromo.",
    location: "Simpang Wonokromo",
    severity: "danger",
    recommendation: "AI merekomendasikan penyesuaian durasi hijau frontage A. Yani (+10 dtk) untuk mengurai antrean."
  },
  {
    type: "MOBIL MOGOK (VEHICLE-FAIL)",
    title: "Kendaraan mogok di Flyover Kupang",
    description: "Mobil minibus mogok di tanjakan flyover lajur kanan. Petugas Dishub sedang menuju lokasi untuk derek darurat.",
    location: "Jl. Mayjen Sungkono",
    severity: "warning",
    recommendation: "AI menyarankan rekayasa lalu lintas arus barat dialihkan ke Jl. HR Muhammad."
  },
  {
    type: "PEKERJAAN JALAN (ROADWORK)",
    title: "Pekerjaan pipa PDAM di Kertajaya",
    description: "Galian perbaikan pipa air memakan setengah lajur kanan. Kecepatan rata-rata koridor turun menjadi 15 km/jam.",
    location: "Jl. Kertajaya",
    severity: "warning",
    recommendation: "AI merekomendasikan pemangkasan durasi siklus hijau simpang Dharmawangsa menjadi 70 detik."
  },
  {
    type: "KAPASITAS BERLEBIH (CONGESTION)",
    title: "Kepadatan volume di depan Taman Bungkul",
    description: "Peningkatan arus sore hari arah Pusat Kota. Antrean kendaraan mencapai 120 meter di lajur tengah.",
    location: "Jl. Raya Darmo",
    severity: "warning",
    recommendation: "AI menyarankan percepatan lampu hijau prioritas lajur lurus arah Tunjungan."
  },
  {
    type: "KEGIATAN UMUM (EVENT)",
    title: "Konser / Parade budaya di Jl. Tunjungan",
    description: "Penutupan parsial satu lajur lambat untuk panggung pagelaran seni. Arus tersendat di depan Siola.",
    location: "Jl. Tunjungan",
    severity: "danger",
    recommendation: "AI merekomendasikan pengaktifan sinyal penyeberang pejalan kaki adaptif (pedestrian preemption)."
  },
  {
    type: "POHON TUMBANG (HAZARD)",
    title: "Dahan pohon patah menghalangi MERR",
    description: "Dahan pohon besar patah akibat angin kencang menutup lajur lambat arah utara. Petugas kebersihan kota sedang membersihkan jalur.",
    location: "MERR Kertajaya",
    severity: "danger",
    recommendation: "AI merekomendasikan pengalihan lajur sementara menggunakan traffic cone."
  }
];

let activeIncidents = [
  {
    id: 1,
    type: "⚠️ KECELAKAAN (ACCIDENT-02)",
    title: "Tabrakan Ringan di Simpang Darmo - Basra",
    description: "Insiden benturan minor dua kendaraan pada lajur kiri. Menghambat arus Jl. Raya Darmo ke arah utara. Rekomendasi AI: perpanjang fase hijau ke arah Basuki Rahmat untuk mengurai antrean.",
    location: "Jl. Raya Darmo",
    timeAgo: "5 menit lalu",
    severity: "danger"
  },
  {
    id: 2,
    type: "🚧 PENUTUPAN JALUR (ROADBLOCK-01)",
    title: "Galian Utilitas Kabel di Jl. Raya Darmo (Depan Al-Falah)",
    description: "Pekerjaan utilitas memakan satu lajur frontage road. Mengakibatkan penyempitan arus (bottleneck) menuju Wonokromo.",
    location: "Jl. Raya Darmo",
    timeAgo: "15 menit lalu",
    severity: "warning"
  }
];

let incidentIdCounter = 3;

function addMapWarningMarker(id, locationName) {
  const coords = {
    "Wonokromo": { cx: 452, cy: 338 },
    "Ahmad Yani": { cx: 467, cy: 502 },
    "Darmo": { cx: 436, cy: 208 },
    "Tunjungan": { cx: 336, cy: 143 },
    "Kertajaya": { cx: 714, cy: 162 },
    "Sungkono": { cx: 220, cy: 268 },
    "MERR": { cx: 768, cy: 308 }
  };
  
  let coord = coords["Wonokromo"];
  for (let key in coords) {
    if (locationName.toLowerCase().includes(key.toLowerCase())) {
      coord = coords[key];
      break;
    }
  }
  
  const cx = coord.cx;
  const cy = coord.cy;
  const pathD = `M${cx} ${cy - 10} l8 15 h-16z`;
  
  const svgs = document.querySelectorAll("svg");
  svgs.forEach(svg => {
    const warnGroup = svg.querySelector(".warn-points");
    if (warnGroup) {
      const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathEl.setAttribute("d", pathD);
      pathEl.setAttribute("data-incident-id", id);
      pathEl.setAttribute("class", "dynamic-warn-marker");
      warnGroup.appendChild(pathEl);
    }
  });
}

function removeMapWarningMarker(id) {
  const markers = document.querySelectorAll(`[data-incident-id="${id}"]`);
  markers.forEach(m => m.remove());
}

function spawnDynamicIncident() {
  if (activeIncidents.length >= 10) {
    const oldest = activeIncidents.pop();
    removeMapWarningMarker(oldest.id);
    showToast(`🤖 AI AUTO-RESOLVED: ${oldest.title} diselesaikan oleh sistem.`);
    
    // Add auto-approve log to webhook event stream
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour12: false });
    const line = document.createElement("div");
    line.className = "terminal-line";
    line.style.color = "var(--success)";
    line.style.fontWeight = "bold";
    line.textContent = `[${timeStr}] AI AUTO-APPROVE: Ambang batas terlampaui. Menyelesaikan otomatis insiden #${oldest.id} (${oldest.title}).`;
    const terminalLogs = document.getElementById("terminalLogs");
    if (terminalLogs) {
      terminalLogs.appendChild(line);
      while (terminalLogs.childElementCount > 15) {
        terminalLogs.removeChild(terminalLogs.firstChild);
      }
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }
  }

  const base = incidentPool[Math.floor(Math.random() * incidentPool.length)];
  const id = incidentIdCounter++;
  const timeStr = "Baru saja";
  
  const newIncident = {
    id: id,
    type: base.type === "KECELAKAAN (ACCIDENT)" ? "⚠️ KECELAKAAN (ACCIDENT-0" + id + ")" :
          base.type === "MOBIL MOGOK (VEHICLE-FAIL)" ? "🚗 KENDARAAN MOGOK (BREAKDOWN-0" + id + ")" :
          base.type === "PEKERJAAN JALAN (ROADWORK)" ? "🚧 PEKERJAAN JALAN (ROADWORK-0" + id + ")" :
          base.type === "KAPASITAS BERLEBIH (CONGESTION)" ? "🚨 KEPADATAN TINGGI (CONGESTION-0" + id + ")" : "⚠️ ANOMALI (HAZARD-0" + id + ")",
    title: base.title,
    description: base.description + " " + base.recommendation,
    location: base.location,
    timeAgo: timeStr,
    severity: base.severity
  };
  
  activeIncidents.unshift(newIncident);
  addMapWarningMarker(id, base.location);
  
  playSound('warning');
  showToast(`🚨 INSIDEN BARU SITS: ${base.title}`);
  
  renderIncidentsHtml();
}

function renderIncidentsHtml() {
  const dashboardTimeline = document.querySelector("#incidents .timeline");
  const incidentsViewList = document.querySelector("#view-incidents .incident-logs-list");
  const dashboardBadge = document.querySelector("#incidents .pill");
  const incidentViewBadge = document.querySelector("#view-incidents .pill");
  
  const activeCount = activeIncidents.length;
  if (dashboardBadge) {
    dashboardBadge.textContent = `${activeCount} Alert`;
    dashboardBadge.className = activeCount > 0 ? "pill pill-danger" : "pill pill-live";
  }
  if (incidentViewBadge) {
    incidentViewBadge.textContent = `${activeCount} Unresolved Alerts`;
    incidentViewBadge.className = activeCount > 0 ? "pill pill-danger" : "pill pill-live";
  }
  
  if (dashboardTimeline) {
    dashboardTimeline.innerHTML = "";
    activeIncidents.slice(0, 4).forEach(inc => {
      const li = document.createElement("li");
      const dotClass = inc.severity === "danger" ? "timeline-dot danger pulse-red-dot" : "timeline-dot warning";
      li.innerHTML = `
        <span class="${dotClass}"></span>
        <div><strong>${inc.title}</strong><small>${inc.location} • ${inc.timeAgo}</small></div>
      `;
      dashboardTimeline.appendChild(li);
    });
  }
  
  if (incidentsViewList) {
    incidentsViewList.innerHTML = "";
    
    // Apply filters based on currentIncidentFilter state
    let filteredIncidents = [];
    const currentFilter = (typeof currentIncidentFilter !== "undefined") ? currentIncidentFilter : "all";
    
    if (currentFilter === "all") {
      filteredIncidents = activeIncidents;
    } else if (currentFilter === "accident") {
      filteredIncidents = activeIncidents.filter(inc => inc.type.includes("ACCIDENT") || inc.type.includes("KECELAKAAN"));
    } else if (currentFilter === "roadblock") {
      filteredIncidents = activeIncidents.filter(inc => inc.type.includes("ROADBLOCK") || inc.type.includes("PENUTUPAN") || inc.type.includes("PEKERJAAN"));
    } else if (currentFilter === "resolved") {
      filteredIncidents = [
        {
          id: 991,
          type: "✓ SELESAI (RESOLVED)",
          title: "Pohon patah lajur lambat MERR",
          description: "Dahan pohon patah menghalangi MERR Kertajaya telah dibersihkan oleh Dinas Kebersihan Kota Surabaya. Arus lalu lintas normal kembali.",
          location: "MERR Kertajaya",
          timeAgo: "1 jam lalu",
          severity: "success"
        },
        {
          id: 992,
          type: "✓ SELESAI (RESOLVED)",
          title: "Kemacetan Simpang Wonokromo",
          description: "Penumpukan kendaraan ekor Margorejo berhasil diurai setelah AI menerapkan perpanjangan fase hijau frontage Ahmad Yani.",
          location: "Simpang Wonokromo",
          timeAgo: "2 jam lalu",
          severity: "success"
        }
      ];
    }
    
    if (filteredIncidents.length === 0) {
      incidentsViewList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 8px;">✓</div>
          <h3>Tidak Ada Insiden</h3>
          <p>Tidak ada data insiden aktif untuk kategori filter ini.</p>
        </div>
      `;
    } else {
      filteredIncidents.forEach(inc => {
        const item = document.createElement("div");
        item.className = "incident-log-item unresolved";
        const badgeClass = inc.severity === "danger" ? "alert-red" : inc.severity === "success" ? "alert-green" : "alert-orange";
        const isResolved = currentFilter === "resolved";
        
        item.innerHTML = `
          <div class="inc-meta">
            <span class="inc-type ${badgeClass}">${inc.type}</span>
            <span class="inc-time">${inc.timeAgo}</span>
          </div>
          <strong>${inc.title}</strong>
          <p>${inc.description}</p>
          <div class="inc-actions">
            ${isResolved ? '' : `
              <button class="btn btn-primary compact resolve-btn" onclick="resolveDynamicIncident(${inc.id})">Mark as Resolved</button>
              <button class="btn btn-ghost compact dispatch-btn" onclick="openIncidentDetail(${inc.id})">Disposisi Petugas</button>
            `}
          </div>
        `;
        incidentsViewList.appendChild(item);
      });
    }
  }
}

window.resolveDynamicIncident = function(id) {
  const index = activeIncidents.findIndex(inc => inc.id === id);
  if (index === -1) return;
  
  const inc = activeIncidents[index];
  playSound('success');
  showToast(`Insiden teratasi: ${inc.title}`);
  
  removeMapWarningMarker(id);
  activeIncidents.splice(index, 1);
  renderIncidentsHtml();
};

function initDynamicIncidents() {
  addMapWarningMarker(1, "Jl. Raya Darmo");
  addMapWarningMarker(2, "Jl. Raya Darmo");
  renderIncidentsHtml();
  
  setInterval(() => {
    spawnDynamicIncident();
  }, 5000);
  
  setInterval(() => {
    activeIncidents.forEach(inc => {
      if (inc.timeAgo === "Baru saja") {
        inc.timeAgo = "1 menit lalu";
      } else if (inc.timeAgo.includes("menit lalu")) {
        const mins = parseInt(inc.timeAgo.match(/\d+/)[0]);
        inc.timeAgo = `${mins + 1} menit lalu`;
      }
    });
    renderIncidentsHtml();
  }, 60000);
}
initDynamicIncidents();

// ==================== 20 UI/UX UPDATES ADDITIONAL LOGIC ====================

// 1. Ambient Background Particles Generator
function generateAmbientParticles() {
  const container = document.getElementById("particleContainer");
  if (!container) return;
  
  const particleCount = 18;
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("div");
    particle.className = "particle-ambient";
    
    // Randomize positioning & speed
    const size = Math.random() * 4 + 2; 
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${Math.random() * 100}vw`;
    particle.style.top = `${Math.random() * 100}vh`;
    
    const duration = Math.random() * 15 + 10; // 10s - 25s
    const delay = Math.random() * -15; // start immediately in mid-air
    particle.style.animationDuration = `${duration}s`;
    particle.style.animationDelay = `${delay}s`;
    
    container.appendChild(particle);
  }
}
generateAmbientParticles();

// 2. Sidebar Navigation Sliding Accent Line
function initSidebarAccent() {
  const accent = document.getElementById("sidebarAccent");
  const navMenu = document.querySelector(".nav-menu");
  if (!accent || !navMenu) return;
  
  function positionAccent(targetItem) {
    const menuRect = navMenu.getBoundingClientRect();
    const itemRect = targetItem.getBoundingClientRect();
    
    accent.style.opacity = "1";
    accent.style.height = `${itemRect.height}px`;
    accent.style.transform = `translateY(${itemRect.top - menuRect.top + navMenu.scrollTop}px)`;
  }
  
  // Position initially on active nav item
  const activeItem = navMenu.querySelector(".nav-item.active");
  if (activeItem) {
    setTimeout(() => positionAccent(activeItem), 200);
  }
  
  // Hover & Click triggers
  const navItemsList = navMenu.querySelectorAll(".nav-item");
  navItemsList.forEach(item => {
    item.addEventListener("mouseenter", () => {
      positionAccent(item);
    });
    
    item.addEventListener("click", () => {
      navItemsList.forEach(nav => nav.classList.remove("active"));
      item.classList.add("active");
      positionAccent(item);
    });
  });
  
  // Return to active when mouse leaves nav menu
  navMenu.addEventListener("mouseleave", () => {
    const currentActive = navMenu.querySelector(".nav-item.active");
    if (currentActive) {
      positionAccent(currentActive);
    } else {
      accent.style.opacity = "0";
    }
  });
}
initSidebarAccent();

// 3. Heartbeat speed controls (fast under chaos mode)
const heartbeatPath = document.querySelector(".heartbeat-path");
function updateHeartbeatSpeed() {
  if (!heartbeatPath) return;
  setInterval(() => {
    if (typeof isChaosMode !== "undefined" && isChaosMode) {
      heartbeatPath.style.animationDuration = "0.8s";
      heartbeatPath.style.stroke = "var(--danger)";
    } else {
      heartbeatPath.style.animationDuration = "2.2s";
      heartbeatPath.style.stroke = "var(--success)";
    }
  }, 1000);
}
updateHeartbeatSpeed();

// 4. Map Tooltip hover context display (Surabaya Districts & Telemetry details) via Event Delegation
function initMapTooltip() {
  const tooltip = document.getElementById("mapTooltip");
  if (!tooltip) return;
  
  // Mouse position tracking
  document.addEventListener("mousemove", (e) => {
    if (tooltip.classList.contains("show")) {
      tooltip.style.left = `${e.clientX + 16}px`;
      tooltip.style.top = `${e.clientY + 12}px`;
    }
  });
  
  // Event Delegation for hover states
  document.addEventListener("mouseover", (e) => {
    // Check if hovering over a road or road-glow
    const road = e.target.closest("path.road, path.road-glow");
    if (road) {
      let name = "Jalan Surabaya";
      let status = "Lancar";
      let speed = "45 km/jam";
      let cap = "28%";
      
      const id = road.id || "";
      const dAttr = road.getAttribute("d") || "";
      const cls = road.className.baseVal || "";
      
      if (id === "dashRoad1" || dAttr.includes("C472")) {
        name = "Jl. Ahmad Yani (Wonokromo)";
        status = typeof isChaosMode !== "undefined" && isChaosMode ? "Macet Parah (Gridlock)" : "Macet";
        speed = typeof isChaosMode !== "undefined" && isChaosMode ? "3 km/jam" : "14 km/jam";
        cap = typeof isChaosMode !== "undefined" && isChaosMode ? "98%" : "83%";
      } else if (id === "dashRoad2" || dAttr.includes("M452")) {
        name = "Jl. Raya Darmo (Wonokromo→Darmo)";
        status = typeof isChaosMode !== "undefined" && isChaosMode ? "Macet Parah" : "Padat Merayap";
        speed = typeof isChaosMode !== "undefined" && isChaosMode ? "5 km/jam" : "26 km/jam";
        cap = typeof isChaosMode !== "undefined" && isChaosMode ? "95%" : "61%";
      } else if (id === "dashRoad3" || dAttr.includes("M246")) {
        name = "Jl. Tunjungan - Basuki Rahmat";
        status = typeof isChaosMode !== "undefined" && isChaosMode ? "Macet Parah" : "Normal";
        speed = typeof isChaosMode !== "undefined" && isChaosMode ? "6 km/jam" : "38 km/jam";
        cap = typeof isChaosMode !== "undefined" && isChaosMode ? "94%" : "44%";
      } else if (id === "dashRoad4" || dAttr.includes("M534")) {
        name = "Jl. Kertajaya (Koridor Timur)";
        status = typeof isChaosMode !== "undefined" && isChaosMode ? "Macet Parah" : "Lancar";
        speed = typeof isChaosMode !== "undefined" && isChaosMode ? "8 km/jam" : "48 km/jam";
        cap = typeof isChaosMode !== "undefined" && isChaosMode ? "90%" : "22%";
      } else if (id === "dashRoad5" || dAttr.includes("M766")) {
        name = "MERR (Middle East Ring Road)";
        status = typeof isChaosMode !== "undefined" && isChaosMode ? "Macet Parah" : "Lancar";
        speed = typeof isChaosMode !== "undefined" && isChaosMode ? "12 km/jam" : "52 km/jam";
        cap = typeof isChaosMode !== "undefined" && isChaosMode ? "88%" : "18%";
      } else if (cls.includes("road-danger")) {
        name = "Koridor Utama SITS";
        status = "Macet Parah";
        speed = "8 km/jam";
        cap = "88%";
      } else if (cls.includes("road-warning")) {
        name = "Jalan Penghubung Koridor";
        status = "Padat Merayap";
        speed = "24 km/jam";
        cap = "62%";
      } else if (cls.includes("road-success")) {
        name = "Jalan Alternatif SITS";
        status = "Lancar";
        speed = "48 km/jam";
        cap = "20%";
      }
      
      tooltip.innerHTML = `
        <h4>${name}</h4>
        <div class="tooltip-metric"><span>Status:</span><strong style="color: ${status.includes("Macet") ? "var(--danger)" : status.includes("Padat") ? "var(--warning)" : "var(--success)"}">${status}</strong></div>
        <div class="tooltip-metric"><span>Kecepatan:</span><strong>${speed}</strong></div>
        <div class="tooltip-metric"><span>Kepadatan:</span><strong>${cap}</strong></div>
      `;
      tooltip.classList.add("show");
      tooltip.style.opacity = "1";
      return;
    }
    
    // Check if hovering over a signal node
    const node = e.target.closest(".signal-node");
    if (node) {
      let name = "Simpang SITS";
      let cycle = "42s";
      let status = "Stabil";
      
      const cx = parseFloat(node.getAttribute("cx"));
      const cy = parseFloat(node.getAttribute("cy"));
      
      if (cx === 452 && cy === 338) {
        name = "Simpang Wonokromo";
        cycle = `${activeCycles[0]}s Green`;
        status = typeof isChaosMode !== "undefined" && isChaosMode ? "OVERLOADED" : "Siklus Aktif";
      } else if (cx === 468 && cy === 154) {
        name = "Simpang Tunjungan (Siola)";
        cycle = `${activeCycles[1]}s Green`;
        status = typeof isChaosMode !== "undefined" && isChaosMode ? "OVERLOADED" : "Siklus Aktif";
      } else if (cx === 534 && cy === 172) {
        name = "Simpang Kertajaya";
        cycle = "35s Green";
        status = "Siklus Aktif";
      } else if (cx === 436 && cy === 208) {
        name = "Simpang Darmo";
        cycle = "38s Green";
        status = "Siklus Aktif";
      } else if (cx === 464 && cy === 438) {
        name = "Simpang Jemursari";
        cycle = "59s Green";
        status = "Siklus Aktif";
      } else if (cx === 220 && cy === 268) {
        name = "Simpang Sungkono";
        cycle = "40s Green";
        status = "Siklus Aktif";
      }
      
      tooltip.innerHTML = `
        <h4>${name}</h4>
        <div class="tooltip-metric"><span>Sinyal ATCS:</span><strong>SITS Connected</strong></div>
        <div class="tooltip-metric"><span>Fase Hijau:</span><strong>${cycle}</strong></div>
        <div class="tooltip-metric"><span>Status AI:</span><strong style="color: ${status.includes("OVERLOAD") ? "var(--danger)" : "var(--success)"}">${status}</strong></div>
      `;
      tooltip.classList.add("show");
      tooltip.style.opacity = "1";
    }
  });

  document.addEventListener("mouseout", (e) => {
    const road = e.target.closest("path.road, path.road-glow");
    const node = e.target.closest(".signal-node");
    if (road || node) {
      tooltip.classList.remove("show");
      tooltip.style.opacity = "0";
    }
  });
}
initMapTooltip();

// 5. CCTV Grid Matrix selectors
function initCctvMatrixSelectors() {
  const container = document.querySelector(".cctv-feed-grid");
  const buttons = document.querySelectorAll(".matrix-btn");
  if (!container || buttons.length === 0) return;
  
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const gridLayout = btn.dataset.grid;
      container.className = "cctv-feed-grid"; // reset
      
      if (gridLayout === "grid-1x3") {
        container.classList.add("grid-1x3");
      } else if (gridLayout === "grid-focus") {
        container.classList.add("grid-focus");
      }
      
      showToast(`Tampilan CCTV dialihkan ke mode: ${btn.title}`);
    });
  });
}
initCctvMatrixSelectors();

// 6. Signal Phase Timeline ticker countdown animation
function initSignalTimelineAnimation() {
  setInterval(() => {
    // 1. Dashboard Wonokromo Timeline Indicator
    const dashInd = document.getElementById("dashboardPhaseIndicator");
    if (dashInd) {
      // cycle count goes 38 down to 0, maps to percentage
      const percent = ((38 - activeCycles[0]) / 38) * 100;
      dashInd.style.left = `${Math.max(0, Math.min(96, percent))}%`;
    }
    
    // 2. Signals Pane Wonokromo Timeline Indicator
    const sigInd1 = document.getElementById("signalsPhaseIndicator1");
    if (sigInd1) {
      const percent = ((38 - activeCycles[0]) / 38) * 100;
      sigInd1.style.left = `${Math.max(0, Math.min(96, percent))}%`;
    }
    
    // 3. Signals Pane Tunjungan Timeline Indicator
    const sigInd2 = document.getElementById("signalsPhaseIndicator2");
    if (sigInd2) {
      const percent = ((28 - activeCycles[1]) / 28) * 100;
      sigInd2.style.left = `${Math.max(0, Math.min(96, percent))}%`;
    }
  }, 100);
}
initSignalTimelineAnimation();

// 7. REST API Gateway Explorer Playground Request Preview
function initApiRequestPreview() {
  const endpointSelect = document.getElementById("apiEndpoint");
  const previewBox = document.getElementById("apiPayloadPreview");
  if (!endpointSelect || !previewBox) return;
  
  const payloads = {
    "/sits/api/v1/telemetry": {
      method: "GET",
      headers: {
        "Authorization": "Bearer sits_surabaya_secret_token_184",
        "Accept": "application/json"
      },
      params: {
        "corridor": "ahmad_yani",
        "detailed": "true"
      }
    },
    "/sits/api/v1/incidents": {
      method: "GET",
      headers: {
        "Authorization": "Bearer sits_surabaya_secret_token_184",
        "Accept": "application/json"
      },
      params: {
        "status": "unresolved",
        "severity": "high"
      }
    },
    "/sits/api/v1/preemption": {
      method: "POST",
      headers: {
        "Authorization": "Bearer sits_surabaya_secret_token_184",
        "Content-Type": "application/json"
      },
      body: {
        "responder_id": "AMBULANCE-02",
        "route_id": "route-yani-darmo",
        "preemption_level": "critical",
        "gps_coordinates": {
          "lat": -7.308,
          "lng": 112.738
        }
      }
    }
  };
  
  function updatePreview() {
    const endpoint = endpointSelect.value;
    const methodSpan = document.getElementById("apiMethod");
    const payload = payloads[endpoint] || {};
    
    if (methodSpan) {
      methodSpan.textContent = payload.method || "GET";
      methodSpan.style.background = payload.method === "POST" ? "var(--warning)" : "var(--success)";
    }
    
    previewBox.textContent = JSON.stringify(payload, null, 2);
  }
  
  endpointSelect.addEventListener("change", updatePreview);
  updatePreview(); // initial call
}
initApiRequestPreview();


// 9. Floating Help Tour Guide Widget
function initQuickHelpTour() {
  const btnTour = document.getElementById("btnQuickTour");
  const tooltipTour = document.getElementById("quickTourTooltip");
  const btnClose = document.getElementById("btnCloseTour");
  
  if (!btnTour || !tooltipTour || !btnClose) return;
  
  btnTour.addEventListener("click", (e) => {
    e.stopPropagation();
    playSound('click');
    tooltipTour.classList.toggle("show");
  });
  
  btnClose.addEventListener("click", (e) => {
    e.stopPropagation();
    playSound('click');
    tooltipTour.classList.remove("show");
  });
  
  document.addEventListener("click", (e) => {
    if (!tooltipTour.contains(e.target) && e.target !== btnTour) {
      tooltipTour.classList.remove("show");
    }
  });
}
initQuickHelpTour();

// ==================== PHASE 2 ADDITIONS ====================

// 1. Search Box Auto-complete Dropdown Suggestions
const listIntersections = [
  { name: "Simpang Wonokromo (A. Yani)", density: "High", color: "var(--danger)" },
  { name: "Simpang Darmo (Polisi Istimewa)", density: "Moderate", color: "var(--warning)" },
  { name: "Simpang Kertajaya (Dharmawangsa)", density: "Low", color: "var(--success)" },
  { name: "Simpang Tunjungan (Gedung Siola)", density: "Moderate", color: "var(--warning)" },
  { name: "Simpang Jemursari (A. Yani)", density: "High", color: "var(--danger)" },
  { name: "Simpang Sungkono", density: "Moderate", color: "var(--warning)" },
  { name: "Simpang MERR Kertajaya", density: "Low", color: "var(--success)" }
];

const searchSuggestions = document.getElementById("searchSuggestions");
if (searchInput && searchSuggestions) {
  searchInput.addEventListener("input", () => {
    const val = searchInput.value.trim().toLowerCase();
    if (!val) {
      searchSuggestions.classList.add("is-hidden");
      return;
    }
    const matches = listIntersections.filter(i => i.name.toLowerCase().includes(val));
    if (matches.length === 0) {
      searchSuggestions.classList.add("is-hidden");
      return;
    }
    searchSuggestions.innerHTML = "";
    matches.forEach(match => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      div.innerHTML = `
        <span>${match.name}</span>
        <span class="suggestion-density" style="background: ${match.color}; color: #fff;">${match.density}</span>
      `;
      div.addEventListener("click", () => {
        searchInput.value = match.name;
        searchSuggestions.classList.add("is-hidden");
        applyTableFilter();
        playSound('success');
      });
      searchSuggestions.appendChild(div);
    });
    searchSuggestions.classList.remove("is-hidden");
  });
  
  // Close suggestions when clicking outside
  document.addEventListener("click", (e) => {
    if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
      searchSuggestions.classList.add("is-hidden");
    }
  });
}

// 2. Simulation Speed Control & CCTV Play/Pause
const simSpeedRange = document.getElementById("simulationSpeedRange");
const simSpeedVal = document.getElementById("simSpeedVal");
if (simSpeedRange && simSpeedVal) {
  simSpeedRange.addEventListener("input", () => {
    simSpeedMultiplier = parseFloat(simSpeedRange.value);
    simSpeedVal.textContent = simSpeedMultiplier === 0 ? "Jeda" : `${simSpeedMultiplier}x`;
    playSound('hover');
    // If set to 0, it acts as pause
    if (simSpeedMultiplier === 0) {
      isCctvPaused = true;
      const btnPause = document.getElementById("btnPlayPauseCctv");
      if (btnPause) {
        btnPause.textContent = "▶ Putar";
        btnPause.classList.add("active");
      }
    } else {
      isCctvPaused = false;
      const btnPause = document.getElementById("btnPlayPauseCctv");
      if (btnPause) {
        btnPause.textContent = "⏸ Jeda";
        btnPause.classList.remove("active");
      }
    }
  });
}

const btnPlayPauseCctv = document.getElementById("btnPlayPauseCctv");
if (btnPlayPauseCctv) {
  btnPlayPauseCctv.addEventListener("click", () => {
    isCctvPaused = !isCctvPaused;
    btnPlayPauseCctv.innerHTML = isCctvPaused ? `<span class="btn-icon">▶</span> Putar` : `<span class="btn-icon">⏸</span> Jeda`;
    btnPlayPauseCctv.classList.toggle("active", isCctvPaused);
    
    // Toggle paused state on all CCTV video boxes to show PAUSED indicator badge
    const cameraBoxes = document.querySelectorAll(".camera-box");
    cameraBoxes.forEach(box => {
      box.classList.toggle("is-paused", isCctvPaused);
    });

    if (isCctvPaused) {
      if (simSpeedRange && simSpeedVal) {
        simSpeedRange.value = 0;
        simSpeedVal.textContent = "Jeda";
      }
    } else {
      if (simSpeedRange && simSpeedVal && simSpeedRange.value == 0) {
        simSpeedRange.value = 1;
        simSpeedVal.textContent = "1x";
        simSpeedMultiplier = 1;
      }
    }
    showToast(isCctvPaused ? "Simulasi feed CCTV dihentikan (PAUSED)." : "Simulasi feed CCTV dijalankan kembali.");
    playSound('switch');
  });
}

// 3. Map Zoom & Pan Controls
let zoomScale = 1;
let panX = 0;
let panY = 0;
const mapSvg = document.querySelector("#dashboardMapBox svg");

function applyMapTransform() {
  if (mapSvg) {
    mapSvg.style.transform = `scale(${zoomScale}) translate(${panX}px, ${panY}px)`;
    mapSvg.style.transformOrigin = "center center";
    mapSvg.style.transition = "transform 0.2s var(--ease)";
  }
  const fullMapSvg = document.getElementById("fullMapSvg");
  if (fullMapSvg) {
    fullMapSvg.style.transform = `scale(${zoomScale}) translate(${panX}px, ${panY}px)`;
    fullMapSvg.style.transformOrigin = "center center";
    fullMapSvg.style.transition = "transform 0.2s var(--ease)";
  }
}

const btnZoomIn = document.getElementById("btnMapZoomIn");
const btnZoomOut = document.getElementById("btnMapZoomOut");
const btnZoomReset = document.getElementById("btnMapZoomReset");

if (btnZoomIn) {
  btnZoomIn.addEventListener("click", () => {
    zoomScale = Math.min(3, zoomScale + 0.25);
    applyMapTransform();
    playSound('click');
  });
}
if (btnZoomOut) {
  btnZoomOut.addEventListener("click", () => {
    zoomScale = Math.max(1, zoomScale - 0.25);
    if (zoomScale === 1) { panX = 0; panY = 0; }
    applyMapTransform();
    playSound('click');
  });
}
if (btnZoomReset) {
  btnZoomReset.addEventListener("click", () => {
    zoomScale = 1;
    panX = 0;
    panY = 0;
    applyMapTransform();
    playSound('success');
  });
}

// Full-Bleed Map Zoom & Reset Controls (iOS Round Buttons)
const btnFullZoomIn = document.getElementById("btnFullMapZoomIn");
const btnFullZoomOut = document.getElementById("btnFullMapZoomOut");
const btnFullReset = document.getElementById("btnFullMapReset");

if (btnFullZoomIn) {
  btnFullZoomIn.addEventListener("click", () => {
    if (surabayaMap) {
      surabayaMap.zoomIn();
    } else {
      zoomScale = Math.min(3, zoomScale + 0.25);
      applyMapTransform();
    }
    if (typeof playSound === 'function') playSound('click');
  });
}
if (btnFullZoomOut) {
  btnFullZoomOut.addEventListener("click", () => {
    if (surabayaMap) {
      surabayaMap.zoomOut();
    } else {
      zoomScale = Math.max(1, zoomScale - 0.25);
      if (zoomScale === 1) { panX = 0; panY = 0; }
      applyMapTransform();
    }
    if (typeof playSound === 'function') playSound('click');
  });
}
if (btnFullReset) {
  btnFullReset.addEventListener("click", () => {
    if (surabayaMap) {
      surabayaMap.setView([-7.2756, 112.7424], 13);
    } else {
      zoomScale = 1;
      panX = 0;
      panY = 0;
      applyMapTransform();
    }
    if (typeof playSound === 'function') playSound('success');
  });
}

// Collapsible Layer Drawer Toggle Handlers (🥞 Button)
const btnToggleLayers = document.getElementById("btnToggleFullMapLayers");
const fullMapLayerDeck = document.getElementById("fullMapLayerDeck");
const btnCloseLayers = document.getElementById("btnCloseFullMapLayers");

if (btnToggleLayers && fullMapLayerDeck) {
  btnToggleLayers.addEventListener("click", (e) => {
    e.stopPropagation();
    fullMapLayerDeck.classList.toggle("is-open");
    if (typeof playSound === 'function') playSound('click');
  });
}

if (btnCloseLayers && fullMapLayerDeck) {
  btnCloseLayers.addEventListener("click", (e) => {
    e.stopPropagation();
    fullMapLayerDeck.classList.remove("is-open");
    if (typeof playSound === 'function') playSound('click');
  });
}

// Close layer drawer or vehicle popover when clicking anywhere else on the map wrapper
const fullMapWrapper = document.getElementById("fullMapContainerWrapper");
if (fullMapWrapper) {
  fullMapWrapper.addEventListener("click", (e) => {
    if (fullMapLayerDeck && !fullMapLayerDeck.contains(e.target) && e.target !== btnToggleLayers && !btnToggleLayers?.contains(e.target)) {
      fullMapLayerDeck.classList.remove("is-open");
    }
    const popover = document.getElementById("mapVehiclePopover");
    if (popover && !popover.contains(e.target) && !e.target.closest(".emergency-gps-marker-group")) {
      popover.classList.add("is-hidden");
    }
  });

  // Allow dragging full-bleed map when zoomed
  fullMapWrapper.addEventListener("mousedown", (e) => {
    if (zoomScale > 1 && !e.target.closest("button") && !e.target.closest(".map-layer-deck") && !e.target.closest(".map-interactive-popover")) {
      isDraggingMap = true;
      startDragX = e.clientX - panX;
      startDragY = e.clientY - panY;
      fullMapWrapper.style.cursor = "grabbing";
    }
  });
  window.addEventListener("mouseup", () => {
    if (fullMapWrapper) fullMapWrapper.style.cursor = "";
  });
}

// Close Vehicle Popover Button
const btnClosePopover = document.getElementById("btnCloseVehiclePopover");
if (btnClosePopover) {
  btnClosePopover.addEventListener("click", (e) => {
    e.stopPropagation();
    const popover = document.getElementById("mapVehiclePopover");
    if (popover) popover.classList.add("is-hidden");
    if (typeof playSound === 'function') playSound('click');
  });
}

// Hook up warning points click to show incident info in popover
function setupIncidentPointClicks() {
  document.querySelectorAll(".warn-points path, .warn-points circle").forEach(pt => {
    pt.style.cursor = "pointer";
    pt.addEventListener("click", (e) => {
      e.stopPropagation();
      const popover = document.getElementById("mapVehiclePopover");
      if (!popover) return;
      
      const titleEl = document.getElementById("popoverTitle");
      const badgeEl = document.getElementById("popoverBadge");
      const speedEl = document.getElementById("popoverSpeed");
      const routeEl = document.getElementById("popoverRoute");
      const etaEl = document.getElementById("popoverEta");
      
      if (badgeEl) {
        badgeEl.textContent = "⚠️ PERINGATAN INSIDEN LALU LINTAS";
        badgeEl.style.color = "#f59e0b";
      }
      if (titleEl) titleEl.textContent = "Kepadatan Simpang Wonokromo - Darmo";
      if (speedEl) speedEl.textContent = "14 km/jam (Padat)";
      if (routeEl) routeEl.textContent = "Penyempitan Lajur Akibat Kendaraan Mogok";
      if (etaEl) etaEl.textContent = "+12 menit kelambatan";
      
      popover.classList.remove("is-hidden");
      if (typeof playSound === 'function') playSound('alert');
    });
  });
}
setTimeout(setupIncidentPointClicks, 800);

// 4. Landmark Click Detail Cards Overlay
function setupLandmarkClicks() {
  const landmarkData = {
    "rsud dr. soetomo": {
      title: "RSUD Dr. Soetomo Surabaya",
      desc: "Pusat rujukan medis darurat utama kota. Akses lalu lintas dipantau ketat untuk memfasilitasi preemption ambulans secara otomatis.",
      status: "Lancar (Koridor Emergency)",
      color: "var(--success)"
    },
    "tunjungan plaza": {
      title: "Tunjungan Plaza Mall",
      desc: "Kawasan komersial tersibuk di pusat kota. Sering terjadi kepadatan parkir pada akhir pekan di sepanjang Jl. Basuki Rahmat.",
      status: "Padat Merayap",
      color: "var(--warning)"
    },
    "flyover wonokromo": {
      title: "Flyover Wonokromo",
      desc: "Pintu masuk utama Surabaya Selatan. Menghubungkan Jl. Ahmad Yani dengan Jl. Raya Darmo. Titik krusial kemacetan jam sibuk.",
      status: "Kepadatan Tinggi",
      color: "var(--danger)"
    },
    "pelabuhan tg. perak": {
      title: "Pelabuhan Tanjung Perak",
      desc: "Gerbang logistik maritim Jawa Timur. Volume kendaraan didominasi truk muatan besar. Dipantau oleh sensor muatan Edge AI.",
      status: "Normal Lancar",
      color: "var(--success)"
    }
  };
  
  const landmarkCard = document.getElementById("landmarkDetailCard");
  const landmarkTitle = document.getElementById("landmarkTitle");
  const landmarkDesc = document.getElementById("landmarkDesc");
  const landmarkStatus = document.getElementById("landmarkStatus");
  const btnCloseLandmark = document.getElementById("btnCloseLandmarkCard");
  
  if (landmarkCard) {
    document.addEventListener("click", (e) => {
      const dot = e.target.closest(".landmark-dot");
      const label = e.target.closest(".landmark-label-box");
      const text = e.target.closest(".landmark-text");
      
      if (dot || label || text) {
        let name = "";
        if (dot) {
          const nextSiblingText = dot.parentNode.querySelector(`.landmark-text`);
          if (nextSiblingText) name = nextSiblingText.textContent.trim().toLowerCase();
        } else if (label) {
          const siblingText = label.parentNode.querySelector(`.landmark-text`);
          if (siblingText) name = siblingText.textContent.trim().toLowerCase();
        } else if (text) {
          name = text.textContent.trim().toLowerCase();
        }
        
        const info = landmarkData[name] || {
          title: name.toUpperCase(),
          desc: "Lokasi strategis di Surabaya Command Center.",
          status: "Normal",
          color: "var(--success)"
        };
        
        if (landmarkTitle) landmarkTitle.textContent = info.title;
        if (landmarkDesc) landmarkDesc.textContent = info.desc;
        if (landmarkStatus) {
          landmarkStatus.textContent = info.status;
          landmarkStatus.style.color = info.color;
        }
        
        landmarkCard.classList.remove("is-hidden");
        playSound('success');
      }
    });
    
    if (btnCloseLandmark) {
      btnCloseLandmark.addEventListener("click", () => {
        landmarkCard.classList.add("is-hidden");
        playSound('click');
      });
    }
  }
}
setupLandmarkClicks();

// 5. CCTV Filters (Color Matrix Effects)
const filterModeButtons = document.querySelectorAll(".filter-mode-btn");
if (filterModeButtons.length > 0) {
  filterModeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      filterModeButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const filterType = btn.dataset.filter || "none";
      playSound('click');
      
      const cameraBoxes = document.querySelectorAll(".camera-box");
      cameraBoxes.forEach(box => {
        if (filterType === "mono") {
          box.style.filter = "grayscale(100%) contrast(1.1)";
        } else if (filterType === "night") {
          box.style.filter = "brightness(1.2) contrast(1.2) hue-rotate(80deg)";
        } else if (filterType === "thermal") {
          box.style.filter = "invert(1) hue-rotate(180deg) saturate(2.5)";
        } else {
          box.style.filter = "none";
        }
      });
      
      showToast(`Filter video CCTV: ${btn.textContent}`);
    });
  });
}

// 6. Bounding Box Confidence Threshold Slider
const cctvThresholdRange = document.getElementById("cctvThresholdRange");
const thresholdVal = document.getElementById("thresholdVal");
if (cctvThresholdRange && thresholdVal) {
  const updateThreshold = () => {
    const threshold = parseInt(cctvThresholdRange.value);
    thresholdVal.textContent = `${threshold}%`;
    
    const cvRects = document.querySelectorAll(".cv-rect");
    cvRects.forEach(rect => {
      const tag = rect.querySelector(".cv-tag");
      if (tag) {
        const match = tag.textContent.match(/(\d+)%/);
        if (match) {
          const conf = parseInt(match[1]);
          if (conf < threshold) {
            rect.style.opacity = "0";
            rect.style.pointerEvents = "none";
            rect.style.transform = "scale(0.85)";
          } else {
            rect.style.opacity = "1";
            rect.style.pointerEvents = "auto";
            rect.style.transform = "scale(1)";
          }
        }
      }
    });
  };

  cctvThresholdRange.addEventListener("input", updateThreshold);
  updateThreshold();
}

// 7. Intersections Grid/Cards Layout Switcher
const btnToggleLayout = document.getElementById("btnToggleIntersectionsLayout");
const intersectionsPanel = document.getElementById("intersections");
if (btnToggleLayout && intersectionsPanel) {
  let gridContainer = document.getElementById("intersectionsGridContainer");
  if (!gridContainer) {
    gridContainer = document.createElement("div");
    gridContainer.id = "intersectionsGridContainer";
    gridContainer.style.display = "none";
    gridContainer.style.gridTemplateColumns = "repeat(auto-fill, minmax(220px, 1fr))";
    gridContainer.style.gap = "14px";
    gridContainer.style.marginTop = "14px";
    intersectionsPanel.appendChild(gridContainer);
  }
  
  btnToggleLayout.addEventListener("click", () => {
    playSound('switch');
    const isGrid = gridContainer.style.display === "none";
    gridContainer.style.display = isGrid ? "grid" : "none";
    const tableWrap = intersectionsPanel.querySelector(".table-wrap");
    if (tableWrap) {
      tableWrap.style.display = isGrid ? "none" : "block";
    }
    
    if (isGrid) {
      gridContainer.innerHTML = "";
      const rows = intersectionsPanel.querySelectorAll("tbody tr");
      rows.forEach(row => {
        const name = row.cells[0].textContent;
        const status = row.cells[1].textContent;
        const densitySpan = row.cells[2].querySelector(".tag");
        const densityText = densitySpan ? densitySpan.textContent : "Low";
        const densityClass = densitySpan ? densitySpan.className : "tag tag-low";
        const waitTime = row.cells[3].textContent;
        
        const card = document.createElement("div");
        card.className = "intersection-grid-card glass-soft";
        card.innerHTML = `
          <h3 style="margin: 0; font-size: 13px; font-weight: 800; color: var(--primary-2);">${name}</h3>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
            <span>Status: <strong>${status}</strong></span>
            <span class="${densityClass}">${densityText}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
            <span>Waktu Tunggu:</span>
            <strong>${waitTime}</strong>
          </div>
        `;
        gridContainer.appendChild(card);
      });
      showToast("Tampilan Simpang diubah ke mode GRID.");
    } else {
      showToast("Tampilan Simpang diubah ke mode TABEL.");
    }
  });
}

// 8. Device Config Slide-out Drawer & Node Jetson Diagnostics
const deviceRows = document.querySelectorAll(".clickable-device-row");
const deviceDrawer = document.getElementById("deviceDrawerConfig");
const closeDeviceDrawer = document.getElementById("closeDeviceDrawer");

if (deviceDrawer) {
  deviceRows.forEach(row => {
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      
      playSound('click');
      const deviceId = row.dataset.device;
      const name = row.cells[1].textContent;
      
      const cfgName = document.getElementById("cfgDeviceName");
      if (cfgName) cfgName.value = `${deviceId} - ${name}`;
      
      const temp = Math.floor(48 + Math.random() * 18);
      const gpu = Math.floor(25 + Math.random() * 60);
      const ram = (4.2 + Math.random() * 2.8).toFixed(1);
      const fan = Math.floor(40 + Math.random() * 35);
      
      const diagTemp = document.getElementById("diagTemp");
      const diagGpu = document.getElementById("diagGpu");
      const diagRam = document.getElementById("diagRam");
      const diagFan = document.getElementById("diagFan");
      
      if (diagTemp) diagTemp.textContent = `${temp}°C`;
      if (diagGpu) diagGpu.textContent = `${gpu}%`;
      if (diagRam) diagRam.textContent = `${ram} GB / 8.0 GB`;
      if (diagFan) diagFan.textContent = `${fan}% RPM`;
      
      deviceDrawer.classList.add("open");
      showToast(`Membuka konfigurasi node: ${deviceId}`);
      if (typeof updateAndDrawLatency === "function") {
        updateAndDrawLatency();
        if (window.latencyInterval) clearInterval(window.latencyInterval);
        window.latencyInterval = setInterval(updateAndDrawLatency, 1000);
      }
    });
  });
  
  if (closeDeviceDrawer) {
    closeDeviceDrawer.addEventListener("click", () => {
      deviceDrawer.classList.remove("open");
      playSound('click');
      if (window.latencyInterval) {
        clearInterval(window.latencyInterval);
        window.latencyInterval = null;
      }
    });
  }
  
  const configForm = document.getElementById("deviceConfigForm");
  if (configForm) {
    configForm.addEventListener("submit", (e) => {
      e.preventDefault();
      deviceDrawer.classList.remove("open");
      playSound('success');
      showToast("Konfigurasi parameter Node Edge AI berhasil disimpan.");
    });
  }
}

// 9. Retro Terminal Prompt Input CLI Command Parser
const terminalInput = document.getElementById("terminalCommandInput");
if (terminalInput && terminal) {
  terminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = terminalInput.value.trim();
      if (!val) return;
      
      playSound('click');
      terminalInput.value = "";
      
      const userLine = document.createElement("div");
      userLine.className = "terminal-line";
      userLine.style.color = "#a5f3fc";
      userLine.textContent = `SITS:~$ ${val}`;
      terminal.appendChild(userLine);
      
      const replyLine = document.createElement("div");
      replyLine.className = "terminal-line";
      
      const lowerVal = val.toLowerCase();
      if (lowerVal === "/help") {
        replyLine.innerHTML = `
          Daftar Perintah Terminal:<br/>
          &nbsp;&nbsp;/help - Tampilkan panduan ini<br/>
          &nbsp;&nbsp;/clear - Bersihkan log terminal<br/>
          &nbsp;&nbsp;/ping [node_id] - Uji koneksi ke Edge AI node (contoh: /ping NODE-EDGE-01)<br/>
          &nbsp;&nbsp;/chaos - Aktifkan / Matikan mode keos darurat lalu lintas<br/>
          &nbsp;&nbsp;/status - Cek status kesehatan telemetri Surabaya
        `;
      } else if (lowerVal === "/clear") {
        terminal.innerHTML = "";
        return;
      } else if (lowerVal.startsWith("/ping")) {
        const parts = val.split(" ");
        const node = parts[1] || "ALL NODES";
        replyLine.textContent = `PINGING ${node.toUpperCase()} ... [SUCCESS] RTT: ${Math.floor(8 + Math.random() * 15)}ms`;
        replyLine.style.color = "var(--success)";
      } else if (lowerVal === "/chaos") {
        const btnChaos = document.getElementById("btnToggleChaos");
        if (btnChaos) {
          btnChaos.click();
          replyLine.textContent = `CHAOS MODE TOGGLED. Status: ${isChaosMode ? "ACTIVE (SYSTEM ALERT)" : "RESOLVED (NORMAL)"}`;
          replyLine.style.color = isChaosMode ? "var(--danger)" : "var(--success)";
        }
      } else if (lowerVal === "/status") {
        replyLine.innerHTML = `
          SITS Status Report Surabaya:<br/>
          &nbsp;&nbsp;- Uptime: 99.7%<br/>
          &nbsp;&nbsp;- Active Nodes: 4 / 4<br/>
          &nbsp;&nbsp;- IoT Sensors connected: 312<br/>
          &nbsp;&nbsp;- DB sync: synchronized (OK)<br/>
          &nbsp;&nbsp;- System load: normal
        `;
        replyLine.style.color = "var(--success)";
      } else {
        replyLine.textContent = `Unknown command "${val}". Type /help for list of commands.`;
        replyLine.style.color = "var(--danger)";
      }
      
      terminal.appendChild(replyLine);
      terminal.scrollTop = terminal.scrollHeight;
    }
  });
}

// 10. API Gateway Payload JSON Validation & Sandbox Presets
const apiEditor = document.getElementById("apiPayloadEditor");
const validateTag = document.getElementById("apiJsonValidateTag");
if (apiEditor && validateTag) {
  const apiEndpoint = document.getElementById("apiEndpoint");
  
  function updateEditorPayload() {
    const ep = apiEndpoint.value;
    let defaultJson = "{}";
    if (ep === "/sits/api/v1/telemetry") {
      defaultJson = JSON.stringify({ corridor: "ahmad_yani", detailed: true, limit: 10 }, null, 2);
    } else if (ep === "/sits/api/v1/incidents") {
      defaultJson = JSON.stringify({ severity: "high", include_resolved: false }, null, 2);
    } else if (ep === "/sits/api/v1/preemption") {
      defaultJson = JSON.stringify({ responder_id: "AMBULANCE-02", preemption_level: "critical" }, null, 2);
    }
    apiEditor.value = defaultJson;
    validateJson();
  }
  
  function validateJson() {
    try {
      JSON.parse(apiEditor.value);
      validateTag.textContent = "JSON VALID";
      validateTag.className = "valid";
    } catch (err) {
      validateTag.textContent = "JSON INVALID";
      validateTag.className = "invalid";
    }
  }
  
  apiEndpoint.addEventListener("change", updateEditorPayload);
  apiEditor.addEventListener("input", validateJson);
  
  setTimeout(updateEditorPayload, 200);
}

// 11. Settings Volume, Alert Tone, & Ambient hum soundscapes
let ambientOsc = null;
let ambientGain = null;
let ambientInterval = null;

const chkAmbient = document.getElementById("chkAmbientSoundscape");
const volumeRange = document.getElementById("audioVolumeRange");
const toneSelector = document.getElementById("audioToneSelector");

let systemVolume = 0.7;
let alertToneType = "cyber";

if (volumeRange) {
  volumeRange.addEventListener("input", () => {
    systemVolume = parseFloat(volumeRange.value) / 100;
    if (ambientGain) {
      ambientGain.gain.setValueAtTime(systemVolume * 0.08, audioCtx.currentTime);
    }
  });
}
if (toneSelector) {
  toneSelector.addEventListener("change", () => {
    alertToneType = toneSelector.value;
    playSound('success');
  });
}

function playSelectedSound(type) {
  if (!audioEnabled) return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  const vol = systemVolume * 0.05;
  
  if (type === 'click' || type === 'hover') {
    if (alertToneType === "click") {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(type === 'hover' ? 1800 : 1500, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.03);
      gain.gain.setValueAtTime(vol * 0.4, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.03);
    } else if (alertToneType === "cyber") {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'hover' ? 1200 : 900, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1800, audioCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(vol * 0.4, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.05);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(type === 'hover' ? 800 : 600, audioCtx.currentTime);
      gain.gain.setValueAtTime(vol * 0.25, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.04);
    }
  } else if (type === 'success') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.08);
    osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.16);
    gain.gain.setValueAtTime(vol * 0.8, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } else if (type === 'warning') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(260, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(vol * 1.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } else if (type === 'switch') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(180, audioCtx.currentTime + 0.06);
    gain.gain.setValueAtTime(vol * 0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.06);
  }
}
window.playSound = playSelectedSound;

function startAmbientSoundscape() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  ambientOsc = audioCtx.createOscillator();
  ambientGain = audioCtx.createGain();
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(120, audioCtx.currentTime);
  
  ambientOsc.type = "sine";
  ambientOsc.frequency.setValueAtTime(55, audioCtx.currentTime);
  
  ambientOsc.connect(filter);
  filter.connect(ambientGain);
  ambientGain.connect(audioCtx.destination);
  
  ambientGain.gain.setValueAtTime(systemVolume * 0.08, audioCtx.currentTime);
  ambientOsc.start();
  
  ambientInterval = setInterval(() => {
    if (!audioEnabled) return;
    const tone = audioCtx.createOscillator();
    const tGain = audioCtx.createGain();
    
    tone.connect(tGain);
    tGain.connect(audioCtx.destination);
    
    tone.type = "sine";
    const randomPitch = 120 + Math.random() * 80;
    tone.frequency.setValueAtTime(randomPitch, audioCtx.currentTime);
    tGain.gain.setValueAtTime(0.003 * systemVolume, audioCtx.currentTime);
    tGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
    
    tone.start();
    tone.stop(audioCtx.currentTime + 1.2);
  }, 3800);
}

function stopAmbientSoundscape() {
  if (ambientOsc) {
    try {
      ambientOsc.stop();
    } catch(e){}
    ambientOsc = null;
  }
  if (ambientInterval) {
    clearInterval(ambientInterval);
    ambientInterval = null;
  }
}

if (chkAmbient) {
  chkAmbient.addEventListener("change", () => {
    if (chkAmbient.checked) {
      audioEnabled = true;
      const audioToggle = document.getElementById("audioToggle");
      if (audioToggle) {
        audioToggle.querySelector(".audio-icon").textContent = "🔊";
        audioToggle.classList.add("active");
      }
      startAmbientSoundscape();
      playSound('success');
      showToast("City Ambient Traffic Soundscape diaktifkan.");
    } else {
      stopAmbientSoundscape();
      showToast("City Ambient Traffic Soundscape dimatikan.");
    }
  });
}

// 12. Floating Collapsible Coordination Staff Team Chat with Premium Synthesized Sounds & Interactivity
const staffChatPanel = document.getElementById("staffChatPanel");
const staffChatHeader = document.getElementById("staffChatHeader");
const btnToggleChat = document.getElementById("btnToggleChatPanel");
const chatInputText = document.getElementById("chatInputText");
const btnSendChat = document.getElementById("btnSendChat");
const staffChatBody = document.getElementById("staffChatBody");
const chatTypingWrapper = document.getElementById("chatTypingWrapper");

let chatAudioMuted = false;

// Custom synthesizers for chat interaction
const playChatSound = (type = 'incoming') => {
  if (!audioEnabled || chatAudioMuted) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'outgoing') {
      // Outgoing mechanical "bubble pop" sound
      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(700, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.015, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } else if (type === 'incoming') {
      // Incoming tech-chime: dual high-pitch beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(987.77, audioCtx.currentTime); // B5
      gain.gain.setValueAtTime(0.015, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.004, audioCtx.currentTime + 0.08);
      osc.start();
      
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1318.51, audioCtx.currentTime + 0.08); // E6
      gain2.gain.setValueAtTime(0.015, audioCtx.currentTime + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc2.start(audioCtx.currentTime + 0.08);
      
      osc.stop(audioCtx.currentTime + 0.08);
      osc2.stop(audioCtx.currentTime + 0.25);
    }
  } catch (e) {
    console.warn("Audio Context error in chat:", e);
  }
};

window.highlightMapLocation = function(locName) {
  if (!locName) return;
  const nameLower = locName.toLowerCase();
  let cx = null, cy = null;
  
  if (nameLower.includes("wonokromo") || nameLower.includes("yani")) {
    cx = 452; cy = 338;
  } else if (nameLower.includes("tunjungan") || nameLower.includes("siola") || nameLower.includes("basuki")) {
    cx = 468; cy = 154;
  } else if (nameLower.includes("kertajaya")) {
    cx = 534; cy = 172;
  } else if (nameLower.includes("darmo")) {
    cx = 436; cy = 208;
  } else if (nameLower.includes("jemursari")) {
    cx = 464; cy = 438;
  } else if (nameLower.includes("sungkono")) {
    cx = 220; cy = 268;
  }
  
  if (cx === null || cy === null) {
    showToast(`Lokasi "${locName}" tidak ditemukan di peta.`);
    return;
  }
  
  showToast(`Menyorot ${locName} di Peta SITS...`);
  playChatSound('incoming');
  
  // Highlight node in all maps
  const nodes = document.querySelectorAll(`.signal-node[cx="${cx}"][cy="${cy}"]`);
  if (nodes.length > 0) {
    nodes.forEach(node => {
      node.classList.add("node-highlighted");
      setTimeout(() => {
        node.classList.remove("node-highlighted");
      }, 4500);
    });
  }
};

if (staffChatPanel && staffChatHeader) {
  const toggleChat = () => {
    staffChatPanel.classList.toggle("collapsed");
    if (btnToggleChat) {
      btnToggleChat.textContent = staffChatPanel.classList.contains("collapsed") ? "＋" : "—";
    }
    playSound('click');
  };
  
  staffChatHeader.addEventListener("click", toggleChat);
  
  // Toggle sound button
  const btnToggleChatSound = document.getElementById("btnToggleChatSound");
  if (btnToggleChatSound) {
    btnToggleChatSound.addEventListener("click", (e) => {
      e.stopPropagation();
      chatAudioMuted = !chatAudioMuted;
      btnToggleChatSound.classList.toggle("muted", chatAudioMuted);
      btnToggleChatSound.textContent = chatAudioMuted ? "🔇" : "🔊";
      playSound('click');
      showToast(chatAudioMuted ? "Suara koordinasi disenyapkan." : "Suara koordinasi diaktifkan.");
    });
  }

  // Active Dispatchers drawer
  const chatOnlinePanel = document.getElementById("chatOnlinePanel");
  const chatStatusMeta = document.getElementById("chatStatusMeta");
  const btnCloseOnlinePanel = document.getElementById("btnCloseOnlinePanel");
  
  if (chatStatusMeta && chatOnlinePanel) {
    chatStatusMeta.addEventListener("click", (e) => {
      e.stopPropagation();
      chatOnlinePanel.classList.add("open");
      playSound('click');
    });
  }
  if (btnCloseOnlinePanel && chatOnlinePanel) {
    btnCloseOnlinePanel.addEventListener("click", (e) => {
      e.stopPropagation();
      chatOnlinePanel.classList.remove("open");
      playSound('click');
    });
  }
  
  const autoReplies = [
    { sender: "Rian (Dishub)", msg: "Laporan diterima. Rute prioritas ambulance darurat terpantau aman.", initial: "R" },
    { sender: "SITS Bot", msg: "AI Signal override Wonokromo disetel +15 detik berdasarkan volume kepadatan.", initial: "S" },
    { sender: "Budi (Dishub)", msg: "Armada patroli Dishub sudah berada di frontage road Wonokromo.", initial: "B" },
    { sender: "Rian (Dishub)", msg: "Flyover Wonokromo mulai terurai, lancar ke arah selatan.", initial: "R" }
  ];
  
  const renderChatMessage = (sender, msg, isOutgoing = false) => {
    if (!staffChatBody) return;
    
    const row = document.createElement("div");
    row.className = `chat-message-row ${isOutgoing ? 'outgoing' : 'incoming'}`;
    
    const isRich = typeof msg === 'object';
    const initial = isOutgoing ? 'Z' : (sender.includes("SITS") ? 'S' : sender.charAt(0));
    
    const now = new Date();
    const timeFormatted = now.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    
    let bubbleContent = '';
    
    if (isRich && msg.type === 'radar') {
      row.classList.add('media-row');
      bubbleContent = `
        <span class="chat-bubble-sender">${sender}</span>
        <div class="chat-card">
          <div class="radar-preview-box">
            <div class="radar-grid"></div>
            <div class="radar-sweep"></div>
            <div class="radar-target" style="top: 35%; left: 55%;"></div>
            <div class="radar-crosshair"></div>
            <div class="radar-hud">CCTV-02 // ${msg.location.toUpperCase()}</div>
          </div>
          <div class="chat-card-content">
            <strong>CCTV-02 ${msg.location}</strong>
            <span>Ekor antrean terdeteksi +95m. Kecepatan rata-rata 12 km/jam.</span>
            <button class="quick-chip" type="button" style="width:100%; justify-content:center; margin-top:4px;" onclick="window.highlightMapLocation('${msg.location}')">📍 Lihat Lokasi</button>
          </div>
        </div>
      `;
    } else {
      let text = typeof msg === 'string' ? msg : JSON.stringify(msg);
      // Auto highlight location names as clickable buttons
      const locations = ["Wonokromo", "Darmo", "Kertajaya", "Jemursari", "Sungkono", "Ahmad Yani"];
      locations.forEach(loc => {
        const regex = new RegExp(`\\b${loc}\\b`, 'gi');
        text = text.replace(regex, `<span style="text-decoration: underline; cursor: pointer; color: var(--primary-2); font-weight: 700;" onclick="window.highlightMapLocation('${loc}')">$&</span>`);
      });
      
      bubbleContent = `
        <span class="chat-bubble-sender">${sender}</span>
        <span>${text}</span>
      `;
    }
    
    row.innerHTML = `
      <div class="chat-user-initials">${initial}</div>
      <div class="chat-bubble ${isRich ? 'rich-media' : ''}">
        ${bubbleContent}
        <span class="chat-bubble-meta">
          ${timeFormatted}
          ${isOutgoing ? '<span class="chat-bubble-ticks">✓✓</span>' : ''}
        </span>
      </div>
    `;
    
    staffChatBody.appendChild(row);
    staffChatBody.scrollTop = staffChatBody.scrollHeight;
  };
  
  // Initial messages
  setTimeout(() => {
    renderChatMessage("Zaki (Anda)", "Wonokromo termonitor padat keluar Margorejo.", true);
    setTimeout(() => {
      renderChatMessage("Rian (Dishub)", "Copy, pemadam SITS sudah meluncur rute Darmo.", false);
    }, 400);
  }, 100);
  
  const sendChatMessage = (customTxt = null, isRich = false, richPayload = null) => {
    const txt = customTxt ? customTxt.trim() : chatInputText.value.trim();
    if (!txt && !isRich) return;
    
    playChatSound('outgoing');
    if (!customTxt) chatInputText.value = "";
    
    if (isRich && richPayload) {
      renderChatMessage("Zaki (Anda)", richPayload, true);
    } else {
      renderChatMessage("Zaki (Anda)", txt, true);
    }
    
    // Simulate other dispatchers typing and replying
    setTimeout(() => {
      const reply = autoReplies[Math.floor(Math.random() * autoReplies.length)];
      
      // Show typing indicator
      if (chatTypingWrapper) {
        const initialsEl = chatTypingWrapper.querySelector(".typing-initials");
        const labelEl = chatTypingWrapper.querySelector(".typing-label");
        if (initialsEl) initialsEl.textContent = reply.initial;
        if (labelEl) labelEl.textContent = `${reply.sender.split(" ")[0]} sedang mengetik...`;
        chatTypingWrapper.classList.remove("is-hidden");
        staffChatBody.scrollTop = staffChatBody.scrollHeight;
      }
      
      setTimeout(() => {
        // Hide typing indicator
        if (chatTypingWrapper) {
          chatTypingWrapper.classList.add("is-hidden");
        }
        
        renderChatMessage(reply.sender, reply.msg, false);
        playChatSound('incoming');
      }, 1500); // typing duration
    }, 1200); // time before typing starts
  };
  
  if (btnSendChat) {
    btnSendChat.addEventListener("click", () => sendChatMessage());
  }
  if (chatInputText) {
    chatInputText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChatMessage();
    });
  }

  // Quick Action Chips Event Bindings
  const quickChips = document.querySelectorAll("#chatQuickSuggestions .quick-chip");
  if (quickChips.length > 0) {
    quickChips.forEach(chip => {
      chip.addEventListener("click", () => {
        const msg = chip.getAttribute("data-msg");
        sendChatMessage(msg);
      });
    });
  }

  // Attachment Button Simulator
  const btnChatAttach = document.getElementById("btnChatAttach");
  if (btnChatAttach) {
    btnChatAttach.addEventListener("click", () => {
      sendChatMessage(null, true, { type: 'radar', location: 'Wonokromo' });
      showToast("Radar Diagnostic Telemetry dikirim.");
    });
  }
  
  // Crisis sequence chat dispatchers
  window.triggerChaosChatSequence = function() {
    setTimeout(() => {
      if (chatTypingWrapper) {
        chatTypingWrapper.querySelector(".typing-initials").textContent = "B";
        chatTypingWrapper.querySelector(".typing-label").textContent = "Budi sedang mengetik...";
        chatTypingWrapper.classList.remove("is-hidden");
      }
      setTimeout(() => {
        if (chatTypingWrapper) chatTypingWrapper.classList.add("is-hidden");
        renderChatMessage("Budi (Dishub)", "⚠️ LAPORAN DARURAT: Terjadi insiden beruntun di frontage road Ahmad Yani! Lajur tersumbat total.", false);
        playChatSound('incoming');
      }, 1500);
    }, 1000);

    setTimeout(() => {
      if (chatTypingWrapper) {
        chatTypingWrapper.querySelector(".typing-initials").textContent = "R";
        chatTypingWrapper.querySelector(".typing-label").textContent = "Rian sedang mengetik...";
        chatTypingWrapper.classList.remove("is-hidden");
      }
      setTimeout(() => {
        if (chatTypingWrapper) chatTypingWrapper.classList.add("is-hidden");
        renderChatMessage("Rian (Dishub)", "Macet parah! Ekor antrean Ahmad Yani memanjang sampai Bundaran Waru. Zaki mohon override prioritas hijau Wonokromo!", false);
        playChatSound('incoming');
      }, 1500);
    }, 4500);

    setTimeout(() => {
      if (chatTypingWrapper) {
        chatTypingWrapper.querySelector(".typing-initials").textContent = "S";
        chatTypingWrapper.querySelector(".typing-label").textContent = "SITS Bot sedang mengetik...";
        chatTypingWrapper.classList.remove("is-hidden");
      }
      setTimeout(() => {
        if (chatTypingWrapper) chatTypingWrapper.classList.add("is-hidden");
        renderChatMessage("SITS Bot", "🤖 WARNING: Tingkat kepadatan Wonokromo melampaui 95%. AI menyarankan rekayasa prioritas darurat diaktifkan segera.", false);
        playChatSound('incoming');
      }, 1500);
    }, 8500);
  };

  window.triggerNormalChatSequence = function() {
    setTimeout(() => {
      if (chatTypingWrapper) {
        chatTypingWrapper.querySelector(".typing-initials").textContent = "B";
        chatTypingWrapper.querySelector(".typing-label").textContent = "Budi sedang mengetik...";
        chatTypingWrapper.classList.remove("is-hidden");
      }
      setTimeout(() => {
        if (chatTypingWrapper) chatTypingWrapper.classList.add("is-hidden");
        renderChatMessage("Budi (Dishub)", "✅ Evakuasi selesai. Roda dua sudah dipindahkan ke bahu jalan, jalur mulai dibersihkan.", false);
        playChatSound('incoming');
      }, 1500);
    }, 1000);

    setTimeout(() => {
      if (chatTypingWrapper) {
        chatTypingWrapper.querySelector(".typing-initials").textContent = "R";
        chatTypingWrapper.querySelector(".typing-label").textContent = "Rian sedang mengetik...";
        chatTypingWrapper.classList.remove("is-hidden");
      }
      setTimeout(() => {
        if (chatTypingWrapper) chatTypingWrapper.classList.add("is-hidden");
        renderChatMessage("Rian (Dishub)", "Frontage Ahmad Yani mengalir lancar. Rekayasa dicabut, terima kasih operator dashboard.", false);
        playChatSound('incoming');
      }, 1500);
    }, 4500);
  };
  
  staffChatPanel.classList.add("collapsed");
  if (btnToggleChat) btnToggleChat.textContent = "＋";
}

// 13. Keyboard Shortcuts visual guide modal and global listener bindings
const shortcutsModal = document.getElementById("keyboardShortcutsModal");
const btnShowShortcuts = document.getElementById("btnShowShortcuts");
const closeShortcutsModal = document.getElementById("closeShortcutsModal");

if (shortcutsModal) {
  const toggleShortcuts = (show) => {
    shortcutsModal.classList.toggle("show", show);
    playSound('click');
  };
  
  if (btnShowShortcuts) btnShowShortcuts.addEventListener("click", () => toggleShortcuts(true));
  if (closeShortcutsModal) closeShortcutsModal.addEventListener("click", () => toggleShortcuts(false));
  
  shortcutsModal.addEventListener("click", (e) => {
    if (e.target === shortcutsModal) toggleShortcuts(false);
  });
}

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  
  const key = e.key.toLowerCase();
  if (key === 'k') {
    const btnChaos = document.getElementById("btnToggleChaos");
    if (btnChaos) btnChaos.click();
  } else if (key === 't') {
    const btnTour = document.getElementById("btnQuickTour");
    if (btnTour) btnTour.click();
  } else if (key === 'm') {
    const mapNav = document.querySelector(".nav-item[data-view='map']");
    if (mapNav) mapNav.click();
  } else if (key === 'd') {
    const dashNav = document.querySelector(".nav-item[data-view='dashboard']");
    if (dashNav) dashNav.click();
  } else if (key === 'r') {
    const refreshBtn = document.querySelector("[data-action='refresh']");
    if (refreshBtn) refreshBtn.click();
  }
});

// 14. Incident Detailed Modal Viewer & category chips selector
const incidentModal = document.getElementById("incidentDetailModal");
const closeIncModal = document.getElementById("closeIncidentModal");
const btnIncClose = document.getElementById("btnIncidentClose");
const btnIncDispatch = document.getElementById("btnIncidentDispatch");

if (incidentModal) {
  const toggleIncModal = (show) => {
    incidentModal.classList.toggle("show", show);
    playSound('click');
  };
  
  if (closeIncModal) closeIncModal.addEventListener("click", () => toggleIncModal(false));
  if (btnIncClose) btnIncClose.addEventListener("click", () => toggleIncModal(false));
  
  if (btnIncDispatch) {
    btnIncDispatch.addEventListener("click", () => {
      toggleIncModal(false);
      playSound('success');
      showToast("Disposisi petugas lalu lintas Dishub dikirim ke pos terdekat.");
    });
  }
  
  window.openIncidentDetail = function(id) {
    const inc = activeIncidents.find(i => i.id === id);
    if (!inc) return;
    
    const heading = document.getElementById("incModalHeading");
    const badge = document.getElementById("incModalBadge");
    const location = document.getElementById("incModalLocation");
    const time = document.getElementById("incModalTime");
    const desc = document.getElementById("incModalDesc");
    
    if (heading) heading.textContent = inc.title;
    if (badge) {
      badge.textContent = inc.type.split(" ")[0];
      badge.className = inc.severity === "danger" ? "pill pill-danger" : "pill pill-warning";
    }
    if (location) location.textContent = inc.location;
    if (time) time.textContent = inc.timeAgo;
    if (desc) desc.textContent = inc.description;
    
    toggleIncModal(true);
  };
}
const incFilters = document.querySelectorAll("[data-inc-filter]");
if (incFilters.length > 0) {
  incFilters.forEach(chip => {
    chip.addEventListener("click", () => {
      incFilters.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentIncidentFilter = chip.dataset.incFilter;
      playSound('click');
      renderIncidentsHtml();
      showToast(`Filter log insiden: ${chip.textContent}`);
    });
  });
}

// 15. Export Telemetry (CSV & JSON) Data Exporter
function exportTelemetryData(format = 'json') {
  const data = {
    system: "SITS Command Center Surabaya",
    timestamp: new Date().toISOString(),
    metrics: {
      active_intersections: 126,
      congestion_index: document.querySelector(".stat-card:nth-child(2) h2")?.textContent.trim() || "68/100",
      wait_time_seconds: document.querySelector(".stat-card:nth-child(3) h2")?.textContent.trim() || "42",
      emissions_reduction: document.querySelector(".stat-card:nth-child(7) h2")?.textContent.trim() || "18%",
      network_load: document.getElementById("networkLoad")?.textContent.trim() || "72%"
    },
    incidents: activeIncidents
  };
  
  let blob, filename;
  if (format === 'csv') {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Metric,Value\r\n";
    csvContent += `Active Intersections,${data.metrics.active_intersections}\r\n`;
    csvContent += `Congestion Index,${data.metrics.congestion_index}\r\n`;
    csvContent += `Average Wait Time,${data.metrics.wait_time_seconds}\r\n`;
    csvContent += `Emissions Reduction,${data.metrics.emissions_reduction}\r\n`;
    csvContent += `Network Load,${data.metrics.network_load}\r\n`;
    
    blob = new Blob([csvContent], { type: 'text/csv' });
    filename = "sits_telemetry_surabaya.csv";
  } else {
    blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    filename = "sits_telemetry_surabaya.json";
  }
  
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  playSound('success');
  showToast(`Telemetri SITS berhasil diekspor sebagai ${filename.toUpperCase()}.`);
  if (typeof addExportHistory === "function") {
    addExportHistory(filename, format);
  }
}

document.querySelectorAll("[data-action='export']").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportTelemetryData('json');
  });
});

// ESG Carbon Target Configurator Logic
function updateEsgProgress() {
  const progressFill = document.getElementById("esgProgressFill");
  const progressText = document.getElementById("esgProgressText");
  if (!progressFill || !progressText) return;

  const pct = Math.min(100, Math.max(0, Math.round((co2SavedVal / esgCo2Target) * 100)));
  progressText.textContent = `${pct}%`;
  progressFill.style.width = `${pct}%`;
}

function initEsgConfigurator() {
  const form = document.getElementById("esgConfigForm");
  const targetInput = document.getElementById("esgCo2TargetInput");
  if (!form || !targetInput) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const newTarget = parseInt(targetInput.value);
    if (isNaN(newTarget) || newTarget <= 0) {
      showToast("Target CO₂ tidak valid. Masukkan angka positif.");
      playSound("error");
      return;
    }
    
    esgCo2Target = newTarget;
    updateEsgProgress();
    playSound("success");
    showToast(`Target reduksi CO₂ berhasil diperbarui menjadi ${newTarget.toLocaleString("id-ID")} kg.`);
  });
}

// Initialise ESG Configurator and sync progress
initEsgConfigurator();
updateEsgProgress();

// ==========================================
// 20 NEW FEATURES JS LOGIC IMPLEMENTATION
// ==========================================

// 2. AI Voice Broadcast (Text-to-Speech Alert)
window.speakAlert = function(message) {
  const voiceEnabled = document.getElementById("chkVoiceAlerts")?.checked;
  if (voiceEnabled && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "id-ID";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("TTS Error: ", e);
    }
  }
};

// 10. Stacked Toast Alert System (Max 2, Auto-dismiss, Close button, iOS frosted glass)
window.showStackedToast = function(title, message, type = 'info') {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  
  // Enforce queue constraint: limit active visible toasts to MAXIMUM 2
  const activeToasts = stack.querySelectorAll(".stacked-toast:not(.hide)");
  if (activeToasts.length >= 2) {
    // Dismiss the oldest one smoothly
    const oldest = activeToasts[0];
    oldest.classList.remove("show");
    oldest.classList.add("hide");
    oldest.style.pointerEvents = "none";
    setTimeout(() => {
      if (oldest.parentNode) oldest.remove();
    }, 300);
  }
  
  const toastCard = document.createElement("div");
  toastCard.className = "stacked-toast";
  
  let icon = "⚡";
  if (type === 'danger' || type === 'error') {
    icon = "🚨";
    toastCard.style.borderColor = "rgba(239, 68, 68, 0.5)";
  } else if (type === 'warning') {
    icon = "⚠️";
    toastCard.style.borderColor = "rgba(245, 158, 11, 0.5)";
  } else if (type === 'success') {
    icon = "✅";
    toastCard.style.borderColor = "rgba(16, 185, 129, 0.5)";
  } else {
    icon = "ℹ️";
    toastCard.style.borderColor = "rgba(0, 229, 255, 0.4)";
  }
  
  toastCard.innerHTML = `
    <div class="stacked-toast-icon">${icon}</div>
    <div class="stacked-toast-body">
      <div class="stacked-toast-title">${title}</div>
      <div class="stacked-toast-message">${message}</div>
    </div>
    <button class="stacked-toast-close" type="button" aria-label="Tutup Notifikasi">&times;</button>
  `;
  
  let dismissTimer = null;

  const dismissToast = () => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    toastCard.classList.remove("show");
    toastCard.classList.add("hide");
    toastCard.style.pointerEvents = "none";
    setTimeout(() => {
      if (toastCard.parentNode) {
        toastCard.remove();
      }
    }, 300);
  };

  // Close button listener
  const btnClose = toastCard.querySelector(".stacked-toast-close");
  if (btnClose) {
    btnClose.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissToast();
    });
  }
  
  stack.appendChild(toastCard);
  void toastCard.offsetHeight; // trigger reflow
  toastCard.classList.add("show");
  
  const isSystemAlert = title.toLowerCase().includes("alert");
  if (!isSystemAlert) {
    if (type === 'danger' || type === 'error') {
      if (typeof playSound === "function") playSound('warning');
    } else {
      if (typeof playSound === "function") playSound('click');
    }
    
    // TTS Voice Broadcast
    if (type === 'danger' || type === 'warning') {
      if (typeof speakAlert === "function") speakAlert(`${title}. ${message}`);
    }
  }
  
  // Auto-dismiss after 4.5 seconds
  dismissTimer = setTimeout(dismissToast, 4500);
};

// Route default showToast into modern toast stack
const originalShowToast = window.showToast;
window.showToast = function(msg, customType = null) {
  if (!msg) return;
  const msgLower = msg.toLowerCase();
  let type = customType || 'info';
  let title = 'Pemberitahuan Sistem';
  
  if (msgLower.includes("keos") || msgLower.includes("gridlock") || msgLower.includes("bahaya") || msgLower.includes("terputus")) {
    type = 'danger';
    title = 'System Alert';
  } else if (msgLower.includes("prioritas") || msgLower.includes("hujan") || msgLower.includes("insiden") || msgLower.includes("padat") || msgLower.includes("peringatan")) {
    type = 'warning';
    title = 'Peringatan Lalu Lintas';
  } else if (msgLower.includes("berhasil") || msgLower.includes("sukses") || msgLower.includes("diaktifkan") || msgLower.includes("normal") || msgLower.includes("lancar")) {
    type = 'success';
    title = 'Operasi Berhasil';
  }
  
  showStackedToast(title, msg, type);
};

// 1. BMKG Weather Widget & AI Recommendation Adaptor
let weatherStates = [
  { temp: "32°C", icon: "☀️", status: "Cerah", text: "AI menjalankan fase normal." },
  { temp: "28°C", icon: "☁️", status: "Mendung", text: "AI mendeteksi mendung, memonitor jalan basah." },
  { temp: "24°C", icon: "🌧️", status: "Hujan Deras", text: "AI Hujan Aktif: Durasi hijau diselaraskan +15%." }
];
let currentIdx = 0;

function cycleWeather() {
  currentIdx = (currentIdx + 1) % weatherStates.length;
  const state = weatherStates[currentIdx];
  
  const wTemp = document.getElementById("weatherTemp");
  const wIcon = document.getElementById("weatherIcon");
  
  if (wTemp) wTemp.textContent = state.temp;
  if (wIcon) wIcon.textContent = state.icon;
  
  const recList = document.getElementById("aiRecommendationList");
  const confVal = document.getElementById("aiConfidenceVal");
  const confBar = document.getElementById("aiConfidenceBar");
  
  if (state.status === "Hujan Deras") {
    showStackedToast("BMKG Surabaya Info", "Hujan deras terdeteksi. AI menyesuaikan durasi hijau ATCS Surabaya.", "warning");
    if (recList) {
      recList.innerHTML = `
        <li>Selaraskan durasi hijau Simpang Wonokromo (+12s)</li>
        <li>Aktifkan antisipasi pengereman basah A. Yani</li>
        <li>Tingkatkan toleransi sensor radar simpang</li>
        <li>Dishub Siaga 1 koordinasi genangan air</li>
      `;
    }
    if (confVal) confVal.textContent = "96%";
    if (confBar) confBar.style.setProperty("--value", "96%");
  } else if (state.status === "Mendung") {
    showStackedToast("BMKG Surabaya Info", "Cuaca mendung terdeteksi di sekitar Wonokromo.", "info");
    if (recList) {
      recList.innerHTML = `
        <li>Mulai pemantauan sensor drainase kota</li>
        <li>Pertahankan cycle Darmo 80 detik</li>
        <li>Rekomendasikan siaga lampu darurat</li>
      `;
    }
    if (confVal) confVal.textContent = "91%";
    if (confBar) confBar.style.setProperty("--value", "91%");
  } else {
    // Normal / Cerah
    if (recList) {
      recList.innerHTML = `
        <li>Tambah hijau Wonokromo +12 detik</li>
        <li>Turunkan cycle Darmo menjadi 80 detik</li>
        <li>Aktifkan prioritas pedestrian Tunjungan</li>
        <li>Reduksi delay frontage A. Yani</li>
      `;
    }
    if (confVal) confVal.textContent = "92%";
    if (confBar) confBar.style.setProperty("--value", "92%");
  }
}
setInterval(cycleWeather, 15000); // cycle weather every 15 seconds

// 5. Leaderboard Kemacetan Koridor Surabaya
let corridors = [
  { id: 0, name: "1. Jl. Ahmad Yani", val: 83, stat: "danger" },
  { id: 1, name: "2. Jl. Raya Darmo", val: 61, stat: "warning" },
  { id: 2, name: "3. Jl. Tunjungan", val: 44, stat: "text" },
  { id: 3, name: "4. Jl. Kertajaya", val: 22, stat: "success" },
  { id: 4, name: "5. MERR Ir. Soekarno", val: 18, stat: "success" }
];

function updateLeaderboard() {
  corridors.forEach(c => {
    // Fluctuate
    let diff = Math.floor(Math.random() * 7) - 3;
    c.val = Math.max(5, Math.min(98, c.val + diff));
    
    if (c.val > 70) c.stat = "danger";
    else if (c.val > 40) c.stat = "warning";
    else c.stat = "success";
  });
  
  // Sort descending
  corridors.sort((a, b) => b.val - a.val);
  
  // Render
  const container = document.querySelector("#widgetLeaderboard .leaderboard-container");
  if (container) {
    container.innerHTML = corridors.map((c, idx) => {
      let colorClass = `var(--${c.stat})`;
      if (c.stat === "text") colorClass = "var(--text)";
      return `
        <div class="leaderboard-item" id="leadRoad-${c.id}" style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--panel-soft); border-radius:8px; font-size:11px; transition: all 0.3s var(--ease);">
          <span>${idx + 1}. ${c.name.split(". ")[1]}</span>
          <strong style="color:${colorClass};" class="lead-val">${c.val}%</strong>
        </div>
      `;
    }).join("");
  }
}
setInterval(updateLeaderboard, 2000);

// 8. Diagnostic Performance Chip (FPS counter)
let fps = 0;
let lastFpsUpdate = 0;
let frameCount = 0;
const perfChip = document.getElementById("perfChip");

function trackFps(timestamp) {
  if (!lastFpsUpdate) lastFpsUpdate = timestamp;
  frameCount++;
  
  if (timestamp - lastFpsUpdate >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastFpsUpdate = timestamp;
    
    // Update display chip
    if (perfChip) {
      const ping = Math.floor(10 + Math.random() * 15);
      const mem = Math.floor(410 + Math.random() * 60);
      const chipText = perfChip.querySelector(".perf-text");
      if (chipText) {
        chipText.textContent = `FPS: ${fps} | Latency: ${ping} ms | Memory: ${mem} MB`;
      }
      // Update dot based on load
      const dot = perfChip.querySelector(".perf-dot");
      if (dot) {
        if (fps < 30) {
          dot.style.background = "var(--danger)";
          dot.style.boxShadow = "0 0 6px var(--danger)";
        } else {
          dot.style.background = "var(--success)";
          dot.style.boxShadow = "0 0 6px var(--success)";
        }
      }
    }
  }
  requestAnimationFrame(trackFps);
}
requestAnimationFrame(trackFps);

// 9. Volume Control for Ambient Soundscape
let ambientVolume = 0.3;
const ambientVolumeRange = document.getElementById("ambientVolumeRange");
if (ambientVolumeRange) {
  ambientVolumeRange.addEventListener("input", () => {
    ambientVolume = parseFloat(ambientVolumeRange.value) / 100;
    if (ambientGain && audioCtx) {
      ambientGain.gain.setValueAtTime(ambientVolume * 0.08, audioCtx.currentTime);
    }
  });
}

// 13. Export History Logs widget helper
window.addExportHistory = function(filename, format) {
  const list = document.getElementById("exportHistoryList");
  if (!list) return;
  
  const emptyText = list.querySelector(".empty-history-text");
  if (emptyText) emptyText.remove();
  
  const item = document.createElement("div");
  item.style.display = "flex";
  item.style.justify = "space-between";
  item.style.alignItems = "center";
  item.style.padding = "6px 8px";
  item.style.background = "var(--panel-soft)";
  item.style.borderRadius = "6px";
  item.style.fontSize = "10px";
  item.style.border = "1px solid var(--border)";
  item.style.marginTop = "4px";
  
  const time = new Date().toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:2px;">
      <strong style="color:var(--text); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${filename}</strong>
      <span style="color:var(--text-muted); font-size:9px;">${time} • ${format.toUpperCase()}</span>
    </div>
    <button class="btn btn-ghost compact" style="font-size:9px; padding:2px 6px;" onclick="showToast('Mengunduh ulang berkas ${filename}'); playSound('success');">Unduh</button>
  `;
  list.prepend(item);
};

// 18. Real-Time Network Latency Line Chart (Canvas diagnostics)
window.latencyHistory = [12, 14, 18, 12, 11, 15, 13, 14, 16, 12];
window.latencyInterval = null;
const latencyCanvas = document.getElementById("deviceLatencyCanvas");

window.updateAndDrawLatency = function() {
  if (!latencyCanvas) return;
  
  // Fluctuate latency
  const nextPing = Math.floor(8 + Math.random() * 14);
  latencyHistory.push(nextPing);
  if (latencyHistory.length > 20) {
    latencyHistory.shift();
  }
  
  const ctx = latencyCanvas.getContext("2d");
  const w = latencyCanvas.width;
  const h = latencyCanvas.height;
  
  ctx.clearRect(0, 0, w, h);
  
  // Background grid
  ctx.strokeStyle = "rgba(0, 229, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 10; i < w; i += 30) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
  }
  for (let j = 10; j < h; j += 20) {
    ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(w, j); ctx.stroke();
  }
  
  // Draw Area Fill
  ctx.beginPath();
  const step = w / (latencyHistory.length - 1);
  latencyHistory.forEach((val, idx) => {
    const x = idx * step;
    const y = h - (val / 30) * (h - 10) - 5;
    if (idx === 0) ctx.moveTo(x, h);
    ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = "rgba(0, 229, 255, 0.05)";
  ctx.fill();
  
  // Draw path line
  ctx.beginPath();
  latencyHistory.forEach((val, idx) => {
    const x = idx * step;
    const y = h - (val / 30) * (h - 10) - 5;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "var(--primary-2, #00e5ff)";
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Last point pulsing dot
  const lastIdx = latencyHistory.length - 1;
  const lastX = lastIdx * step;
  const lastY = h - (latencyHistory[lastIdx] / 30) * (h - 10) - 5;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, 2 * Math.PI);
  ctx.fillStyle = "#ff0055";
  ctx.fill();
};

// 6. AI Command Palette (Terminal input command router)
const termInput = document.getElementById("terminalCommandInput");
const termLogs = document.getElementById("terminalLogs");

if (termInput && termLogs) {
  termInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const line = termInput.value.trim();
      termInput.value = "";
      if (!line) return;
      
      // Append input line
      const inputDiv = document.createElement("div");
      inputDiv.className = "terminal-line";
      inputDiv.innerHTML = `<span style="color:var(--primary-2)">SITS:~$</span> ${line}`;
      termLogs.appendChild(inputDiv);
      playSound('click');
      
      // Parse Command
      const parts = line.split(" ");
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ");
      
      const outDiv = document.createElement("div");
      outDiv.className = "terminal-line";
      outDiv.style.color = "#a5f3fc";
      
      if (cmd === "/chaos" || cmd === "chaos") {
        const btnChaos = document.getElementById("btnToggleChaos");
        if (btnChaos) {
          btnChaos.click();
          outDiv.textContent = "Sistem: Membalikkan status Mode Keos Surabaya.";
        }
      } else if (cmd === "/preempt" || cmd === "preempt") {
        if (!arg) {
          outDiv.textContent = "Syntax error. Gunakan: /preempt wonokromo | kertajaya | tunjungan";
        } else {
          const opt = arg.toLowerCase();
          const preemptForm = document.getElementById("preemptForm");
          const respRoute = document.getElementById("respRoute");
          if (preemptForm && respRoute) {
            if (opt.includes("wono")) {
              respRoute.value = "route-yani-darmo";
              preemptForm.dispatchEvent(new Event("submit"));
              outDiv.textContent = "Sistem: Mengoverride fase hijau Simpang Wonokromo.";
            } else if (opt.includes("kerta")) {
              respRoute.value = "route-kertajaya";
              preemptForm.dispatchEvent(new Event("submit"));
              outDiv.textContent = "Sistem: Mengoverride fase hijau Simpang Kertajaya.";
            } else if (opt.includes("tunj")) {
              respRoute.value = "route-tunjungan";
              preemptForm.dispatchEvent(new Event("submit"));
              outDiv.textContent = "Sistem: Mengoverride fase hijau Simpang Tunjungan.";
            } else {
              outDiv.textContent = `Error: simpang '${arg}' tidak ditemukan.`;
            }
          }
        }
      } else if (cmd === "/theme" || cmd === "theme") {
        const current = document.documentElement.dataset.theme;
        const targetTheme = arg.toLowerCase() === "dark" || arg.toLowerCase() === "light" ? arg.toLowerCase() : (current === "dark" ? "light" : "dark");
        if (typeof applyTheme === "function") {
          applyTheme(targetTheme);
          outDiv.textContent = `Sistem: Visual beralih ke ${targetTheme === "dark" ? "Mode Gelap" : "Mode Terang"}.`;
        }
      } else if (cmd === "/weather" || cmd === "weather") {
        if (arg.includes("hujan")) {
          currentIdx = 1; cycleWeather();
          outDiv.textContent = "Sistem: Modifikasi cuaca simulatip ke Hujan Deras.";
        } else if (arg.includes("mendung")) {
          currentIdx = 0; cycleWeather();
          outDiv.textContent = "Sistem: Modifikasi cuaca simulatip ke Mendung.";
        } else if (arg.includes("cerah")) {
          currentIdx = 2; cycleWeather();
          outDiv.textContent = "Sistem: Modifikasi cuaca simulatip ke Cerah.";
        } else {
          outDiv.textContent = "Syntax error. Gunakan: /weather cerah | mendung | hujan";
        }
      } else if (cmd === "/clear" || cmd === "clear") {
        termLogs.innerHTML = `<div class="terminal-line" style="color:var(--text-muted)">Terminal Logs cleared.</div>`;
        return;
      } else if (cmd === "/help" || cmd === "help" || cmd === "?") {
        outDiv.innerHTML = `
          Daftar perintah:<br>
          • <strong>/chaos</strong> : Aktifkan/nonaktifkan gridlock sistem<br>
          • <strong>/preempt [simpang]</strong> : Override prioritas darurat<br>
          • <strong>/theme [light|dark]</strong> : Ganti tema tampilan<br>
          • <strong>/weather [cerah|mendung|hujan]</strong> : Ganti status cuaca<br>
          • <strong>/clear</strong> : Bersihkan log konsol<br>
          • <strong>/help</strong> : Tampilkan menu bantuan
        `;
      } else {
        outDiv.textContent = `Error: Perintah '${cmd}' tidak dikenali. Ketik /help untuk daftar komando.`;
      }
      
      termLogs.appendChild(outDiv);
      termLogs.scrollTop = termLogs.scrollHeight;
    }
  });

  // Focus terminal input bar on pressing '/' key
  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== termInput && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault();
      const integrationNav = document.querySelector(".nav-item[data-view='integration']");
      if (integrationNav) integrationNav.click();
      setTimeout(() => {
        termInput.focus();
        showToast("AI Command Palette Terminal fokus.");
      }, 100);
    }
  });
}

// 14. Custom Map Right-Click Context Menu
const mapBoxEl = document.querySelector(".map-box");
const contextMenu = document.getElementById("mapContextMenu");

if (mapBoxEl && contextMenu) {
  mapBoxEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    contextMenu.style.display = "flex";
    playSound('click');
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#mapContextMenu")) {
      contextMenu.style.display = "none";
    }
  });

  contextMenu.querySelectorAll(".context-item").forEach(item => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      contextMenu.style.display = "none";
      playSound('click');
      if (action === "override-sinyal") {
        const respType = document.getElementById("respType");
        const respRoute = document.getElementById("respRoute");
        const respName = document.getElementById("respName");
        if (respType) respType.value = "Ambulans";
        if (respRoute) respRoute.value = "route-yani-darmo";
        if (respName) respName.value = "Ambulans Darurat SITS-01";
        
        const preemptForm = document.getElementById("preemptForm");
        if (preemptForm) {
          preemptForm.dispatchEvent(new Event("submit"));
        } else {
          showToast("Override sinyal darurat diaktifkan via Peta.");
        }
      } else if (action === "lapor-insiden") {
        showStackedToast("Laporan Diterima", "Insiden baru didaftarkan di koordinat terpilih via peta.", "warning");
      } else if (action === "zoom-simpang") {
        showToast("Membuka CCTV Zoom Simpang terdekat.");
        openCctvZoom("Simpang Wonokromo (CCTV-01)", 0);
      }
    });
  });
}

// 17. CCTV Fullscreen Zoom Viewer & Object Tracking simulation (Canvas loop)
const cctvModal = document.getElementById("cctvZoomModal");
const cctvCanvas = document.getElementById("cctvZoomCanvas");
const closeCctvModal = document.getElementById("closeCctvZoomModal");
let cctvZoomActive = false;
let cctvZoomLoopId = null;

// Vehicle bounding boxes details
let vehicles = [
  { x: 100, y: 120, w: 60, h: 40, speed: 2.5, label: "Mobil (98% confidence)", color: "rgba(16, 185, 129, 0.8)" },
  { x: 280, y: 180, w: 40, h: 30, speed: 3.2, label: "Motor (94% confidence)", color: "rgba(0, 229, 255, 0.8)" },
  { x: 450, y: 90, w: 100, h: 60, speed: 1.8, label: "Bus Suroboyo (99% confidence)", color: "rgba(245, 158, 11, 0.8)" }
];

window.openCctvZoom = function(title, index) {
  if (!cctvModal || !cctvCanvas) return;
  
  const mTitle = document.getElementById("zoomModalTitle");
  if (mTitle) mTitle.textContent = `Live CCTV Feed — ${title}`;
  
  cctvModal.style.display = "flex";
  cctvZoomActive = true;
  playSound('click');
  
  // Render loop
  const ctx = cctvCanvas.getContext("2d");
  const w = cctvCanvas.width;
  const h = cctvCanvas.height;
  
  function drawCctvTracking() {
    if (!cctvZoomActive) return;
    
    // Background simulated road scene
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, w, h);
    
    // Draw road markings
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 15]);
    ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
    ctx.setLineDash([]);
    
    // Update and draw vehicles
    vehicles.forEach(v => {
      v.x += v.speed * simSpeedMultiplier;
      if (v.x > w + 50) v.x = -v.w - 50;
      
      // Draw Bounding Box
      ctx.strokeStyle = v.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(v.x, v.y, v.w, v.h);
      
      // Draw Label Background
      ctx.fillStyle = v.color;
      ctx.font = "bold 9px 'Share Tech Mono', monospace";
      const txtWidth = ctx.measureText(v.label).width;
      ctx.fillRect(v.x - 1, v.y - 14, txtWidth + 6, 14);
      
      // Draw Label text
      ctx.fillStyle = "#02070e";
      ctx.fillText(v.label, v.x + 2, v.y - 4);
    });
    
    // Simulated scan overlay text
    ctx.fillStyle = "rgba(0, 229, 255, 0.8)";
    ctx.font = "9px 'Share Tech Mono', monospace";
    ctx.fillText("CV INFERENCE ENGINE: RESNET-50 ON JETSON ORIN", 15, h - 15);
    ctx.fillText(`SYSTEM STATUS: ONLINE | CYCLE STABLE | SPEEDx${simSpeedMultiplier}`, w - 240, h - 15);
    
    cctvZoomLoopId = requestAnimationFrame(drawCctvTracking);
  }
  
  drawCctvTracking();
};

if (closeCctvModal) {
  closeCctvModal.addEventListener("click", () => {
    cctvModal.style.display = "none";
    cctvZoomActive = false;
    cancelAnimationFrame(cctvZoomLoopId);
    playSound('click');
  });
}

// Hook CCTV grid items in live CCTV panel
document.querySelectorAll(".cctv-card").forEach((card, idx) => {
  card.style.cursor = "zoom-in";
  card.addEventListener("click", () => {
    const title = card.querySelector(".cctv-title")?.textContent.trim() || `CCTV Feed ${idx+1}`;
    openCctvZoom(title, idx);
  });
});

// 20. Interactive Quick Tour Guide Overlay
const tourOverlay = document.getElementById("quickTourOverlay");
const tourCard = document.getElementById("tourStepCard");
const btnTourPrev = document.getElementById("btnTourPrev");
const btnTourNext = document.getElementById("btnTourNext");
const tourTitle = document.getElementById("tourStepTitle");
const tourText = document.getElementById("tourStepText");
const tourIndicator = document.getElementById("tourStepIndicator");
const closeTourBtn = document.getElementById("btnCloseTour");

const tourSteps = [
  {
    title: "1. SITS Heartbeat Status (Topbar)",
    text: "Menunjukkan latensi ping & data sinkronisasi server Dinas Perhubungan Surabaya (Dishub) saat ini secara real-time.",
    target: ".sits-signal-chip",
    pos: { top: "90px", left: "calc(50% - 140px)" }
  },
  {
    title: "2. Estimasi Reduksi Emisi Carbon",
    text: "Pemberitahuan reduksi CO₂ digital yang terakumulasi setiap detik berkat optimalisasi sinyal cerdas ATCS.",
    target: ".stat-card.reveal-card:nth-child(7)",
    pos: { top: "310px", left: "calc(50% - 140px)" }
  },
  {
    title: "3. Leaderboard Kepadatan Koridor",
    text: "Tabulasi peringkat volume kemacetan jalan-jalan utama Surabaya secara real-time untuk penyesuaian lalu lintas cepat.",
    target: "#widgetLeaderboard",
    pos: { top: "420px", left: "20px" }
  },
  {
    title: "4. Live CCTV Grid Feed & CV AI",
    text: "Pencitraan lalu lintas Surabaya dengan overlay scanlines. Klik CCTV manapun untuk zoom modal dengan tracking deteksi AI.",
    target: "a[data-view='cctv']",
    pos: { top: "220px", left: "100px" }
  },
  {
    title: "5. Smart City Command Terminal",
    text: "Konsol telemetri Smart City. Tekan tombol '/' keyboard untuk membuka terminal ini dan eksekusi komando seperti /help.",
    target: "a[data-view='integration']",
    pos: { top: "260px", left: "100px" }
  }
];

let currentTourStep = 0;

function showTourStep(idx) {
  const step = tourSteps[idx];
  tourTitle.textContent = step.title;
  tourText.textContent = step.text;
  tourIndicator.textContent = `${idx + 1} / ${tourSteps.length}`;
  
  // Highlight target
  document.querySelectorAll(".tour-highlight").forEach(el => el.classList.remove("tour-highlight"));
  const el = document.querySelector(step.target);
  if (el) {
    el.classList.add("tour-highlight");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  
  // Position Step Card
  if (step.pos) {
    if (step.pos.top) tourCard.style.top = step.pos.top;
    if (step.pos.left) tourCard.style.left = step.pos.left;
  }
}

window.startQuickTour = function() {
  if (!tourOverlay) return;
  tourOverlay.style.display = "block";
  currentTourStep = 0;
  showTourStep(0);
  playSound('click');
};

const btnQuickTour = document.getElementById("btnQuickTour");
if (btnQuickTour) {
  btnQuickTour.addEventListener("click", () => {
    // Hide default simple tooltip helper if shown
    const tooltip = document.getElementById("quickTourTooltip");
    if (tooltip) tooltip.style.display = "none";
    startQuickTour();
  });
}

if (btnTourPrev) {
  btnTourPrev.addEventListener("click", () => {
    if (currentTourStep > 0) {
      currentTourStep--;
      showTourStep(currentTourStep);
      playSound('click');
    }
  });
}

if (btnTourNext) {
  btnTourNext.addEventListener("click", () => {
    if (currentTourStep < tourSteps.length - 1) {
      currentTourStep++;
      showTourStep(currentTourStep);
      playSound('click');
    } else {
      // Finished
      tourOverlay.style.display = "none";
      document.querySelectorAll(".tour-highlight").forEach(el => el.classList.remove("tour-highlight"));
      showStackedToast("Quick Tour Selesai", "Anda siap menggunakan fitur-fitur baru dashboard SITS Surabaya.", "success");
    }
  });
}

if (tourOverlay) {
  tourOverlay.addEventListener("click", (e) => {
    if (e.target === tourOverlay) {
      tourOverlay.style.display = "none";
      document.querySelectorAll(".tour-highlight").forEach(el => el.classList.remove("tour-highlight"));
    }
  });
}

// ==================== REAL LEAFLET.JS SURABAYA GEOSPATIAL MAP ====================

const mapLayerGroups = {
  'district-zones': null,
  'map-river': null,
  'road-glows': null,
  'minor-roads': null,
  'warn-points': null,
  'landmark-group': null
};

function initLeafletSurabayaMap() {
  const mapContainer = document.getElementById("map-surabaya");
  if (!mapContainer || typeof L === 'undefined') return;
  if (surabayaMap) {
    surabayaMap.invalidateSize();
    return;
  }

  // 1. Instantiate Leaflet Map centered at Surabaya
  surabayaMap = L.map('map-surabaya', {
    zoomControl: false,
    attributionControl: true
  }).setView([-7.2756, 112.7424], 13);

  // 2. Base Tile Layer (Clean Esri Canvas Light Gray Base - Free & Watermark-Free)
  const esriTileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';

  leafletTileLayer = L.tileLayer(esriTileUrl, {
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 17
  }).addTo(surabayaMap);

  // Initialize Layer Groups
  Object.keys(mapLayerGroups).forEach(key => {
    mapLayerGroups[key] = L.layerGroup().addTo(surabayaMap);
  });

  // 3. Draw Real Surabaya Corridors (Polylines with Status & Glowing Effect)
  drawSurabayaCorridors();

  // 4. Draw Kalimas River Waterway
  drawSurabayaRiver();

  // 5. Draw City District Zones
  drawSurabayaDistricts();

  // 6. Draw Incident Points (Kupang, Kertajaya)
  drawSurabayaIncidents();

  // 7. Draw Landmarks & CCTV Camera Points
  drawSurabayaLandmarksAndCctv();

  // 8. Draw Moving Emergency Vehicles (Ambulans 02 & Pemadam 04)
  drawMovingEmergencyVehicles();

  // Initial resize calculation
  setTimeout(() => {
    if (surabayaMap) surabayaMap.invalidateSize();
  }, 250);
}

function drawSurabayaCorridors() {
  if (!surabayaMap || !mapLayerGroups['road-glows']) return;

  const corridors = [
    {
      name: "Koridor Darmo - A. Yani",
      status: "Padat / Macet (14 km/jam)",
      color: "#ef4444",
      weight: 6,
      coords: [
        [-7.3450, 112.7285],
        [-7.3320, 112.7300],
        [-7.3180, 112.7320],
        [-7.3050, 112.7345],
        [-7.2920, 112.7370],
        [-7.2810, 112.7395],
        [-7.2710, 112.7410],
        [-7.2650, 112.7420]
      ]
    },
    {
      name: "Koridor MERR / Dr. Ir. H. Soekarno",
      status: "Lancar Jaya (52 km/jam)",
      color: "#22c55e",
      weight: 6,
      coords: [
        [-7.2480, 112.7850],
        [-7.2620, 112.7838],
        [-7.2780, 112.7825],
        [-7.2980, 112.7810],
        [-7.3220, 112.7795],
        [-7.3450, 112.7780]
      ]
    },
    {
      name: "Koridor Tunjungan - Pemuda",
      status: "Normal / Ramai (32 km/jam)",
      color: "#06b6d4",
      weight: 5,
      coords: [
        [-7.2550, 112.7375],
        [-7.2610, 112.7390],
        [-7.2635, 112.7420],
        [-7.2655, 112.7460],
        [-7.2680, 112.7520],
        [-7.2720, 112.7590]
      ]
    },
    {
      name: "Koridor HR Muhammad - Mayjen Sungkono",
      status: "Ramai Lancar (38 km/jam)",
      color: "#eab308",
      weight: 5,
      coords: [
        [-7.2915, 112.7330],
        [-7.2895, 112.7160],
        [-7.2875, 112.6970],
        [-7.2855, 112.6820],
        [-7.2830, 112.6680]
      ]
    }
  ];

  corridors.forEach(c => {
    const glowLine = L.polyline(c.coords, {
      color: c.color,
      weight: c.weight + 4,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round'
    });

    const coreLine = L.polyline(c.coords, {
      color: c.color,
      weight: c.weight,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    });

    const popupHtml = `
      <div class="ios-popup-card">
        <div class="ios-popup-header">
          <span class="cctv-live-tag"><span class="live-dot"></span> REALTIME SITS</span>
          <span class="ios-popup-subtitle">KORIDOR TRAFFIC</span>
        </div>
        <h4 class="ios-popup-title">🛣️ ${c.name}</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Status Koridor:</span>
            <span class="ios-info-value" style="color:${c.color}; font-weight:800;">${c.status}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Sistem Pengatur:</span>
            <span class="ios-info-value">ATCS Surabaya Integrated Traffic System</span>
          </div>
        </div>
      </div>
    `;

    coreLine.bindPopup(popupHtml);
    glowLine.bindPopup(popupHtml);

    mapLayerGroups['road-glows'].addLayer(glowLine);
    mapLayerGroups['road-glows'].addLayer(coreLine);
  });

  const minorRoads = [
    {
      name: "Jl. Diponegoro - Pasar Kembang",
      color: "#f59e0b",
      coords: [
        [-7.2960, 112.7340],
        [-7.2910, 112.7300],
        [-7.2780, 112.7260],
        [-7.2670, 112.7240],
        [-7.2560, 112.7230]
      ]
    },
    {
      name: "Akses Jembatan Suramadu",
      color: "#22c55e",
      coords: [
        [-7.2280, 112.7720],
        [-7.2080, 112.7700],
        [-7.1850, 112.7680]
      ]
    }
  ];

  minorRoads.forEach(mr => {
    const line = L.polyline(mr.coords, {
      color: mr.color,
      weight: 3.5,
      opacity: 0.75,
      dashArray: '6, 4'
    });
    line.bindTooltip(mr.name, { sticky: true });
    mapLayerGroups['minor-roads'].addLayer(line);
  });
}

function drawSurabayaRiver() {
  if (!surabayaMap || !mapLayerGroups['map-river']) return;

  const kalimasCoords = [
    [-7.2350, 112.7410],
    [-7.2480, 112.7400],
    [-7.2610, 112.7440],
    [-7.2670, 112.7490],
    [-7.2820, 112.7480],
    [-7.2980, 112.7380]
  ];

  const riverLine = L.polyline(kalimasCoords, {
    color: '#0284c7',
    weight: 5,
    opacity: 0.7,
    dashArray: '8, 4'
  });

  riverLine.bindTooltip("🌊 Aliran Sungai Kalimas Surabaya", { sticky: true });
  mapLayerGroups['map-river'].addLayer(riverLine);
}

function drawSurabayaDistricts() {
  if (!surabayaMap || !mapLayerGroups['district-zones']) return;

  const districts = [
    {
      name: "Surabaya Pusat",
      color: "#38bdf8",
      coords: [[-7.2500, 112.7300], [-7.2500, 112.7600], [-7.2800, 112.7600], [-7.2800, 112.7300]]
    },
    {
      name: "Surabaya Selatan",
      color: "#3b82f6",
      coords: [[-7.2800, 112.7150], [-7.2800, 112.7500], [-7.3400, 112.7500], [-7.3400, 112.7150]]
    },
    {
      name: "Surabaya Timur",
      color: "#10b981",
      coords: [[-7.2500, 112.7600], [-7.2500, 112.8000], [-7.3400, 112.8000], [-7.3400, 112.7600]]
    }
  ];

  districts.forEach(d => {
    const polygon = L.polygon(d.coords, {
      color: d.color,
      weight: 1,
      dashArray: '4, 4',
      fillColor: d.color,
      fillOpacity: 0.05
    });
    polygon.bindTooltip(`📍 Wilayah: ${d.name}`, { sticky: true });
    mapLayerGroups['district-zones'].addLayer(polygon);
  });
}

function drawSurabayaIncidents() {
  if (!surabayaMap || !mapLayerGroups['warn-points']) return;

  const incidents = [
    {
      id: "inc-kupang",
      name: "Simpang Kupang / Pasar Kembang",
      lat: -7.2650,
      lng: 112.7240,
      jenis: "Penyempitan Jalan Akibat Truk Mogok",
      est: "± 20 Menit (Derek On-Site)",
      petugas: "Bripka Rahmat (Satlantas) & Tim SITS"
    },
    {
      id: "inc-kertajaya",
      name: "Simpang Kertajaya Indah",
      lat: -7.2780,
      lng: 112.7680,
      jenis: "Genangan Air (12 cm) Lajur Kiri",
      est: "± 15 Menit (Pompa DPU-BMCK)",
      petugas: "Tim BPBD Surabaya & Dishub"
    }
  ];

  incidents.forEach(inc => {
    const customIcon = L.divIcon({
      className: 'custom-incident-div-icon',
      html: `<div class="leaflet-incident-marker" title="${inc.name}">⚠️</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([inc.lat, inc.lng], { icon: customIcon });
    
    marker.bindPopup(`
      <div class="ios-popup-card incident-popup">
        <div class="ios-popup-header alert">
          <span class="alert-pill">⚠️ INSIDEN LALU LINTAS</span>
          <span class="ios-popup-subtitle">SIAGA SITS 112</span>
        </div>
        <h4 class="ios-popup-title">${inc.name}</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Jenis Insiden:</span>
            <span class="ios-info-value highlight-red">${inc.jenis}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Status Penanganan:</span>
            <span class="ios-info-value highlight-amber">${inc.est} (${inc.petugas})</span>
          </div>
        </div>
      </div>
    `);

    mapLayerGroups['warn-points'].addLayer(marker);
  });
}

function drawSurabayaLandmarksAndCctv() {
  if (!surabayaMap || !mapLayerGroups['landmark-group']) return;

  // Optimized CCTV Positions (with coordinate offsets in North area to prevent overlaps)
  const cameras = [
    {
      name: "CCTV-01 Margorejo",
      lat: -7.3180,
      lng: 112.7320,
      ruas: "Jl. A. Yani → Wonokromo",
      status: "Padat Merayap (350m)",
      statusClass: "red",
      speed: "14 km/jam"
    },
    {
      name: "CCTV-02 Wonokromo",
      lat: -7.2985,
      lng: 112.7345,
      ruas: "Simpang Wonokromo → Darmo",
      status: "Ramai Lancar (120m)",
      statusClass: "yellow",
      speed: "28 km/jam"
    },
    {
      name: "CCTV-03 Tunjungan",
      lat: -7.2580,
      lng: 112.7365,
      ruas: "Jl. Tunjungan → Gubernur Suryo",
      status: "Padat Merayap (210m)",
      statusClass: "red",
      speed: "18 km/jam"
    },
    {
      name: "CCTV-04 MERR Kertajaya",
      lat: -7.2780,
      lng: 112.7825,
      ruas: "MERR → Kenjeran",
      status: "Lancar Jaya (Bebas)",
      statusClass: "green",
      speed: "54 km/jam"
    }
  ];

  cameras.forEach((cam, idx) => {
    const cctvIcon = L.divIcon({
      className: 'custom-cctv-div-icon',
      html: `<div class="leaflet-cctv-marker">📷 ${cam.name}</div>`,
      iconSize: [120, 24],
      iconAnchor: [60, 12]
    });

    const marker = L.marker([cam.lat, cam.lng], { icon: cctvIcon });
    
    marker.bindPopup(`
      <div class="ios-popup-card cctv-popup">
        <div class="ios-popup-header">
          <span class="cctv-live-tag"><span class="live-dot"></span> LIVE SITS</span>
          <span class="ios-popup-subtitle">CCTV MONITORING</span>
        </div>
        <h4 class="ios-popup-title">📷 ${cam.name}</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Nama Simpang:</span>
            <span class="ios-info-value">${cam.name}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Status Antrean:</span>
            <span class="ios-info-value status-badge ${cam.statusClass}">${cam.status}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Ruas & Arah Jalur:</span>
            <span class="ios-info-value">${cam.ruas}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Kecepatan Rata-rata:</span>
            <span class="ios-info-value speed-val">${cam.speed}</span>
          </div>
        </div>
        <div class="ios-popup-video-box">
          <div class="video-overlay-bar">
            <span>FEED: CAM-#0${idx+1}</span>
            <span class="tech-mono">ONLINE // 1080P 30FPS</span>
          </div>
          <div class="video-sim-wave"></div>
        </div>
      </div>
    `);

    mapLayerGroups['landmark-group'].addLayer(marker);
  });

  // Optimized Landmark Positions (with offsets in Pusat/Tunjungan/Soetomo area)
  const landmarks = [
    { name: "🏥 RSUD Dr. Soetomo", lat: -7.2690, lng: 112.7635 },
    { name: "🏬 Tunjungan Plaza", lat: -7.2635, lng: 112.7410 },
    { name: "🏛️ Balaikota Surabaya", lat: -7.2660, lng: 112.7525 },
    { name: "🚉 Stasiun Pasarturi", lat: -7.2480, lng: 112.7320 },
    { name: "🌳 Taman Bungkul", lat: -7.2885, lng: 112.7380 },
    { name: "🌉 Jembatan Suramadu", lat: -7.2080, lng: 112.7700 }
  ];

  landmarks.forEach(lm => {
    const lmIcon = L.divIcon({
      className: 'custom-lm-div-icon',
      html: `<div class="leaflet-landmark-marker">${lm.name}</div>`,
      iconSize: [120, 20],
      iconAnchor: [60, 10]
    });

    const marker = L.marker([lm.lat, lm.lng], { icon: lmIcon });
    marker.bindTooltip(lm.name, { sticky: true });
    mapLayerGroups['landmark-group'].addLayer(marker);
  });
}

function drawMovingEmergencyVehicles() {
  if (!surabayaMap) return;

  const pathAmbulance = [
    [-7.3320, 112.7300],
    [-7.3180, 112.7320],
    [-7.3050, 112.7345],
    [-7.2920, 112.7370],
    [-7.2810, 112.7395],
    [-7.2710, 112.7410],
    [-7.2690, 112.7580]
  ];

  const pathFire = [
    [-7.2895, 112.7160],
    [-7.2875, 112.6970],
    [-7.2855, 112.6820],
    [-7.2875, 112.6970]
  ];

  const ambIcon = L.divIcon({
    className: 'custom-veh-div-icon',
    html: `<div class="leaflet-vehicle-pill ambulance"><span class="v-icon">🚑</span><span>Ambulans 02</span><span class="v-speed-badge">62 km/j</span></div>`,
    iconSize: [120, 26],
    iconAnchor: [60, 13]
  });

  const ambMarker = L.marker(pathAmbulance[0], { icon: ambIcon }).addTo(surabayaMap);
  ambMarker.bindPopup(`
    <div class="ios-popup-card vehicle-popup">
      <div class="ios-popup-header">
        <span class="cctv-live-tag" style="background: rgba(239, 68, 68, 0.2); color: #ef4444;"><span class="live-dot" style="background:#ef4444;"></span> DARURAT</span>
        <span class="ios-popup-subtitle">RESPON DINI SITS</span>
      </div>
      <h4 class="ios-popup-title">🚑 Ambulans 02</h4>
      <div class="ios-popup-info-grid">
        <div class="ios-info-row">
          <span class="ios-info-label">Kecepatan:</span>
          <span class="ios-info-value speed-val" style="color:#ef4444; font-weight:800;">62 km/jam</span>
        </div>
        <div class="ios-info-row">
          <span class="ios-info-label">Rute Tujuan:</span>
          <span class="ios-info-value">A. Yani → Darmo → RSU Dr. Soetomo</span>
        </div>
      </div>
    </div>
  `);

  const fireIcon = L.divIcon({
    className: 'custom-veh-div-icon',
    html: `<div class="leaflet-vehicle-pill fire"><span class="v-icon">🚒</span><span>Pemadam 04</span><span class="v-speed-badge">55 km/j</span></div>`,
    iconSize: [120, 26],
    iconAnchor: [60, 13]
  });

  const fireMarker = L.marker(pathFire[0], { icon: fireIcon }).addTo(surabayaMap);
  fireMarker.bindPopup(`
    <div class="ios-popup-card vehicle-popup">
      <div class="ios-popup-header">
        <span class="cctv-live-tag" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;"><span class="live-dot" style="background:#f59e0b;"></span> DARURAT</span>
        <span class="ios-popup-subtitle">RESPON DINI PMK</span>
      </div>
      <h4 class="ios-popup-title">🚒 Pemadam 04</h4>
      <div class="ios-popup-info-grid">
        <div class="ios-info-row">
          <span class="ios-info-label">Kecepatan:</span>
          <span class="ios-info-value speed-val" style="color:#f59e0b; font-weight:800;">55 km/jam</span>
        </div>
        <div class="ios-info-row">
          <span class="ios-info-label">Rute Tujuan:</span>
          <span class="ios-info-value">Mayjen Sungkono → HR Muhammad</span>
        </div>
      </div>
    </div>
  `);

  let ambSeg = 0;
  let ambProgress = 0;
  let fireSeg = 0;
  let fireProgress = 0;

  if (vehicleAnimInterval) clearInterval(vehicleAnimInterval);

  vehicleAnimInterval = setInterval(() => {
    // Interpolasi Ambulans 02
    ambProgress += 0.04;
    if (ambProgress >= 1) {
      ambProgress = 0;
      ambSeg = (ambSeg + 1) % (pathAmbulance.length - 1);
    }
    const p1Amb = pathAmbulance[ambSeg];
    const p2Amb = pathAmbulance[ambSeg + 1];
    const latAmb = p1Amb[0] + (p2Amb[0] - p1Amb[0]) * ambProgress;
    const lngAmb = p1Amb[1] + (p2Amb[1] - p1Amb[1]) * ambProgress;
    ambMarker.setLatLng([latAmb, lngAmb]);

    // Interpolasi Pemadam 04
    fireProgress += 0.03;
    if (fireProgress >= 1) {
      fireProgress = 0;
      fireSeg = (fireSeg + 1) % (pathFire.length - 1);
    }
    const p1Fire = pathFire[fireSeg];
    const p2Fire = pathFire[fireSeg + 1];
    const latFire = p1Fire[0] + (p2Fire[0] - p1Fire[0]) * fireProgress;
    const lngFire = p1Fire[1] + (p2Fire[1] - p1Fire[1]) * fireProgress;
    fireMarker.setLatLng([latFire, lngFire]);
  }, 100);
}

// Auto Initialize Leaflet Map on Load if Container Exists
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (document.getElementById("map-surabaya")) {
      initLeafletSurabayaMap();
    }
  }, 300);
});

// ==================== 22. ALL REMAINING INTERACTIVE FEATURES ====================

// --- FEATURE 1: CCTV INTERACTIVE CONTROLS ---
document.addEventListener("DOMContentLoaded", () => {
  // CCTV Filter Mode buttons
  document.querySelectorAll(".filter-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.filter || "none";
      const cctvGrid = document.querySelector(".cctv-feed-grid");
      if (cctvGrid) {
        cctvGrid.classList.remove("cctv-filter-mono", "cctv-filter-night", "cctv-filter-thermal");
        if (mode !== "none") {
          cctvGrid.classList.add(`cctv-filter-${mode}`);
        }
      }
      if (typeof playSound === "function") playSound("click");
      if (typeof showStackedToast === "function") {
        showStackedToast("Filter CCTV Diubah", `Mode filter visual: ${mode.toUpperCase()}`, "info");
      }
    });
  });

  // Threshold CV slider
  const thresholdSlider = document.getElementById("cctvThresholdRange");
  const thresholdValText = document.getElementById("thresholdVal");
  if (thresholdSlider) {
    thresholdSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      if (thresholdValText) thresholdValText.textContent = `${val}%`;
      // Adjust visibility/opacity of bounding boxes
      document.querySelectorAll(".cv-rect").forEach(rect => {
        const tag = rect.querySelector(".cv-tag");
        if (tag) {
          const match = tag.textContent.match(/(\d+)%/);
          if (match) {
            const conf = parseInt(match[1]);
            if (conf < val) {
              rect.style.opacity = "0.15";
              rect.style.borderStyle = "dashed";
            } else {
              rect.style.opacity = "1";
              rect.style.borderStyle = "solid";
            }
          }
        }
      });
    });
  }

  // Jeda CCTV button
  const btnPlayPauseCctv = document.getElementById("btnPlayPauseCctv");
  if (btnPlayPauseCctv) {
    btnPlayPauseCctv.addEventListener("click", () => {
      window.isCctvPaused = !window.isCctvPaused;
      const isPaused = window.isCctvPaused;
      btnPlayPauseCctv.innerHTML = isPaused ? `<span class="btn-icon">▶</span> Putar` : `<span class="btn-icon">⏸</span> Jeda`;
      document.querySelectorAll(".camera-box").forEach(box => {
        box.classList.toggle("is-paused", isPaused);
      });
      if (typeof playSound === "function") playSound("click");
      if (typeof showStackedToast === "function") {
        showStackedToast("Status CCTV", isPaused ? "Streaming CCTV di-jeda (bingkai dibekukan)" : "Streaming CCTV dilanjutkan", isPaused ? "warning" : "success");
      }
    });
  }

  // --- FEATURE 2: SIGNAL INTELLIGENCE MODAL ---
  const signalIntelModal = document.getElementById("signalIntelModal");
  const closeSignalIntelModal = document.getElementById("closeSignalIntelModal");
  const chkGreenWave = document.getElementById("chkGreenWave");

  document.querySelectorAll('button[data-action="system-check"]').forEach(btn => {
    btn.addEventListener("click", () => {
      if (signalIntelModal) {
        signalIntelModal.style.display = "flex";
        signalIntelModal.classList.add("show");
      }
      if (typeof playSound === "function") playSound("click");
    });
  });

  if (closeSignalIntelModal) {
    closeSignalIntelModal.addEventListener("click", () => {
      if (signalIntelModal) {
        signalIntelModal.style.display = "none";
        signalIntelModal.classList.remove("show");
      }
    });
  }

  if (signalIntelModal) {
    signalIntelModal.addEventListener("click", (e) => {
      if (e.target === signalIntelModal) {
        signalIntelModal.style.display = "none";
        signalIntelModal.classList.remove("show");
      }
    });
  }

  // Auto updating APILL timers inside modal
  let apillTimerSec = 24;
  let apillStateWonokromo = "green";
  let isGreenWaveActive = false;

  setInterval(() => {
    if (isGreenWaveActive) return;
    
    apillTimerSec--;
    if (apillTimerSec <= 0) {
      if (apillStateWonokromo === "green") {
        apillStateWonokromo = "yellow";
        apillTimerSec = 3;
      } else if (apillStateWonokromo === "yellow") {
        apillStateWonokromo = "red";
        apillTimerSec = 25;
      } else {
        apillStateWonokromo = "green";
        apillTimerSec = 30;
      }
    }

    const wBadge = document.getElementById("wonokromoBadge");
    const wGreenTime = document.getElementById("wonokromoGreenTime");
    const wYellowTime = document.getElementById("wonokromoYellowTime");
    const wRedTime = document.getElementById("wonokromoRedTime");

    if (wBadge) {
      if (apillStateWonokromo === "green") {
        wBadge.textContent = `HIJAU (${apillTimerSec}s)`;
        wBadge.className = "status-badge green";
        if (wGreenTime) wGreenTime.textContent = `${apillTimerSec}s`;
        if (wYellowTime) wYellowTime.textContent = "0s";
        if (wRedTime) wRedTime.textContent = "0s";
      } else if (apillStateWonokromo === "yellow") {
        wBadge.textContent = `KUNING (${apillTimerSec}s)`;
        wBadge.className = "status-badge yellow";
        if (wGreenTime) wGreenTime.textContent = "0s";
        if (wYellowTime) wYellowTime.textContent = `${apillTimerSec}s`;
        if (wRedTime) wRedTime.textContent = "0s";
      } else {
        wBadge.textContent = `MERAH (${apillTimerSec}s)`;
        wBadge.className = "status-badge red";
        if (wGreenTime) wGreenTime.textContent = "0s";
        if (wYellowTime) wYellowTime.textContent = "0s";
        if (wRedTime) wRedTime.textContent = `${apillTimerSec}s`;
      }
    }

    const mBadge = document.getElementById("margorejoBadge");
    const mGreenTime = document.getElementById("margorejoGreenTime");
    const mRedTime = document.getElementById("margorejoRedTime");
    if (mBadge) {
      if (apillStateWonokromo === "green") {
        mBadge.textContent = `MERAH (${apillTimerSec}s)`;
        mBadge.className = "status-badge red";
        if (mRedTime) mRedTime.textContent = `${apillTimerSec}s`;
        if (mGreenTime) mGreenTime.textContent = "0s";
      } else {
        mBadge.textContent = `HIJAU (${apillTimerSec}s)`;
        mBadge.className = "status-badge green";
        if (mGreenTime) mGreenTime.textContent = `${apillTimerSec}s`;
        if (mRedTime) mRedTime.textContent = "0s";
      }
    }
  }, 1000);

  // Emergency Green Wave Toggle
  if (chkGreenWave) {
    chkGreenWave.addEventListener("change", (e) => {
      isGreenWaveActive = e.target.checked;
      const wBadge = document.getElementById("wonokromoBadge");
      const mBadge = document.getElementById("margorejoBadge");
      const wGreenTime = document.getElementById("wonokromoGreenTime");
      const mGreenTime = document.getElementById("margorejoGreenTime");

      if (isGreenWaveActive) {
        if (wBadge) {
          wBadge.textContent = "GREEN WAVE (HIJAU)";
          wBadge.className = "status-badge green";
        }
        if (mBadge) {
          mBadge.textContent = "GREEN WAVE (HIJAU)";
          mBadge.className = "status-badge green";
        }
        if (wGreenTime) wGreenTime.textContent = "∞";
        if (mGreenTime) mGreenTime.textContent = "∞";
        if (typeof playSound === "function") playSound("alert");
        if (typeof showStackedToast === "function") {
          showStackedToast("🚨 Emergency Green Wave Aktif!", "Sinyal koridor A. Yani - Darmo dikunci Hijau Permanen.", "danger");
        }
      } else {
        apillTimerSec = 20;
        apillStateWonokromo = "green";
        if (typeof playSound === "function") playSound("click");
        if (typeof showStackedToast === "function") {
          showStackedToast("Green Wave Dinonaktifkan", "Mode otomatisasi sinyal ATCS SITS Surabaya kembali normal.", "info");
        }
      }
    });
  }

  // --- FEATURE 3: NOTIFICATION DRAWER ---
  const notifToggle = document.getElementById("notifToggle");
  const notifDrawer = document.getElementById("notifDrawer");
  const notifDrawerBackdrop = document.getElementById("notifDrawerBackdrop");
  const closeNotifDrawer = document.getElementById("closeNotifDrawer");
  const notifBadgeCount = document.getElementById("notifBadgeCount");

  function openNotifDrawer() {
    if (notifDrawer) notifDrawer.classList.add("show");
    if (notifDrawerBackdrop) notifDrawerBackdrop.classList.add("show");
    if (typeof playSound === "function") playSound("click");
  }

  function closeNotifDrawerPanel() {
    if (notifDrawer) notifDrawer.classList.remove("show");
    if (notifDrawerBackdrop) notifDrawerBackdrop.classList.remove("show");
  }

  if (notifToggle) notifToggle.addEventListener("click", openNotifDrawer);
  if (closeNotifDrawer) closeNotifDrawer.addEventListener("click", closeNotifDrawerPanel);
  if (notifDrawerBackdrop) notifDrawerBackdrop.addEventListener("click", closeNotifDrawerPanel);

  // Handle "Tandai Selesai" incident item removal
  document.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("resolve-notif-btn")) {
      const cardId = e.target.dataset.notifId;
      const card = document.getElementById(cardId);
      if (card) {
        card.style.opacity = "0";
        card.style.transform = "translateX(20px)";
        card.style.transition = "all 0.3s ease";
        setTimeout(() => {
          card.remove();
          const remaining = document.querySelectorAll("#notifListContainer .notif-item-card").length;
          if (notifBadgeCount) {
            notifBadgeCount.textContent = remaining;
            if (remaining === 0) notifBadgeCount.style.display = "none";
          }
          if (typeof showStackedToast === "function") {
            showStackedToast("Insiden Diarsipkan", "Status insiden ditandai selesai oleh dispatcher.", "success");
          }
        }, 300);
      }
    }
  });

  // --- FEATURE 4: OFFICER COORDINATION CHAT POPOVER ---
  const staffChatPanel = document.getElementById("staffChatPanel");
  const staffChatHeader = document.getElementById("staffChatHeader");
  const btnToggleChatPanel = document.getElementById("btnToggleChatPanel");

  if (staffChatHeader) {
    staffChatHeader.addEventListener("click", () => {
      if (staffChatPanel) {
        staffChatPanel.classList.toggle("expanded");
        if (btnToggleChatPanel) {
          btnToggleChatPanel.textContent = staffChatPanel.classList.contains("expanded") ? "▼" : "▲";
        }
        if (typeof playSound === "function") playSound("click");
      }
    });
  }

  // --- FEATURE 5: GLOBAL THEME & AUDIO TOGGLE ---
  const btnThemeToggle = document.getElementById("themeToggle");
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
      const isDark = document.body.classList.toggle("dark-theme");
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      const icon = btnThemeToggle.querySelector(".theme-icon");
      if (icon) icon.textContent = isDark ? "☀" : "☾";
      if (typeof leafletTileLayer !== "undefined" && leafletTileLayer) {
        const darkUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
        const lightUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
        leafletTileLayer.setUrl(isDark ? darkUrl : lightUrl);
      }
      if (typeof playSound === "function") playSound("click");
      if (typeof showStackedToast === "function") {
        showStackedToast("Tema Sistem Diperbarui", isDark ? "Mengaktifkan Dark Theme Mode (Cyberpunk)" : "Mengaktifkan Light Theme Mode (Glassmorphism)", "info");
      }
    });
  }

  const btnAudioToggle = document.getElementById("audioToggle");
  if (btnAudioToggle) {
    btnAudioToggle.addEventListener("click", () => {
      window.audioEnabled = !window.audioEnabled;
      const isMuted = !window.audioEnabled;
      const icon = btnAudioToggle.querySelector(".audio-icon");
      if (icon) icon.textContent = isMuted ? "🔇" : "🔊";
      if (typeof showStackedToast === "function") {
        showStackedToast("Efek Suara SITS", isMuted ? "Suara alarm & sirine di-Mute" : "Efek suara & sirine di-Unmute", isMuted ? "warning" : "success");
      }
    });
  }
});

// --- CENTRALIZED REAL-TIME CLOCK & STAMP SYNCHRONIZER (1000ms) ---
function startCentralClockSync() {
  setInterval(() => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}:${seconds}`;
    const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
    
    const clockEl = document.getElementById("clock");
    const opTimeEl = document.getElementById("opTimeVal");
    
    if (clockEl) clockEl.textContent = `${timeStr} WIB`;
    if (opTimeEl) opTimeEl.textContent = `${hours}.${minutes} WIB`;
    
    // Sync CCTV camera overlay timestamps (.cctv-time)
    document.querySelectorAll(".cctv-time").forEach(el => {
      el.textContent = `${dateStr} ${timeStr}`;
    });
  }, 1000);
}
startCentralClockSync();

// --- LEAFLET MAP STABILITY RESIZE LISTENER ---
window.addEventListener('resize', () => {
  if (typeof surabayaMap !== 'undefined' && surabayaMap) {
    surabayaMap.invalidateSize();
  }
});

// --- DASHBOARD LIVE CCTV SWITCHER & AI RECOMMENDATION HANDLERS ---
const dashCctvSwitcher = document.getElementById("dashCctvSwitcher");
if (dashCctvSwitcher) {
  dashCctvSwitcher.addEventListener("click", (e) => {
    const btn = e.target.closest(".cctv-mini-btn");
    if (!btn) return;
    
    dashCctvSwitcher.querySelectorAll(".cctv-mini-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    
    const camNum = btn.dataset.cam;
    const camName = btn.dataset.name;
    const camSub = btn.dataset.sub;
    
    const titleEl = document.getElementById("dashCamTitle");
    const subEl = document.getElementById("dashCamSub");
    if (titleEl) titleEl.textContent = camName;
    if (subEl) subEl.textContent = camSub;
    
    // Trigger visual glitch transition
    const glitch = document.getElementById("dashCameraGlitch");
    if (glitch) {
      glitch.classList.add("show");
      setTimeout(() => glitch.classList.remove("show"), 350);
    }
    
    playSound('click');
    showToast(`Beralih ke feed ${btn.textContent}: ${camName}`);
  });
}

window.dismissAiRecommendation = function() {
  playSound('click');
  showToast("Rekomendasi AI diabaikan. Jadwal kalkulasi ulang siklus berikutnya dalam 60 detik.");
  const aiRecText = document.getElementById("aiRecText");
  if (aiRecText) {
    aiRecText.style.opacity = "0.45";
    setTimeout(() => {
      aiRecText.style.opacity = "1";
    }, 400);
  }
};







