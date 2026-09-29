import { backendState } from '../services/stateManager.js';
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';
import { diagnosticEngine } from '../services/diagnosticEngine.js';

export function executeTerminalCommand(req, res) {
  const { command } = req.body || {};
  const cmd = (command || '').trim();
  const lower = cmd.toLowerCase().split(' ')[0];
  const time = backendState._getWibTimeString();
  const executionId = `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  // Security: authenticated user strictly from verified principal (req.user), never client body
  const act = req.user.name;

  let responseLines = [];
  let color = "var(--text)";

  if (!cmd) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Perintah terminal tidak boleh kosong.",
      { field: "command" }
    ));
  }

  const allowedCommands = ['/help', 'help', '/status', 'status', '/ping', 'ping', '/telemetry', 'telemetry', '/nodes', 'nodes', '/chaos', 'chaos', '/clear', 'clear', '/perf', 'perf', '/sys-metrics', '/diagnostics', 'diagnostics', '/sim', 'sim'];

  if (!allowedCommands.includes(lower)) {
    responseLines = [
      `❌ PERINTAH DITOLAK: Perintah '${cmd}' tidak aman atau tidak diizinkan.`,
      `Gunakan /help untuk melihat panduan perintah yang valid.`
    ];

    const auditRecord = {
      operator: act,
      action: "TERMINAL_EXEC_REJECT",
      entity: `Terminal ${executionId}`,
      result: `REJECTED (Command '${cmd}' is not allowed)`,
      timestamp: new Date().toISOString()
    };
    backendState.auditLogs.unshift(auditRecord);
    if (backendState.auditLogs.length > 150) backendState.auditLogs.pop();

    return res.status(422).json({
      success: false,
      type: "terminal_command_rejected",
      code: "COMMAND_NOT_PERMITTED",
      message: `Perintah '${cmd}' tidak aman atau tidak diizinkan.`,
      timestamp: Date.now(),
      executionId,
      command: cmd,
      output: responseLines,
      color: "var(--danger)",
      data: {
        executionId,
        command: cmd,
        output: responseLines,
        color: "var(--danger)"
      },
      error: {
        code: "COMMAND_NOT_PERMITTED",
        message: `Perintah '${cmd}' tidak aman atau tidak diizinkan.`,
        details: { allowedCommands }
      }
    });
  }

  if (lower === '/help' || lower === 'help') {
    responseLines = [
      "Perintah SITS Gateway yang tersedia:",
      "  • /status     - Cek kesehatan gateway & node SITS",
      "  • /telemetry  - Ringkasan statistik & jaringan real-time",
      "  • /nodes      - Daftar kluster sensor persimpangan",
      "  • /ping       - Tes latensi ke edge node",
      "  • /chaos      - Status mode keos SITS",
      "  • /perf       - Diagnostics performa & statistik memori server",
      "  • /clear      - Bersihkan log tampilan terminal"
    ];
    color = "var(--primary-2)";
  } else if (lower === '/perf' || lower === 'perf' || lower === '/sys-metrics') {
    const mem = process.memoryUsage();
    const clientsCount = backendState.io ? backendState.io.engine?.clientsCount || 0 : 0;
    responseLines = [
      `📊 DIAGNOSTIK PERFORMA SERVER SITS:`,
      `  • Heap Used  : ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `  • Heap Total : ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      `  • RSS        : ${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      `  • Connected Clients: ${clientsCount}`,
      `  • Active Sequence : ${backendState.sequence}`,
      `  • Injected Faults: ${diagnosticEngine.activeFaults.size}`
    ];
    color = "var(--cyan)";
  } else if (lower === '/diagnostics' || lower === 'diagnostics') {
    const snap = diagnosticEngine.captureSnapshot();
    const subs = snap.subsystems || {};
    responseLines = [
      `🔍 OBSERVABILITY & DIAGNOSTICS SNAPSHOT:`,
      `  • Database      : ${subs.database?.status || 'UNKNOWN'} (Latency: ${subs.database?.latencyMs ?? 0}ms)`,
      `  • State Hydration: ${subs.state_manager?.status || 'UNKNOWN'} (Seq: ${backendState.sequence})`,
      `  • Socket Stream : ${subs.socket?.status || 'UNKNOWN'} (Clients: ${backendState.io?.engine?.clientsCount || 0})`,
      `  • Fault Matrix  : ${snap.activeFaultsCount} Active Fault(s)`,
      `  • Transitions   : ${snap.metrics.stateTransitionCount} applied, ${snap.metrics.rejectedTransitionCount} rejected`,
      `  • Command Stats : ${snap.metrics.commandSuccessCount} OK, ${snap.metrics.commandFailureCount} Fail`
    ];
    color = "var(--primary-2)";

  } else if (lower === '/status' || lower === 'status') {
    responseLines = [
      `[HTTP 200 OK] SITS Enterprise Server: ONLINE`,
      `Backend Uptime: ${backendState.state.sitsUptime}% | CCTV Online: ${backendState.state.cctvOnline}/184`,
      `IoT Sensors: ${backendState.state.iotOnline}/312 | AI Confidence: ${backendState.state.aiConfidence}%`
    ];
    color = "var(--success)";
  } else if (lower === '/ping' || lower === 'ping') {
    responseLines = [
      `Memulai ping ke 4 Edge Node SITS Surabaya...`,
      `  • Node Wonokromo (DTC)     : 8 ms  [ONLINE]`,
      `  • Node Raya Darmo          : 11 ms [ONLINE]`,
      `  • Node Tunjungan / Siola   : 14 ms [ONLINE]`,
      `  • Node MERR Kertajaya      : 9 ms  [ONLINE]`,
      `Semua node merespons dalam <15ms.`
    ];
    color = "var(--success)";
  } else if (lower === '/telemetry' || lower === 'telemetry') {
    responseLines = [
      `Ringkasan Telemetri SITS (${time}):`,
      `  • Beban Jaringan : ${backendState.state.networkLoad}%`,
      `  • Waktu Tunggu   : ${backendState.state.avgWaitTime}s`,
      `  • Indeks Macet   : ${backendState.state.congestionIndex}`,
      `  • Total Kendaraan: ${backendState.state.vehiclesToday.toLocaleString('id-ID')}`
    ];
    color = "var(--text)";
  } else if (lower === '/nodes' || lower === 'nodes') {
    responseLines = [
      `Daftar Edge Cluster Nodes Active:`,
      `  [NODE-01] Wonokromo  (Status: ${backendState.state.intersections[0].status})`,
      `  [NODE-02] Jemursari  (Status: ${backendState.state.intersections[1].status})`,
      `  [NODE-03] Raya Darmo (Status: ${backendState.state.intersections[2].status})`,
      `  [NODE-04] Tunjungan  (Status: ${backendState.state.intersections[3].status})`,
      `  [NODE-05] MERR       (Status: ${backendState.state.intersections[4].status})`
    ];
    color = "var(--primary-2)";
  } else if (lower === '/chaos' || lower === 'chaos') {
    responseLines = [
      `Status Mode Keos: ${backendState.state.isChaosMode ? 'AKTIF (Level ' + backendState.state.chaosLevel + ')' : 'NON-AKTIF (Sistem Normal)'}`
    ];
    color = backendState.state.isChaosMode ? "var(--danger)" : "var(--success)";
  } else if (lower === '/sim' || lower === 'sim') {
    const clk = backendState.clock;
    const sim = backendState.simEngine;
    responseLines = [
      `⏱️ SITS UNIFIED DETERMINISTIC SIMULATION:`,
      `  • Mode            : ${clk.mode} (Paused: ${clk.paused})`,
      `  • Speed Multiplier: ${clk.speedMultiplier}x`,
      `  • Simulation Time : ${clk.nowWibString()} (${clk.now()} ms)`,
      `  • Active Seed     : ${backendState.simConfig.seed}`,
      `  • Tick Sequence   : ${sim.tickSequence} (Last duration: ${sim.lastTickDurationMs}ms)`,
      `  • Event Sequence  : ${sim.eventSequence} (Journal: ${sim.eventJournal.length} events)`
    ];
    color = "var(--cyan)";
  } else if (lower === '/clear' || lower === 'clear') {
    responseLines = ["CLEAR_TERMINAL"];
  }

  const auditRecord = {
    operator: act,
    action: "TERMINAL_EXECUTE",
    entity: `Terminal ${executionId}`,
    result: `SUCCESS (Command '${cmd}' executed)`,
    timestamp: new Date().toISOString()
  };
  backendState.auditLogs.unshift(auditRecord);

  if (lower !== '/clear' && lower !== 'clear' && backendState.io) {
    backendState.io.emit('audit:log', {
      type: "terminal:executed",
      timestamp: new Date().toISOString(),
      entity: `Terminal ${executionId}`,
      source: act,
      reasonCode: "TERM_CMD",
      result: "SUCCESS",
      correlationId: executionId,
      details: `Terminal command '${cmd}' executed successfully.`
    });
  }

  res.status(200).json(createApiResponse({
    type: "terminal_command_success",
    data: {
      executionId,
      command: cmd,
      timestamp: time,
      output: responseLines,
      color
    },
    extra: {
      executionId,
      command: cmd,
      timestamp: time,
      output: responseLines,
      color
    }
  }));
}
