import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.js';
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
router.get('/health', requireCapability('diagnostics:read'), getDiagnosticHealth);
router.get('/snapshot', requireCapability('diagnostics:read'), getDiagnosticSnapshot);
router.get('/events', requireCapability('diagnostics:read'), getDiagnosticEvents);

// Deterministic Simulation Diagnostics & Control
router.get('/simulation', requireCapability('diagnostics:read'), getSimulationDiagnostics);
router.post('/simulation/control', requireCapability('simulation:control'), controlSimulation);

// Chaos injection & control (Admin only)
router.post('/chaos/faults/inject', requireCapability('chaos:fault-inject'), injectChaosFault);
router.post('/chaos/faults/clear', requireCapability('chaos:fault-clear'), clearChaosFault);
router.delete('/chaos/faults/:faultId', requireCapability('chaos:fault-clear'), clearChaosFault);

export default router;
