import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { isOriginAllowed, ALLOW_TEST_QUERY_TOKEN_AUTH, NODE_ENV } from '../config/env.js';
import { verifyToken } from '../middlewares/auth.js';
import { backendState } from '../services/stateManager.js';
import { cvEngine } from '../services/visionEngine.js';
import { registerOperatorHandlers } from './handlers/operatorHandler.js';
import { registerSignalHandlers } from './handlers/signalHandler.js';
import { registerEmergencyHandlers } from './handlers/emergencyHandler.js';
import { registerChaosHandlers } from './handlers/chaosHandler.js';
import { realtimeDispatcher } from './realtimeDispatcher.js';
import { REALTIME_ROOMS } from './eventRegistry.js';
import { SAFETY_BOUNDARY } from '../config/safetyBoundary.js';
import { ROLES } from '../config/constants.js';

const ROOM_ROLES = new Map([
  [REALTIME_ROOMS.DASHBOARD, [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.TRAFFIC, [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.SIGNALS, [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.INCIDENTS, [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.EMERGENCY, [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.DEVICES, [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.ANALYTICS, [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.AUDIT, [ROLES.OPERATOR, ROLES.ADMIN]],
  [REALTIME_ROOMS.ADMIN, [ROLES.ADMIN]],
  [REALTIME_ROOMS.CCTV_ALL, [ROLES.OPERATOR, ROLES.ADMIN]]
]);

function isRoomAllowedForRole(room, role) {
  const allowedRoles = ROOM_ROLES.get(room) ||
    (/^room:cctv:[a-z0-9_-]{1,64}$/i.test(room) ? [ROLES.OPERATOR, ROLES.ADMIN] : null);
  return !!allowedRoles?.includes(role);
}

export function initializeSocketServer(httpServer) {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 1e6, // 1 MB payload protection
    pingTimeout: 20000,
    pingInterval: 10000,
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS request rejected: Origin not allowed'));
      },
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Skalabilitas Horisontal: Integrasi Redis Adapter bila konfigurasi REDIS_URL tersedia
  if (process.env.REDIS_URL) {
    try {
      const pubClient = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 100, 2000),
        lazyConnect: true
      });
      const subClient = pubClient.duplicate();

      pubClient.on('error', (err) => {
        console.warn('⚠️ [Redis Adapter] Pub connection error:', err.message);
      });
      subClient.on('error', (err) => {
        console.warn('⚠️ [Redis Adapter] Sub connection error:', err.message);
      });

      Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
          io.adapter(createAdapter(pubClient, subClient));
          console.log('🚀 [Socket.io] Redis Adapter aktif untuk klaster horisontal terdistribusi.');
        })
        .catch((err) => {
          console.warn('⚠️ [Socket.io] Gagal menghubungkan ke Redis, fallback ke default in-memory adapter:', err.message);
        });
    } catch (err) {
      console.warn('⚠️ [Socket.io] Gagal menginisialisasi Redis Adapter, fallback ke default in-memory adapter:', err.message);
    }
  } else {
    console.log('ℹ️ [Socket.io] Berjalan dengan in-memory adapter lokal.');
  }

  backendState.setIo(io);
  realtimeDispatcher.setIo(io);

  // Handshake Authentication Middleware
  io.use((socket, next) => {
    const header = socket.handshake.headers?.authorization;
    const cookieHeader = socket.handshake.headers?.cookie;
    let cookieToken = null;
    if (typeof cookieHeader === 'string') {
      const match = cookieHeader.match(/(?:^|;\s*)omnitraf_session=([^;]+)/);
      if (match) cookieToken = decodeURIComponent(match[1]).trim();
    }
    const queryTokenAllowed = NODE_ENV === 'test' && ALLOW_TEST_QUERY_TOKEN_AUTH;
    const token = socket.handshake.auth?.token ||
      (typeof header === 'string' && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : null) ||
      cookieToken ||
      (queryTokenAllowed ? socket.handshake.query?.token : null);

    if (!token) return next(new Error('AUTHENTICATION_REQUIRED: JWT Bearer token wajib disertakan.'));
    const principal = verifyToken(token);
    if (!principal) return next(new Error('AUTHENTICATION_FAILED: Token tidak valid atau telah kedaluwarsa.'));
    socket.user = principal;
    return next();
  });

  // Client Connection Handler
  io.on('connection', (socket) => {
    console.log(`🔌 [Socket.io] Client terhubung: ${socket.id} (User: ${socket.user?.name}, Role: ${socket.user?.role})`);

    // Join only rooms this authenticated role may read.
    socket.join(REALTIME_ROOMS.DASHBOARD);
    socket.join(REALTIME_ROOMS.TRAFFIC);
    socket.join(REALTIME_ROOMS.SIGNALS);
    socket.join(REALTIME_ROOMS.INCIDENTS);
    socket.join(REALTIME_ROOMS.EMERGENCY);
    socket.join(REALTIME_ROOMS.DEVICES);
    if (isRoomAllowedForRole(REALTIME_ROOMS.AUDIT, socket.user.role)) socket.join(REALTIME_ROOMS.AUDIT);
    if (isRoomAllowedForRole(REALTIME_ROOMS.ADMIN, socket.user.role)) socket.join(REALTIME_ROOMS.ADMIN);

    // Send initial full canonical state snapshot
    const initialSnapshot = backendState.getSnapshot();
    socket.emit('traffic:init', {
      state: backendState.state,
      canonical: initialSnapshot.canonical,
      seq: backendState.sequence,
      cctvSeq: backendState.cctvSequence,
      incidentSeq: backendState.incidentSequence,
      emergencySeq: backendState.emergencySequence,
      signalSeq: backendState.signalSequence,
      deviceSeq: backendState.deviceSequence,
      timestampMs: backendState.lastUpdated,
      source: 'server',
      provenance: 'SIMULATED',
      safetyBoundary: SAFETY_BOUNDARY
    });
    if (isRoomAllowedForRole(REALTIME_ROOMS.CCTV_ALL, socket.user.role)) {
      socket.emit('cctv:vision-update', cvEngine.generateFramePayload(backendState.state.isChaosMode));
    }

    // Dynamic Room Subscription Management (Langkah 4 & 13)
    socket.on('channel:subscribe', (data, callback) => {
      const { channels, room } = data && typeof data === 'object' ? data : {};
      const targetChannels = (Array.isArray(channels) ? channels : (room ? [room] : [])).slice(0, 32);
      const accepted = [];
      const rejected = [];
      targetChannels.forEach(ch => {
        if (typeof ch === 'string' && isRoomAllowedForRole(ch.trim(), socket.user.role)) {
          socket.join(ch.trim());
          accepted.push(ch.trim());
        } else {
          rejected.push(typeof ch === 'string' ? ch.slice(0, 80) : '[invalid]');
        }
      });
      if (typeof callback === 'function') {
        callback({ success: rejected.length === 0, subscribed: accepted, rejected });
      }
    });

    socket.on('channel:unsubscribe', (data, callback) => {
      const { channels, room } = data && typeof data === 'object' ? data : {};
      const targetChannels = (Array.isArray(channels) ? channels : (room ? [room] : [])).slice(0, 32);
      const accepted = [];
      const rejected = [];
      targetChannels.forEach(ch => {
        if (typeof ch === 'string' && isRoomAllowedForRole(ch.trim(), socket.user.role)) {
          socket.leave(ch.trim());
          accepted.push(ch.trim());
        } else {
          rejected.push(typeof ch === 'string' ? ch.slice(0, 80) : '[invalid]');
        }
      });
      if (typeof callback === 'function') {
        callback({ success: rejected.length === 0, unsubscribed: accepted, rejected });
      }
    });

    // 0. Idempotent State Resync
    socket.on('state:resync', (data, callback) => {
      const snapshot = backendState.getSnapshot();
      socket.emit('traffic:init', {
        state: backendState.state,
        canonical: snapshot.canonical,
        seq: backendState.sequence,
        cctvSeq: backendState.cctvSequence,
        incidentSeq: backendState.incidentSequence,
        emergencySeq: backendState.emergencySequence,
        signalSeq: backendState.signalSequence,
        deviceSeq: backendState.deviceSequence,
        timestampMs: backendState.lastUpdated,
        source: 'server',
        provenance: 'SIMULATED',
        safetyBoundary: SAFETY_BOUNDARY
      });
      if (typeof callback === 'function') {
        callback({
          success: true,
          ...snapshot
        });
      }
    });

    // 0.1 Heartbeat Ping-Pong
    socket.on('heartbeat:ping', (data, callback) => {
      const res = {
        pong: true,
        clientTimestamp: data?.timestamp || null,
        serverTimestamp: Date.now(),
        seq: backendState.sequence
      };
      socket.emit('heartbeat:pong', res);
      if (typeof callback === 'function') {
        callback(res);
      }
    });

    // Register Modular Event Handlers
    registerOperatorHandlers(io, socket);
    registerSignalHandlers(io, socket);
    registerEmergencyHandlers(io, socket);
    registerChaosHandlers(io, socket);

    socket.on('disconnect', () => {
      console.log(`❌ [Socket.io] Client terputus: ${socket.id}`);
    });
  });

  // 1. Core Telemetry & APILL Ticker Loop (1000ms with elapsed delta tracking)
  let lastTrafficTickMonotonic = backendState.clock.monotonic();
  setInterval(() => {
    const nowMono = backendState.clock.monotonic();
    const elapsedMs = Math.max(100, Math.round(nowMono - lastTrafficTickMonotonic));
    lastTrafficTickMonotonic = nowMono;

    if (io.engine.clientsCount === 0) return;
    const updatedState = backendState.tick(elapsedMs);
    // Broadcast via RealtimeEventDispatcher + direct io.emit fallback for legacy/test clients
    realtimeDispatcher.dispatchTrafficUpdate(updatedState);
  }, 1000).unref();

  // 2. High-Efficiency Computer Vision Detection Stream (300ms)
  setInterval(() => {
    if (io.engine.clientsCount === 0) return;
    const isChaos = backendState.state.isChaosMode;
    const visionPayload = cvEngine.generateFramePayload(isChaos);
    // Dispatched via RealtimeEventDispatcher with per-camera stream separation & aggregate
    realtimeDispatcher.dispatchCctvVision(visionPayload);
  }, 300).unref();

  return io;
}
