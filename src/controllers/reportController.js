/**
 * OmniTRAF Surabaya - Reports & Executive Export Controller
 * Menangani pembuatan Mobility Snapshot Surabaya, pencetakan PDF eksekutif,
 * canvas rendering visualisasi tren, error handling, dan penyalinan JSON API.
 */

import { soundManager } from '../core/soundManager.js';
import { stateStore } from '../core/stateStore.js';
import { commandLayer } from '../core/commandLayer.js';
import { Disposer } from '../core/disposer.js';
import { buildIncidentCsv } from '../core/csv.js';
import { createReportSnapshot } from '../../shared/reportSnapshot.js';

export class ReportController {
  constructor() {
    this.isGenerating = false;
    this.abortController = null;
    this.lastType = "Snapshot sesi";
    this.snapshot = null;
    this.returnFocusTo = null;
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
    this._bindExportCsv();
    this._bindModalControls();
    this._bindPrintExecutive();
    this._bindCopyJson();
    this._exposeGlobalBridges();
    this._syncSnapshotControls();
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
        const type = btn.dataset.reportType || btn.getAttribute("data-type") || "Snapshot sesi";
        this.generateMobilitySnapshot(type);
      }
    });
  }

  _bindExportCsv() {
    const button = document.getElementById('btnExportCsv');
    if (!button) return;
    this.disposer.addEventListener(button, 'click', () => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const snapshot = this._getActiveSnapshot();
        const csv = buildIncidentCsv(snapshot.incidents, snapshot.source, snapshot);
        this._logExportHistory(`CSV · ${snapshot.id} · berkas dibuat`, snapshot.id);
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `OmniTRAF-Simulation-Incidents-${new Date().toISOString().slice(0, 10)}.csv`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        if (typeof window.showToast === 'function') {
          const count = Array.isArray(snapshot.incidents) ? snapshot.incidents.length : 0;
          window.showToast(count ? `CSV simulasi dibuat dari snapshot ${snapshot.id} (${count} insiden).` : `CSV snapshot ${snapshot.id} dibuat tanpa insiden.`);
        }
        soundManager.play('success');
      } catch (error) {
        if (typeof window.showToast === 'function') window.showToast(`Ekspor CSV gagal: ${error.message}`, 'danger');
        soundManager.play('alert');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
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
          const { generateReportPdf } = await import('../../shared/reportPdf.js');
          const snapshot = this._getActiveSnapshot();
          if (!snapshot) throw new Error('Buat pratinjau snapshot terlebih dahulu.');
          const bytes = await generateReportPdf(snapshot);
          const blob = new Blob([bytes], { type: 'application/pdf' });

          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `OmniTRAF-Mobility-Snapshot-${new Date().toISOString().slice(0, 10)}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);

          this._logExportHistory(`PDF · ${snapshot.id} · berkas dibuat`, snapshot.id);
          if (typeof window.showToast === "function") {
            window.showToast("PDF simulasi dibuat dan unduhan dimulai.");
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
  async generateMobilitySnapshot(type = "Snapshot sesi") {
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
      if (!modal.classList.contains('show')) this.returnFocusTo = document.activeElement;
      modal.inert = false;
      modal.setAttribute('aria-hidden', 'false');
      modal.classList.add("show", "open");
      modal.style.setProperty("display", "flex", "important");
      document.getElementById('closeModal')?.focus({ preventScroll: true });
    }

    if (loaderState) loaderState.style.display = "block";
    if (errorState) errorState.style.display = "none";
    if (previewState) previewState.style.display = "none";

    try {
      this.isGenerating = true;
      this._updateLoaderProgress(5, "Menyiapkan snapshot simulasi...");

      // Stage 1: Fast Telemetry Aggregation (10% -> 50%)
      this._updateLoaderProgress(20, "Membaca state simulator...");
      await this._delay(0);
      if (signal.aborted) return;

      this._updateLoaderProgress(50, "Mengkalkulasi indikator volume & SPM...");
      const telemetryData = this._getReportTelemetry(type);
      await this._delay(0);
      if (signal.aborted) return;

      // Stage 2: Complete the report preview without adding an illustrative, non-data chart.
      this._updateLoaderProgress(100, "Selesai!");
      await this._delay(0);
      if (signal.aborted) return;

      this._showDocPreviewState(telemetryData);


      // Log to centralized audit trail
      commandLayer.addAuditEvent({
        type: "report:preview-generated",
        entity: `Preview report ${type}`,
        source: commandLayer.actor,
        reasonCode: "REPORT_PREVIEW",
        result: "SUCCESS",
        details: `Pratinjau Mobility Snapshot simulasi (${type}) berhasil dibuat (${telemetryData.docId}).`
      });

      if (typeof window.showToast === "function") {
        window.showToast(`Pratinjau snapshot simulasi berhasil dibuat.`);
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
    this.snapshot = createReportSnapshot(stateStore.getState() || {}, type || 'Snapshot sesi');
    this._syncSnapshotControls();
    return { ...this.snapshot.metrics, docId: this.snapshot.id, timestamp: this.snapshot.timestamp };
  }

  _getActiveSnapshot() {
    if (!this.snapshot) throw new Error('Buat snapshot sesi terlebih dahulu.');
    return this.snapshot;
  }

  _syncSnapshotControls() {
    const snapshot = this.snapshot;
    const status = document.getElementById('activeReportSnapshotState');
    const controls = ['btnExportCsv', 'btnPrintExecutive', 'btnCopyTelemetryJson', 'btnCopyApiJson'];
    controls.forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = !snapshot;
    });
    if (status) {
      if (!snapshot) {
        status.textContent = 'Belum ada snapshot. Buat snapshot untuk mengaktifkan ekspor CSV, PDF, JSON, dan cetak.';
        delete status.dataset.snapshotId;
      } else {
        const createdAt = Number.isFinite(new Date(snapshot.timestamp).getTime())
          ? new Date(snapshot.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB'
          : 'waktu tidak tersedia';
        const freshness = snapshot.stale ? ' · state sumber berstatus STALE' : '';
        status.textContent = `Snapshot aktif ${snapshot.id} · dibuat ${createdAt}${freshness}. Semua format memakai snapshot ini.`;
        status.dataset.snapshotId = snapshot.id;
      }
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

    const formatValue = (value, unit = '') => value === null || value === undefined || value === ''
      ? 'Tidak tersedia'
      : `${Number.isFinite(Number(value)) ? Number(value).toLocaleString('id-ID') : String(value)}${unit}`;
    if (volumeEl) volumeEl.textContent = formatValue(data.volume, ' kendaraan');
    if (waitEl) waitEl.textContent = formatValue(data.waitTime, ' detik');
    if (co2El) co2El.textContent = formatValue(data.co2Saved, ' kg');
    if (incidentsEl) incidentsEl.textContent = formatValue(data.incidents, ' insiden');
    const createdAt = data.timestamp && Number.isFinite(new Date(data.timestamp).getTime())
      ? new Date(data.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB'
      : 'waktu tidak tersedia';
    if (docIdEl) docIdEl.textContent = `ID: ${data.docId} · dibuat ${createdAt} · snapshot simulasi`;
    const snapshot = this.snapshot;
    const modal = document.getElementById('reportModal');
    if (modal && snapshot) modal.dataset.snapshotId = snapshot.id;
    const previewId = document.getElementById('docPreviewSnapshotId');
    if (previewId && snapshot) previewId.textContent = snapshot.id;
    const previewFreshness = document.getElementById('docPreviewFreshness');
    if (previewFreshness && snapshot) previewFreshness.textContent = snapshot.stale ? 'STALE' : 'CURRENT';
    const previewTime = document.getElementById('docPreviewTime');
    if (previewTime) previewTime.textContent = createdAt;
    const previewVolume = document.getElementById('docPreviewVolume');
    if (previewVolume) previewVolume.textContent = formatValue(data.volume, ' kendaraan');
    const previewWait = document.getElementById('docPreviewWait');
    if (previewWait) previewWait.textContent = formatValue(data.waitTime, ' detik');
    const previewCo2 = document.getElementById('docPreviewCo2');
    if (previewCo2) previewCo2.textContent = formatValue(data.co2Saved, ' kg');
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

  _updateLoaderProgress(percent, message) {
    const progress = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    const percentageEl = document.getElementById('loaderPercentage');
    const statusEl = document.getElementById('loaderStatus');
    const circle = document.getElementById('modalLoaderCircle');
    if (percentageEl) percentageEl.textContent = `${progress}%`;
    if (statusEl) statusEl.textContent = String(message || 'Menyiapkan pratinjau laporan simulasi…');
    if (circle) circle.style.strokeDashoffset = String(264 * (1 - progress / 100));
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
      modal.setAttribute('aria-hidden', 'true');
      modal.inert = true;
    }
    const returnFocusTo = this.returnFocusTo;
    this.returnFocusTo = null;
    if (returnFocusTo?.isConnected && !returnFocusTo.disabled) returnFocusTo.focus({ preventScroll: true });
  }

  _logExportHistory(type, snapshotId = null) {
    const list = document.getElementById("exportHistoryList");
    if (!list) return;

    const empty = list.querySelector(".empty-history-text");
    if (empty) empty.remove();

    const time = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
    const item = document.createElement("div");
    item.className = "export-history-item glass-soft";
    if (snapshotId) item.dataset.snapshotId = snapshotId;
    item.style.cssText = "padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; display: flex; justify-content: space-between; font-size: 11.5px;";
    const label = document.createElement('span');
    label.textContent = `${String(type ?? '')}`;
    const timestamp = document.createElement('span');
    timestamp.className = 'report-timestamp';
    timestamp.textContent = `${time} WIB`;
    item.append(label, timestamp);
    list.insertBefore(item, list.firstChild);
  }

  _bindPrintExecutive() {
    const printBtns = [
      document.getElementById("btnPrintExecutive")
    ].filter(Boolean);

    printBtns.forEach(btn => {
      this.disposer.addEventListener(btn, "click", () => {
        soundManager.play('click');
        try {
          const snapshot = this._getActiveSnapshot();
          this._refreshExecutivePrintDocument();
          this._logExportHistory(`Cetak · ${snapshot.id} · dialog dibuka`, snapshot.id);
          window.print();
        } catch (error) {
          if (typeof window.showToast === 'function') window.showToast(error.message, 'warning');
        }
      });
    });
  }

  _refreshExecutivePrintDocument() {
    const root = document.getElementById('executivePrintDoc');
    if (!root) return;
    const snapshot = this._getActiveSnapshot();
    root.dataset.snapshotId = snapshot.id;
    const telemetry = { vehiclesToday: snapshot.metrics.volume, avgWaitTime: snapshot.metrics.waitTime, co2SavedKg: snapshot.metrics.co2Saved };
    const formatValue = (value, unit = '') => value === null || value === undefined || value === ''
      ? 'Tidak tersedia'
      : `${Number.isFinite(Number(value)) ? Number(value).toLocaleString('id-ID') : String(value)}${unit}`;
    const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };

    setText('printSnapshotId', snapshot.id);
    setText('printSourceFreshness', snapshot.stale ? 'STALE' : 'CURRENT');
    setText('printDateStr', new Date(snapshot.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB');
    setText('printVolVal', formatValue(telemetry.vehiclesToday ?? telemetry.totalVehicles, ' kendaraan'));
    setText('printWaitVal', formatValue(telemetry.avgWaitTime, ' detik'));
    setText('printCo2Val', formatValue(telemetry.co2SavedKg, ' kg CO₂'));
    setText('printIncVal', `${snapshot.metrics.incidents} insiden selesai`);

    const rows = root.querySelector('#printCorridorRows');
    if (!rows) return;
    rows.replaceChildren();
    const intersections = snapshot.intersections;
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
        intersection.volume,
        intersection.speed,
        intersection.controlMode,
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
        let snapshot;
        try { snapshot = this._getActiveSnapshot(); }
        catch (error) {
          if (typeof window.showToast === 'function') window.showToast(error.message, 'warning');
          return;
        }
        const payload = JSON.stringify(snapshot, null, 2);
        if (!navigator.clipboard?.writeText) {
          if (typeof window.showToast === "function") window.showToast("Clipboard tidak tersedia pada browser ini.", "danger");
          return;
        }
        navigator.clipboard.writeText(payload).then(() => {
          if (typeof window.showToast === "function") {
            window.showToast("✓ Snapshot sesi dalam format JSON disalin ke Clipboard.");
          }
          this._logExportHistory(`JSON · ${snapshot.id} · disalin`, snapshot.id);
          soundManager.play('success');
        }).catch((error) => {
          if (typeof window.showToast === "function") {
            window.showToast(`Gagal menyalin snapshot: ${error.message || 'akses clipboard ditolak'}.`, "danger");
          }
          soundManager.play('alert');
        });
      });
    });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const reportController = new ReportController();
