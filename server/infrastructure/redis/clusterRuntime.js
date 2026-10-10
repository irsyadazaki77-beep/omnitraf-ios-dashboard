import { createHash, randomUUID } from 'node:crypto';
import { OMNITRAF_RUNTIME_MODE } from '../../config/env.js';
import { runtimeInstanceId } from './simulationLeadership.js';

export class ClusterRuntime {
  constructor({ mode = OMNITRAF_RUNTIME_MODE, instanceId = runtimeInstanceId, redisManager, leadership, eventBus, commandTimeoutMs = 10_000 } = {}) {
    this.mode = mode;
    this.instanceId = instanceId;
    this.redis = redisManager;
    this.leadership = leadership;
    this.eventBus = eventBus;
    this.commandTimeoutMs = commandTimeoutMs;
    this.pendingCommands = new Map();
    this.forwardedCommands = 0;
    this.forwardTimeouts = 0;
    this.idempotentReplayCount = 0;
    this.executeOnLeader = null;
    this.unsubscribeRequest = null;
    this.unsubscribeReply = null;
  }

  configureCommandHandler(handler) { this.executeOnLeader = handler; }

  async startCommandBroker() {
    if (this.mode !== 'cluster') return;
    const replyChannel = `omnitraf:commands:reply:${this.instanceId}`;
    this.unsubscribeReply = await this.redis.subscribe(replyChannel, (raw) => {
      let message;
      try { message = JSON.parse(raw); } catch (_) { return; }
      const pending = this.pendingCommands.get(message.requestId);
      if (!pending) return;
      this.pendingCommands.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(message.error.message);
        error.code = message.error.code;
        error.statusCode = message.error.statusCode;
        pending.reject(error);
      } else pending.resolve(message.result);
    });
    this.unsubscribeRequest = await this.redis.subscribe('omnitraf:commands:request', (raw) => {
      this._handleCommandRequest(raw, this.instanceId).catch(() => {});
    });
  }

  async _handleCommandRequest(raw, instanceId) {
    if (!this.leadership?.isLeader() || !this.executeOnLeader) return;
    let request;
    try { request = JSON.parse(raw); } catch (_) { return; }
    if (request.targetLeaderId && request.targetLeaderId !== instanceId) return;
    try {
      const result = await this.executeOnLeader({ ...request.params, sourceInstanceId: request.sourceInstanceId || null });
      await this.redis.publish(request.replyChannel, { requestId: request.requestId, result });
    } catch (error) {
      await this.redis.publish(request.replyChannel, { requestId: request.requestId, error: { message: error.message, code: error.code, statusCode: error.statusCode } });
    }
  }

  async forwardCommand(params) {
    if (this.mode !== 'cluster' || !this.redis?.isConnected() || !this.leadership?.synchronized || !this.leadership.leaderId) {
      const error = new Error('Authoritative simulation leader is unavailable.');
      error.code = 'CLUSTER_UNAVAILABLE'; error.statusCode = 503; throw error;
    }
    if (this.pendingCommands.size >= 1000) {
      const error = new Error('Distributed command queue is full.'); error.code = 'COMMAND_QUEUE_FULL'; error.statusCode = 503; throw error;
    }
    const requestId = randomUUID();
    this.forwardedCommands++;
    const replyChannel = `omnitraf:commands:reply:${this.instanceId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        this.forwardTimeouts++;
        const error = new Error('Timed out waiting for authoritative command execution.');
        error.code = 'COMMAND_LEADER_TIMEOUT'; error.statusCode = 503; reject(error);
      }, this.commandTimeoutMs);
      timer.unref?.();
      this.pendingCommands.set(requestId, { resolve, reject, timer });
      this.redis.publish('omnitraf:commands:request', { requestId, replyChannel, sourceInstanceId: this.instanceId, targetLeaderId: this.leadership.leaderId, params })
        .catch((error) => { clearTimeout(timer); this.pendingCommands.delete(requestId); reject(error); });
    });
  }

  async executeIdempotently(idempotencyKey, fingerprint, execute, metadata = {}) {
    if (this.mode !== 'cluster') return execute();
    const hashedKey = createHash('sha256').update(String(idempotencyKey)).digest('hex');
    const key = `omnitraf:command:${hashedKey}`;
    const ownerToken = randomUUID();
    const processing = JSON.stringify({ status: 'PROCESSING', ownerToken, fingerprint, actorId: metadata.actorId || null });
    const reserved = await this.redis.set(key, processing, 'PX', 300_000, 'NX');
    if (reserved !== 'OK') {
      const deadline = Date.now() + this.commandTimeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const existingRaw = await this.redis.get(key);
        let existing;
        try { existing = JSON.parse(existingRaw || 'null'); } catch (_) { existing = null; }
        if (!existing) break;
        if (existing.fingerprint && existing.fingerprint !== fingerprint) {
          const error = new Error('Idempotency key was reused for a different command.'); error.code = 'IDEMPOTENCY_CONFLICT'; error.statusCode = 409; throw error;
        }
        if (existing.status === 'SUCCEEDED') { this.idempotentReplayCount++; return { ...existing.result, isIdempotentReplay: true }; }
        if (existing.status === 'PROCESSING') {
          // A PROCESSING marker can outlive a crashed leader. The durable
          // command receipt is the serialization point: a concurrent claim
          // blocks on PostgreSQL's unique key and then replays or executes.
          return execute();
        }
        if (existing.status === 'FAILED') return execute();
      }
      if (await this.redis.get(key) === null) return this.executeIdempotently(idempotencyKey, fingerprint, execute, metadata);
      const error = new Error('Command with this idempotency key is already processing.'); error.code = 'COMMAND_IN_PROGRESS'; error.statusCode = 409; throw error;
    }
    try {
      const result = await execute();
      const complete = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) else return 0 end";
      await this.redis.eval(complete, [key], [processing, JSON.stringify({ status: 'SUCCEEDED', fingerprint, actorId: metadata.actorId || null, result }), '86400']);
      return result;
    } catch (error) {
      // The PostgreSQL receipt is authoritative. Keeping a Redis FAILED result
      // could mask a commit whose acknowledgement was lost; release only our
      // reservation so a retry can resolve against the durable receipt.
      const release = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
      await this.redis.eval(release, [key], [processing]);
      throw error;
    }
  }

  async getIdempotentCommandResult(idempotencyKey) {
    if (this.mode !== 'cluster' || !this.redis?.isConnected() || !idempotencyKey) return null;
    const hashedKey = createHash('sha256').update(String(idempotencyKey)).digest('hex');
    const raw = await this.redis.get(`omnitraf:command:${hashedKey}`);
    try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }

  getDiagnostics() {
    return { mode: this.mode, pendingCommands: this.pendingCommands.size, forwardedCommands: this.forwardedCommands,
      commandForwardTimeoutCount: this.forwardTimeouts, idempotentReplayCount: this.idempotentReplayCount,
      ...(this.eventBus?.getMetrics() || {}) };
  }
}
