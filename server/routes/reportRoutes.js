import { Router } from 'express';
import {
  downloadPdfReport,
  getForecast,
  getForecastTestCases
} from '../controllers/reportController.js';

const router = Router();

router.get('/reports/download', downloadPdfReport);
router.get('/prediction/v1/forecast', getForecast);
router.get('/prediction/v1/test-cases', getForecastTestCases);

export default router;
