import { Router } from 'express';
import { backendState } from '../services/stateManager.js';
import { requireCapability } from '../middlewares/auth.js';
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';

const router = Router();
router.use(requireCapability('traffic:read'));

const SIMULATION_META = {
  isSimulation: true,
  provenance: 'SYNTHETIC_SIMULATOR',
  deviceConnected: false,
  source: 'OmniTRAF SITS Virtual Simulator'
};

router.get('/traffic/realtime', (req, res) => res.json(createApiResponse({
  type: 'sandbox_traffic_realtime',
  data: {
    city: 'Surabaya',
    activeNodes: 184,
    networkLoadPercent: backendState.state.networkLoad,
    averageWaitTimeSec: backendState.state.avgWaitTime,
    activeCorridor: 'Jl. Ahmad Yani (Frontage Jemursari)'
  },
  extra: {
    status: 'success',
    ...SIMULATION_META
  }
})));

router.get('/signals/cycle', (req, res) => res.json(createApiResponse({
  type: 'sandbox_signals_cycle',
  data: {
    junctionId: 'SITS-WNK-01',
    phase: backendState.state.greenWaveActive ? 'GREEN_WAVE_LOCKED' : 'ADAPTIVE_GREEN',
    cycleRemainingSec: backendState.state.intersections[0]?.timer ?? 30,
    splitOptimizationRatio: 1.45
  },
  extra: {
    status: 'success',
    ...SIMULATION_META
  }
})));

router.get('/cctv/detections', (req, res) => res.json(createApiResponse({
  type: 'sandbox_cctv_detections',
  data: {
    camera: 'CCTV-01-AYANI',
    fps: 30.0,
    detectionsCount: 18,
    breakdown: { cars: 10, motorcycles: 6, buses: 2 }
  },
  extra: {
    status: 'success',
    ...SIMULATION_META
  }
})));

// Reject unsupported methods on known sandbox routes with HTTP 405 Method Not Allowed
router.all(['/traffic/realtime', '/signals/cycle', '/cctv/detections'], (req, res) => {
  res.setHeader('Allow', 'GET');
  return res.status(405).json(createApiErrorResponse(
    405,
    'METHOD_NOT_ALLOWED',
    `Metode HTTP ${req.method} tidak diizinkan untuk endpoint ini. Gunakan GET.`,
    { allowedMethods: ['GET'], method: req.method, path: req.path }
  ));
});

// Unknown endpoints return explicit 404 Not Found instead of false successes
router.all('/*', (req, res) => {
  return res.status(404).json(createApiErrorResponse(
    404,
    'API_ENDPOINT_NOT_FOUND',
    `Endpoint sandbox '${req.method} ${req.path}' tidak ditemukan.`,
    { endpoint: req.path, method: req.method }
  ));
});

export default router;

