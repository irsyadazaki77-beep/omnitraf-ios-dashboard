import { backendState } from '../services/stateManager.js';
import { generateSitsPdfBuffer } from '../services/pdfService.js';
import { getForecastSnapshot, getForecastTestSuite } from '../services/forecastService.js';
import { compareTrafficScenarios } from '../../src/modules/trafficModel.js';
import { createApiResponse, createApiErrorResponse, createCommandErrorResponse } from '../middlewares/errorHandler.js';
import { validateForecastQuery } from '../config/contracts.js';

export async function downloadPdfReport(req, res) {
  try {
    const currentState = backendState.getSnapshot ? (backendState.getSnapshot().state || backendState.state) : backendState.state;
    const pdfBuffer = await generateSitsPdfBuffer(currentState);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `OmniTRAF-Simulation-Report-${dateStamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('❌ [API Report] Gagal men-generate PDF buffer:', err);
    res.status(500).json(createApiErrorResponse(
      500,
      'REPORT_GENERATION_FAILED',
      'Gagal menghasilkan laporan demo simulasi OmniTRAF.',
      { details: err.message }
    ));
  }
}

export function getForecast(req, res) {
  try {
    const hour = validateForecastQuery(req.query.hour, new Date().getHours());

    const currentState = backendState.getSnapshot().state || {};
    const forecastSnapshot = getForecastSnapshot(hour, currentState);

    const metadata = {
      requestedHour: hour,
      evaluatedHour: hour,
      wasClamped: false,
      engineVersion: "v6.0.0-aggregate-flow",
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
    if (err.code === 'INVALID_COMMAND') return res.status(err.statusCode || 422).json(createCommandErrorResponse(err));
    res.status(500).json(createApiErrorResponse(
      500,
      'FORECAST_ENGINE_ERROR',
      `Gagal menghasilkan estimasi prediksi arus lalu lintas: ${err.message}`
    ));
  }
}

export function getScenarioComparison(req, res) {
  try {
    const snapshot = backendState.getSnapshot();
    const horizonMinutes = Number(req.query.horizonMinutes ?? 15);
    if (!Number.isInteger(horizonMinutes) || horizonMinutes < 1 || horizonMinutes > 120) {
      return res.status(422).json(createApiErrorResponse(422, 'INVALID_SCENARIO_HORIZON', 'horizonMinutes must be an integer from 1 to 120.'));
    }
    const requestedSeed = req.query.seed === undefined ? snapshot.simConfig?.seed ?? 42 : Number(req.query.seed);
    if (!Number.isSafeInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > 2147483647) {
      return res.status(422).json(createApiErrorResponse(422, 'INVALID_SCENARIO_SEED', 'seed must be a non-negative 32-bit integer.'));
    }
    const state = snapshot.state || {};
    const hour = req.query.hour === undefined ? Number(String(state.timestamp || '08:00').slice(0, 2)) : Number(req.query.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return res.status(422).json(createApiErrorResponse(422, 'INVALID_SCENARIO_HOUR', 'hour must be an integer from 0 to 23.'));
    }
    const comparison = compareTrafficScenarios(state, {
      hour,
      horizonMinutes,
      seed: requestedSeed
    });
    return res.status(200).json(createApiResponse({
      type: 'traffic_scenario_comparison',
      sequence: snapshot.seq,
      data: comparison,
      extra: { status: 'success', ...comparison }
    }));
  } catch (err) {
    return res.status(500).json(createApiErrorResponse(500, 'SCENARIO_COMPARISON_FAILED', `Gagal membandingkan skenario simulasi: ${err.message}`));
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
