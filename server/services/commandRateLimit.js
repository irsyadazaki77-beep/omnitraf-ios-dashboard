import { NODE_ENV } from '../config/env.js';
import { createHash } from 'node:crypto';
import { OMNITRAF_RUNTIME_MODE } from '../config/env.js';
import { redisManager } from '../infrastructure/redis/redisManager.js';

const COMMAND_WINDOW_MS = 10_000;
const COMMAND_MAX_PER_WINDOW = 60;
const MAX_ACTOR_WINDOWS = 5_000;
const windows = new Map();

/** Transport-independent command budget shared by REST and Socket.IO. */
export async function assertCommandRateLimit(actorId, now = Date.now()) {
  // Keep deterministic integration/unit suites independent of command order.
  if (NODE_ENV === 'test') return;

  if (OMNITRAF_RUNTIME_MODE === 'cluster') {
    try {
      const actorKey = createHash('sha256').update(String(actorId)).digest('hex');
      const [count, ttl] = await redisManager.incrementWindow(`omnitraf:ratelimit:command:${actorKey}`, COMMAND_WINDOW_MS);
      if (Number(count) > COMMAND_MAX_PER_WINDOW) {
        const error = new Error('Batas perintah per operator terlampaui. Tunggu sebelum mengirim perintah lagi.');
        error.code = 'COMMAND_RATE_LIMITED'; error.statusCode = 429; error.retryAfterMs = Math.max(0, Number(ttl));
        error.details = { retryAfterMs: error.retryAfterMs, limit: COMMAND_MAX_PER_WINDOW, windowMs: COMMAND_WINDOW_MS };
        throw error;
      }
      return;
    } catch (error) {
      if (error.code === 'COMMAND_RATE_LIMITED') throw error;
      const unavailable = new Error('Shared command rate limiter is unavailable.');
      unavailable.code = 'CLUSTER_UNAVAILABLE'; unavailable.statusCode = 503; throw unavailable;
    }
  }

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
