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
import { confirmationService } from './confirmationService.js';
import { commandAudit } from './commandAudit.js';

export { confirmationService, commandAudit };

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

    this._subscribeToEvents();
  }

  // Delegated getters and methods for backward compatibility
  get auditHistory() {
    return commandAudit.auditHistory;
  }

  set auditHistory(val) {
    commandAudit.auditHistory = val;
  }

  get maxAuditLimit() {
    return commandAudit.maxAuditLimit;
  }

  set maxAuditLimit(val) {
    commandAudit.maxAuditLimit = val;
  }

  get recommendationTrace() {
    return commandAudit.recommendationTrace;
  }

  _setupUIElements() {
    confirmationService.ensureModalDOM();
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
    return confirmationService.confirm(intent);
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
    commandAudit.addAuditEvent(event, broadcast, this.actor);
  }

  getAuditTrail(filter = {}) {
    return commandAudit.getAuditTrail(filter);
  }
}

export const commandLayer = new CommandLayer();
if (typeof window !== 'undefined') {
  // Compatibility bridge consumed by SocketClient during reconnect reconciliation.
  window.commandLayer = commandLayer;
}
