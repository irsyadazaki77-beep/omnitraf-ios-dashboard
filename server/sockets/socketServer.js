import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { isOriginAllowed } from '../config/env.js';
import { ROLES } from '../config/constants.js';
import { verifyToken } from '../middlewares/auth.js';
import { backendState } from '../services/stateManager.js';
import { cvEngine } from '../services/visionEngine.js';
import { registerOperatorHandlers } from './handlers/operatorHandler.js';
import { registerSignalHandlers } from './handlers/signalHandler.js';
import { registerEmergencyHandlers } from './handlers/emergencyHandler.js';
import { registerChaosHandlers } from './handlers/chaosHandler.js';

export function initializeSocketServer(httpServer) {
  const io = new Server(httpServer, {
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

  // Handshake Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token ||
                  socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
                  socket.handshake.query?.token;

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        socket.user = decoded;
        return next();
      }
    }

    // Default viewer role if no valid token
    socket.user = {
      id: 'usr-anonymous',
      username: 'anonymous',
      role: ROLES.VIEWER,
      name: 'Publik / Dishub Viewer'
    };
    next();
  });

  // Client Connection Handler
  io.on('connection', (socket) => {
    console.log(`🔌 [Socket.io] Client terhubung: ${socket.id} (User: ${socket.user?.name}, Role: ${socket.user?.role})`);

    // Send initial full canonical state snapshot
    socket.emit('traffic:init', {
      ...backendState.state,
      seq: backendState.sequence,
      timestampMs: backendState.lastUpdated,
      source: 'server'
    });
    socket.emit('cctv:vision-update', cvEngine.generateFramePayload(backendState.state.isChaosMode));

    // 0. Idempotent State Resync
    socket.on('state:resync', (data, callback) => {
      const snapshot = backendState.getSnapshot();
      socket.emit('traffic:init', {
        ...backendState.state,
        seq: backendState.sequence,
        timestampMs: backendState.lastUpdated,
        source: 'server'
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

  // 1. Core Telemetry & APILL Ticker Loop (1000ms)
  setInterval(() => {
    if (io.engine.clientsCount === 0) return;
    const updatedState = backendState.tick();
    io.emit('traffic:update', updatedState);
  }, 1000).unref();

  // 2. High-Efficiency Computer Vision Detection Stream (300ms)
  setInterval(() => {
    if (io.engine.clientsCount === 0) return;
    const isChaos = backendState.state.isChaosMode;
    const visionPayload = cvEngine.generateFramePayload(isChaos);
    io.emit('cctv:vision-update', visionPayload);
  }, 300).unref();

  return io;
}
