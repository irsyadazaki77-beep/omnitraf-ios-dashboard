import { Router } from 'express';
import { login, getCurrentUser } from '../controllers/authController.js';
import { requireAuth } from '../middlewares/auth.js';
import { authRateLimiter } from '../middlewares/rateLimiter.js';

const router = Router();

router.post('/login', authRateLimiter, login);
router.get('/me', requireAuth(), getCurrentUser);

export default router;

