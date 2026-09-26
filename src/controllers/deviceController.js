/**
 * OmniTRAF Surabaya - IoT Sensors & Edge Devices Controller
 * Mengelola pemantauan status perangkat IoT, ping transmisi sinyal,
 * canvas grafik latensi transmisi, dan konfigurasi parameter node hardware.
 * Berbasis Unified State, Realtime Synchronization, dan Deterministic Health Pipeline.
 */

import { soundManager } from '../core/soundManager.js';
import { SYSTEM_CONFIG } from '../config/systemConfig.js';
import { stateStore, updateDeviceState } from '../core/stateStore.js';
import { socketClient } from '../core/socketClient.js';
import { authManager } from '../core/authManager.js';

export class DeviceController {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this._isInitialized = false;
    this.selectedDeviceId = "NODE-EDGE-01";
    this._unsubscribeCallbacks = [];
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    console.info("🔌 [DeviceController] Menginisialisasi Edge Node Registry & Health Monitor...");

    this.canvas = document.getElementById("deviceLatencyCanvas") || document.getElementById("latencySparkCanvas");
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
    }

    // 1. Subscribe ke StateStore untuk update data secara reaktif
    const unDevices = stateStore.subscribe("state:devices", () => {
      this.render();
    });
    this._unsubscribeCallbacks.push(unDevices);

    // 2. Registrasi Socket.io listener untuk transisi konfigurasi
    const socket = socketClient.getSocket();
    if (socket) {
      socket.on('device:config-transition', (transitionData) => {
        this._handleConfigTransitionEvent(transitionData);
      });
    }

    // 3. Centralized Event Delegation untuk tabel & dashboard
    this._bindTableEvents();
    this._bindDrawerEvents();

    // Jalankan render awal
    this.render();
  }

  activate() {
    this.canvas = document.getElementById("deviceLatencyCanvas") || document.getElementById("latencySparkCanvas");
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
    }
    this._bindTableEvents();
    this._bindDrawerEvents();
    this.render();
  }

  /**
   * Render seluruh UI Device Management berdasarkan Snapshot StateStore murni
   */
  render() {
    const state = stateStore.getState();
    const devices = state.devices || [];

    if (devices.length === 0) return;

    // 1. Render Summary Cards di atas dashboard Device Management
    this._renderSummaryCards(devices);

    // 2. Render Tabel Device secara dinamis
    this._renderDeviceTable(devices);

    // 3. Jika drawer sedang terbuka, update datanya secara real-time
    this._updateDrawerDetailsLive(devices);
  }

  _renderSummaryCards(devices) {
    const totalCount = devices.length;
    const onlineCount = devices.filter(d => d.healthLevel === "HEALTHY" || d.healthLevel === "DEGRADED").length;
    
    // Hitung rata-rata CPU Load & Suhu untuk perangkat aktif
    let cpuSum = 0;
    let tempSum = 0;
    let activeDevicesCount = 0;

    devices.forEach(d => {
      if (d.healthLevel !== "OFFLINE") {
        cpuSum += d.cpuPercent || 0;
        tempSum += d.temperatureC || 0;
        activeDevicesCount++;
      }
    });

    const avgCpu = activeDevicesCount > 0 ? Math.round(cpuSum / activeDevicesCount) : 0;
    const avgTemp = activeDevicesCount > 0 ? Math.round(tempSum / activeDevicesCount) : 0;

    const summaryGrid = document.querySelector(".devices-summary-grid");
    if (summaryGrid) {
      const valElements = summaryGrid.querySelectorAll("strong");
      if (valElements.length >= 4) {
        valElements[0].textContent = `${totalCount} Perangkat`;
        valElements[1].innerHTML = `<span style="color:#22c55e;">${onlineCount} Online</span>`;
        valElements[2].textContent = `${avgCpu}% Load`;
        valElements[3].textContent = `${avgTemp}°C`;
      }
    }
  }

  _renderDeviceTable(devices) {
    const tbody = document.getElementById("deviceTableBody");
    if (!tbody) return;

    // Simpan scroll position tabel
    const scrollTop = tbody.parentElement ? tbody.parentElement.scrollTop : 0;

    let html = "";
    devices.forEach(dev => {
      // Tentukan status badge HTML
      let badgeHtml = "";
      if (dev.healthLevel === "HEALTHY") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#22c55e;"></span><span class="pulse-ring-inner" style="background:#22c55e;"></span></span><span style="color:#22c55e; font-weight:700;">HEALTHY</span>`;
      } else if (dev.healthLevel === "DEGRADED") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#f59e0b;"></span><span class="pulse-ring-inner" style="background:#f59e0b;"></span></span><span style="color:#f59e0b; font-weight:700;">DEGRADED</span>`;
      } else if (dev.healthLevel === "STALE") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#ef4444;"></span><span class="pulse-ring-inner" style="background:#ef4444;"></span></span><span style="color:#ef4444; font-weight:700;">STALE</span>`;
      } else { // OFFLINE
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#64748b;"></span><span class="pulse-ring-inner" style="background:#64748b;"></span></span><span style="color:#64748b; font-weight:700;">OFFLINE</span>`;
      }

      // Bar indikator CPU load
      const cpuColor = dev.cpuPercent > 80 ? 'load-orange' : 'load-green';
      const cpuBarHtml = `
        <div class="diag-bar-wrap">
          <div class="diag-bar-track">
            <div class="diag-bar-fill ${cpuColor}" style="width: ${dev.cpuPercent}%;"></div>
          </div>
          <span class="diag-val" style="font-family:'Share Tech Mono';">${dev.cpuPercent}%</span>
        </div>
      `;

      // Bar indikator suhu
      const tempColorClass = dev.temperatureC > 75 ? 'temp-warm-fill' : 'temp-cool-fill';
      const tempBadgeClass = dev.temperatureC > 75 ? 'temp-warm' : 'temp-cool';
      const tempBarHtml = `
        <div class="diag-temp-wrap">
          <div class="diag-temp-bar">
            <div class="diag-temp-fill ${tempColorClass}" style="width: ${Math.min(100, (dev.temperatureC / 100) * 100)}%;"></div>
          </div>
          <span class="badge-temp ${tempBadgeClass}" style="font-family:'Share Tech Mono';">${dev.temperatureC}°C</span>
        </div>
      `;

      // Sparkline SVG mini berbasis ring buffer history murni
      const history = dev.history || [12, 11, 14, 10, 13, 12];
      const minVal = Math.min(...history) || 1;
      const maxVal = Math.max(...history) || 50;
      const range = maxVal - minVal || 1;
      
      let points = "";
      const step = 50 / (history.length - 1 || 1);
      history.forEach((val, idx) => {
        const x = idx * step;
        const y = 13 - ((val - minVal) / range) * 11;
        points += `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
      });

      const sparklineHtml = `
        <svg viewBox="0 0 50 15" width="50" height="15" style="overflow:visible;">
          <path d="${points}" fill="none" stroke="${dev.healthLevel === 'OFFLINE' ? '#64748b' : dev.healthLevel === 'DEGRADED' ? '#f59e0b' : '#00e5ff'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      const inferenceRateText = dev.fps > 0 ? `${dev.fps} FPS` : dev.type.includes("PLC") ? "Active Telemetry" : "N/A";

      // Row layout HTML murni
      html += `
        <tr class="clickable-device-row ${this.selectedDeviceId === dev.deviceId ? 'active-row-highlight' : ''}" data-device="${dev.deviceId}" style="border-bottom:1px solid rgba(255,255,255,0.05); transition:background 0.2s;">
          <td><strong style="font-family:'Share Tech Mono'; color:#00e5ff;">${dev.deviceId}</strong></td>
          <td>
            <div style="font-weight:600;">${dev.deviceName}</div>
            <small style="color:#64748b; font-size:10px;">${dev.location}</small>
          </td>
          <td style="font-size:11px; color:#94a3b8;">${dev.type}</td>
          <td>${badgeHtml}</td>
          <td>${cpuBarHtml}</td>
          <td>${tempBarHtml}</td>
          <td class="device-ping" style="font-family:'Share Tech Mono';">${dev.healthLevel === 'OFFLINE' ? '--' : dev.latencyMs + ' ms'}</td>
          <td class="device-ping-spark">${sparklineHtml}</td>
          <td style="font-size:11px; font-family:'Share Tech Mono';">${inferenceRateText}</td>
          <td><button class="btn btn-ghost compact btn-ping-device-row" data-device="${dev.deviceId}" style="font-size:10px; padding:3px 8px;">Ping</button></td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    // Kembalikan scroll position
    if (tbody.parentElement) {
      tbody.parentElement.scrollTop = scrollTop;
    }
  }

  _bindTableEvents() {
    const tbody = document.getElementById("deviceTableBody");
    if (!tbody) return;

    // centralized click delegator
    tbody.addEventListener("click", (e) => {
      const pingBtn = e.target.closest(".btn-ping-device-row");
      const row = e.target.closest(".clickable-device-row");

      if (pingBtn) {
        e.stopPropagation();
        const devId = pingBtn.dataset.device;
        this.pingDevice(devId, pingBtn);
        return;
      }

      if (row) {
        const devId = row.dataset.device;
        this.selectDevice(devId);
        soundManager.play('click');
      }
    });

    // Bind Ping All button
    const btnPingAll = document.getElementById("btnPingAll");
    if (btnPingAll) {
      btnPingAll.addEventListener("click", async () => {
        btnPingAll.disabled = true;
        const origText = btnPingAll.textContent;
        btnPingAll.textContent = "Pinging All...";
        soundManager.play('click');

        const state = stateStore.getState();
        const devices = state.devices || [];

        // Ping sequential / concurrent limit
        for (const dev of devices) {
          try {
            await fetch(`/api/devices/ping?deviceId=${dev.deviceId}&actor=System-Scheduler`);
          } catch (err) {
            console.warn("Ping failed for", dev.deviceId);
          }
        }

        window.showToast("✓ Pemindaian Latensi Seluruh Node Berhasil Diselesaikan.");
        soundManager.play('success');
        btnPingAll.disabled = false;
        btnPingAll.textContent = origText;
      });
    }
  }

  async pingDevice(deviceId, btnElement = null) {
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.textContent = "Pinging...";
    }

    try {
      const res = await fetch(`/api/devices/ping?deviceId=${deviceId}&actor=Zaki Putra (Operator)`);
      const payload = await res.json();

      if (payload && payload.success) {
        const latency = payload.data.latencyMs;
        window.showToast(`✓ Ping ${deviceId} Sukses: ${latency} ms respon balik.`);
        soundManager.play('success');
      } else {
        throw new Error(payload?.error?.message || "Unknown error");
      }
    } catch (err) {
      window.showToast(`❌ Gagal ping ${deviceId}: ${err.message}`, "danger");
      soundManager.play('alert');
    } finally {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = "Ping";
      }
    }
  }

  selectDevice(deviceId) {
    this.selectedDeviceId = deviceId;
    
    // Highlight row active di tabel
    document.querySelectorAll(".clickable-device-row").forEach(row => {
      if (row.dataset.device === deviceId) {
        row.classList.add("active-row-highlight");
      } else {
        row.classList.remove("active-row-highlight");
      }
    });

    // Buka Drawer Konfigurasi
    const drawer = document.getElementById("deviceDrawerConfig") || document.getElementById("deviceConfigDrawer");
    if (drawer) {
      drawer.classList.add("open");
      drawer.style.display = "block";
    }

    // Force update detail drawer
    const state = stateStore.getState();
    this._updateDrawerDetailsLive(state.devices || [], true);
  }

  _updateDrawerDetailsLive(devices, isInitialSelect = false) {
    const dev = devices.find(d => d.deviceId === this.selectedDeviceId);
    if (!dev) return;

    const drawer = document.getElementById("deviceDrawerConfig") || document.getElementById("deviceConfigDrawer");
    if (!drawer || (drawer.style.display === "none" && !isInitialSelect)) return;

    // Tulis nilai-nilai ke form input
    const nameInput = document.getElementById("cfgDeviceName");
    if (nameInput) {
      nameInput.value = dev.deviceName;
    }

    const fpsInput = document.getElementById("cfgDeviceFps");
    if (fpsInput && (isInitialSelect || document.activeElement !== fpsInput)) {
      fpsInput.value = dev.fps || 30;
      if (dev.type.includes("PLC")) {
        fpsInput.parentElement.style.display = "none";
      } else {
        fpsInput.parentElement.style.display = "block";
      }
    }

    const resSelect = document.getElementById("cfgDeviceResolution");
    if (resSelect && (isInitialSelect || document.activeElement !== resSelect)) {
      resSelect.value = dev.resolution || "1080p";
      if (dev.type.includes("PLC")) {
        resSelect.parentElement.style.display = "none";
      } else {
        resSelect.parentElement.style.display = "block";
      }
    }

    // Suntik komponen diagnostik detail ke dalam box diagnostics murni secara programmatic
    const diagBox = drawer.querySelector(".device-diagnostics-metrics");
    if (diagBox) {
      // Kita buat custom layout di dalam box tersebut agar visualnya sangat premium
      const activeFlags = [];
      if (dev.latencyMs > 45) activeFlags.push("HIGH_LATENCY");
      if (dev.fps > 0 && dev.fps < 15) activeFlags.push("LOW_FPS");
      if (dev.temperatureC > 75) activeFlags.push("HIGH_TEMPERATURE");
      if (dev.cpuPercent > 80 || dev.memoryPercent > 80) activeFlags.push("RESOURCE_PRESSURE");
      if (dev.healthLevel === "STALE") activeFlags.push("STALE_TELEMETRY");
      if (dev.healthLevel === "OFFLINE") activeFlags.push("HEARTBEAT_TIMEOUT");

      const flagsText = activeFlags.length > 0 
        ? activeFlags.map(f => `<span style="background:rgba(239,68,68,0.15); color:#ef4444; padding:2px 6px; border-radius:4px; font-size:9.5px; border:1px solid rgba(239,68,68,0.3); margin-right:4px;">${f}</span>`).join("")
        : `<span style="color:#22c55e; font-weight:700;">🟢 None (Optimal)</span>`;

      const healthColor = dev.healthLevel === 'HEALTHY' ? '#22c55e' : dev.healthLevel === 'DEGRADED' ? '#f59e0b' : '#ef4444';

      diagBox.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:11px; margin-bottom:12px;">
          <div>🌡️ Suhu GPU: <strong style="color:${dev.temperatureC > 75 ? '#ef4444' : '#fff'};">${dev.temperatureC}°C</strong></div>
          <div>📊 CPU/GPU Load: <strong>${dev.cpuPercent}%</strong></div>
          <div>💾 RAM Node: <strong>${dev.type.includes("PLC") ? "256 KB" : "4.2 / 8.0 GB"}</strong></div>
          <div>🌀 Fan Speed: <strong>${dev.type.includes("PLC") ? "N/A" : dev.healthLevel === "OFFLINE" ? "0 RPM" : "2400 RPM"}</strong></div>
          <div>⏳ Uptime %: <strong style="color:#10b981;">${dev.healthLevel === 'OFFLINE' ? '0.0%' : dev.uptimePercent + '%'}</strong></div>
          <div>❌ Packet Loss: <strong style="color:${dev.packetLossPercent > 5 ? '#ef4444' : '#fff'};">${dev.packetLossPercent}%</strong></div>
          <div>📶 Status: <strong style="color:${healthColor};">${dev.healthLevel}</strong></div>
          <div>🎯 Skor Sehat: <strong style="color:${healthColor}; font-size:12px; font-family:'Share Tech Mono';">${dev.healthScore}/100</strong></div>
        </div>
        <div class="diag-extra-details" style="font-size:10.5px; border-top:1px solid rgba(255,255,255,0.08); padding-top:10px; margin-top:10px; color:#94a3b8;">
          <div style="margin-bottom:6px;">🚩 Active Flags: ${flagsText}</div>
          <div style="margin-bottom:4px;">⏰ Last Heartbeat: <strong style="color:#fff;">${new Date(dev.lastHeartbeatAt).toLocaleTimeString('id-ID')} WIB</strong></div>
          <div style="margin-bottom:6px;">📦 Provenance: <strong style="color:#00e5ff; font-family:'Share Tech Mono';">${dev.source}</strong></div>
          <div style="border-top:1px solid rgba(255,255,255,0.05); margin-top:8px; padding-top:8px;">
            <strong>Last Action / Command Audit:</strong>
            <div id="diagLastCommand" style="font-family:'Share Tech Mono', monospace; font-size:10px; color:#38bdf8; margin-top:3px; word-break:break-all; line-height:1.3;">Memuat histori audit...</div>
          </div>
        </div>
        <!-- Fault Injection Controls -->
        <div class="fault-injection-container" style="border-top:1px solid rgba(255,255,255,0.08); padding-top:10px; margin-top:10px;">
          <label class="cfg-label" style="display:block; margin-bottom:6px; font-weight:700; color:#ef4444; font-size:10.5px; letter-spacing:0.3px;">⚠️ DETECTABLE FAULT INJECTION (DEMO)</label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="latency_spike" style="font-size:9.5px; padding:4px 6px;">Latency Spike</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="packet_loss" style="font-size:9.5px; padding:4px 6px;">Packet Loss</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="low_fps" style="font-size:9.5px; padding:4px 6px;" ${dev.type.includes("PLC") ? 'disabled' : ''}>Low FPS</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="thermal_warning" style="font-size:9.5px; padding:4px 6px;">Thermal Warning</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="heartbeat_timeout" style="font-size:9.5px; padding:4px 6px;">HB Timeout</button>
            <button class="btn btn-primary compact btn-inject-fault" type="button" data-fault="recover" style="font-size:9.5px; padding:4px 6px; background:#10b981; border-color:#10b981; color:#fff;">Recover Node</button>
          </div>
        </div>
      `;

      // Re-bind click handlers untuk tombol fault injection yang baru di-render
      diagBox.querySelectorAll(".btn-inject-fault").forEach(btn => {
        btn.addEventListener("click", () => {
          this._handleFaultInjectionClick(this.selectedDeviceId, btn.dataset.fault);
        });
      });
    }

    // Render Latency Sparkline di Drawer Canvas
    this._drawLatencySparklineDrawer(dev.history || []);

    // Jika ini inisialisasi klik awal, lakukan fetch audit trail terpusat
    if (isInitialSelect) {
      this._fetchDeviceAuditTrail(this.selectedDeviceId);
    }
  }

  _drawLatencySparklineDrawer(history) {
    if (!this.ctx || !this.canvas) {
      this.canvas = document.getElementById("deviceLatencyCanvas");
      if (this.canvas) this.ctx = this.canvas.getContext("2d");
      if (!this.ctx) return;
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Render grid background
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (history.length === 0) return;

    const minVal = Math.min(...history) || 1;
    const maxVal = Math.max(...history) || 50;
    const range = maxVal - minVal || 1;

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.5;

    const step = w / (history.length - 1 || 1);
    history.forEach((val, idx) => {
      const x = idx * step;
      // Map value into canvas height securely
      const y = h - 6 - ((val - minVal) / range) * (h - 12);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Draw area fill
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(0, 229, 255, 0.2)");
    grad.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw values text on last point
    const lastVal = history[history.length - 1];
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 9px 'Share Tech Mono', monospace";
    ctx.fillText(`${lastVal}ms`, w - 34, h - 10);
  }

  async _fetchDeviceAuditTrail(deviceId) {
    try {
      const res = await fetch(`/api/devices/audit?deviceId=${deviceId}`);
      const payload = await res.json();
      const el = document.getElementById("diagLastCommand");
      if (!el) return;

      if (payload && payload.success && payload.data && payload.data.length > 0) {
        const cmd = payload.data[0];
        const time = new Date(cmd.requestedAt).toLocaleTimeString('id-ID');
        
        let desc = "";
        if (cmd.actionId.includes("CFG")) {
          desc = `Config update (FPS:${cmd.newState.fps}, Res:${cmd.newState.resolution}) oleh ${cmd.actor}`;
        } else if (cmd.actionId.includes("PING")) {
          desc = `Manual ping selesai, respon: ${cmd.newState.latencyMs}ms oleh ${cmd.actor}`;
        } else if (cmd.actionId.includes("FAULT")) {
          desc = `Fault: ${cmd.newState} disuntik oleh ${cmd.actor}`;
        }

        el.innerHTML = `
          <strong>[${time} WIB] ID: ${cmd.actionId.slice(-6)}</strong><br/>
          <span style="color:#10b981;">• Status: ${cmd.status || 'APPLIED'}</span><br/>
          <span>• Detail: ${desc}</span>
        `;
      } else {
        el.textContent = "Belum ada riwayat audit perintah.";
      }
    } catch (err) {
      const el = document.getElementById("diagLastCommand");
      if (el) el.textContent = "Gagal memuat log audit.";
    }
  }

  _bindDrawerEvents() {
    const drawer = document.getElementById("deviceDrawerConfig") || document.getElementById("deviceConfigDrawer");
    const closeBtn = document.getElementById("closeDeviceDrawer");
    const form = document.getElementById("deviceConfigForm");
    const saveBtn = document.getElementById("btnSaveDeviceConfig");

    const closeDrawer = () => {
      if (drawer) {
        drawer.classList.remove("open");
        setTimeout(() => { drawer.style.display = "none"; }, 200);
      }
      soundManager.play('click');
    };

    if (closeBtn) {
      closeBtn.addEventListener("click", closeDrawer);
    }

    const handleFormSubmit = async (e) => {
      if (e) e.preventDefault();
      
      const fpsInput = document.getElementById("cfgDeviceFps");
      const resSelect = document.getElementById("cfgDeviceResolution");

      const payload = {
        deviceId: this.selectedDeviceId,
        actor: "Zaki Putra (Operator)"
      };

      if (fpsInput) payload.fps = parseInt(fpsInput.value, 10);
      if (resSelect) payload.resolution = resSelect.value;

      const submitBtn = form ? form.querySelector("button[type='submit']") : saveBtn;
      const origText = submitBtn ? submitBtn.textContent : "Simpan";

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "VALIDATING...";
      }

      try {
        const token = authManager.getToken();
        const res = await fetch("/api/devices/config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data && data.success) {
          window.showToast(`✓ Konfigurasi parameter ${this.selectedDeviceId} berhasil disimpan & disinkronkan.`);
          soundManager.play('success');
          closeDrawer();
        } else {
          throw new Error(data?.error?.message || data?.message || "Validation failed");
        }
      } catch (err) {
        window.showToast(`❌ Gagal menyimpan konfigurasi: ${err.message}`, "danger");
        soundManager.play('alert');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origText;
        }
      }
    };

    if (form) {
      form.addEventListener("submit", handleFormSubmit);
    }
    if (saveBtn) {
      saveBtn.addEventListener("click", handleFormSubmit);
    }
  }

  async _handleFaultInjectionClick(deviceId, faultType) {
    try {
      const token = authManager.getToken();
      const res = await fetch("/api/devices/fault", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          deviceId,
          type: faultType,
          actor: authManager.getUser()?.name || "Administrator SITS"
        })
      });

      const payload = await res.json();
      if (payload && payload.success) {
        if (faultType === "recover") {
          window.showToast(`✓ Perangkat ${deviceId} berhasil dipulihkan secara normal (HEALTHY).`);
          soundManager.play('success');
        } else {
          window.showToast(`⚠️ Gangguan "${faultType.toUpperCase()}" disuntikkan secara deterministik pada ${deviceId}.`, "warning");
          soundManager.play('alert');
        }
        // Force update drawer live details
        this._updateDrawerDetailsLive(stateStore.getState().devices || []);
        this._fetchDeviceAuditTrail(deviceId);
      } else {
        throw new Error(payload?.error?.message || "Fault injection rejected");
      }
    } catch (err) {
      window.showToast(`❌ Gagal menyuntikkan gangguan: ${err.message}`, "danger");
      soundManager.play('alert');
    }
  }

  _handleConfigTransitionEvent(data) {
    if (!data || data.deviceId !== this.selectedDeviceId) return;

    // Tampilkan di log audit real-time
    const el = document.getElementById("diagLastCommand");
    if (el) {
      const time = new Date(data.timestamp).toLocaleTimeString('id-ID');
      let statusColor = "#38bdf8"; // requested
      if (data.status === "VALIDATING") statusColor = "#f59e0b";
      else if (data.status === "APPLIED") statusColor = "#22c55e";
      else if (data.status === "REJECTED") statusColor = "#ef4444";

      el.innerHTML = `
        <strong>[${time} WIB] ID: ${data.actionId.slice(-6)}</strong><br/>
        <span style="color:${statusColor}; font-weight:700;">• Status: ${data.status}</span><br/>
        <span>• Param: FPS:${data.newState.fps}, Res:${data.newState.resolution}</span>
      `;
    }
  }

  destroy() {
    this._unsubscribeCallbacks.forEach(un => {
      if (typeof un === 'function') un();
    });
    this._unsubscribeCallbacks = [];
    this._isInitialized = false;

    // Hapus socket listener
    const socket = socketClient.getSocket();
    if (socket) {
      socket.off('device:config-transition');
    }
  }
}

export const deviceController = new DeviceController();
