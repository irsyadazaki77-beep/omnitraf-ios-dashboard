import Redis from 'ioredis';
import { REDIS_URL } from '../../config/env.js';

export class RedisManager {
  constructor({ url = REDIS_URL, clientFactory = (connectionUrl, options) => new Redis(connectionUrl, options) } = {}) {
    this.url = url;
    this.clientFactory = clientFactory;
    this.clients = [];
    this.commandClient = null;
    this.eventPublisher = null;
    this.eventSubscriber = null;
    this.socketPublisher = null;
    this.socketSubscriber = null;
    this.status = 'NOT_CONFIGURED';
    this.lastError = null;
    this._listeners = new Map();
  }

  async connect() {
    if (!this.url) throw new Error('REDIS_URL is required for Redis coordination.');
    if (this.status === 'CONNECTED') return this;
    this.status = 'CONNECTING';
    const options = { lazyConnect: true, maxRetriesPerRequest: 3, retryStrategy: (attempt) => Math.min(attempt * 200, 2000) };
    this.commandClient = this.clientFactory(this.url, options);
    this.eventPublisher = this.commandClient.duplicate();
    this.eventSubscriber = this.commandClient.duplicate();
    this.socketPublisher = this.commandClient.duplicate();
    this.socketSubscriber = this.commandClient.duplicate();
    this.clients = [this.commandClient, this.eventPublisher, this.eventSubscriber, this.socketPublisher, this.socketSubscriber];
    this.eventSubscriber.on('message', (channel, message) => {
      for (const listener of this._listeners.get(channel) || []) listener(message);
    });
    for (const client of this.clients) {
      client.on('error', (error) => {
        this.lastError = error.message;
        if (this.status === 'CONNECTED') this.status = 'DEGRADED';
      });
      client.on('ready', () => {
        if (this.clients.length > 0 && this.clients.every((candidate) => candidate.status === 'ready')) {
          this.status = 'CONNECTED';
          this.lastError = null;
        }
      });
    }
    try {
      await Promise.all(this.clients.map((client) => client.connect()));
      this.status = 'CONNECTED';
      this.lastError = null;
      return this;
    } catch (error) {
      this.status = 'UNAVAILABLE';
      this.lastError = error.message;
      await this.disconnect();
      this.status = 'UNAVAILABLE';
      throw error;
    }
  }

  async disconnect() {
    const clients = this.clients.splice(0);
    await Promise.allSettled(clients.map((client) => client.quit()));
    this.commandClient = this.eventPublisher = this.eventSubscriber = null;
    this.socketPublisher = this.socketSubscriber = null;
    if (this.status !== 'UNAVAILABLE') this.status = this.url ? 'DISCONNECTED' : 'NOT_CONFIGURED';
  }

  isConnected() { return this.status === 'CONNECTED' && !!this.commandClient; }
  socketClients() { return this.socketPublisher && this.socketSubscriber ? [this.socketPublisher, this.socketSubscriber] : null; }

  async publish(channel, envelope) {
    if (!this.isConnected()) throw new Error('REDIS_UNAVAILABLE');
    return this.eventPublisher.publish(channel, JSON.stringify(envelope));
  }

  async subscribe(channel, listener) {
    if (!this.isConnected()) throw new Error('REDIS_UNAVAILABLE');
    if (!this._listeners.has(channel)) {
      this._listeners.set(channel, new Set());
      await this.eventSubscriber.subscribe(channel);
    }
    this._listeners.get(channel).add(listener);
    return () => {
      const listeners = this._listeners.get(channel);
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this._listeners.delete(channel);
        this.eventSubscriber.unsubscribe(channel).catch(() => {});
      }
    };
  }

  async set(key, value, ...args) {
    if (!this.isConnected()) throw new Error('REDIS_UNAVAILABLE');
    return this.commandClient.set(key, value, ...args);
  }
  async get(key) {
    if (!this.isConnected()) throw new Error('REDIS_UNAVAILABLE');
    return this.commandClient.get(key);
  }
  async eval(script, keys = [], args = []) {
    if (!this.isConnected()) throw new Error('REDIS_UNAVAILABLE');
    return this.commandClient.eval(script, keys.length, ...keys, ...args);
  }
  async incrementWindow(key, windowMs) {
    const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}";
    return this.eval(script, [key], [String(windowMs)]);
  }

  getHealth() {
    return { status: this.status, lastError: this.lastError, configured: !!this.url };
  }
}

export const redisManager = new RedisManager();
