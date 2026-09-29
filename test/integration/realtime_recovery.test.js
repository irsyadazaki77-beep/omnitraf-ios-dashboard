import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { io as Client } from 'socket.io-client';

// Setup port 0 for dynamic testing port
process.env.PORT = '0';
process.env.DB_PATH = 'data/test_realtime_omnitraf.sqlite';
const { server } = await import('../../server.js');
const { backendState } = await import('../../server/services/stateManager.js');
const { generateToken } = await import('../../server/middlewares/auth.js');
const { ROLES } = await import('../../server/config/constants.js');

describe('Phase 18: Realtime Reliability, Ordering & Recovery Hardening Test Suite', () => {
  let baseUrl;
  let serverPort;
  let adminToken;
  let operatorToken;

  before(async () => {
    await new Promise((resolve) => {
      if (server.listening) {
        resolve();
      } else {
        server.listen(0, '127.0.0.1', () => {
          resolve();
        });
      }
    });

    serverPort = server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;

    adminToken = generateToken({
      id: 'usr-admin-test',
      username: 'admintest',
      role: ROLES.ADMIN,
      name: 'Admin Test'
    });

    operatorToken = generateToken({
      id: 'usr-op-test',
      username: 'operatortest',
      role: ROLES.OPERATOR,
      name: 'Operator Test'
    });
  });

  after(() => {
    server.close();
    try {
      if (fs.existsSync(process.env.DB_PATH)) {
        fs.unlinkSync(process.env.DB_PATH);
      }
    } catch (_) {}
  });

  function createClient(options = {}) {
    const cl = Client(baseUrl, {
      auth: { token: adminToken },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      ...options
    });
    cl.on('error', () => {});
    cl.on('connect_error', () => {});
    return cl;
  }

  test('1. Socket.IO connection & handshake authentication enforcement', async () => {
    // 1.1 Invalid token -> reject connection with AUTHENTICATION_FAILED
    const badClient = createClient({
      auth: { token: 'invalid.expired.jwt.token' }
    });

    const connectErrorPromise = new Promise((resolve) => {
      badClient.on('connect_error', (err) => {
        resolve(err.message);
      });
    });

    badClient.connect();
    const errorMsg = await connectErrorPromise;
    assert.ok(errorMsg.includes('AUTHENTICATION_FAILED'), `Expected AUTHENTICATION_FAILED, got: ${errorMsg}`);
    badClient.disconnect();

    // 1.2 Valid token -> successful connection with proper user role
    const goodClient = createClient({
      auth: { token: adminToken }
    });

    const connectPromise = new Promise((resolve) => {
      goodClient.on('connect', () => {
        resolve(goodClient.id);
      });
    });

    goodClient.connect();
    const socketId = await connectPromise;
    assert.ok(socketId, 'Socket should be successfully connected');
    goodClient.disconnect();
  });

  test('2. Initial state snapshot (traffic:init) schema & domain sequences contract', async () => {
    const client = createClient();

    const initPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for traffic:init')), 4000);
      client.on('traffic:init', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    client.connect();
    const initData = await initPromise;
    assert.ok(initData, 'Should receive traffic:init payload');
    assert.strictEqual(initData.source, 'server');
    assert.ok(typeof initData.seq === 'number', 'Payload should have global sequence number');
    assert.ok(typeof initData.cctvSeq === 'number', 'Payload should have cctv sequence number');
    assert.ok(typeof initData.incidentSeq === 'number', 'Payload should have incident sequence number');
    assert.ok(typeof initData.emergencySeq === 'number', 'Payload should have emergency sequence number');
    assert.ok(typeof initData.signalSeq === 'number', 'Payload should have signal sequence number');
    assert.ok(typeof initData.deviceSeq === 'number', 'Payload should have device sequence number');
    assert.ok(typeof initData.timestampMs === 'number', 'Payload should have timestampMs');
    assert.ok(initData.state && typeof initData.state === 'object', 'Payload should contain canonical state');
    assert.ok(Array.isArray(initData.state.intersections), 'State should contain intersections');
    assert.ok(Array.isArray(initData.state.incidents), 'State should contain incidents');
    assert.ok(Array.isArray(initData.state.devices), 'State should contain devices');

    client.disconnect();
  });

  test('3. Idempotent state:resync via Socket.IO matches authoritative backend state', async () => {
    const client = createClient();
    client.connect();
    await new Promise((resolve) => client.on('connect', resolve));

    // Request state:resync with callback
    const resyncPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout state:resync')), 4000);
      client.emit('state:resync', {}, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    const resyncResponse = await resyncPromise;
    assert.ok(resyncResponse.success, 'Resync response should indicate success');
    assert.strictEqual(resyncResponse.source, 'server');
    assert.ok(resyncResponse.seq >= backendState.sequence - 1);
    assert.ok(resyncResponse.state.intersections.length > 0);

    // REST fallback consistency: compare with GET /api/state/snapshot
    const restRes = await fetch(`${baseUrl}/api/state/snapshot`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.strictEqual(restRes.status, 200);
    const restData = await restRes.json();
    assert.strictEqual(restData.success, true);
    assert.strictEqual(restData.extra.source, 'server');
    assert.strictEqual(restData.extra.state.intersections.length, resyncResponse.state.intersections.length);

    client.disconnect();
  });

  test('4. Heartbeat ping-pong RTT latency tracking and sequence validation', async () => {
    const client = createClient();
    client.connect();
    await new Promise((resolve) => client.on('connect', resolve));

    const pingTime = Date.now();
    const pongPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout heartbeat:ping')), 4000);
      client.emit('heartbeat:ping', { timestamp: pingTime }, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    const pong = await pongPromise;
    assert.strictEqual(pong.pong, true);
    assert.strictEqual(pong.clientTimestamp, pingTime);
    assert.ok(typeof pong.serverTimestamp === 'number');
    assert.ok(pong.serverTimestamp >= pingTime);
    assert.ok(typeof pong.seq === 'number');

    client.disconnect();
  });

  test('5. Domain sequence separation: emergency vs signal vs device sequences', async () => {
    const client = createClient();
    client.connect();
    await new Promise((resolve) => client.on('connect', resolve));

    const initialEmergencySeq = backendState.emergencySequence;
    const initialSignalSeq = backendState.signalSequence;

    // Trigger signal override
    const signalUpdatePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout signal:update')), 4000);
      client.on('signal:update', (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    client.emit('operator:command', {
      cmd: {
        action: 'signal:override',
        targetId: 'node-wonokromo',
        payload: { duration: 25 },
        commandId: `CMD-TEST-SIG-${Date.now()}`,
        idempotencyKey: `IDEMP-TEST-SIG-${Date.now()}`
      },
      correlationId: `CORR-TEST-SIG-${Date.now()}`
    });

    const signalData = await signalUpdatePromise;
    assert.strictEqual(signalData.source, 'server');
    assert.ok(signalData.seq > initialSignalSeq, 'Signal sequence must increment');
    assert.strictEqual(backendState.emergencySequence, initialEmergencySeq, 'Emergency sequence must remain untouched');

    client.disconnect();
  });

  test('6. Command idempotency & status check contract', async () => {
    const client = createClient();
    client.connect();
    await new Promise((resolve) => client.on('connect', resolve));

    const commandId = `CMD-IDEMP-${Date.now()}`;
    const idempotencyKey = `IDEMP-KEY-${Date.now()}`;
    const correlationId = `CORR-IDEMP-${Date.now()}`;

    // 1. First execution
    const firstExecPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout command 1')), 4000);
      client.emit('operator:command', {
        cmd: {
          action: 'green-split:update',
          targetId: 'node-wonokromo',
          payload: { value: 40 },
          commandId,
          idempotencyKey
        },
        correlationId
      }, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    const firstResult = await firstExecPromise;
    assert.strictEqual(firstResult.success, true);
    assert.strictEqual(firstResult.status, 'SERVER_APPLIED');

    // 2. Query command:status
    const statusQueryPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout command:status')), 4000);
      client.emit('command:status', { commandId, idempotencyKey, correlationId }, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    const statusResult = await statusQueryPromise;
    assert.strictEqual(statusResult.success, true);
    assert.strictEqual(statusResult.status, 'SERVER_APPLIED');

    // 3. Second identical execution -> returns idempotent cached result
    const secondExecPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout command 2')), 4000);
      client.emit('operator:command', {
        cmd: {
          action: 'green-split:update',
          targetId: 'node-wonokromo',
          payload: { value: 40 },
          commandId,
          idempotencyKey
        },
        correlationId
      }, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    const secondResult = await secondExecPromise;
    assert.strictEqual(secondResult.success, true);
    assert.strictEqual(secondResult.isIdempotentReplay, true);

    // 4. Unknown command status check -> NOT_FOUND
    const unknownStatusPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout unknown command:status')), 4000);
      client.emit('command:status', { commandId: 'UNKNOWN-CMD-99999' }, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });
    const unknownResult = await unknownStatusPromise;
    assert.strictEqual(unknownResult.status, 'NOT_FOUND');

    client.disconnect();
  });

  test('7. CCTV Computer Vision frames: ordering metadata and stream validation', async () => {
    const client = createClient();

    const frames = [];
    const framePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout cctv:vision-update')), 4000);
      client.on('cctv:vision-update', (payload) => {
        frames.push(payload);
        if (frames.length >= 2) {
          clearTimeout(timer);
          resolve(frames);
        }
      });
    });

    client.connect();
    await framePromise;
    assert.strictEqual(frames.length, 2);

    const f1 = frames[0];
    const f2 = frames[1];

    assert.strictEqual(f1.source, 'server');
    assert.strictEqual(f2.source, 'server');
    assert.ok(typeof f1.seq === 'number');
    assert.ok(typeof f2.seq === 'number');
    assert.ok(f2.seq >= f1.seq, `Subsequent frame seq (${f2.seq}) must be >= previous frame seq (${f1.seq})`);
    assert.ok(f1.cameras && typeof f1.cameras === 'object');

    client.disconnect();
  });

  test('8. SSE Stream (/api/stream-traffic): diagnostic stream format, headers, and clean disconnect', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream-traffic`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: controller.signal
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/event-stream'));
    assert.ok(res.headers.get('cache-control').includes('no-cache'));

    // Read the first chunk
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const textChunk = new TextDecoder().decode(value);

    assert.ok(textChunk.includes('event: telemetry'));
    assert.ok(textChunk.includes('"source":"sse-stream"'));
    assert.ok(textChunk.includes('"type":"traffic_stream"'));

    reader.releaseLock();
    controller.abort();
    await new Promise(r => setTimeout(r, 100));
  });
});
