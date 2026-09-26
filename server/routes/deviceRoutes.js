import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { requireAuth } from '../middlewares/auth.js';
import {
  updateDeviceConfig,
  pingDevice,
  injectDeviceFault,
  getDeviceAuditTrail
} from '../controllers/deviceController.js';

const router = Router();

router.post('/config', requireAuth([ROLES.ADMIN]), updateDeviceConfig);
router.get('/ping', pingDevice);
router.post('/ping', pingDevice);
router.post('/fault', requireAuth([ROLES.ADMIN]), injectDeviceFault);
router.get('/audit', getDeviceAuditTrail);

export default router;
