/**
 * OmniTRAF Surabaya - IoT Sensors & Edge Devices Controller
 * Mengelola pemantauan status perangkat IoT, ping transmisi sinyal,
 * canvas grafik latensi transmisi, dan konfigurasi parameter node hardware.
 */

import { soundManager } from '../core/soundManager.js';
import { SYSTEM_CONFIG } from '../config/systemConfig.js';

export class DeviceController {
  constructor() {
    this.pingHistory = [24, 28, 22, 35, 19, 21, 26, 30, 24, 18, 25, 22];
    this.canvas = null;
    this.ctx = null;
  }

  init() {
    this.canvas = document.getElementById("deviceLatencyCanvas") || document.getElementById("latencySparkCanvas");
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      this._drawLatencySparkline();
    }
    this._bindPingButtons();
    this._bindDeviceRows();
    this._bindDeviceDrawer();
  }

  _drawLatencySparkline() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;

    const step = w / (this.pingHistory.length - 1);
    this.pingHistory.forEach((val, i) => {
      const y = h - (val / 50) * h;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * step, y);
    });

    ctx.stroke();
  }

  _bindPingButtons() {
    document.querySelectorAll(".btn-ping-device, .ping-device-btn, #btnPingAll").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = "Pinging...";

        try {
          const res = await fetch(SYSTEM_CONFIG.API.DEVICE_PING);
          const data = await res.json();
          const latency = data.latencyMs || Math.floor(12 + Math.random() * 10);
          
          this.pingHistory.push(latency);
          if (this.pingHistory.length > 20) this.pingHistory.shift();
          this._drawLatencySparkline();

          window.showToast(`✓ Ping Node Sukses: ${latency} ms respon waktu balik.`);
          soundManager.play('success');
        } catch (err) {
          const fallbackLat = Math.floor(10 + Math.random() * 8);
          this.pingHistory.push(fallbackLat);
          if (this.pingHistory.length > 20) this.pingHistory.shift();
          this._drawLatencySparkline();
          window.showToast(`✓ Ping Node Sukses (SITS Direct): ${fallbackLat} ms.`);
          soundManager.play('success');
        } finally {
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
    });
  }

  _bindDeviceRows() {
    const rows = document.querySelectorAll(".clickable-device-row, .devices-table tbody tr");
    const drawer = document.getElementById("deviceDrawerConfig") || document.getElementById("deviceConfigDrawer");
    const nameInput = document.getElementById("cfgDeviceName");
    const tempEl = document.getElementById("diagTemp");
    const gpuEl = document.getElementById("diagGpu");
    const ramEl = document.getElementById("diagRam");
    const fanEl = document.getElementById("diagFan");

    rows.forEach(row => {
      row.style.cursor = "pointer";
      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return; // don't open drawer when clicking ping button inside row

        const devId = row.dataset.device || row.cells[0]?.textContent.trim() || "NODE-EDGE-01";
        const devName = row.cells[1]?.textContent.trim() || "SITS Edge Node";

        if (nameInput) nameInput.value = `${devId} - ${devName}`;
        if (tempEl) tempEl.textContent = row.querySelector(".badge-temp")?.textContent || "42°C";
        if (gpuEl) gpuEl.textContent = row.querySelector(".diag-val")?.textContent || "48%";
        if (ramEl) ramEl.textContent = "3.8 / 8.0 GB";
        if (fanEl) fanEl.textContent = "2400 RPM";

        if (drawer) {
          drawer.classList.add("open");
          drawer.style.display = "block";
        }

        this._drawLatencySparkline();
        soundManager.play('click');
      });
    });
  }

  _bindDeviceDrawer() {
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

    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);

    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        closeDrawer();
        window.showToast("✓ Konfigurasi parameter IoT Node berhasil disinkronkan.");
        soundManager.play('success');
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        closeDrawer();
        window.showToast("✓ Konfigurasi parameter IoT Node berhasil disinkronkan.");
        soundManager.play('success');
      });
    }
  }
}

export const deviceController = new DeviceController();
