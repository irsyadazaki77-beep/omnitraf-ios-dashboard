import { randomUUID } from 'node:crypto';
import { OMNITRAF_RUNTIME_MODE } from '../../config/env.js';

const LEADER_KEY = 'omnitraf:simulation:leader';
const LEASE_TTL_MS = 10_000;
const RENEW_INTERVAL_MS = 3_000;
const RENEW_SCRIPT = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
const RELEASE_SCRIPT = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";

export const runtimeInstanceId = `instance-${randomUUID()}`;

export class SimulationLeadership {
  constructor({ redisManager, eventBus = null, mode = OMNITRAF_RUNTIME_MODE, instanceId = runtimeInstanceId, leaseTtlMs = LEASE_TTL_MS, renewIntervalMs = RENEW_INTERVAL_MS, onRoleChange = async () => {}, onSnapshot = () => null, applySnapshot = async () => false, onLeaderReady = async () => {}, now = Date.now }) {
    this.redis = redisManager;
    this.eventBus = eventBus;
    this.mode = mode;
    this.instanceId = instanceId;
    this.leaseTtlMs = leaseTtlMs;
    this.renewIntervalMs = renewIntervalMs;
    this.onRoleChange = onRoleChange;
    this.onSnapshot = onSnapshot;
    this.applySnapshot = applySnapshot;
    this.onLeaderReady = onLeaderReady;
    this.now = now;
    this.role = mode === 'single' ? 'FOLLOWER' : 'STARTING';
    this.leaderId = null;
    this.synchronized = mode === 'single';
    this.lastLeaseAt = null;
    this.lastError = null;
    this.timer = null;
    this.stopped = false;
    this.transitions = 0;
    this.acquiringPromise = null;
    this.roleListeners = new Set();
  }

  isLeader() { return this.role === 'LEADER'; }
  addRoleListener(listener) { this.roleListeners.add(listener); return () => this.roleListeners.delete(listener); }

  async start() {
    this.stopped = false;
    if (this.mode === 'single') {
      await this._transition('LEADER');
      this.leaderId = this.instanceId;
      this.synchronized = true;
      return this;
    }
    if (!this.redis?.isConnected()) throw new Error('Cluster runtime requires a connected Redis manager.');
    this.timer = setInterval(() => this._heartbeat().catch((error) => this._redisFailure(error)), this.renewIntervalMs);
    this.timer.unref?.();
    await this._attemptAcquire();
    return this;
  }

  async _heartbeat() {
    if (this.stopped) return;
    if (!this.redis.isConnected()) throw new Error('REDIS_UNAVAILABLE');
    if (this.isLeader() || this.role === 'BECOMING_LEADER') {
      const renewed = await this.redis.eval(RENEW_SCRIPT, [LEADER_KEY], [this.instanceId, String(this.leaseTtlMs)]);
      if (Number(renewed) !== 1) return this._loseLease();
      this.lastLeaseAt = this.now();
      return;
    }
    await this._attemptAcquire();
  }

  async _attemptAcquire() {
    if (this.acquiringPromise) return this.acquiringPromise;
    this.acquiringPromise = this._doAcquire();
    try { return await this.acquiringPromise; }
    finally { this.acquiringPromise = null; }
  }

  async _doAcquire() {
    const acquired = await this.redis.set(LEADER_KEY, this.instanceId, 'PX', this.leaseTtlMs, 'NX');
    if (acquired === 'OK') {
      if (this.stopped) {
        await this.redis.eval(RELEASE_SCRIPT, [LEADER_KEY], [this.instanceId]);
        return;
      }
      await this._transition('BECOMING_LEADER');
      const savedSnapshot = await this.redis.get('omnitraf:state:snapshot');
      if (savedSnapshot) {
        const parsed = JSON.parse(savedSnapshot);
        this.synchronized = await this.applySnapshot(parsed.payload);
        if (!this.synchronized) throw new Error('AUTHORITATIVE_SNAPSHOT_INVALID');
      } else this.synchronized = true;
      await this.onLeaderReady();
      const stillOwner = await this.redis.eval(RENEW_SCRIPT, [LEADER_KEY], [this.instanceId, String(this.leaseTtlMs)]);
      if (Number(stillOwner) !== 1) return this._loseLease();
      this.leaderId = this.instanceId;
      this.lastLeaseAt = this.now();
      this.lastError = null;
      await this._transition('LEADER');
      await this.publishSnapshot();
      return;
    }
    const owner = await this.redis.get(LEADER_KEY);
    this.leaderId = owner || null;
    if (this.role !== 'FOLLOWER') await this._transition('FOLLOWER');
    const savedSnapshot = await this.redis.get('omnitraf:state:snapshot');
    if (savedSnapshot) this.synchronized = await this.applySnapshot(JSON.parse(savedSnapshot).payload) || this.synchronized;
  }

  async publishSnapshot() {
    if (!this.isLeader()) return false;
    const payload = this.onSnapshot();
    if (!payload) return false;
    const envelope = this.eventBus
      ? this.eventBus.createEnvelope('cluster:state-snapshot', payload.stateVersion, payload)
      : { eventId: randomUUID(), sourceInstanceId: this.instanceId, timestamp: new Date(this.now()).toISOString(), sequence: payload.stateVersion, payload };
    await this.redis.set('omnitraf:state:snapshot', JSON.stringify(envelope), 'PX', 30_000);
    if (this.eventBus) await this.eventBus.publishEnvelope('omnitraf:events:snapshot', envelope);
    else await this.redis.publish('omnitraf:events:snapshot', envelope);
    return true;
  }

  async onSnapshotEvent(envelope) {
    if (this.isLeader() || !envelope?.payload) return false;
    this.synchronized = await this.applySnapshot(envelope.payload) || this.synchronized;
    this.leaderId = envelope.sourceInstanceId;
    return this.synchronized;
  }

  async _loseLease() {
    if (this.stopped) return;
    this.leaderId = null;
    this.synchronized = false;
    this.lastError = 'LEADERSHIP_LEASE_LOST';
    await this._transition('LEASE_LOST');
    await this._transition('FOLLOWER');
  }
  async _redisFailure(error) {
    if (this.stopped) return;
    this.lastError = error.message;
    this.leaderId = null;
    this.synchronized = false;
    await this._transition('UNAVAILABLE');
  }
  async _transition(role) {
    if (this.role === role) return;
    const previousRole = this.role;
    this.role = role;
    this.transitions++;
    await this.onRoleChange({ previousRole, role, instanceId: this.instanceId });
    for (const listener of this.roleListeners) listener({ previousRole, role, instanceId: this.instanceId });
  }

  async stop({ release = true } = {}) {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.isLeader() && release && this.redis?.isConnected()) {
      await this.redis.eval(RELEASE_SCRIPT, [LEADER_KEY], [this.instanceId]);
    }
    this.leaderId = null;
    await this._transition('STOPPED');
  }

  getDiagnostics() {
    const leaseExpiresInMs = this.lastLeaseAt === null ? 0 : Math.max(0, this.leaseTtlMs - (this.now() - this.lastLeaseAt));
    const lastErrorCode = this.lastError
      ? (this.lastError.includes('LEASE_LOST') ? 'LEADERSHIP_LEASE_LOST' : this.lastError.includes('SNAPSHOT') ? 'AUTHORITATIVE_SNAPSHOT_INVALID' : 'COORDINATION_UNAVAILABLE')
      : null;
    return { mode: this.mode, instanceId: this.instanceId, role: this.role, redisStatus: this.mode === 'single' ? 'NOT_REQUIRED' : (this.redis?.getHealth().status || 'UNAVAILABLE'), leaderId: this.leaderId, leaseExpiresInMs, synchronized: this.synchronized, lastErrorCode, transitions: this.transitions };
  }
}
