import { Router } from 'express';
import { reportRateLimiter } from '../middlewares/rateLimiter.js';
import { requireCapability } from '../middlewares/auth.js';
import {
  downloadPdfReport,
  getForecast,
  getForecastTestCases
} from '../controllers/reportController.js';

const router = Router();

router.get('/reports/download', requireCapability('reports:read'), reportRateLimiter, downloadPdfReport);
router.get('/prediction/v1/forecast', requireCapability('forecast:read'), getForecast);
router.get('/prediction/v1/test-cases', requireCapability('diagnostics:read'), getForecastTestCases);

export default router;
