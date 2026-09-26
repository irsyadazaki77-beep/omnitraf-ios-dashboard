import { backendState } from '../services/stateManager.js';

export function getStateSnapshot(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    status: 'success',
    seq: backendState.sequence,
    timestamp: backendState.lastUpdated,
    source: 'server',
    state: backendState.state
  });
}

export function streamTrafficSse(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const initialPayload = {
    ...backendState.state,
    seq: backendState.sequence,
    timestampMs: backendState.lastUpdated,
    source: 'server'
  };
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

  const sseInterval = setInterval(() => {
    const payload = {
      ...backendState.state,
      seq: backendState.sequence,
      timestampMs: backendState.lastUpdated,
      source: 'server'
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }, 1000);

  req.on('close', () => {
    clearInterval(sseInterval);
  });
}
