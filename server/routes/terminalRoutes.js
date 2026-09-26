import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { requireAuth } from '../middlewares/auth.js';
import { executeTerminalCommand } from '../controllers/terminalController.js';

const router = Router();

router.post('/terminal/execute', requireAuth([ROLES.ADMIN]), executeTerminalCommand);

export default router;
