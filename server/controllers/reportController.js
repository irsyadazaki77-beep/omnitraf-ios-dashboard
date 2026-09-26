import { backendState } from '../services/stateManager.js';
import { generateSitsPdfBuffer } from '../services/pdfService.js';
import { getForecastSnapshot, getForecastTestSuite } from '../services/forecastService.js';

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
    res.status(500).json({
      status: "error",
      message: "Gagal menghasilkan dokumen laporan PDF mobilitas SITS.",
      error: err.message
    });
  }
}

export function getForecast(req, res) {
  try {
    const hour = parseFloat(req.query.hour ?? new Date().getHours());
    const currentState = backendState.getSnapshot().state || {};
    const forecastSnapshot = getForecastSnapshot(hour, currentState);

    res.json({
      success: true,
      ...forecastSnapshot
    });
  } catch (err) {
    console.error('❌ [API Forecast] Error:', err);
    res.status(500).json({ status: "error", success: false, message: err.message });
  }
}

export function getForecastTestCases(req, res) {
  try {
    const currentState = backendState.getSnapshot().state || {};
    const testReport = getForecastTestSuite(currentState);
    res.json({
      success: true,
      status: "success",
      testReport
    });
  } catch (err) {
    console.error('❌ [API Forecast Test Suite] Error:', err);
    res.status(500).json({ status: "error", success: false, message: err.message });
  }
}
