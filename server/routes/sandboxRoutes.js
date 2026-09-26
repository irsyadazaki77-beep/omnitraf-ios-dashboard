import { Router } from 'express';
import { backendState } from '../services/stateManager.js';

const router = Router();

router.get('/traffic/realtime', (req, res) => res.json({
  status: "success",
  timestamp: new Date().toISOString(),
  city: "Surabaya",
  activeNodes: 184,
  networkLoadPercent: backendState.state.networkLoad,
  averageWaitTimeSec: backendState.state.avgWaitTime,
  activeCorridor: "Jl. Ahmad Yani (Frontage Margorejo)"
}));

router.get('/signals/cycle', (req, res) => res.json({
  status: "success",
  junctionId: "SITS-WNK-01",
  phase: backendState.state.greenWaveActive ? "GREEN_WAVE_LOCKED" : "ADAPTIVE_GREEN",
  cycleRemainingSec: backendState.state.intersections[0].timer,
  splitOptimizationRatio: 1.45
}));

router.get('/cctv/detections', (req, res) => res.json({
  status: "success",
  camera: "CCTV-01-AYANI",
  fps: 30.0,
  detectionsCount: 18,
  breakdown: { cars: 10, motorcycles: 6, buses: 2 }
}));

router.all('/*', (req, res) => {
  const pathStr = req.path;
  if (pathStr === '/traffic/realtime' || pathStr === '/v1/traffic/realtime') {
    return res.json({
      status: "success",
      timestamp: new Date().toISOString(),
      city: "Surabaya",
      activeNodes: 184,
      networkLoadPercent: backendState.state.networkLoad,
      averageWaitTimeSec: backendState.state.avgWaitTime,
      activeCorridor: "Jl. Ahmad Yani (Frontage Margorejo)"
    });
  }
  if (pathStr === '/signals/cycle' || pathStr === '/v1/signals/cycle') {
    return res.json({
      status: "success",
      junctionId: "SITS-WNK-01",
      phase: backendState.state.greenWaveActive ? "GREEN_WAVE_LOCKED" : "ADAPTIVE_GREEN",
      cycleRemainingSec: backendState.state.intersections[0].timer,
      splitOptimizationRatio: 1.45
    });
  }
  if (pathStr === '/cctv/detections' || pathStr === '/v1/cctv/detections') {
    return res.json({
      status: "success",
      camera: "CCTV-01-AYANI",
      fps: 30.0,
      detectionsCount: 18,
      breakdown: { cars: 10, motorcycles: 6, buses: 2 }
    });
  }
  return res.json({
    status: "success",
    method: req.method,
    endpoint: req.path,
    timestamp: new Date().toISOString(),
    message: `Respons sukses dari Server API SITS Surabaya untuk ${req.method} ${req.path}`,
    data: req.body || null
  });
});

export default router;
