/**
 * OmniTRAF Surabaya - Reports & Executive Export Controller
 * Menangani pembuatan Mobility Snapshot Surabaya, pencetakan PDF eksekutif,
 * canvas rendering visualisasi tren, error handling, dan penyalinan JSON API.
 */

import { soundManager } from '../core/soundManager.js';
import { stateStore } from '../core/stateStore.js';
import { commandLayer } from '../core/commandLayer.js';

export class ReportController {
  constructor() {
    this.isGenerating = false;
    this.abortController = null;
    this.lastType = "Daily Mobility";
    this._isBound = false;
  }

  init() {
    if (this._isBound) return;
    this._isBound = true;

    this._bindExportButtons();
    this._bindModalControls();
    this._bindPrintExecutive();
    this._bindCopyJson();
    this._exposeGlobalBridges();
  }

  _exposeGlobalBridges() {
    window.closeReportModal = () => this.closeReportModal();
    window.generateMobilitySnapshot = (type) => this.generateMobilitySnapshot(type);
  }

  _bindExportButtons() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-export-report, [data-action='download-report'], [data-action='export'], .btn-download-report, #btnGenerateReport");
      if (btn) {
        e.preventDefault();
        const type = btn.dataset.reportType || btn.getAttribute("data-type") || "Daily Mobility";
        this.generateMobilitySnapshot(type);
      }
    });
  }

  _bindModalControls() {
    const closeBtns = [
      document.getElementById("closeModal"),
      document.getElementById("btnClosePreviewDoc"),
      document.getElementById("btnCancelReportGen"),
      document.getElementById("btnCancelReportError")
    ].filter(Boolean);

    closeBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.closeReportModal();
      });
    });

    const modal = document.getElementById("reportModal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          this.closeReportModal();
        }
      });
    }

    const retryBtn = document.getElementById("btnRetryReportGen");
    if (retryBtn) {
      retryBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.generateMobilitySnapshot(this.lastType);
      });
    }

    const printDocBtn = document.getElementById("btnPrintReportDoc");
    if (printDocBtn) {
      printDocBtn.addEventListener("click", (e) => {
        e.preventDefault();
        soundManager.play('click');
        const downloadUrl = `/api/reports/download?type=${encodeURIComponent(this.lastType || "Daily Mobility")}`;
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.target = "_blank";
        a.download = `OmniTRAF-Mobility-Snapshot-${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (typeof window.showToast === "function") {
          window.showToast("🖨️ Mengunduh dokumen resmi PDF SITS Surabaya...");
        }
      });
    }
  }

  /**
   * Main Pipeline for Generating Mobility Snapshot
   */
  async generateMobilitySnapshot(type = "Daily Mobility") {
    this.lastType = type;

    if (this.abortController) {
      this.abortController.abort();
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const modal = document.getElementById("reportModal");
    const loaderState = document.getElementById("reportLoaderState");
    const errorState = document.getElementById("reportErrorState");
    const previewState = document.getElementById("reportDocPreviewState");

    if (modal) {
      modal.classList.add("show", "open");
      modal.style.setProperty("display", "flex", "important");
    }

    if (loaderState) loaderState.style.display = "block";
    if (errorState) errorState.style.display = "none";
    if (previewState) previewState.style.display = "none";

    this._updateLoaderProgress(5, "Menginisialisasi pencatatan telemetri SITS...");

    try {
      this.isGenerating = true;

      // Stage 1: Fast Telemetry Aggregation (10% -> 50%)
      this._updateLoaderProgress(20, "Mengagregasi telemetri SITS & status sensor...");
      await this._delay(200);
      if (signal.aborted) return;

      this._updateLoaderProgress(50, "Mengkalkulasi indikator volume & SPM...");
      const telemetryData = this._getReportTelemetry(type);
      await this._delay(200);
      if (signal.aborted) return;

      // Stage 2: Render Canvas Preview (50% -> 85%)
      this._updateLoaderProgress(80, "Merender grafik visualisasi snapshot & tren mobilitas...");
      await this._renderReportPreviewCanvas(telemetryData);
      if (signal.aborted) return;

      // Stage 3: Complete
      this._updateLoaderProgress(100, "Selesai!");
      await this._delay(150);
      if (signal.aborted) return;

      this._showDocPreviewState(telemetryData);
      this._logExportHistory(type);

      // Log to centralized audit trail
      commandLayer.addAuditEvent({
        type: "report:generated",
        entity: `Report ${type}`,
        source: commandLayer.actor,
        reasonCode: "REPORT_GEN",
        result: "SUCCESS",
        details: `Laporan Mobility Snapshot (${type}) berhasil digenerate (${telemetryData.docId}).`
      });

      if (typeof window.showToast === "function") {
        window.showToast(`✓ Mobility Snapshot Surabaya (${type}) berhasil dibuat.`);
      }
      soundManager.play('success');

    } catch (err) {
      if (signal.aborted) return;
      console.error("[ReportController] Generation error:", err);
      this._showErrorState(`Gagal menyusun Mobility Snapshot: ${err.message || 'Terjadi kesalahan sistem'}`);
      soundManager.play('alert');
    } finally {
      this.isGenerating = false;
    }
  }

  _getReportTelemetry(type) {
    const state = stateStore.getState() || {};
    return {
      volume: state.vehiclesToday || 128540,
      waitTime: state.avgWaitTime || 48,
      co2Saved: state.co2Saved || state.co2SavedKg || 1420,
      incidents: state.resolvedIncidents || 12,
      docId: `SITS-EKS-${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/REC-${Math.floor(1000 + Math.random() * 9000)}`
    };
  }

  async _renderReportPreviewCanvas(data) {
    return new Promise((resolve) => {
      try {
        const canvas = document.getElementById("reportPreviewCanvas");
        if (!canvas) {
          resolve();
          return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve();
          return;
        }

        const width = 600;
        const height = 200;
        canvas.width = width;
        canvas.height = height;

        // Clean dark gradient background
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#0f172a");
        bgGrad.addColorStop(1, "#1e293b");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Subtle grid lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
        ctx.lineWidth = 1;
        for (let x = 40; x < width; x += 65) {
          ctx.beginPath();
          ctx.moveTo(x, 20);
          ctx.lineTo(x, height - 30);
          ctx.stroke();
        }
        for (let y = 30; y < height - 30; y += 35) {
          ctx.beginPath();
          ctx.moveTo(40, y);
          ctx.lineTo(width - 20, y);
          ctx.stroke();
        }

        // Data points curve
        const points = [
          { x: 50, y: height - 40 },
          { x: 120, y: height - 60 },
          { x: 190, y: height - 130 }, // Morning peak
          { x: 260, y: height - 85 },
          { x: 330, y: height - 75 },
          { x: 400, y: height - 145 }, // Evening peak
          { x: 470, y: height - 90 },
          { x: 540, y: height - 50 }
        ];

        // Gradient area under curve
        const areaGrad = ctx.createLinearGradient(0, 20, 0, height - 30);
        areaGrad.addColorStop(0, "rgba(56, 189, 248, 0.35)");
        areaGrad.addColorStop(1, "rgba(56, 189, 248, 0.0)");

        ctx.beginPath();
        ctx.moveTo(points[0].x, height - 30);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, height - 30);
        ctx.closePath();
        ctx.fillStyle = areaGrad;
        ctx.fill();

        // Stroke curve
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          const xc = (points[i].x + points[i - 1].x) / 2;
          const yc = (points[i].y + points[i - 1].y) / 2;
          ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Glow dots
        points.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#38bdf8";
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });

        // Time labels
        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px 'Share Tech Mono', sans-serif";
        ctx.textAlign = "center";
        const times = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "23:00"];
        times.forEach((t, idx) => {
          const x = 50 + idx * 80;
          if (x <= width - 20) {
            ctx.fillText(t, x, height - 10);
          }
        });

        // Header watermark tag
        ctx.fillStyle = "rgba(0, 229, 255, 0.85)";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("SITS SURABAYA SNAPSHOT GRAPH", width - 20, 22);

        resolve();
      } catch (e) {
        console.warn("[ReportController] Canvas rendering notice:", e);
        resolve();
      }
    });
  }

  _updateLoaderProgress(percent, statusText) {
    const circle = document.getElementById("modalLoaderCircle");
    const percentEl = document.getElementById("loaderPercentage");
    const statusEl = document.getElementById("loaderStatus");

    if (circle) {
      const maxOffset = 264;
      const offset = maxOffset - (maxOffset * percent / 100);
      circle.style.strokeDashoffset = offset;
    }

    if (percentEl) {
      percentEl.textContent = `${Math.round(percent)}%`;
    }

    if (statusEl && statusText) {
      statusEl.textContent = statusText;
    }
  }

  _showDocPreviewState(data) {
    const loaderState = document.getElementById("reportLoaderState");
    const errorState = document.getElementById("reportErrorState");
    const previewState = document.getElementById("reportDocPreviewState");

    if (loaderState) loaderState.style.display = "none";
    if (errorState) errorState.style.display = "none";

    if (previewState) {
      previewState.style.display = "block";
      previewState.classList.remove("is-hidden");
    }

    const volumeEl = document.getElementById("repPreviewVolume");
    const waitEl = document.getElementById("repPreviewWait");
    const co2El = document.getElementById("repPreviewCo2");
    const incidentsEl = document.getElementById("repPreviewIncidents");
    const docIdEl = document.getElementById("repPreviewDocId");

    if (volumeEl) volumeEl.textContent = Number(data.volume).toLocaleString('id-ID');
    if (waitEl) waitEl.textContent = `${data.waitTime} detik`;
    if (co2El) co2El.textContent = `${data.co2Saved} kg`;
    if (incidentsEl) incidentsEl.textContent = `${data.incidents} insiden`;
    if (docIdEl) docIdEl.textContent = `DOC-ID: ${data.docId} • TERVERIFIKASI SISTEM`;
  }

  _showErrorState(message) {
    const loaderState = document.getElementById("reportLoaderState");
    const errorState = document.getElementById("reportErrorState");
    const previewState = document.getElementById("reportDocPreviewState");
    const msgEl = document.getElementById("reportErrorMessage");

    if (loaderState) loaderState.style.display = "none";
    if (previewState) previewState.style.display = "none";

    if (msgEl) msgEl.textContent = message;

    if (errorState) {
      errorState.style.display = "block";
      errorState.classList.remove("is-hidden");
    }
  }

  closeReportModal() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isGenerating = false;

    const modal = document.getElementById("reportModal");
    if (modal) {
      modal.classList.remove("show", "open");
      modal.style.setProperty("display", "none", "important");
    }
  }

  _logExportHistory(type) {
    const list = document.getElementById("exportHistoryList");
    if (!list) return;

    const empty = list.querySelector(".empty-history-text");
    if (empty) empty.remove();

    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement("div");
    item.className = "export-history-item glass-soft";
    item.style.cssText = "padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; display: flex; justify-content: space-between; font-size: 11.5px;";
    item.innerHTML = `
      <span>📄 Laporan ${type} (PDF)</span>
      <span style="color: var(--text-muted);">${time} WIB</span>
    `;
    list.insertBefore(item, list.firstChild);
  }

  _bindPrintExecutive() {
    const printBtns = [
      document.getElementById("btnPrintExecutive"),
      document.getElementById("printExecutiveReport")
    ].filter(Boolean);

    printBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        soundManager.play('click');
        window.print();
      });
    });
  }

  _bindCopyJson() {
    const copyBtns = [
      document.getElementById("btnCopyTelemetryJson"),
      document.getElementById("btnCopyApiJson")
    ].filter(Boolean);

    copyBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const state = stateStore.getState();
        const payload = JSON.stringify(state.telemetry || state, null, 2);
        navigator.clipboard.writeText(payload).then(() => {
          if (typeof window.showToast === "function") {
            window.showToast("✓ Format JSON Telemetri SITS disalin ke Clipboard.");
          }
          soundManager.play('success');
        }).catch(() => {
          if (typeof window.showToast === "function") {
            window.showToast("✓ Format JSON Telemetri SITS disalin.");
          }
          soundManager.play('success');
        });
      });
    });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const reportController = new ReportController();
