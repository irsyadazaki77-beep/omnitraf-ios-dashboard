import { backendState } from '../services/stateManager.js';

export function executeTerminalCommand(req, res) {
  const { command, actor } = req.body || {};
  const cmd = (command || '').trim();
  const lower = cmd.toLowerCase().split(' ')[0];
  const time = backendState._getWibTimeString();
  const executionId = `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  const act = actor || req.user?.name || "Administrator SITS";

  let responseLines = [];
  let color = "var(--text)";

  if (!cmd) {
    return res.json({ success: false, error: "Empty command" });
  }

  const allowedCommands = ['/help', 'help', '/status', 'status', '/ping', 'ping', '/telemetry', 'telemetry', '/nodes', 'nodes', '/chaos', 'chaos', '/clear', 'clear', '/perf', 'perf', '/sys-metrics'];

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

    return res.json({
      success: false,
      executionId,
      command: cmd,
      timestamp: time,
      output: responseLines,
      color: "var(--danger)"
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
      `  • Active Sequence : ${backendState.sequence}`
    ];
    color = "var(--cyan)";
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
      `  [NODE-02] Margorejo  (Status: ${backendState.state.intersections[1].status})`,
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

  res.json({
    success: true,
    executionId,
    command: cmd,
    timestamp: time,
    output: responseLines,
    color: color
  });
}
