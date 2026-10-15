import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.js';
import {
  getScenarioLabPresets, compareScenarioLab, createScenarioLabSession,
  getScenarioLabSession, controlScenarioLabSession, deleteScenarioLabSession
} from '../controllers/scenarioLabController.js';

const router = Router();
router.get('/scenario-lab/presets', requireCapability('forecast:read'), getScenarioLabPresets);
router.post('/scenario-lab/compare', requireCapability('forecast:read'), compareScenarioLab);
router.post('/scenario-lab/sessions', requireCapability('simulation:control'), createScenarioLabSession);
router.get('/scenario-lab/sessions/:sessionId', requireCapability('forecast:read'), getScenarioLabSession);
router.post('/scenario-lab/sessions/:sessionId/control', requireCapability('simulation:control'), controlScenarioLabSession);
router.delete('/scenario-lab/sessions/:sessionId', requireCapability('simulation:control'), deleteScenarioLabSession);

export default router;
