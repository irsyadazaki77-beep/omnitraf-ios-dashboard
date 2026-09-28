import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { requireAuth } from '../middlewares/auth.js';
import { mutationRateLimiter } from '../middlewares/rateLimiter.js';
import { executeTerminalCommand } from '../controllers/terminalController.js';

const router = Router();

router.post('/terminal/execute', requireAuth([ROLES.ADMIN]), mutationRateLimiter, executeTerminalCommand);

export default router;

