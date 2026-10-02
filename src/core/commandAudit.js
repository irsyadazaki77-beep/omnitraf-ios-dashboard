/**
 * OmniTRAF Surabaya - Command Audit & History Service (Phase 1 Refactor)
 * Bertanggung jawab khusus untuk in-memory ring-buffer Audit Trail,
 * deduplication, terminal logging, dan decision traceability.
 */

import { eventBus } from './eventBus.js';

export class CommandAudit {
  constructor(maxAuditLimit = 150) {
    this.auditHistory = [];
    this.maxAuditLimit = maxAuditLimit;
    this.recommendationTrace = new Map(); // recommendationId -> { commandId, resultingState }
  }

  recordRecommendationTrace(recommendationId, commandId, resultingState) {
    if (!recommendationId) return;
    this.recommendationTrace.set(recommendationId, {
      commandId,
      resultingState
    });
  }

  getRecommendationTrace(recommendationId) {
    return this.recommendationTrace.get(recommendationId);
  }

  /**
   * Menambahkan log event baru ke dalam Centralized Audit Trail & Sinkronisasi Terminal
   */
  addAuditEvent(event, broadcast = true, actor = 'System Core') {
    const timestamp = event.timestamp || new Date().toISOString();
    const cleanLog = {
      id: `AUD-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp,
      type: event.type || "state:changed",
      entity: event.entity || "System Core",
      source: event.source || actor,
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
      eventBus.publish("audit:log:new", cleanLog);
    }
  }

  _updateTerminalLogUI(log) {
    if (typeof document === 'undefined') return;
    const terminal = document.getElementById("terminalLogs");
    if (!terminal) return;

    const time = new Date(log.timestamp).toLocaleTimeString('id-ID');

    const label = log.type.replace(':', ' ').toUpperCase();
    
    let colorStyle = "color:#94a3b8;"; // default info
    if (log.result === "FAILED") colorStyle = "color:#f43f5e; font-weight:700;"; // red
    else if (log.result === "REJECTED") colorStyle = "color:#fbbf24; font-weight:700;"; // orange/yellow
    else if (log.type.includes("command:acknowledged") || log.details.includes("pulih") || log.details.includes("Selesai")) colorStyle = "color:#10b981; font-weight:700;"; // green success
    else if (log.type.includes("command:requested") || log.type.includes("validated")) colorStyle = "color:#38bdf8;"; // sky blue
    else if (log.type.includes("emergency")) colorStyle = "color:#f43f5e;"; // emergency red

    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.style.cssText = `margin-bottom:4px; font-family:'Share Tech Mono', monospace; font-size:11.5px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:3px; ${colorStyle}`;
    line.textContent = `[${time}] [${label}] • ${String(log.details ?? '')}`;

    // Append as text so server/operator-controlled audit details cannot become markup.
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;

    // Bounded terminal lines in DOM
    const lines = terminal.querySelectorAll(".terminal-line");
    if (lines && lines.length > 80) {
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

export const commandAudit = new CommandAudit();
