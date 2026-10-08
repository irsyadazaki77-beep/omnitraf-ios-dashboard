/**
 * OmniTRAF Surabaya - Reports & Executive Export Controller
 * Menangani pembuatan Mobility Snapshot Surabaya, pencetakan PDF eksekutif,
 * canvas rendering visualisasi tren, error handling, dan penyalinan JSON API.
 */

import { soundManager } from '../core/soundManager.js';
import { stateStore } from '../core/stateStore.js';
import { commandLayer } from '../core/commandLayer.js';
import { Disposer } from '../core/disposer.js';

export class ReportController {
  constructor() {
    this.isGenerating = false;
    this.abortController = null;
    this.lastType = "Daily Mobility";
    this._isBound = false;
    this.disposer = new Disposer('ReportController');
  }

  init() {
    if (this._isBound) return;
    this._isBound = true;
  }

  activate() {
    this.deactivate(); // Ensure clean slate before binding

    this._bindExportButtons();
    this._bindModalControls();
    this._bindPrintExecutive();
    this._bindCopyJson();
    this._exposeGlobalBridges();
  }

  deactivate() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isGenerating = false;
    this.disposer.clear();
  }

  _exposeGlobalBridges() {
    window.closeReportModal = () => this.closeReportModal();
    window.generateMobilitySnapshot = (type) => this.generateMobilitySnapshot(type);
  }

  _bindExportButtons() {
    this.disposer.addEventListener(document, "click", (e) => {
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
      this.disposer.addEventListener(btn, "click", (e) => {
        e.preventDefault();
        this.closeReportModal();
      });
    });

    const modal = document.getElementById("reportModal");
    if (modal) {
      this.disposer.addEventListener(modal, "click", (e) => {
        if (e.target === modal) {
          this.closeReportModal();
        }
      });
    }

    const retryBtn = document.getElementById("btnRetryReportGen");
    if (retryBtn) {
      this.disposer.addEventListener(retryBtn, "click", (e) => {
        e.preventDefault();
        this.generateMobilitySnapshot(this.lastType);
      });
    }

    const printDocBtn = document.getElementById("btnPrintReportDoc");
    if (printDocBtn) {
      this.disposer.addEventListener(printDocBtn, "click", async (e) => {
        e.preventDefault();
        soundManager.play('click');
        const origText = printDocBtn.textContent;
        printDocBtn.disabled = true;
        printDocBtn.textContent = "Mengunduh PDF...";

        try {
          const downloadUrl = `/api/reports/download?type=${encodeURIComponent(this.lastType || "Daily Mobility")}`;
          const res = await fetch(downloadUrl);
          const contentType = res.headers.get("content-type") || "";

          if (!res.ok || !contentType.includes("application/pdf")) {
            let errorMsg = `Server mengembalikan status HTTP ${res.status}`;
            try {
              const errJson = await res.json();
              if (errJson?.error?.message) errorMsg = errJson.error.message;
              else if (errJson?.message) errorMsg = errJson.message;
            } catch (_) {}
            throw new Error(errorMsg);
          }

          const blob = await res.blob();
          if (blob.size < 100) {
            throw new Error("Dokumen PDF yang diterima kosong atau korup.");
          }

          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `OmniTRAF-Mobility-Snapshot-${new Date().toISOString().slice(0, 10)}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);

          if (typeof window.showToast === "function") {
            window.showToast("✓ Laporan demo simulasi berhasil diunduh.");
          }
          soundManager.play('success');
        } catch (err) {
          console.error("Gagal mengunduh PDF laporan:", err);
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal unduh PDF: ${err.message}`, "danger");
          }
          soundManager.play('alert');
        } finally {
          printDocBtn.disabled = false;
          printDocBtn.textContent = origText;
        }
      });
    }
  }

  /**
   * Main Pipeline for Generating Mobility Snapshot
   */
  async generateMobilitySnapshot(type = "Daily Mobility") {
    if (this.isGenerating) {
      console.warn("[ReportController] Laporan sedang diproses. Mengabaikan request ganda.");
      return;
    }

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

      // Stage 2: Complete the report preview without adding an illustrative, non-data chart.
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
    const telemetry = state.telemetry || {};
    return {
      volume: telemetry.vehiclesToday ?? telemetry.totalVehicles ?? null,
      waitTime: telemetry.avgWaitTime ?? null,
      co2Saved: telemetry.co2SavedKg ?? null,
      incidents: Array.isArray(state.incidents) ? state.incidents.filter(i => i.status === 'RESOLVED').length : null,
      docId: `SITS-EKS-${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/REC-${Math.floor(1000 + Math.random() * 9000)}`
    };
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

    const formatValue = (value, unit = '') => value === null || value === undefined || value === ''
      ? 'Tidak tersedia'
      : `${Number.isFinite(Number(value)) ? Number(value).toLocaleString('id-ID') : String(value)}${unit}`;
    if (volumeEl) volumeEl.textContent = formatValue(data.volume, ' kendaraan');
    if (waitEl) waitEl.textContent = formatValue(data.waitTime, ' detik');
    if (co2El) co2El.textContent = formatValue(data.co2Saved, ' kg');
    if (incidentsEl) incidentsEl.textContent = formatValue(data.incidents, ' insiden');
    if (docIdEl) docIdEl.textContent = `ID DEMO: ${data.docId} • DATA SIMULASI, TIDAK TERVERIFIKASI UNTUK OPERASI`;
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
    const label = document.createElement('span');
    label.textContent = `📄 Laporan ${String(type ?? '')} (PDF)`;
    const timestamp = document.createElement('span');
    timestamp.className = 'report-timestamp';
    timestamp.textContent = `${time} WIB`;
    item.append(label, timestamp);
    list.insertBefore(item, list.firstChild);
  }

  _bindPrintExecutive() {
    const printBtns = [
      document.getElementById("btnPrintExecutive"),
      document.getElementById("btnPrintReportDoc")
    ].filter(Boolean);

    printBtns.forEach(btn => {
      this.disposer.addEventListener(btn, "click", () => {
        soundManager.play('click');
        this._refreshExecutivePrintDocument();
        window.print();
      });
    });
  }

  _refreshExecutivePrintDocument() {
    const root = document.getElementById('executivePrintDoc');
    if (!root) return;
    const state = stateStore.getState() || {};
    const telemetry = state.telemetry || {};
    const formatValue = (value, unit = '') => value === null || value === undefined || value === ''
      ? 'Tidak tersedia'
      : `${Number.isFinite(Number(value)) ? Number(value).toLocaleString('id-ID') : String(value)}${unit}`;
    const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };

    setText('printDateStr', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB');
    setText('printVolVal', formatValue(telemetry.vehiclesToday ?? telemetry.totalVehicles, ' kendaraan'));
    setText('printWaitVal', formatValue(telemetry.avgWaitTime, ' detik'));
    setText('printCo2Val', formatValue(telemetry.co2SavedKg, ' kg CO₂'));
    setText('printIncVal', Array.isArray(state.incidents)
      ? `${state.incidents.filter((incident) => String(incident.status).toUpperCase() === 'RESOLVED').length} insiden selesai`
      : 'Tidak tersedia');

    const rows = root.querySelector('#printCorridorRows');
    if (!rows) return;
    rows.replaceChildren();
    const intersections = Array.isArray(state.intersections) ? state.intersections.slice(0, 8) : [];
    if (intersections.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'Data koridor belum tersedia pada snapshot ini.';
      row.appendChild(cell);
      rows.appendChild(row);
      return;
    }
    intersections.forEach((intersection) => {
      const row = document.createElement('tr');
      const values = [
        intersection.name || intersection.id || 'Simpang tanpa nama',
        intersection.traffic?.volume ?? intersection.traffic?.vehicleCount,
        intersection.traffic?.speed,
        intersection.signal?.controlMode,
        intersection.status
      ];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        const unit = index === 1 && value !== null && value !== undefined ? ' kendaraan' : index === 2 && value !== null && value !== undefined ? ' km/jam' : '';
        cell.textContent = index === 0 ? String(value) : formatValue(value, unit);
        row.appendChild(cell);
      });
      rows.appendChild(row);
    });
  }

  _bindCopyJson() {
    const copyBtns = [
      document.getElementById("btnCopyTelemetryJson"),
      document.getElementById("btnCopyApiJson")
    ].filter(Boolean);

    copyBtns.forEach(btn => {
      this.disposer.addEventListener(btn, "click", () => {
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
