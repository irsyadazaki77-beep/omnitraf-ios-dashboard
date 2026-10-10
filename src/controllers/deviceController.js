/**
 * OmniTRAF Surabaya - IoT Sensors & Edge Devices Controller
 * Mengelola pemantauan status perangkat IoT, ping transmisi sinyal,
 * canvas grafik latensi transmisi, dan konfigurasi parameter node hardware.
 * Berbasis Unified State, Realtime Synchronization, dan Deterministic Health Pipeline.
 */

import { soundManager } from '../core/soundManager.js';
import { SYSTEM_CONFIG } from '../config/systemConfig.js';
import { stateStore, updateDeviceState, escapeHtml } from '../core/stateStore.js';
import { socketClient, fetchWithCacheAndDedupe } from '../core/socketClient.js';
import { authManager } from '../core/authManager.js';
import { Disposer } from '../core/disposer.js';
import { commandLayer } from '../core/commandLayer.js';

export class DeviceController {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this._isInitialized = false;
    this.selectedDeviceId = "NODE-EDGE-01";
    this.disposer = new Disposer('DeviceController');
    this.deviceAuditCache = new Map();
    this.deviceAuditInFlight = new Set();
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
    console.info("🔌 [DeviceController] Menginisialisasi Edge Node Registry & Health Monitor...");
  }

  activate() {
    this.deactivate(); // Ensure clean slate before binding

    this.canvas = document.getElementById("deviceLatencyCanvas") || document.getElementById("latencySparkCanvas");
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
    }

    this._setupStoreListeners();
    this._setupSocketListeners();
    this._bindTableEvents();
    this._bindDrawerEvents();
    this.disposer.addEventListener(window, 'omnitraf:entity-focus', (event) => {
      if (event.detail?.kind !== 'device') return;
      const exists = (stateStore.getState().devices || []).some((device) => String(device.deviceId) === String(event.detail.id));
      if (exists) this.selectDevice(String(event.detail.id));
    });
    this.disposer.add(authManager.onAuthChange(() => this.render()));
    
    this.render();
  }

  deactivate() {
    this.disposer.clear();
  }

  _setupStoreListeners() {
    this.disposer.addStoreSubscription(stateStore, "state:devices", () => {
      this.render();
    });
  }

  _setupSocketListeners() {
    const socket = socketClient.getSocket();
    if (socket) {
      this.disposer.addSocketListener(socketClient, 'device:config-transition', (transitionData) => {
        this._handleConfigTransitionEvent(transitionData);
      });
    }
  }

  /**
   * Render seluruh UI Device Management berdasarkan Snapshot StateStore murni
   */
  render() {
    const state = stateStore.getState();
    const devices = state.devices || [];

    // 1. Render Summary Cards di atas dashboard Device Management
    this._renderSummaryCards(devices);

    // 2. Render Tabel Device secara dinamis
    this._renderDeviceTable(devices);
    const pingAllButton = document.getElementById('btnPingAll');
    const canPing = authManager.hasRole(['OPERATOR', 'ADMIN']);
    if (pingAllButton) pingAllButton.hidden = !canPing;
    document.querySelectorAll('#view-devices .ping-device-btn').forEach((button) => { button.hidden = !canPing; });
    const saveConfiguration = document.querySelector('#deviceConfigForm button[type="submit"]');
    if (saveConfiguration) saveConfiguration.hidden = !authManager.hasRole('ADMIN');

    // 3. Jika drawer sedang terbuka, update datanya secara real-time
    this._updateDrawerDetailsLive(devices);
  }

  _renderSummaryCards(devices) {
    const totalCount = devices.length;
    const exceptionCount = devices.filter(d => ["OFFLINE", "DEGRADED", "STALE", "FAULT", "RECOVERING", "MAINTENANCE"].includes(String(d.status === 'MAINTENANCE' ? d.status : d.healthLevel || '').toUpperCase())).length;
    
    // Hitung rata-rata CPU Load & Suhu untuk perangkat aktif
    let cpuSum = 0;
    let tempSum = 0;
    let activeDevicesCount = 0;

    devices.forEach(d => {
      if (!['OFFLINE', 'SIMULATED'].includes(String(d.healthLevel || '').toUpperCase())
        && Number.isFinite(Number(d.cpuPercent)) && d.cpuPercent !== null
        && Number.isFinite(Number(d.temperatureC)) && d.temperatureC !== null) {
        cpuSum += Number(d.cpuPercent);
        tempSum += Number(d.temperatureC);
        activeDevicesCount++;
      }
    });

    const avgCpu = activeDevicesCount > 0 ? Math.round(cpuSum / activeDevicesCount) : 0;
    const avgTemp = activeDevicesCount > 0 ? Math.round(tempSum / activeDevicesCount) : 0;

    const values = [
      [document.querySelector('#view-devices .workspace-header-summary-strip .workspace-summary-item:first-child strong'), `${totalCount} Perangkat`],
      [document.getElementById('nodeStatusSummary'), `${exceptionCount} pengecualian`],
      [document.getElementById('nodeGpuSummary'), activeDevicesCount ? `${avgCpu}% beban model` : '—'],
      [document.getElementById('nodeTempSummary'), activeDevicesCount ? `${avgTemp}°C` : '—']
    ];
    values.forEach(([element, value]) => { if (element) element.textContent = value; });
  }

  _renderDeviceTable(devices) {
    const tbody = document.getElementById("deviceTableBody");
    if (!tbody) return;

    // Simpan scroll position tabel
    const scrollTop = tbody.parentElement ? tbody.parentElement.scrollTop : 0;

    let html = "";
    const sortedDevices = [...devices].sort((a, b) => {
      const priority = (device) => ['OFFLINE', 'FAULT', 'DEGRADED', 'STALE', 'RECOVERING', 'MAINTENANCE'].indexOf(String(device.status === 'MAINTENANCE' ? device.status : device.healthLevel || '').toUpperCase());
      const aPriority = priority(a) < 0 ? 99 : priority(a);
      const bPriority = priority(b) < 0 ? 99 : priority(b);
      return aPriority - bPriority;
    });
    sortedDevices.forEach(dev => {
      const safeDeviceId = escapeHtml(dev.deviceId);
      const safeDeviceName = escapeHtml(dev.deviceName);
      const safeLocation = escapeHtml(dev.location);
      const safeType = escapeHtml(dev.type);
      const resolvedHealth = dev.status === 'MAINTENANCE' ? 'MAINTENANCE' : String(dev.healthLevel || '').toUpperCase();
      const safeHealthLevel = ['HEALTHY', 'DEGRADED', 'STALE', 'FAULT', 'RECOVERING', 'OFFLINE', 'SIMULATED', 'MAINTENANCE'].includes(resolvedHealth) ? resolvedHealth : 'OFFLINE';
      const numericValue = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
      const cpuReading = numericValue(dev.cpuPercent);
      const temperatureReading = numericValue(dev.temperatureC);
      const latencyMs = numericValue(dev.latencyMs);
      const fps = numericValue(dev.fps);
      const cpuPercent = Math.max(0, Math.min(100, cpuReading ?? 0));
      const temperatureC = Math.max(0, Math.min(150, temperatureReading ?? 0));
      // Tentukan status badge HTML
      let badgeHtml = "";
      if (safeHealthLevel === "HEALTHY") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#22c55e;"></span><span class="pulse-ring-inner" style="background:#22c55e;"></span></span><span style="color:#22c55e; font-weight:700;">DEMO · HEALTHY</span>`;
      } else if (safeHealthLevel === "DEGRADED") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#f59e0b;"></span><span class="pulse-ring-inner" style="background:#f59e0b;"></span></span><span style="color:#f59e0b; font-weight:700;">DEMO · DEGRADED</span>`;
      } else if (safeHealthLevel === "STALE") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#94a3b8;"></span><span class="pulse-ring-inner" style="background:#94a3b8;"></span></span><span style="color:#94a3b8; font-weight:700;">DEMO · STALE</span>`;
      } else if (safeHealthLevel === "FAULT") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#ef4444;"></span><span class="pulse-ring-inner" style="background:#ef4444;"></span></span><span style="color:#ef4444; font-weight:700;">FAULT DEMO</span>`;
      } else if (safeHealthLevel === "RECOVERING") {
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#38bdf8;"></span><span class="pulse-ring-inner" style="background:#38bdf8;"></span></span><span style="color:#38bdf8; font-weight:700;">DEMO · RECOVERING</span>`;
      } else if (safeHealthLevel === "MAINTENANCE") {
        badgeHtml = `<span class="status-badge gray">MAINTENANCE · DEMO</span>`;
      } else if (safeHealthLevel === "SIMULATED") {
        badgeHtml = `<span class="status-badge gray">MODEL ONLY</span>`;
      } else { // OFFLINE
        badgeHtml = `<span class="status-dot-wrapper"><span class="pulse-ring-outer" style="border-color:#64748b;"></span><span class="pulse-ring-inner" style="background:#64748b;"></span></span><span style="color:#64748b; font-weight:700;">OFFLINE DEMO</span>`;
      }

      // Bar indikator CPU load
      const cpuColor = cpuPercent > 80 ? 'load-orange' : 'load-green';
      const cpuBarHtml = cpuReading === null ? '<span class="metric-unavailable">Tidak tersedia</span>' : `
        <div class="diag-bar-wrap">
          <div class="diag-bar-track">
            <div class="diag-bar-fill ${cpuColor}" style="width: ${cpuPercent}%;"></div>
          </div>
          <span class="diag-val" style="font-family:'Share Tech Mono';">${cpuPercent}%</span>
        </div>
      `;

      // Bar indikator suhu
      const tempColorClass = temperatureC > 75 ? 'temp-warm-fill' : 'temp-cool-fill';
      const tempBadgeClass = temperatureC > 75 ? 'temp-warm' : 'temp-cool';
      const tempBarHtml = temperatureReading === null ? '<span class="metric-unavailable">Tidak tersedia</span>' : `
        <div class="diag-temp-wrap">
          <div class="diag-temp-bar">
            <div class="diag-temp-fill ${tempColorClass}" style="width: ${Math.min(100, (temperatureC / 100) * 100)}%;"></div>
          </div>
          <span class="badge-temp ${tempBadgeClass}" style="font-family:'Share Tech Mono';">${temperatureC}°C</span>
        </div>
      `;

      // Sparkline SVG mini berbasis ring buffer history murni
      const history = (Array.isArray(dev.history) ? dev.history : [12, 11, 14, 10, 13, 12])
        .filter(value => Number.isFinite(Number(value))).slice(-64).map(Number);
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
        <svg viewBox="0 0 50 15" width="50" height="15" class="device-sparkline" aria-label="Tren latensi model">
          <path d="${points}" fill="none" class="device-sparkline-line ${safeHealthLevel.toLowerCase()}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      const inferenceRateText = fps === null ? (typeof dev.type === 'string' && dev.type.includes("PLC")) ? "Telemetri demo" : "Tidak tersedia" : `${fps} FPS simulasi`;

      // Row layout HTML murni
      html += `
        <tr class="device-row ${this.selectedDeviceId === dev.deviceId ? 'active-row-highlight' : ''}" data-device="${safeDeviceId}" data-health="${safeHealthLevel.toLowerCase()}">
          <td><strong>${safeDeviceId}</strong></td>
          <td>
            <div style="font-weight:600;">${safeDeviceName}</div>
            <small style="color:#64748b; font-size:10px;">${safeLocation}</small>
          </td>
          <td style="font-size:11px; color:#94a3b8;">${safeType}</td>
          <td>${badgeHtml}</td>
          <td>${cpuBarHtml}</td>
          <td>${tempBarHtml}</td>
          <td class="device-ping" style="font-family:'Share Tech Mono';">${latencyMs === null || safeHealthLevel === 'OFFLINE' ? '—' : latencyMs + ' ms model'}</td>
          <td class="device-ping-spark">${sparklineHtml}</td>
          <td style="font-size:11px; font-family:'Share Tech Mono';">${inferenceRateText}</td>
        <td><button type="button" class="btn btn-ghost compact btn-device-detail" aria-label="Lihat detail ${safeDeviceName}">Lihat detail</button>${authManager.hasRole(['OPERATOR', 'ADMIN']) && !['SIMULATED', 'MAINTENANCE'].includes(safeHealthLevel) ? `<button type="button" aria-label="Uji koneksi simulasi ${safeDeviceId}" class="btn btn-ghost compact btn-ping-device-row" data-device="${safeDeviceId}">Uji koneksi demo</button>` : ''}</td>
        </tr>
      `;
    });

    if (sortedDevices.length === 0) {
      html = '<tr class="device-empty-row"><td colspan="10">Belum ada data perangkat dari server simulasi.</td></tr>';
    }

    tbody.innerHTML = html;
    const columnLabels = Array.from(tbody.closest('table')?.querySelectorAll('thead th') || [], header => header.textContent.trim());
    tbody.querySelectorAll('tr').forEach(row => {
      row.querySelectorAll('td').forEach((cell, index) => {
        if (cell.colSpan > 1) return;
        if (columnLabels[index]) cell.dataset.label = columnLabels[index];
      });
    });
    this._applyDeviceFilters();

    // Kembalikan scroll position
    if (tbody.parentElement) {
      tbody.parentElement.scrollTop = scrollTop;
    }
  }

  _bindTableEvents() {
    const tbody = document.getElementById("deviceTableBody");
    if (!tbody) return;

    const search = document.getElementById('deviceSearch');
    const statusFilter = document.getElementById('deviceStatusFilter');
    if (search) this.disposer.addEventListener(search, 'input', () => this._applyDeviceFilters());
    if (statusFilter) this.disposer.addEventListener(statusFilter, 'change', () => this._applyDeviceFilters());

    // centralized click delegator
    this.disposer.addEventListener(tbody, "click", (e) => {
      const pingBtn = e.target.closest(".btn-ping-device-row");
      const detailBtn = e.target.closest('.btn-device-detail');

      if (pingBtn) {
        e.stopPropagation();
        const devId = pingBtn.dataset.device;
        this.pingDevice(devId, pingBtn);
        return;
      }

      if (detailBtn) {
        const devId = detailBtn.closest('.device-row')?.dataset.device;
        if (!devId) return;
        this.selectDevice(devId);
        soundManager.play('click');
      }
    });

    // Bind Ping All button
    const btnPingAll = document.getElementById("btnPingAll");
    if (btnPingAll) {
      this.disposer.addEventListener(btnPingAll, "click", async () => {
        btnPingAll.disabled = true;
        const origText = btnPingAll.textContent;
        btnPingAll.textContent = "Pinging All...";
        soundManager.play('click');

        const state = stateStore.getState();
        const devices = state.devices || [];
        let pingFailures = 0;

        // Ping sequential / concurrent limit
        for (const dev of devices) {
          try {
            const result = await fetchWithCacheAndDedupe(
              `/api/devices/ping?deviceId=${encodeURIComponent(dev.deviceId)}`,
              { method: 'GET', forceRefresh: true }
            );
            if (!result?.success) pingFailures++;
          } catch (err) {
            pingFailures++;
            console.warn("Ping failed for", dev.deviceId);
          }
        }

        window.showToast(pingFailures
          ? `⚠ Pemindaian selesai, ${pingFailures} node tidak dapat diping.`
          : "✓ Pemindaian Latensi Seluruh Node Berhasil Diselesaikan.", pingFailures ? 'warning' : 'success');
        soundManager.play(pingFailures ? 'alert' : 'success');
        btnPingAll.disabled = false;
        btnPingAll.textContent = origText;
      });
    }
  }

  _applyDeviceFilters() {
    const tbody = document.getElementById('deviceTableBody');
    if (!tbody) return;
    const query = (document.getElementById('deviceSearch')?.value || '').trim().toLowerCase();
    const status = document.getElementById('deviceStatusFilter')?.value || 'all';
    let visible = 0;
    const rows = [...tbody.querySelectorAll('.device-row')];
    rows.forEach((row) => {
      const health = row.dataset.health || 'offline';
      const matchesQuery = !query || row.textContent.toLowerCase().includes(query);
      const isException = ['offline', 'degraded', 'stale', 'fault', 'recovering', 'maintenance'].includes(health);
      const matchesStatus = status === 'all'
        || (status === 'exceptions' && isException)
        || (status === 'offline' && health === 'offline')
        || (status === 'degraded' && ['degraded', 'stale', 'fault', 'recovering'].includes(health))
        || (status === 'maintenance' && health === 'maintenance')
        || (status === 'healthy' && health === 'healthy');
      row.hidden = !(matchesQuery && matchesStatus);
      if (!row.hidden) visible += 1;
    });
    const count = document.getElementById('deviceFilterCount');
    if (count) count.textContent = `${visible} / ${rows.length} perangkat`;
    const emptyState = document.getElementById('deviceFilterEmpty');
    if (emptyState) emptyState.hidden = visible > 0 || rows.length === 0;
  }

  async pingDevice(deviceId, btnElement = null) {
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.textContent = "Pinging...";
    }

    try {
      const payload = await fetchWithCacheAndDedupe(
        `/api/devices/ping?deviceId=${encodeURIComponent(deviceId)}`,
        { method: 'GET', forceRefresh: true }
      );

      if (payload && payload.success) {
        const latency = payload.data?.latencyMs ?? payload.latencyMs;
        window.showToast(latency === undefined || latency === null
          ? `Ping demo ${deviceId} berhasil; latensi simulasi tidak tersedia.`
          : `Ping demo ${deviceId}: ${latency} ms waktu simulasi; tidak menguji perangkat fisik.`);
        soundManager.play('success');
      } else {
        throw new Error(payload?.error?.message || "Ping gagal diproses.");
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
    document.querySelectorAll(".device-row").forEach(row => {
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
      drawer.style.display = "flex";
      drawer.setAttribute('aria-hidden', 'false');
    }

    // Force update detail drawer
    const state = stateStore.getState();
    this._updateDrawerDetailsLive(state.devices || [], true);
  }

  _updateDrawerDetailsLive(devices, isInitialSelect = false) {
    const dev = devices.find(d => d.deviceId === this.selectedDeviceId);
    if (!dev) {
      const drawer = document.getElementById("deviceDrawerConfig") || document.getElementById("deviceConfigDrawer");
      if (drawer?.classList.contains('open')) {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        drawer.style.display = 'none';
      }
      this.selectedDeviceId = null;
      return;
    }
    const deviceType = typeof dev.type === "string" ? dev.type : "";
    const numericMetric = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const temperatureC = numericMetric(dev.temperatureC);
    const cpuPercent = numericMetric(dev.cpuPercent);
    const healthScore = numericMetric(dev.healthScore);
    const packetLossPercent = numericMetric(dev.packetLossPercent);
    const uptimePercent = numericMetric(dev.uptimePercent);
    const heartbeatTime = new Date(dev.lastHeartbeatAt);
    const heartbeatLabel = Number.isNaN(heartbeatTime.getTime())
      ? "Tidak diketahui"
      : heartbeatTime.toLocaleTimeString("id-ID");

    const drawer = document.getElementById("deviceDrawerConfig") || document.getElementById("deviceConfigDrawer");
    if (!drawer || (drawer.style.display === "none" && !isInitialSelect)) return;

    // Tulis nilai-nilai ke form input
    const nameInput = document.getElementById("cfgDeviceName");
    if (nameInput) {
      nameInput.value = dev.deviceName;
    }

    const fpsInput = document.getElementById("cfgDeviceFps");
    const canConfigure = authManager.hasRole('ADMIN');
    const permissionNote = document.getElementById('deviceConfigPermissionNote');
    if (permissionNote) permissionNote.hidden = canConfigure;
    const saveButton = drawer.querySelector('button[type="submit"]');
    if (saveButton) {
      saveButton.disabled = !canConfigure;
      saveButton.setAttribute('aria-describedby', 'deviceConfigPermissionNote');
    }
    if (fpsInput) {
      fpsInput.disabled = !canConfigure;
      fpsInput.setAttribute('aria-readonly', String(!canConfigure));
    }
    if (fpsInput && (isInitialSelect || document.activeElement !== fpsInput)) {
      fpsInput.value = dev.fps || 30;
      if (fpsInput.parentElement && fpsInput.parentElement.style) {
        if (deviceType.includes("PLC")) {
          fpsInput.parentElement.style.display = "none";
        } else {
          fpsInput.parentElement.style.display = "block";
        }
      }
    }

    const resSelect = document.getElementById("cfgDeviceResolution");
    if (resSelect && (isInitialSelect || document.activeElement !== resSelect)) {
      resSelect.value = dev.resolution || "1080p";
      resSelect.disabled = !canConfigure;
      if (resSelect.parentElement && resSelect.parentElement.style) {
        if (deviceType.includes("PLC")) {
          resSelect.parentElement.style.display = "none";
        } else {
          resSelect.parentElement.style.display = "block";
        }
      }
    }

    // Suntik komponen diagnostik detail ke dalam box diagnostics murni secara programmatic
    const diagBox = drawer.querySelector(".device-diagnostics-metrics");
    if (diagBox) {
      // Kita buat custom layout di dalam box tersebut agar visualnya sangat premium
      const activeFlags = [];
      if (numericMetric(dev.latencyMs) > 45) activeFlags.push("HIGH_LATENCY");
      if (numericMetric(dev.fps) > 0 && numericMetric(dev.fps) < 15) activeFlags.push("LOW_FPS");
      if (temperatureC > 75) activeFlags.push("HIGH_TEMPERATURE");
      if (cpuPercent > 80 || numericMetric(dev.memoryPercent) > 80) activeFlags.push("RESOURCE_PRESSURE");
      if (dev.healthLevel === "STALE") activeFlags.push("STALE_TELEMETRY");
      if (dev.healthLevel === "OFFLINE") activeFlags.push("HEARTBEAT_TIMEOUT");

      const flagLabels = { HIGH_LATENCY: 'Latensi tinggi', LOW_FPS: 'Laju bingkai rendah', HIGH_TEMPERATURE: 'Suhu tinggi', RESOURCE_PRESSURE: 'Tekanan sumber daya', STALE_TELEMETRY: 'Telemetri usang', HEARTBEAT_TIMEOUT: 'Waktu heartbeat habis' };
      const flagsText = activeFlags.length > 0
        ? activeFlags.map(flag => `<span class="device-flag">${flagLabels[flag]}</span>`).join("")
        : `<span class="device-flag-empty">Tidak ada · optimal</span>`;

      const healthColor = dev.healthLevel === 'HEALTHY' ? '#22c55e' : dev.healthLevel === 'DEGRADED' ? '#f59e0b' : '#ef4444';
      const faultInjectionHtml = canConfigure ? `
        <div class="fault-injection-container">
            <label class="cfg-label">Suntik gangguan (simulasi)</label>
          <div class="fault-injection-actions">
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="latency_spike">Lonjakan latensi</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="packet_loss">Kehilangan paket</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="low_fps" ${deviceType.includes("PLC") ? 'disabled' : ''}>Laju bingkai rendah</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="thermal_warning">Peringatan suhu</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="heartbeat_timeout">Batas waktu heartbeat</button>
            <button class="btn btn-ghost compact btn-inject-fault" type="button" data-fault="recover">Pulihkan node</button>
          </div>
        </div>
      ` : '';

      diagBox.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:11px; margin-bottom:12px;">
          <div>🌡️ Suhu GPU: <strong style="color:${temperatureC > 75 ? '#ef4444' : '#fff'};">${temperatureC === null ? '—' : `${temperatureC}°C`}</strong></div>
          <div>📊 Beban CPU/GPU: <strong>${cpuPercent === null ? '—' : `${cpuPercent}%`}</strong></div>
          <div>💾 RAM Node: <strong>${deviceType.includes("PLC") ? "256 KB" : "4.2 / 8.0 GB"}</strong></div>
          <div>🌀 Fan Speed: <strong>${deviceType.includes("PLC") ? "N/A" : dev.healthLevel === "OFFLINE" ? "0 RPM" : "2400 RPM"}</strong></div>
          <div>⏳ Uptime %: <strong style="color:#10b981;">${dev.healthLevel === 'OFFLINE' ? '0.0%' : uptimePercent + '%'}</strong></div>
          <div>❌ Kehilangan paket: <strong style="color:${packetLossPercent > 5 ? '#ef4444' : '#fff'};">${packetLossPercent === null ? '—' : `${packetLossPercent}%`}</strong></div>
          <div>📶 Status: <strong style="color:${healthColor};">${escapeHtml(({ HEALTHY: 'Sehat', DEGRADED: 'Menurun', STALE: 'Usang', FAULT: 'Gangguan', RECOVERING: 'Pemulihan', OFFLINE: 'Terputus', SIMULATED: 'Simulasi' })[dev.healthLevel] || dev.healthLevel || 'Tidak diketahui')}</strong></div>
          <div>🎯 Skor kesehatan: <strong style="color:${healthColor}; font-size:12px; font-family:'Share Tech Mono';">${healthScore === null ? '—' : `${healthScore}/100`}</strong></div>
        </div>
        <div class="diag-extra-details" style="font-size:10.5px; border-top:1px solid rgba(255,255,255,0.08); padding-top:10px; margin-top:10px; color:#94a3b8;">
          <div style="margin-bottom:6px;">🚩 Tanda aktif: ${flagsText}</div>
          <div style="margin-bottom:4px;">⏰ Heartbeat terakhir: <strong style="color:#fff;">${escapeHtml(heartbeatLabel)} WIB</strong></div>
          <div style="margin-bottom:6px;">📦 Sumber data: <strong style="color:#00e5ff; font-family:'Share Tech Mono';">${escapeHtml(dev.source || 'SIMULATED')} · MODEL SIMULASI</strong></div>
          <div style="border-top:1px solid rgba(255,255,255,0.05); margin-top:8px; padding-top:8px;">
            <strong>Audit perintah terakhir:</strong>
            <div id="diagLastCommand" style="font-family:'Share Tech Mono', monospace; font-size:10px; color:#38bdf8; margin-top:3px; word-break:break-all; line-height:1.3;">Memuat riwayat audit...</div>
          </div>
        </div>
        ${faultInjectionHtml}
      `;
      const auditEl = diagBox.querySelector('#diagLastCommand');
      if (auditEl) {
        auditEl.dataset.deviceId = String(this.selectedDeviceId);
        const cachedAudit = this.deviceAuditCache.get(String(this.selectedDeviceId));
        if (cachedAudit) {
          auditEl.innerHTML = cachedAudit;
        } else if (this.deviceAuditInFlight.has(String(this.selectedDeviceId))) {
          auditEl.textContent = 'Memuat histori audit…';
        } else {
          auditEl.textContent = 'Histori audit belum dimuat.';
        }
      }
    }

    // Render Latency Sparkline di Drawer Canvas
    this._drawLatencySparklineDrawer(dev.history || []);

    // Jika ini inisialisasi klik awal, lakukan fetch audit trail terpusat
    if (isInitialSelect && !this.deviceAuditCache.has(String(this.selectedDeviceId))) {
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
    const key = String(deviceId);
    if (this.deviceAuditInFlight.has(key)) return;
    this.deviceAuditInFlight.add(key);
    this._setDeviceAuditContent(key, 'Memuat histori audit…');
    try {
      const payload = await fetchWithCacheAndDedupe(
        `/api/devices/audit?deviceId=${encodeURIComponent(deviceId)}`,
        { method: 'GET', ttlMs: 1500 }
      );
      let html = '';
      if (payload && payload.success && Array.isArray(payload.data) && payload.data.length > 0) {
        const cmd = payload.data[0];
        const time = new Date(cmd.requestedAt).toLocaleTimeString('id-ID');
        
        let desc = "";
        if (cmd.actionId && cmd.actionId.includes("CFG")) {
          desc = `Config update (FPS:${cmd.newState?.fps}, Res:${cmd.newState?.resolution}) oleh ${cmd.actor}`;
        } else if (cmd.actionId && cmd.actionId.includes("PING")) {
          desc = `Manual ping selesai, respon: ${cmd.newState?.latencyMs}ms oleh ${cmd.actor}`;
        } else if (cmd.actionId && cmd.actionId.includes("FAULT")) {
          desc = `Fault: ${typeof cmd.newState === 'object' ? (cmd.newState?.status || 'Active') : cmd.newState} disuntik oleh ${cmd.actor}`;
        }

        html = `
          <strong>[${time} WIB] ID: ${escapeHtml(typeof cmd.actionId === 'string' ? cmd.actionId.slice(-6) : '-')}</strong><br/>
          <span style="color:#10b981;">• Status: ${escapeHtml(cmd.status || 'APPLIED')}</span><br/>
          <span>• Detail: ${escapeHtml(desc)}</span>
        `;
      } else {
        html = "Belum ada riwayat audit perintah.";
      }
      this.deviceAuditCache.set(key, html);
      this._setDeviceAuditContent(key, html, true);
    } catch (err) {
      this._setDeviceAuditContent(key, 'Histori gagal dimuat. <button type="button" class="btn btn-ghost compact btn-retry-device-audit">Coba lagi</button>', true);
    } finally {
      this.deviceAuditInFlight.delete(key);
    }
  }

  _setDeviceAuditContent(deviceId, content, isHtml = false) {
    if (String(this.selectedDeviceId) !== String(deviceId)) return;
    const el = document.getElementById('diagLastCommand');
    if (!el || el.dataset.deviceId !== String(deviceId)) return;
    if (isHtml) el.innerHTML = content;
    else el.textContent = content;
  }

  _bindDrawerEvents() {
    const drawer = document.getElementById("deviceDrawerConfig") || document.getElementById("deviceConfigDrawer");
    const closeBtn = document.getElementById("closeDeviceDrawer");
    const form = document.getElementById("deviceConfigForm");
    const saveBtn = document.getElementById("btnSaveDeviceConfig");

    const closeDrawer = () => {
      if (drawer) {
        drawer.classList.remove("open");
        drawer.setAttribute('aria-hidden', 'true');
        setTimeout(() => { drawer.style.display = "none"; }, 200);
      }
      soundManager.play('click');
    };

    if (closeBtn) {
      this.disposer.addEventListener(closeBtn, "click", closeDrawer);
    }

    const handleFormSubmit = async (e) => {
      if (e) e.preventDefault();
      if (!authManager.hasRole('ADMIN')) {
        window.showToast('Perubahan konfigurasi perangkat memerlukan peran Admin.', 'warning');
        return;
      }
      
      const fpsInput = document.getElementById("cfgDeviceFps");
      const resSelect = document.getElementById("cfgDeviceResolution");

      const payload = {
        deviceId: this.selectedDeviceId,
        actor: authManager.getUser()?.name || 'Demo session'
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
        await commandLayer.dispatchCommand({
          action: 'device:config',
          targetType: 'device',
          targetId: this.selectedDeviceId,
          payload
        }, false); // low risk

        window.showToast(`State konfigurasi demo ${this.selectedDeviceId} diperbarui lokal; tidak dikirim ke hardware.`);
        soundManager.play('success');
        closeDrawer();
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
      this.disposer.addEventListener(form, "submit", handleFormSubmit);
    }
    if (saveBtn) {
      this.disposer.addEventListener(saveBtn, "click", handleFormSubmit);
    }

    // Event delegation on drawer for fault injection clicks - absolutely 100% leak-proof!
    if (drawer) {
      this.disposer.addEventListener(drawer, "click", (e) => {
        const retryAuditBtn = e.target.closest('.btn-retry-device-audit');
        if (retryAuditBtn) {
          this._fetchDeviceAuditTrail(this.selectedDeviceId);
          return;
        }
        const injectBtn = e.target.closest(".btn-inject-fault");
        if (injectBtn) {
          this._handleFaultInjectionClick(this.selectedDeviceId, injectBtn.dataset.fault);
        }
      });
    }
  }

  async _handleFaultInjectionClick(deviceId, faultType) {
    if (!authManager.hasRole('ADMIN')) {
      window.showToast('Fault injection simulasi hanya tersedia untuk Admin.', 'warning');
      return;
    }
    try {
      const payload = await fetchWithCacheAndDedupe("/api/devices/fault", {
        method: "POST",
        body: {
          deviceId,
          type: faultType,
          actor: authManager.getUser()?.name || "Administrator SITS"
        }
      });

      if (payload && payload.success) {
        if (faultType === "recover") {
          window.showToast(`State perangkat demo ${deviceId} dipulihkan di simulator.`);
          soundManager.play('success');
        } else {
          window.showToast(`Gangguan demo "${faultType.toUpperCase()}" disimulasikan untuk ${deviceId}; tidak memengaruhi perangkat fisik.`, "warning");
          soundManager.play('alert');
        }
        // Force update drawer live details
        this._updateDrawerDetailsLive(stateStore.getState().devices || []);
        this._fetchDeviceAuditTrail(deviceId);
      } else {
        throw new Error(payload?.error?.message || "Fault injection rejected");
      }
    } catch (err) {
      const isRoleErr = err.status === 403 || err.code === 'FORBIDDEN';
      const msg = isRoleErr ? 'Akses ditolak: Memerlukan akun role Administrator SITS.' : err.message;
      window.showToast(`❌ Gagal menyuntikkan gangguan: ${msg}`, "danger");
      soundManager.play('alert');
    }
  }

  _handleConfigTransitionEvent(data) {
    if (!data || data.deviceId !== this.selectedDeviceId) return;
    const timestamp = new Date(data.timestamp);
    const time = Number.isNaN(timestamp.getTime()) ? "--:--:--" : timestamp.toLocaleTimeString('id-ID');
    const fps = Number(data.newState?.fps);
    const safeFps = Number.isFinite(fps) ? fps : "-";
    const safeResolution = typeof data.newState?.resolution === 'string' ? data.newState.resolution : '-';

    // Tampilkan di log audit real-time
    const el = document.getElementById("diagLastCommand");
    if (el) {
      let statusColor = "#38bdf8"; // requested
      if (data.status === "VALIDATING") statusColor = "#f59e0b";
      else if (data.status === "APPLIED") statusColor = "#22c55e";
      else if (data.status === "REJECTED") statusColor = "#ef4444";

      const html = `
        <strong>[${time} WIB] ID: ${escapeHtml(typeof data.actionId === 'string' ? data.actionId.slice(-6) : '-')}</strong><br/>
        <span style="color:${statusColor}; font-weight:700;">• Status: ${escapeHtml(data.status)}</span><br/>
        <span>• Param: FPS:${escapeHtml(safeFps)}, Res:${escapeHtml(safeResolution)}</span>
      `;
      this.deviceAuditCache.set(String(data.deviceId), html);
      if (el.dataset.deviceId === String(data.deviceId)) el.innerHTML = html;
    }
  }

  destroy() {
    this.deactivate();
  }
}

export const deviceController = new DeviceController();
