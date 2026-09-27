import { backendState } from '../services/stateManager.js';
import { generateSitsPdfBuffer } from '../services/pdfService.js';
import { getForecastSnapshot, getForecastTestSuite } from '../services/forecastService.js';
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';

export async function downloadPdfReport(req, res) {
  try {
    const currentState = backendState.getSnapshot ? (backendState.getSnapshot().state || backendState.state) : backendState.state;
    const pdfBuffer = await generateSitsPdfBuffer(currentState);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `OmniTRAF-SITS-Surabaya-Mobility-Report-${dateStamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('❌ [API Report] Gagal men-generate PDF buffer:', err);
    res.status(500).json(createApiErrorResponse(
      500,
      'REPORT_GENERATION_FAILED',
      'Gagal menghasilkan dokumen laporan PDF mobilitas SITS.',
      { details: err.message }
    ));
  }
}

export function getForecast(req, res) {
  try {
    let hour = req.query.hour !== undefined ? parseFloat(req.query.hour) : new Date().getHours();

    if (isNaN(hour)) {
      return res.status(400).json(createApiErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Parameter query hour harus berupa angka valid (0 - 23.99).',
        { hour: req.query.hour }
      ));
    }

    const wasClamped = hour < 0 || hour >= 24;
    const clampedHour = Math.max(0, Math.min(23.99, hour));

    const currentState = backendState.getSnapshot().state || {};
    const forecastSnapshot = getForecastSnapshot(clampedHour, currentState);

    const metadata = {
      requestedHour: hour,
      evaluatedHour: clampedHour,
      wasClamped,
      engineVersion: "v5.2.0-deterministic-diurnal",
      evaluatedAt: new Date().toISOString()
    };

    res.status(200).json(createApiResponse({
      type: "forecast_snapshot",
      sequence: backendState.sequence,
      data: {
        ...forecastSnapshot,
        metadata
      },
      extra: {
        status: "success",
        ...forecastSnapshot,
        metadata
      }
    }));
  } catch (err) {
    console.error('❌ [API Forecast] Error:', err);
    res.status(500).json(createApiErrorResponse(
      500,
      'FORECAST_ENGINE_ERROR',
      `Gagal menghasilkan estimasi prediksi arus lalu lintas: ${err.message}`
    ));
  }
}

export function getForecastTestCases(req, res) {
  try {
    const currentState = backendState.getSnapshot().state || {};
    const testReport = getForecastTestSuite(currentState);
    res.status(200).json(createApiResponse({
      type: "forecast_test_suite",
      sequence: backendState.sequence,
      data: testReport,
      extra: {
        status: "success",
        testReport
      }
    }));
  } catch (err) {
    console.error('❌ [API Forecast Test Suite] Error:', err);
    res.status(500).json(createApiErrorResponse(
      500,
      'TEST_SUITE_EXECUTION_ERROR',
      `Gagal mengeksekusi test suite model verifikasi: ${err.message}`
    ));
  }
}
