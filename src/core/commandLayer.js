/**
 * OmniTRAF Surabaya - Centralized Operator Command Layer & Audit Trail (Phase 7)
 * Mengelola siklus perintah (Intent -> Validation -> Guard -> Dispatch -> Ack -> State Update),
 * in-memory ring-buffer Audit Trail, Operator Sessions, dan Decision Traceability.
 */

import { stateStore } from './stateStore.js';
import { socketClient } from './socketClient.js';
import { soundManager } from './soundManager.js';
import { authManager } from './authManager.js';
import { diagnostics, DIAGNOSTIC_LEVELS, EVENT_CATEGORIES } from './diagnostics.js';

function generateSecureId(prefix = 'CMD') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

class CommandLayer {
  constructor() {
    this.sessionId = generateSecureId('SESS');
    this.clientVersion = "v1.7.0-enterprise";
    this.connectedAt = new Date().toISOString();
    this.lastActivityAt = new Date().toISOString();
    
    // Idempotency keys & pending commands maps
    this.executedCommands = new Map(); // idempotencyKey -> result
    this.pendingCommands = new Map(); // commandId -> cmd
    
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

    // Teardown pending state & reset session on auth changes (logout or switch user)
    authManager.onAuthChange((user, token) => {
      this.pendingCommands.clear();
      this.executedCommands.clear();
      this.sessionId = generateSecureId('SESS');
      this.addAuditEvent({
        type: "auth:changed",
        timestamp: new Date().toISOString(),
        source: "client",
        entity: "SessionContext",
        result: user ? `AUTHENTICATED (${user.role})` : "LOGGED_OUT",
        reasonCode: "AUTH_CONTEXT_SWITCH",
        details: user ? `Principal active: ${user.username} (${user.role})` : "Sesi dibersihkan total."
      });
    });
  }

  get actor() {
    const user = authManager.getUser();
    if (user && user.name) {
      return `${user.name} (${user.role ? user.role.toUpperCase() : 'OPERATOR'})`;
    }
    return "Zaki Putra (Operator SITS)";
  }

  /**
   * Mengirim / Menjalankan Operator Command melalui Pipeline Terpusat
   * @param {Object} intent { action, targetType, targetId, payload }
   * @param {boolean} isHighRisk Apakah memerlukan confirmation guard
   * @returns {Promise<Object>} Command outcome
   */
  async dispatchCommand(intent, isHighRisk = false) {
    this.lastActivityAt = new Date().toISOString();
    const commandId = intent.commandId || generateSecureId('CMD');
    const correlationId = intent.correlationId || generateSecureId('CORR');
    const idempotencyKey = intent.idempotencyKey || `IDEMP-${intent.action}-${intent.targetId || 'global'}-${JSON.stringify(intent.payload || {})}`;

    const cmd = {
      commandId,
      correlationId,
      requestedAt: new Date().toISOString(),
      completedAt: null,
      actor: this.actor,
      action: intent.action,
      targetType: intent.targetType,
      targetId: intent.targetId,
      payload: intent.payload || {},
      previousState: this._captureStateSnapshot(intent.targetType, intent.targetId),
      result: 'REQUESTED',
      errorCode: null,
      idempotencyKey
    };

    // 1. Validasi Idempotency
    const pending = Array.from(this.pendingCommands.values()).find(p => p.idempotencyKey === idempotencyKey);
    if (pending) {
      console.warn(`[CommandLayer] Perintah duplikat sedang berjalan: ${intent.action}`);
      throw new Error(`Perintah [${intent.action}] sedang diproses. Silakan tunggu.`);
    }

    if (this.executedCommands.has(idempotencyKey)) {
      const cached = this.executedCommands.get(idempotencyKey);
      console.info(`[CommandLayer] Menggunakan hasil cache idempotensi untuk ${intent.action}`);
      return { success: true, commandId: cached.commandId, data: cached.data, mode: "idempotent_no_op" };
    }

    // 2. State Machine Rule Check
    cmd.result = 'VALIDATING';
    const validationError = this._validateStateMachine(intent);
    if (validationError) {
      cmd.result = 'REJECTED';
      cmd.errorCode = 'VALIDATION_FAILED';
      cmd.completedAt = new Date().toISOString();

      diagnostics.logEvent({
        level: DIAGNOSTIC_LEVELS.WARN,
        category: EVENT_CATEGORIES.STATE_TRANSITION,
        component: 'command_pipeline',
        event: 'COMMAND_VALIDATION_REJECTED',
        operation: intent.action,
        commandId,
        correlationId,
        entityType: intent.targetType,
        entityId: intent.targetId,
        errorCode: 'VALIDATION_FAILED',
        message: `Validation failed: ${validationError}`
      });

      this.addAuditEvent({
        type: "command:rejected",
        entity: intent.targetId,
        source: this.actor,
        reasonCode: "STATE_MACHINE_REJECT",
        result: "REJECTED",
        correlationId,
        details: `Gagal validasi state: ${validationError}`
      });
      throw new Error(validationError);
    }

    // 3. Confirmation Guard untuk aksi berisiko tinggi
    if (isHighRisk) {
      const userApproved = await this._showConfirmationGuard(intent);
      if (!userApproved) {
        cmd.result = 'REJECTED';
        cmd.errorCode = 'OPERATOR_CANCELLED';
        cmd.completedAt = new Date().toISOString();

        diagnostics.logEvent({
          level: DIAGNOSTIC_LEVELS.INFO,
          category: EVENT_CATEGORIES.OPERATIONAL,
          component: 'command_pipeline',
          event: 'COMMAND_OPERATOR_CANCELLED',
          operation: intent.action,
          commandId,
          correlationId,
          entityType: intent.targetType,
          entityId: intent.targetId,
          errorCode: 'OPERATOR_CANCELLED',
          message: 'Operator cancelled confirmation prompt'
        });

        this.addAuditEvent({
          type: "command:rejected",
          entity: intent.targetId,
          source: this.actor,
          reasonCode: "OPERATOR_CANCELLED",
          result: "CANCELLED",
          correlationId,
          details: `Perintah dibatalkan oleh operator.`
        });
        throw new Error("Perintah dibatalkan oleh operator.");
      }
    }

    // 4. Catat ke in-memory pending commands
    cmd.result = 'DISPATCHED';
    this.pendingCommands.set(commandId, cmd);
    diagnostics.recordPendingCommandCount(this.pendingCommands.size);

    diagnostics.logEvent({
      level: DIAGNOSTIC_LEVELS.INFO,
      category: EVENT_CATEGORIES.OPERATIONAL,
      component: 'command_pipeline',
      event: 'COMMAND_DISPATCHED',
      operation: intent.action,
      commandId,
      correlationId,
      entityType: intent.targetType,
      entityId: intent.targetId,
      message: `Dispatched command ${intent.action}`
    });

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
    const dispatchStartTime = Date.now();
    return new Promise((resolve, reject) => {
      const socket = socketClient.getSocket();
      if (!socket || !socket.connected) {
        // Honest Connection & Offline Handling
        cmd.result = 'OFFLINE';
        cmd.errorCode = 'OFFLINE';
        cmd.completedAt = new Date().toISOString();
        this.pendingCommands.delete(commandId);
        diagnostics.recordPendingCommandCount(this.pendingCommands.size);

        diagnostics.logEvent({
          level: DIAGNOSTIC_LEVELS.ERROR,
          category: EVENT_CATEGORIES.FAULT,
          component: 'command_pipeline',
          event: 'COMMAND_DISPATCH_OFFLINE',
          operation: intent.action,
          commandId,
          correlationId,
          entityType: intent.targetType,
          entityId: intent.targetId,
          errorCode: 'OFFLINE',
          message: 'Socket not connected. Command rejected offline.'
        });
        
        this.addAuditEvent({
          type: "command:failed",
          entity: intent.targetId,
          source: this.actor,
          reasonCode: "OFFLINE",
          correlationId,
          result: "OFFLINE",
          details: `Gagal mengirim perintah ${intent.action}: Jaringan Offline.`
        });

        reject(new Error("Koneksi server terputus. Kondisi offline tidak boleh dianggap sebagai eksekusi backend."));
        return;
      }

      // Kirim via Socket.io dengan Timeout 4 detik
      const timeoutId = setTimeout(() => {
        cmd.result = 'TIMEOUT';
        cmd.errorCode = 'TIMEOUT';
        cmd.completedAt = new Date().toISOString();
        this.pendingCommands.delete(commandId);
        diagnostics.recordPendingCommandCount(this.pendingCommands.size);

        diagnostics.logEvent({
          level: DIAGNOSTIC_LEVELS.WARN,
          category: EVENT_CATEGORIES.FAULT,
          component: 'command_pipeline',
          event: 'COMMAND_TIMEOUT',
          operation: intent.action,
          commandId,
          correlationId,
          entityType: intent.targetType,
          entityId: intent.targetId,
          durationMs: Date.now() - dispatchStartTime,
          errorCode: 'TIMEOUT',
          message: 'Command timed out after 4000ms. Triggering state reconciliation.'
        });
        
        this.addAuditEvent({
          type: "command:failed",
          entity: intent.targetId,
          source: this.actor,
          reasonCode: "TIMEOUT_RECONCILIATION",
          correlationId,
          result: "TIMEOUT",
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
        diagnostics.recordPendingCommandCount(this.pendingCommands.size);

        const durationMs = Date.now() - dispatchStartTime;

        if (response && response.success) {
          cmd.result = 'SERVER_APPLIED';
          cmd.completedAt = new Date().toISOString();
          
          this.executedCommands.set(idempotencyKey, {
            commandId,
            data: response.data,
            result: 'SERVER_APPLIED'
          });

          // Simpan Decision Traceability jika berasal dari AI Recommendation
          if (intent.payload && intent.payload.recommendationId) {
            this.recommendationTrace.set(intent.payload.recommendationId, {
              commandId,
              resultingState: response.resultingState || intent.payload
            });
          }

          diagnostics.logEvent({
            level: DIAGNOSTIC_LEVELS.INFO,
            category: EVENT_CATEGORIES.OPERATIONAL,
            component: 'command_pipeline',
            event: 'COMMAND_SERVER_ACK',
            operation: intent.action,
            commandId,
            correlationId,
            entityType: intent.targetType,
            entityId: intent.targetId,
            durationMs,
            message: `Command applied successfully by server in ${durationMs}ms`
          });

          this.addAuditEvent({
            type: "command:acknowledged",
            entity: intent.targetId,
            source: "SITS Core Server",
            reasonCode: "SERVER_ACK",
            correlationId,
            result: "SERVER_APPLIED",
            details: `Perintah ${intent.action} berhasil diterapkan di server.`
          });

          // Apply state strictly based on server acknowledgement response
          if (response.resultingState) {
            stateStore.setState(response.resultingState, { source: 'server' });
          }

          resolve({ success: true, commandId, data: response.data, status: 'SERVER_APPLIED' });
        } else {
          const errMessage = response?.error?.message || (typeof response?.error === 'string' ? response.error : response?.message) || "Perintah ditolak oleh Server ATCS SITS.";
          const errCode = response?.error?.code || response?.code || (typeof response?.error === 'string' ? response.error : 'SERVER_REJECT');

          cmd.result = 'REJECTED';
          cmd.errorCode = errCode;
          cmd.completedAt = new Date().toISOString();

          diagnostics.logEvent({
            level: DIAGNOSTIC_LEVELS.WARN,
            category: EVENT_CATEGORIES.OPERATIONAL,
            component: 'command_pipeline',
            event: 'COMMAND_SERVER_REJECTED',
            operation: intent.action,
            commandId,
            correlationId,
            entityType: intent.targetType,
            entityId: intent.targetId,
            durationMs,
            errorCode: errCode,
            message: `Server rejected command: ${errMessage}`
          });

          this.addAuditEvent({
            type: "command:rejected",
            entity: intent.targetId,
            source: "SITS Core Server",
            reasonCode: "SERVER_REJECTED",
            correlationId,
            result: "REJECTED",
            details: `Perintah ditolak server: ${errMessage}`
          });

          reject(new Error(errMessage));
        }
      });
    });
  }

  handleDisconnect() {
    console.warn(`⚠️ [CommandLayer] Socket disconnect. Marking ${this.pendingCommands.size} pending command(s) as PENDING_RECONCILIATION.`);
    for (const [id, cmd] of this.pendingCommands.entries()) {
      if (cmd.result === 'DISPATCHED') {
        cmd.result = 'PENDING_RECONCILIATION';
      }
    }
  }

  async checkCommandStatusOnServer(commandId, idempotencyKey) {
    const socket = socketClient.getSocket();
    if (!socket || !socket.connected) return null;
    return new Promise((resolve) => {
      socket.emit('command:status', { commandId, idempotencyKey }, (response) => {
        if (response && response.success) {
          resolve(response.status); // 'SERVER_APPLIED' or 'NOT_FOUND'
        } else {
          resolve(null);
        }
      });
    });
  }

  async reconcilePendingCommands() {
    console.info(`🔄 [CommandLayer] Memulai rekonsiliasi perintah tertunda setelah koneksi pulih (${this.pendingCommands.size} commands)...`);
    for (const [commandId, cmd] of this.pendingCommands.entries()) {
      if (cmd.result === 'DISPATCHED' || cmd.result === 'TIMEOUT' || cmd.result === 'PENDING_RECONCILIATION') {
        try {
          const serverStatus = await this.checkCommandStatusOnServer(cmd.commandId, cmd.idempotencyKey);
          if (serverStatus === 'SERVER_APPLIED') {
            cmd.result = 'SERVER_APPLIED';
            cmd.completedAt = new Date().toISOString();
            this.pendingCommands.delete(commandId);
            this.executedCommands.set(cmd.idempotencyKey, {
              commandId,
              correlationId: cmd.correlationId,
              result: 'SERVER_APPLIED'
            });
            this.addAuditEvent({
              type: "command:reconciled",
              entity: cmd.targetId,
              source: "SITS Reconciler",
              reasonCode: "RECONNECT_RECONCILIATION",
              correlationId: cmd.correlationId,
              result: "SERVER_APPLIED",
              details: `Perintah ${cmd.action} berhasil direkonsiliasi dan terkonfirmasi telah diterapkan di server.`
            });
          } else if (serverStatus === 'EXECUTING') {
            cmd.result = 'EXECUTING';
            console.info(`⏳ [CommandLayer] Perintah ${commandId} masih dalam proses eksekusi di server.`);
          } else {
            cmd.result = 'UNKNOWN_SERVER_STATE';
            cmd.errorCode = 'RECONCILIATION_UNCONFIRMED';
            console.warn(`⚠️ [CommandLayer] Status perintah ${commandId} tidak ditemukan di server saat rekonsiliasi.`);
          }
        } catch (err) {
          console.warn(`[CommandLayer] Gagal rekonsiliasi ${commandId}:`, err);
        }
      }
    }
  }

  _checkIdempotency(action, payload) {
    return false; // Handled explicitly using stable idempotencyKey/commandId history
  }

  _validateStateMachine(intent) {
    const state = stateStore.getState();
    const action = intent.action;

    if (action === 'incident:acknowledge' || action === 'incident:dispatch' || action === 'incident:resolve') {
      const id = intent.targetId;
      const inc = (state.incidents || []).find(i => String(i.id) === String(id));
      if (!inc) {
        return `Insiden #${id} tidak ditemukan di log aktif.`;
      }

      const currentStatus = (inc.status || '').trim().toUpperCase();
      if (currentStatus === "ARCHIVED") {
        return `Insiden #${id} sudah diarsipkan (ARCHIVED) dan tidak dapat diubah lagi.`;
      }
      if (currentStatus === "RESOLVED" && action !== 'incident:resolve') {
        return `Insiden #${id} sudah berstatus RESOLVED. Tidak dapat diubah statusnya ke aktif.`;
      }

      if (action === 'incident:resolve' && inc.associatedEmergencyId) {
        const activeEmg = (state.activeEmergencies || []).find(
          e => String(e.id) === String(inc.associatedEmergencyId) || String(e.vehicleId) === String(inc.associatedEmergencyId)
        );
        if (activeEmg && !["ARRIVED", "COMPLETED", "CANCELLED", "TERMINAL_ARCHIVED"].includes(activeEmg.status)) {
          return `Insiden #${id} terhubung ke armada darurat aktif (${activeEmg.vehicleId} - ${activeEmg.status}). Batalkan atau selesaikan dispatch darurat terlebih dahulu.`;
        }
      }
    }

    if (action === 'emergency:activate') {
      const code = intent.payload?.code;
      const existing = (state.activeEmergencies || []).find(
        e => e.vehicleId === code && !["COMPLETED", "CANCELLED", "TERMINAL_ARCHIVED"].includes(e.status)
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
        impacted.textContent = "Wonokromo, Jemursari, Darmo, Tunjungan";
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
        modal.removeEventListener("click", handleBackdropClick);
        window.removeEventListener("keydown", handleEscape);
        resolve(false);
      };

      const handleProceed = () => {
        modal.style.display = "none";
        btnCancel.removeEventListener("click", handleCancel);
        btnProceed.removeEventListener("click", handleProceed);
        modal.removeEventListener("click", handleBackdropClick);
        window.removeEventListener("keydown", handleEscape);
        resolve(true);
      };

      const handleBackdropClick = (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      };

      const handleEscape = (e) => {
        if (e.key === "Escape") {
          handleCancel();
        }
      };

      btnCancel.addEventListener("click", handleCancel);
      btnProceed.addEventListener("click", handleProceed);
      modal.addEventListener("click", handleBackdropClick);
      window.addEventListener("keydown", handleEscape);
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
    // No-op. StateStore strictly only receives final state confirmed by server.
  }

  _handleCommandAck(ack) {
    if (!ack) return;
    const { correlationId, commandId, result, details, resultingState } = ack;
    
    // Check if this ack corresponds to a pending command
    const pendingCmd = (commandId && this.pendingCommands.get(commandId)) ||
                       Array.from(this.pendingCommands.values()).find(c => c.correlationId === correlationId);

    if (!pendingCmd) {
      // Late or duplicate ack for an already finalized command, or unknown correlationId
      if (this.executedCommands.has(commandId) || (correlationId && Array.from(this.executedCommands.values()).some(e => e.correlationId === correlationId))) {
        console.info(`[CommandLayer] Duplicate/Late ACK ignored for finalized command: ${commandId || correlationId}`);
        return;
      }
      console.warn(`[CommandLayer] Unknown ACK correlationId/commandId ignored: ${correlationId || commandId}`);
      return;
    }

    // Apply the acknowledgement
    console.info(`[CommandLayer] Resolving pending command via ACK: ${pendingCmd.commandId} (${result})`);
    pendingCmd.result = result === 'SUCCESS' ? 'SERVER_APPLIED' : 'REJECTED';
    pendingCmd.completedAt = new Date().toISOString();

    if (result === 'SUCCESS') {
      this.executedCommands.set(pendingCmd.idempotencyKey, {
        commandId: pendingCmd.commandId,
        correlationId: pendingCmd.correlationId,
        data: resultingState,
        result: 'SERVER_APPLIED'
      });
      if (resultingState) {
        stateStore.setState(resultingState, { source: 'server' });
      }
    }

    this.pendingCommands.delete(pendingCmd.commandId);

    this.addAuditEvent({
      type: result === 'SUCCESS' ? "command:acknowledged" : "command:rejected",
      entity: pendingCmd.targetId,
      source: "SITS Core Server",
      reasonCode: result === 'SUCCESS' ? "SERVER_ACK" : "SERVER_REJECT",
      correlationId: pendingCmd.correlationId,
      result: pendingCmd.result,
      details: details || `Perintah ${pendingCmd.action} dikonfirmasi server.`
    });
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
    if (terminal && typeof terminal.insertAdjacentHTML === 'function') {
      terminal.insertAdjacentHTML('beforeend', lineHtml);
      terminal.scrollTop = terminal.scrollHeight;
    }

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
if (typeof window !== 'undefined') {
  window.commandLayer = commandLayer;
}
