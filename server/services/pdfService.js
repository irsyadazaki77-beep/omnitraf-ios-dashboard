import { createReportSnapshot } from '../../shared/reportSnapshot.js';
import { generateReportPdf } from '../../shared/reportPdf.js';

export async function generateSitsPdfBuffer(state = {}) {
  return Buffer.from(await generateReportPdf(createReportSnapshot(state)));
}
