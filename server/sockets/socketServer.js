import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { isOriginAllowed, ALLOW_TEST_QUERY_TOKEN_AUTH, NODE_ENV, OMNITRAF_RUNTIME_MODE } from '../config/env.js';
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

export function initializeSocketServer(httpServer, { redisManager = null, leadership = null } = {}) {
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
  io.data = {};

  io.data = { leadership, redisClients: redisManager?.socketClients() || null };
  if (io.data.redisClients) {
    io.adapter(createAdapter(...io.data.redisClients));
    console.log('🚀 [Socket.io] Redis Adapter aktif melalui RedisManager.');
  } else {
    console.log('ℹ️ [Socket.io] Berjalan dengan in-memory adapter lokal.');
  }

  backendState.setIo(io);
  realtimeDispatcher.setIo(io);

  // Handshake Authentication Middleware
  io.use((socket, next) => {
    if (OMNITRAF_RUNTIME_MODE === 'cluster' && !leadership?.synchronized) return next(new Error('STATE_SYNC_PENDING: instance belum menerima baseline authoritative.'));
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
      const latestFrame = cvEngine.getLatestFramePayload();
      if (latestFrame) socket.emit('cctv:vision-update', latestFrame);
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

  let intervalTimers = [];
  let lastTrafficTickMonotonic = backendState.clock.monotonic();
  const stopSimulationLoops = () => {
    intervalTimers.forEach(clearInterval);
    intervalTimers = [];
    io.data.intervalTimers = intervalTimers;
  };
  const startSimulationLoops = () => {
    if (intervalTimers.length || (leadership && !leadership.isLeader())) return;
    lastTrafficTickMonotonic = backendState.clock.monotonic();
    const leaseValid = () => OMNITRAF_RUNTIME_MODE === 'single' || leadership?.hasLeaseSafetyMargin();
    const trafficTicker = setInterval(() => {
      if (!leaseValid()) { stopSimulationLoops(); return; }
      const nowMono = backendState.clock.monotonic();
      const elapsedMs = Math.max(100, Math.round(nowMono - lastTrafficTickMonotonic));
      lastTrafficTickMonotonic = nowMono;
      if (OMNITRAF_RUNTIME_MODE === 'single' && io.engine.clientsCount === 0) return;
      const updatedState = backendState.tick(elapsedMs);
      realtimeDispatcher.dispatchTrafficUpdate(updatedState);
      leadership?.publishSnapshot().catch(() => {});
    }, 1000);
    const visionTicker = setInterval(() => {
      if (!leaseValid()) { stopSimulationLoops(); return; }
      if (OMNITRAF_RUNTIME_MODE === 'single' && io.engine.clientsCount === 0) return;
      const visionPayload = cvEngine.generateFramePayload(backendState.state.isChaosMode);
      realtimeDispatcher.dispatchCctvVision(visionPayload);
      if (OMNITRAF_RUNTIME_MODE === 'cluster') {
        leadership?.eventBus?.publish('omnitraf:events:cctv', 'cctv:state', visionPayload.seq, cvEngine.getSnapshot()).catch(() => {});
      }
    }, 300);
    intervalTimers = [trafficTicker, visionTicker];
    intervalTimers.forEach((timer) => timer.unref?.());
    io.data.intervalTimers = intervalTimers;
  };
  io.data.startSimulationLoops = startSimulationLoops;
  io.data.stopSimulationLoops = stopSimulationLoops;
  io.data.unsubscribeLeadership = leadership?.addRoleListener(({ role }) => {
    if (role === 'LEADER') startSimulationLoops();
    else stopSimulationLoops();
  }) || null;
  if (!leadership || leadership.isLeader()) startSimulationLoops();

  return io;
}
