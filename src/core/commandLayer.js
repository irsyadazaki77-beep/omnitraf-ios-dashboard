/**
 * OmniTRAF Surabaya - Centralized Operator Command Layer & Audit Trail (Phase 7)
 * Mengelola siklus perintah (Intent -> Validation -> Guard -> Dispatch -> Ack -> State Update),
 * in-memory ring-buffer Audit Trail, Operator Sessions, dan Decision Traceability.
 */

import { stateStore } from './stateStore.js';
import { socketClient } from './socketClient.js';
import { soundManager } from './soundManager.js';

class CommandLayer {
  constructor() {
    this.sessionId = `SESS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    this.actor = "Zaki Putra (Operator SITS)";
    this.clientVersion = "v1.7.0-enterprise";
    this.connectedAt = new Date().toISOString();
    this.lastActivityAt = new Date().toISOString();
    
    // Idempotency keys & pending commands maps
    this.executedCommandIds = new Set();
    this.pendingCommands = new Map();
    
    // In-memory Audit Trail Ring Buffer (Bounded)
    this.auditHistory = [];
    this.maxAuditLimit = 150;

    // AI recommendation trace mapping
    this.recommendationTrace = new Map(); // recommendationId -> commandId -> resulting state

    this._setupUIElements();
    this._subscribeToEvents();
  }

  _setupUIElements() {
    // Memastikan elemen modal confirmation guard programmatic ada di DOM
    if (typeof document !== 'undefined') {
      const existing = document.getElementById("operatorConfirmModal");
      if (!existing) {
        const modalHtml = `
          <div class="modal-overlay" id="operatorConfirmModal" style="display:none; z-index:99999; justify-content:center; align-items:center; background:rgba(15,23,42,0.85); backdrop-filter:blur(4px); transition:opacity 0.2s;">
            <div class="modal-content glass-panel" style="max-width:480px; width:94vw; border:1px solid rgba(239,68,68,0.4); padding:24px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
                <span style="font-size:32px; color:#ef4444;">⚠️</span>
                <div>
                  <h3 style="margin:0; font-size:18px; font-weight:800; color:#fff;" id="confirmModalTitle">KONFIRMASI PERINTAH BERISIKO TINGGI</h3>
                  <p style="margin:2px 0 0 0; font-size:11px; color:#ef4444; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;" id="confirmModalLevel">CRITICAL ACTION REQUIRED</p>
                </div>
              </div>
              
              <div style="font-size:12.5px; line-height:1.5; color:#cbd5e1; background:rgba(0,0,0,0.2); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); margin-bottom:18px;">
                <div style="margin-bottom:6px;"><strong style="color:#94a3b8;">Target / Lokasi:</strong> <span id="confirmModalTarget" style="color:#fff; font-family:'Share Tech Mono'; font-weight:700;">-</span></div>
                <div style="margin-bottom:6px;"><strong style="color:#94a3b8;">Alasan / Deskripsi:</strong> <span id="confirmModalReason">-</span></div>
                <div style="margin-bottom:6px;"><strong style="color:#94a3b8;">Estimasi Durasi:</strong> <span id="confirmModalDuration" style="color:#38bdf8;">-</span></div>
                <div><strong style="color:#94a3b8;">Persimpangan Terdampak:</strong> <span id="confirmModalImpacted" style="color:#f59e0b;">-</span></div>
              </div>

              <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button class="btn btn-ghost" id="btnConfirmCancel" style="padding:8px 16px; font-size:12px;">Batalkan</button>
                <button class="btn btn-primary" id="btnConfirmProceed" style="background:#ef4444; border-color:#ef4444; color:#fff; padding:8px 20px; font-weight:700; font-size:12px;">Setujui & Kirim</button>
              </div>
            </div>
          </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
      }
    }
  }

  _subscribeToEvents() {
    // Sinkronisasi status audit log dari server jika ada
    const socket = socketClient.getSocket();
    if (socket) {
      socket.on('audit:log', (log) => {
        this.addAuditEvent(log, false);
      });
      // Sinkronisasi status commands
      socket.on('command:ack', (ack) => {
        this._handleCommandAck(ack);
      });
    }

    // Subscribe global state change untuk logging real-time
    stateStore.subscribe('state:changed', (envelope) => {
      if (envelope && envelope.payload) {
        const payload = envelope.payload;
        this.addAuditEvent({
          type: "state:changed",
          timestamp: envelope.timestamp,
          source: envelope.source || "local",
          entity: "StateStore",
          result: "SUCCESS",
          reasonCode: "STATE_MUTATION",
          details: `Kunci state berubah: ${payload.changedKeys?.join(', ')}`
        });
      }
    });
  }

  /**
   * Mengirim / Menjalankan Operator Command melalui Pipeline Terpusat
   * @param {Object} intent { action, targetType, targetId, payload }
   * @param {boolean} isHighRisk Apakah memerlukan confirmation guard
   * @returns {Promise<Object>} Command outcome
   */
  async dispatchCommand(intent, isHighRisk = false) {
    this.lastActivityAt = new Date().toISOString();
    const commandId = `CMD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const correlationId = `CORR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

    const cmd = {
      commandId,
      action: intent.action,
      targetType: intent.targetType,
      targetId: intent.targetId,
      requestedAt: new Date().toISOString(),
      source: this.actor,
      payload: intent.payload || {},
      previousState: this._captureStateSnapshot(intent.targetType, intent.targetId),
      result: 'PENDING',
      completedAt: null,
      errorCode: null,
      correlationId
    };

    // 1. Validasi Idempotency
    const idempotencyKey = `${intent.action}:${JSON.stringify(intent.payload)}`;
    if (this._checkIdempotency(intent.action, intent.payload)) {
      console.warn(`[CommandLayer] Perintah duplikat / idempotent ditolak: ${intent.action}`);
      return { success: true, type: "idempotent_no_op", commandId };
    }

    // 2. State Machine Rule Check
    const validationError = this._validateStateMachine(intent);
    if (validationError) {
      this.addAuditEvent({
        type: "command:rejected",
        entity: intent.targetId,
        source: this.actor,
        reasonCode: "STATE_MACHINE_REJECT",
        result: "REJECTED",
        details: `Gagal validasi state: ${validationError}`
      });
      throw new Error(validationError);
    }

    // 3. Confirmation Guard untuk aksi berisiko tinggi
    if (isHighRisk) {
      const userApproved = await this._showConfirmationGuard(intent);
      if (!userApproved) {
        this.addAuditEvent({
          type: "command:rejected",
          entity: intent.targetId,
          source: this.actor,
          reasonCode: "OPERATOR_CANCELLED",
          result: "CANCELLED",
          details: `Perintah dibatalkan oleh operator.`
        });
        throw new Error("Perintah dibatalkan oleh operator.");
      }
    }

    // 4. Catat ke in-memory pending commands
    this.pendingCommands.set(commandId, cmd);
    this.addAuditEvent({
      type: "command:requested",
      entity: intent.targetId,
      source: this.actor,
      reasonCode: "COMMAND_PENDING",
      correlationId,
      result: "PROCESSING",
      details: `Menjalankan perintah ${intent.action} pada ${intent.targetId}...`
    });

    // 5. Kirim Perintah secara Fisik ke Server / Socket
    return new Promise((resolve, reject) => {
      const socket = socketClient.getSocket();
      if (!socket || !socket.connected) {
        // Fallback Standalone / Offline Mode
        cmd.result = 'APPLIED';
        cmd.completedAt = new Date().toISOString();
        this.pendingCommands.delete(commandId);
        this.executedCommandIds.add(idempotencyKey);
        
        // Mutasi StateStore lokal optimis
        this._mutateStateStoreLocally(intent);
        
        this.addAuditEvent({
          type: "command:acknowledged",
          entity: intent.targetId,
          source: "Local Fallback Simulator",
          reasonCode: "STANDALONE_ACK",
          correlationId,
          result: "SUCCESS",
          details: `Perintah ${intent.action} berhasil diterapkan secara lokal (Offline Fallback).`
        });

        resolve({ success: true, commandId, state: "applied", mode: "offline" });
        return;
      }

      // Kirim via Socket.io dengan Timeout 4 detik
      const timeoutId = setTimeout(() => {
        cmd.result = 'FAILED';
        cmd.errorCode = 'TIMEOUT';
        cmd.completedAt = new Date().toISOString();
        this.pendingCommands.delete(commandId);
        
        this.addAuditEvent({
          type: "command:failed",
          entity: intent.targetId,
          source: this.actor,
          reasonCode: "TIMEOUT_RECONCILIATION",
          correlationId,
          result: "FAILED",
          details: `Koneksi perintah timeout. Memulai rekonsiliasi resync...`
        });

        // Trigger resync rekonsiliasi state canonical
        socketClient.requestResync();
        reject(new Error("Timeout: Server tidak merespons dalam waktu 4 detik. Menunggu sinkronisasi ulang..."));
      }, 4000);

      // Kirim ke socket server
      socket.emit('operator:command', { cmd, correlationId }, (response) => {
        clearTimeout(timeoutId);
        this.pendingCommands.delete(commandId);

        if (response && response.success) {
          cmd.result = 'APPLIED';
          cmd.completedAt = new Date().toISOString();
          this.executedCommandIds.add(idempotencyKey);

          // Simpan Decision Traceability jika berasal dari AI Recommendation
          if (intent.payload && intent.payload.recommendationId) {
            this.recommendationTrace.set(intent.payload.recommendationId, {
              commandId,
              resultingState: response.resultingState || intent.payload
            });
          }

          this.addAuditEvent({
            type: "command:acknowledged",
            entity: intent.targetId,
            source: "SITS Core Server",
            reasonCode: "SERVER_ACK",
            correlationId,
            result: "SUCCESS",
            details: `Perintah ${intent.action} berhasil divalidasi dan diterapkan di server.`
          });

          resolve({ success: true, commandId, data: response.data });
        } else {
          cmd.result = 'REJECTED';
          cmd.errorCode = response?.error || 'SERVER_REJECT';
          cmd.completedAt = new Date().toISOString();

          this.addAuditEvent({
            type: "command:rejected",
            entity: intent.targetId,
            source: "SITS Core Server",
            reasonCode: "SERVER_REJECTED",
            correlationId,
            result: "REJECTED",
            details: `Perintah ditolak server: ${response?.error || 'Alasan keamanan / otentikasi'}`
          });

          reject(new Error(response?.error || "Perintah ditolak oleh Server ATCS SITS."));
        }
      });
    });
  }

  _checkIdempotency(action, payload) {
    const state = stateStore.getState();

    if (action === 'green-wave:toggle') {
      return state.greenWaveActive === !!payload.active;
    }
    if (action === 'emergency:activate') {
      const activeEmg = state.activeEmergencies || [];
      return activeEmg.some(e => e.vehicleId === payload.code && !["COMPLETED", "CANCELLED"].includes(e.status));
    }
    if (action === 'device:config') {
      const dev = (state.devices || []).find(d => d.deviceId === payload.deviceId);
      if (dev) {
        return dev.fps === payload.fps && dev.resolution === payload.resolution;
      }
    }
    return false;
  }

  _validateStateMachine(intent) {
    const state = stateStore.getState();
    const action = intent.action;

    if (action === 'incident:acknowledge' || action === 'incident:resolve') {
      const id = intent.targetId;
      const inc = (state.incidents || []).find(i => String(i.id) === String(id));
      if (!inc) {
        return `Insiden #${id} tidak ditemukan di log aktif.`;
      }
      if (inc.status === "RESOLVED" && action === 'incident:acknowledge') {
        return `Insiden #${id} sudah terselesaikan (RESOLVED). Tidak dapat di-Acknowledge ulang.`;
      }
    }

    if (action === 'emergency:activate') {
      const code = intent.payload?.code;
      const existing = (state.activeEmergencies || []).find(
        e => e.vehicleId === code && !["COMPLETED", "CANCELLED"].includes(e.status)
      );
      if (existing) {
        return `Kendaraan prioritas ${code} sedang aktif dalam rute. Gunakan rute alternatif atau batalkan dispensasi lama.`;
      }
    }

    return null;
  }

  _showConfirmationGuard(intent) {
    return new Promise((resolve) => {
      const modal = document.getElementById("operatorConfirmModal");
      const title = document.getElementById("confirmModalTitle");
      const target = document.getElementById("confirmModalTarget");
      const reason = document.getElementById("confirmModalReason");
      const duration = document.getElementById("confirmModalDuration");
      const impacted = document.getElementById("confirmModalImpacted");
      const btnCancel = document.getElementById("btnConfirmCancel");
      const btnProceed = document.getElementById("btnConfirmProceed");

      if (!modal) {
        resolve(true);
        return;
      }

      // Customize content based on action severity
      if (intent.action === 'emergency:activate') {
        title.textContent = "KONFIRMASI DISPATCH KENDARAAN DARURAT (112)";
        target.textContent = `${intent.payload.code || 'AMBULANCE-02'} (Rute: ${intent.payload.route ? intent.payload.route.replace('route-', '').toUpperCase() : 'SOETOMO'})`;
        reason.textContent = "Pengaktifan lampu hijau penuh (Preemption Hijau Koridor) berisiko menghentikan arus komuter di persimpangan silang secara tiba-tiba.";
        duration.textContent = "300 detik (Maksimal / Otomatis nonaktif)";
        impacted.textContent = "Wonokromo, Raya Darmo, Marmoyo, DTC Wonokromo";
      } else if (intent.action === 'signal:override') {
        title.textContent = "KONFIRMASI MANUAL SIGNAL OVERRIDE";
        target.textContent = intent.targetId;
        reason.textContent = "Mengunci persimpangan pada fase Hijau selama 45 detik dapat meningkatkan antrean volume kendaraan di arah silang.";
        duration.textContent = "45 detik berkelanjutan";
        impacted.textContent = `${intent.targetId} dan koridor terdekat`;
      } else if (intent.action === 'green-wave:toggle') {
        title.textContent = "KONFIRMASI GREEN WAVE TIMING LOCK";
        target.textContent = "Koridor Utama A. Yani - Darmo";
        reason.textContent = "Melakukan sinkronisasi gelombang hijau penuh untuk mengurai bottleneck. Membatasi kontrol dinamis adaptif AI.";
        duration.textContent = intent.payload.active ? "Aktif terus-menerus sampai dinonaktifkan" : "Kembali ke mode adaptif SITS";
        impacted.textContent = "Wonokromo, Margorejo, Darmo, Tunjungan";
      } else {
        title.textContent = "KONFIRMASI TINDAKAN OPERATOR CRITICAL";
        target.textContent = intent.targetId || "Sistem Core SITS";
        reason.textContent = "Menyesuaikan parameter operasional ATCS Surabaya yang berdampak luas.";
        duration.textContent = "Seketika (Real-Time)";
        impacted.textContent = "Seluruh Node AI SITS";
      }

      modal.style.display = "flex";
      modal.style.opacity = "1";

      const handleCancel = () => {
        modal.style.display = "none";
        btnCancel.removeEventListener("click", handleCancel);
        btnProceed.removeEventListener("click", handleProceed);
        resolve(false);
      };

      const handleProceed = () => {
        modal.style.display = "none";
        btnCancel.removeEventListener("click", handleCancel);
        btnProceed.removeEventListener("click", handleProceed);
        resolve(true);
      };

      btnCancel.addEventListener("click", handleCancel);
      btnProceed.addEventListener("click", handleProceed);
    });
  }

  _captureStateSnapshot(type, id) {
    const state = stateStore.getState();
    if (type === 'intersection') {
      return (state.intersections || []).find(n => n.id === id);
    }
    if (type === 'device') {
      return (state.devices || []).find(d => d.deviceId === id);
    }
    return {};
  }

  _mutateStateStoreLocally(intent) {
    const action = intent.action;
    const payload = intent.payload;

    if (action === 'green-wave:toggle') {
      stateStore.setState({ greenWaveActive: !!payload.active });
    } else if (action === 'signal:override') {
      const ints = (stateStore.getState().intersections || []).map(n => {
        if (n.id === intent.targetId) {
          return { ...n, state: "green", timer: payload.duration || 45, status: "Manual Override" };
        }
        return n;
      });
      stateStore.setState({ intersections: ints });
    } else if (action === 'green-split:update') {
      const ints = (stateStore.getState().intersections || []).map(n => {
        if (n.id === intent.targetId) {
          return { ...n, greenSplit: payload.value };
        }
        return n;
      });
      stateStore.setState({ intersections: ints });
    } else if (action === 'incident:acknowledge') {
      const incs = (stateStore.getState().incidents || []).map(i => {
        if (String(i.id) === String(intent.targetId)) {
          return { ...i, status: "ACKNOWLEDGED", acknowledgedAt: new Date().toISOString() };
        }
        return i;
      });
      stateStore.setState({ incidents: incs });
    } else if (action === 'incident:resolve') {
      const incs = (stateStore.getState().incidents || []).map(i => {
        if (String(i.id) === String(intent.targetId)) {
          return { ...i, status: "RESOLVED", resolvedAt: new Date().toISOString() };
        }
        return i;
      });
      stateStore.setState({ incidents: incs });
    }
  }

  _handleCommandAck(ack) {
    if (!ack) return;
    const { correlationId, commandId, result, details } = ack;
    console.info(`[CommandLayer] Command ACK received: ${commandId} (${result})`);
  }

  /**
   * Menambahkan log event baru ke dalam Centralized Audit Trail & Sinkronisasi Terminal
   */
  addAuditEvent(event, broadcast = true) {
    const timestamp = event.timestamp || new Date().toISOString();
    const cleanLog = {
      id: `AUD-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp,
      type: event.type || "state:changed",
      entity: event.entity || "System Core",
      source: event.source || this.actor,
      reasonCode: event.reasonCode || "AUDIT_RECORD",
      result: event.result || "SUCCESS",
      details: event.details || "",
      correlationId: event.correlationId || ""
    };

    // Pencegahan duplikasi event yang identik berurutan (deduplication)
    const last = this.auditHistory[0];
    if (last && last.type === cleanLog.type && last.details === cleanLog.details && (Date.now() - Date.parse(last.timestamp)) < 1500) {
      return; // Deduplicated!
    }

    this.auditHistory.unshift(cleanLog);
    if (this.auditHistory.length > this.maxAuditLimit) {
      this.auditHistory.pop();
    }

    // Perbarui terminal UI logs secara dinamis
    this._updateTerminalLogUI(cleanLog);

    if (broadcast) {
      stateStore.publish("audit:log:new", cleanLog);
    }
  }

  _updateTerminalLogUI(log) {
    const terminal = document.getElementById("terminalLogs");
    if (!terminal) return;

    const time = new Date(log.timestamp).toLocaleTimeString('id-ID');
    const levelClass = log.result === "FAILED" || log.result === "REJECTED" ? "log-err" : 
                       log.type.includes("emergency") || log.type.includes("high-latency") ? "log-crit" : 
                       log.type.includes("command") ? "log-cmd" : "log-info";

    const label = log.type.replace(':', ' ').toUpperCase();
    
    let colorStyle = "color:#94a3b8;"; // default info
    if (log.result === "FAILED") colorStyle = "color:#f43f5e; font-weight:700;"; // red
    else if (log.result === "REJECTED") colorStyle = "color:#fbbf24; font-weight:700;"; // orange/yellow
    else if (log.type.includes("command:acknowledged") || log.details.includes("pulih") || log.details.includes("Selesai")) colorStyle = "color:#10b981; font-weight:700;"; // green success
    else if (log.type.includes("command:requested") || log.type.includes("validated")) colorStyle = "color:#38bdf8;"; // sky blue
    else if (log.type.includes("emergency")) colorStyle = "color:#f43f5e;"; // emergency red

    const lineHtml = `
      <div class="terminal-line" style="margin-bottom:4px; font-family:'Share Tech Mono', monospace; font-size:11.5px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:3px; ${colorStyle}">
        [${time}] [${label}] • ${log.details}
      </div>
    `;

    // Append to container, keeping limit
    terminal.insertAdjacentHTML('beforeend', lineHtml);
    
    // Auto scroll to bottom
    terminal.scrollTop = terminal.scrollHeight;

    // Bounded terminal lines in DOM
    const lines = terminal.querySelectorAll(".terminal-line");
    if (lines.length > 80) {
      lines[0].remove();
    }
  }

  getAuditTrail(filter = {}) {
    let list = [...this.auditHistory];
    if (filter.type) {
      list = list.filter(l => l.type === filter.type);
    }
    if (filter.entity) {
      list = list.filter(l => l.entity === filter.entity);
    }
    if (filter.severity) {
      list = list.filter(l => l.result === filter.severity);
    }
    return list;
  }
}

export const commandLayer = new CommandLayer();
window.commandLayer = commandLayer;
