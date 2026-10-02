import { Router } from 'express';
import { login, logout, getCurrentUser } from '../controllers/authController.js';
import { authRateLimiter, authSessionRateLimiter } from '../middlewares/rateLimiter.js';
import { requireCapability } from '../middlewares/auth.js';

const router = Router();

router.post('/login', requireCapability('auth:login'), authRateLimiter, login);
router.post('/logout', requireCapability('auth:logout'), authSessionRateLimiter, logout);
router.get('/me', requireCapability('identity:read'), getCurrentUser);

export default router;
