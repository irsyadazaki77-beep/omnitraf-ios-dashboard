import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.js';
import { mutationRateLimiter } from '../middlewares/rateLimiter.js';
import { executeTerminalCommand } from '../controllers/terminalController.js';

const router = Router();

router.post('/terminal/execute', requireCapability('terminal:execute'), mutationRateLimiter, executeTerminalCommand);

export default router;
