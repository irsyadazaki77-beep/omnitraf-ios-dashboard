import { randomUUID } from 'node:crypto';
import { OMNITRAF_RUNTIME_MODE } from '../../config/env.js';

const LEADER_KEY = 'omnitraf:simulation:leader';
const LEASE_TTL_MS = 10_000;
const RENEW_INTERVAL_MS = 3_000;
const RENEW_SCRIPT = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
const RELEASE_SCRIPT = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";

export const runtimeInstanceId = process.env.INSTANCE_ID || `instance-${randomUUID()}`;

export class SimulationLeadership {
  constructor({ redisManager, databaseManager = null, eventBus = null, mode = OMNITRAF_RUNTIME_MODE, instanceId = runtimeInstanceId, leaseTtlMs = LEASE_TTL_MS, renewIntervalMs = RENEW_INTERVAL_MS, onRoleChange = async () => {}, onSnapshot = () => null, applySnapshot = async () => false, onLeaderReady = async () => {}, now = Date.now }) {
    this.redis = redisManager;
    this.database = databaseManager;
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
    this.epoch = null;
    this.lastSnapshotVersion = null;
    this.synchronized = mode === 'single';
    this.lastLeaseAt = null;
    this.lastError = null;
    this.timer = null;
    this.stopped = false;
    this.transitions = 0;
    this.failoverCount = 0;
    this.lastFailoverDurationMs = null;
    this.leadershipLostAt = null;
    this.leaseRenewalStatus = 'NOT_STARTED';
    this.stateVersion = null;
    this.acquiringPromise = null;
    this.roleListeners = new Set();
  }

  isLeader() { return this.role === 'LEADER'; }
  hasLeaseSafetyMargin() {
    return this.mode === 'single' || (this.isLeader() && this.lastLeaseAt !== null && this.now() - this.lastLeaseAt < this.leaseTtlMs);
  }
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
      if (this.database && !await this.database.renewLeadershipFence(this.instanceId, this.epoch, this.leaseTtlMs)) return this._loseLease();
      this.lastLeaseAt = this.now();
      this.leaseRenewalStatus = 'RENEWED';
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
        this.synchronized = await this.applySnapshot(parsed.payload, parsed);
        if (!this.synchronized) throw new Error('AUTHORITATIVE_SNAPSHOT_INVALID');
        this.lastSnapshotVersion = parsed.sequence ?? parsed.payload?.stateVersion ?? null;
      } else this.synchronized = true;
      if (this.database) {
        try { this.epoch = await this.database.claimLeadershipFence(this.instanceId, this.leaseTtlMs); }
        catch (error) {
          await this.redis.eval(RELEASE_SCRIPT, [LEADER_KEY], [this.instanceId]).catch(() => {});
          throw error;
        }
        if (!this.epoch) {
          await this.redis.eval(RELEASE_SCRIPT, [LEADER_KEY], [this.instanceId]);
          this.leaderId = null;
          await this._transition('FOLLOWER');
          return;
        }
      } else if (process.env.NODE_ENV === 'test') {
        // Redis-only leadership is allowed for deterministic unit tests. The
        // production server always injects PostgreSQL and refuses an unfenced leader.
        this.epoch = 'test';
      } else {
        throw new Error('POSTGRES_LEADERSHIP_FENCE_REQUIRED');
      }
      try { await this.onLeaderReady(); }
      catch (error) {
        if (this.database && this.epoch) await this.database.releaseLeadershipFence(this.instanceId, this.epoch).catch(() => {});
        this.epoch = null;
        await this.redis.eval(RELEASE_SCRIPT, [LEADER_KEY], [this.instanceId]).catch(() => {});
        throw error;
      }
      const stillOwner = await this.redis.eval(RENEW_SCRIPT, [LEADER_KEY], [this.instanceId, String(this.leaseTtlMs)]);
      if (Number(stillOwner) !== 1 || (this.database && !await this.database.renewLeadershipFence(this.instanceId, this.epoch, this.leaseTtlMs))) return this._loseLease();
      this.leaderId = this.instanceId;
      this.lastLeaseAt = this.now();
      this.leaseRenewalStatus = 'RENEWED';
      this.lastError = null;
      await this._transition('LEADER');
      await this.publishSnapshot();
      return;
    }
    const owner = await this.redis.get(LEADER_KEY);
    this.leaderId = owner || null;
    if (this.role !== 'FOLLOWER') await this._transition('FOLLOWER');
    const savedSnapshot = await this.redis.get('omnitraf:state:snapshot');
    if (savedSnapshot) {
      const envelope = JSON.parse(savedSnapshot);
      const accepted = await this.applySnapshot(envelope.payload, envelope);
      this.synchronized = accepted === true;
      if (accepted) {
        this.leaderId = envelope.sourceInstanceId || owner || null;
        this.lastSnapshotVersion = envelope.sequence ?? envelope.payload?.stateVersion ?? null;
      }
    }
  }

  async publishSnapshot() {
    if (!this.hasLeaseSafetyMargin()) return false;
    const basePayload = this.onSnapshot();
    if (!basePayload) return false;
    const payload = { ...basePayload, leaderEpoch: this.epoch, sourceInstanceId: this.instanceId, snapshotAt: new Date(this.now()).toISOString() };
    this.stateVersion = payload.stateVersion ?? this.stateVersion;
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
    if (Number.isSafeInteger(envelope.sequence) && Number.isSafeInteger(this.lastSnapshotVersion) && envelope.sequence <= this.lastSnapshotVersion) return false;
    const accepted = await this.applySnapshot(envelope.payload, envelope);
    this.synchronized = accepted === true;
    if (accepted) {
      this.lastSnapshotVersion = envelope.sequence;
      this.leaderId = envelope.sourceInstanceId;
      this.epoch = envelope.payload.leaderEpoch ?? envelope.leaderEpoch ?? null;
      this.stateVersion = envelope.payload.stateVersion ?? envelope.sequence ?? null;
    }
    return this.synchronized;
  }

  async assertCommitFence(fence) {
    if (!this.database || !this.isLeader() || !fence || fence.instanceId !== this.instanceId || String(fence.epoch) !== String(this.epoch) || !this.redis?.isConnected()) {
      throw Object.assign(new Error('LEADERSHIP_FENCE_REJECTED'), { code: 'LEADERSHIP_FENCE_REJECTED', statusCode: 503 });
    }
    const renewed = await this.redis.eval(RENEW_SCRIPT, [LEADER_KEY], [this.instanceId, String(this.leaseTtlMs)]);
    if (Number(renewed) !== 1) {
      throw Object.assign(new Error('LEADERSHIP_FENCE_REJECTED'), { code: 'LEADERSHIP_FENCE_REJECTED', statusCode: 503 });
    }
  }

  async _loseLease() {
    if (this.stopped) return;
    const previousEpoch = this.epoch;
    this.leaderId = null;
    this.synchronized = false;
    this.lastError = 'LEADERSHIP_LEASE_LOST';
    this.leaseRenewalStatus = 'LOST';
    this.epoch = null;
    await this._transition('LEASE_LOST');
    if (this.database && previousEpoch) await this.database.releaseLeadershipFence(this.instanceId, previousEpoch).catch(() => {});
    await this._transition('FOLLOWER');
  }
  async _redisFailure(error) {
    if (this.stopped) return;
    const previousEpoch = this.epoch;
    this.lastError = error.message;
    this.leaseRenewalStatus = 'UNAVAILABLE';
    this.leaderId = null;
    this.synchronized = false;
    this.epoch = null;
    await this._transition('UNAVAILABLE');
    if (this.database && previousEpoch) await this.database.releaseLeadershipFence(this.instanceId, previousEpoch).catch(() => {});
    if (this.redis?.isConnected()) await this.redis.eval(RELEASE_SCRIPT, [LEADER_KEY], [this.instanceId]).catch(() => {});
  }
  async _transition(role) {
    if (this.role === role) return;
    const previousRole = this.role;
    this.role = role;
    if (role === 'LEADER') {
      if (previousRole === 'BECOMING_LEADER' && this.transitions > 1) this.failoverCount++;
      if (this.leadershipLostAt !== null) this.lastFailoverDurationMs = Math.max(0, this.now() - this.leadershipLostAt);
      this.leadershipLostAt = null;
    } else if (previousRole === 'LEADER' && this.leadershipLostAt === null) this.leadershipLostAt = this.now();
    this.transitions++;
    await this.onRoleChange({ previousRole, role, instanceId: this.instanceId });
    for (const listener of this.roleListeners) listener({ previousRole, role, instanceId: this.instanceId });
  }

  async stop({ release = true } = {}) {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.isLeader() && release && this.redis?.isConnected()) {
      if (this.database && this.epoch) await this.database.releaseLeadershipFence(this.instanceId, this.epoch).catch(() => {});
      await this.redis.eval(RELEASE_SCRIPT, [LEADER_KEY], [this.instanceId]).catch(() => {});
    }
    this.epoch = null;
    this.leaderId = null;
    await this._transition('STOPPED');
  }

  getDiagnostics() {
    const leaseExpiresInMs = this.lastLeaseAt === null ? 0 : Math.max(0, this.leaseTtlMs - (this.now() - this.lastLeaseAt));
    const lastErrorCode = this.lastError
      ? (this.lastError.includes('LEASE_LOST') ? 'LEADERSHIP_LEASE_LOST' : this.lastError.includes('SNAPSHOT') ? 'AUTHORITATIVE_SNAPSHOT_INVALID' : 'COORDINATION_UNAVAILABLE')
      : null;
    return { mode: this.mode, instanceId: this.instanceId, role: this.role, leaderEpoch: this.epoch, leaderId: this.leaderId,
      leaseRenewalStatus: this.leaseRenewalStatus, leaseExpiresInMs, synchronized: this.synchronized, stateVersion: this.stateVersion,
      lastSnapshotVersion: this.lastSnapshotVersion, failoverCount: this.failoverCount, lastFailoverDurationMs: this.lastFailoverDurationMs,
      redisStatus: this.mode === 'single' ? 'NOT_REQUIRED' : (this.redis?.getHealth().status || 'UNAVAILABLE'), lastErrorCode, transitions: this.transitions };
  }
}
