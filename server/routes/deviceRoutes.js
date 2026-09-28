import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { requireAuth } from '../middlewares/auth.js';
import { mutationRateLimiter } from '../middlewares/rateLimiter.js';
import {
  updateDeviceConfig,
  pingDevice,
  injectDeviceFault,
  getDeviceAuditTrail
} from '../controllers/deviceController.js';

const router = Router();

router.post('/config', requireAuth([ROLES.ADMIN]), mutationRateLimiter, updateDeviceConfig);
router.get('/ping', pingDevice);
router.post('/ping', pingDevice);
router.post('/fault', requireAuth([ROLES.ADMIN]), mutationRateLimiter, injectDeviceFault);
router.get('/audit', getDeviceAuditTrail);

export default router;

