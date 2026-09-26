import { Router } from 'express';
import { login, getCurrentUser } from '../controllers/authController.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.post('/login', login);
router.get('/me', requireAuth(), getCurrentUser);

export default router;
