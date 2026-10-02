import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.js';
import { diagnosticRateLimiter, mutationRateLimiter } from '../middlewares/rateLimiter.js';
import {
  getDiagnosticHealth,
  getDiagnosticSnapshot,
  getDiagnosticEvents,
  injectChaosFault,
  clearChaosFault,
  getSimulationDiagnostics,
  controlSimulation
} from '../controllers/diagnosticController.js';

const router = Router();

// Diagnostics expose infrastructure and runtime details.
router.get('/health', requireCapability('diagnostics:read'), diagnosticRateLimiter, getDiagnosticHealth);
router.get('/snapshot', requireCapability('diagnostics:read'), diagnosticRateLimiter, getDiagnosticSnapshot);
router.get('/events', requireCapability('diagnostics:read'), diagnosticRateLimiter, getDiagnosticEvents);

// Deterministic Simulation Diagnostics & Control
router.get('/simulation', requireCapability('diagnostics:read'), diagnosticRateLimiter, getSimulationDiagnostics);
router.post('/simulation/control', requireCapability('simulation:control'), mutationRateLimiter, controlSimulation);

// Chaos injection & control (Admin only)
router.post('/chaos/faults/inject', requireCapability('chaos:fault-inject'), mutationRateLimiter, injectChaosFault);
router.post('/chaos/faults/clear', requireCapability('chaos:fault-clear'), mutationRateLimiter, clearChaosFault);
router.delete('/chaos/faults/:faultId', requireCapability('chaos:fault-clear'), mutationRateLimiter, clearChaosFault);

export default router;
