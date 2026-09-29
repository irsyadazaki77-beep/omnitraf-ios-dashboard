import { Router } from 'express';
import { login, getCurrentUser } from '../controllers/authController.js';
import { authRateLimiter } from '../middlewares/rateLimiter.js';
import { requireCapability } from '../middlewares/auth.js';

const router = Router();

router.post('/login', requireCapability('auth:login'), authRateLimiter, login);
router.get('/me', requireCapability('identity:read'), getCurrentUser);

export default router;
