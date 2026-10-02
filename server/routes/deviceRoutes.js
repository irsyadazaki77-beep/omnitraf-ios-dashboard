import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.js';
import { mutationRateLimiter } from '../middlewares/rateLimiter.js';
import {
  updateDeviceConfig,
  pingDevice,
  injectDeviceFault,
  getDeviceAuditTrail
} from '../controllers/deviceController.js';

const router = Router();

router.post('/config', requireCapability('device:config'), mutationRateLimiter, updateDeviceConfig);
router.get('/ping', requireCapability('device:ping'), mutationRateLimiter, pingDevice);
router.post('/ping', requireCapability('device:ping'), mutationRateLimiter, pingDevice);
router.post('/fault', requireCapability('device:fault'), mutationRateLimiter, injectDeviceFault);
router.get('/audit', requireCapability('device:audit:read'), getDeviceAuditTrail);

export default router;
