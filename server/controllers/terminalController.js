import { backendState } from '../services/stateManager.js';
import { createApiResponse, createApiErrorResponse, sanitizeString } from '../middlewares/errorHandler.js';
import { diagnosticEngine } from '../services/diagnosticEngine.js';
import { REALTIME_ROOMS } from '../sockets/eventRegistry.js';

export function executeTerminalCommand(req, res) {
  const { command } = req.body || {};
  const invalidCommandFormat = typeof command !== 'string' || command.length > 40 || /[\x00-\x1F\x7F]/.test(command);
  const cmd = typeof command === 'string' ? sanitizeString(command, 40).trim() : '';
  const lower = cmd.toLowerCase();
  const time = backendState._getWibTimeString();
  const executionId = `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  // Security: authenticated user strictly from verified principal (req.user), never client body
  const act = req.user.name;

  let responseLines = [];
  let color = "var(--text)";

  if (!cmd || invalidCommandFormat) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Perintah terminal harus berupa teks singkat tanpa karakter kontrol.",
      { field: "command" }
    ));
  }

  const allowedCommands = ['/help', 'help', '/status', 'status', '/ping', 'ping', '/telemetry', 'telemetry', '/nodes', 'nodes', '/chaos', 'chaos', '/clear', 'clear', '/perf', 'perf', '/sys-metrics', '/diagnostics', 'diagnostics', '/sim', 'sim'];

  // Commands are read-only simulator shortcuts; require an exact token so a
  // valid prefix cannot hide arbitrary suffixes in responses or audit records.
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
      "Perintah terminal prototipe:",
      "  • /status     - Status backend dan ringkasan data demo",
      "  • /telemetry  - Ringkasan statistik simulasi",
      "  • /nodes      - Daftar simpang pada model contoh",
      "  • /ping       - Tampilkan contoh hasil ping simulasi",
      "  • /chaos      - Status mode fault-injection simulator",
      "  • /perf       - Diagnostics performa & statistik memori server",
      "  • /clear      - Bersihkan log tampilan terminal"
    ];
    color = "var(--primary-2)";
  } else if (lower === '/perf' || lower === 'perf' || lower === '/sys-metrics') {
    const mem = process.memoryUsage();
    const clientsCount = backendState.io ? backendState.io.engine?.clientsCount || 0 : 0;
    responseLines = [
      `📊 DIAGNOSTIK BACKEND PROTOTIPE:`,
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
      `[HTTP 200 OK] Backend prototipe: ONLINE`,
      `Uptime model: ${backendState.state.sitsUptime}% | Kamera simulasi: ${backendState.state.cctvOnline}/184`,
      `Sensor contoh: ${backendState.state.iotOnline}/312 | Skor model: ${backendState.state.aiConfidence}%`,
      `Tidak terhubung ke SITS, CCTV, atau perangkat lapangan.`
    ];
    color = "var(--success)";
  } else if (lower === '/ping' || lower === 'ping') {
    responseLines = [
      `Contoh hasil ping ke node simulasi (bukan perangkat fisik):`,
      `  • Node demo Wonokromo      : 8 ms  [SIMULASI]`,
      `  • Node demo Raya Darmo     : 11 ms [SIMULASI]`,
      `  • Node demo Tunjungan      : 14 ms [SIMULASI]`,
      `  • Node demo Kertajaya      : 9 ms  [SIMULASI]`,
      `Angka latensi ini adalah nilai contoh, bukan hasil ping jaringan.`
    ];
    color = "var(--success)";
  } else if (lower === '/telemetry' || lower === 'telemetry') {
    responseLines = [
      `Ringkasan telemetri simulasi (${time}):`,
      `  • Beban Jaringan : ${backendState.state.networkLoad}%`,
      `  • Waktu Tunggu   : ${backendState.state.avgWaitTime}s`,
      `  • Indeks Macet   : ${backendState.state.congestionIndex}`,
      `  • Total Kendaraan: ${backendState.state.vehiclesToday.toLocaleString('id-ID')}`
    ];
    color = "var(--text)";
  } else if (lower === '/nodes' || lower === 'nodes') {
    responseLines = [
      `Daftar simpang dalam model demo:`,
      `  [DEMO-01] Wonokromo  (Status model: ${backendState.state.intersections[0].status})`,
      `  [DEMO-02] Jemursari  (Status model: ${backendState.state.intersections[1].status})`,
      `  [DEMO-03] Raya Darmo (Status model: ${backendState.state.intersections[2].status})`,
      `  [DEMO-04] Tunjungan  (Status model: ${backendState.state.intersections[3].status})`,
      `  [DEMO-05] MERR       (Status model: ${backendState.state.intersections[4].status})`
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
      `⏱️ SIMULATOR DETERMINISTIK PROTOTIPE:`,
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
    backendState.io.to(REALTIME_ROOMS.AUDIT).emit('audit:log', {
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
