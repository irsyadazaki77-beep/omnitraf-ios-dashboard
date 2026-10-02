import { NODE_ENV } from '../config/env.js';

const COMMAND_WINDOW_MS = 10_000;
const COMMAND_MAX_PER_WINDOW = 60;
const MAX_ACTOR_WINDOWS = 5_000;
const windows = new Map();

/** Transport-independent command budget shared by REST and Socket.IO. */
export function assertCommandRateLimit(actorId, now = Date.now()) {
  // Keep deterministic integration/unit suites independent of command order.
  if (NODE_ENV === 'test') return;

  const key = String(actorId);
  let record = windows.get(key);
  if (!record || now >= record.resetAt) {
    record = { count: 0, resetAt: now + COMMAND_WINDOW_MS };
  }

  record.count++;
  windows.delete(key);
  windows.set(key, record);

  if (windows.size > MAX_ACTOR_WINDOWS) {
    const [oldestKey, oldestRecord] = windows.entries().next().value || [];
    if (oldestKey !== undefined && oldestRecord?.resetAt <= now) windows.delete(oldestKey);
    else if (oldestKey !== undefined && oldestKey !== key) windows.delete(oldestKey);
  }

  if (record.count > COMMAND_MAX_PER_WINDOW) {
    const error = new Error('Batas perintah per operator terlampaui. Tunggu sebelum mengirim perintah lagi.');
    error.code = 'COMMAND_RATE_LIMITED';
    error.statusCode = 429;
    error.retryAfterMs = Math.max(0, record.resetAt - now);
    error.details = { retryAfterMs: error.retryAfterMs, limit: COMMAND_MAX_PER_WINDOW, windowMs: COMMAND_WINDOW_MS };
    throw error;
  }
}
