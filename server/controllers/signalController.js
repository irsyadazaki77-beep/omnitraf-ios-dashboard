import { backendState } from '../services/stateManager.js';
import { createApiResponse } from '../middlewares/errorHandler.js';

export function getStateSnapshot(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const snapshot = backendState.getSnapshot ? backendState.getSnapshot() : {
    seq: backendState.sequence,
    cctvSeq: backendState.cctvSequence,
    incidentSeq: backendState.incidentSequence,
    emergencySeq: backendState.emergencySequence,
    signalSeq: backendState.signalSequence,
    deviceSeq: backendState.deviceSequence,
    timestamp: backendState.lastUpdated,
    source: 'server',
    state: backendState.state
  };

  res.status(200).json(createApiResponse({
    type: 'state_snapshot',
    sequence: backendState.sequence,
    data: snapshot.state || backendState.state,
    extra: {
      status: 'success',
      seq: backendState.sequence,
      cctvSeq: backendState.cctvSequence,
      incidentSeq: backendState.incidentSequence,
      emergencySeq: backendState.emergencySequence,
      signalSeq: backendState.signalSequence,
      deviceSeq: backendState.deviceSequence,
      timestamp: backendState.lastUpdated,
      source: 'server',
      state: snapshot.state || backendState.state
    }
  }));
}

export function streamTrafficSse(req, res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform, no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let isClosed = false;

  const formatPayload = () => ({
    success: true,
    type: 'traffic_stream',
    seq: backendState.sequence,
    sequence: backendState.sequence,
    timestampMs: backendState.lastUpdated,
    timestamp: backendState.state.timestamp,
    data: backendState.state,
    ...backendState.state,
    source: 'sse-stream'
  });

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    if (sseInterval) clearInterval(sseInterval);
    if (pingInterval) clearInterval(pingInterval);
  };

  // Write initial state immediately
  try {
    const initialPayload = formatPayload();
    res.write(`id: ${backendState.sequence}\nevent: telemetry\ndata: ${JSON.stringify(initialPayload)}\n\n`);
  } catch (err) {
    console.warn('[SSE streamTraffic] Failed to write initial telemetry frame:', err.message);
    cleanup();
    return;
  }

  // 1000ms regular telemetry broadcast
  const sseInterval = setInterval(() => {
    if (isClosed) return;
    try {
      const payload = formatPayload();
      res.write(`id: ${backendState.sequence}\nevent: telemetry\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      cleanup();
    }
  }, 1000);

  // 15000ms Keep-Alive heartbeat comment to prevent proxy timeout
  const pingInterval = setInterval(() => {
    if (isClosed) return;
    try {
      res.write(`:ping ${Date.now()}\n\n`);
    } catch (err) {
      cleanup();
    }
  }, 15000);

  req.on('close', cleanup);
  req.on('end', cleanup);
  res.on('finish', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}
