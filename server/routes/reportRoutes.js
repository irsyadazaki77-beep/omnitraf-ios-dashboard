import { Router } from 'express';
import { reportRateLimiter } from '../middlewares/rateLimiter.js';
import {
  downloadPdfReport,
  getForecast,
  getForecastTestCases
} from '../controllers/reportController.js';

const router = Router();

router.get('/reports/download', reportRateLimiter, downloadPdfReport);
router.get('/prediction/v1/forecast', getForecast);
router.get('/prediction/v1/test-cases', getForecastTestCases);

export default router;

