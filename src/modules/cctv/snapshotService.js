/**
 * Save a browser-generated CCTV simulation frame as a demo image.
 * This does not identify violations or create official ETLE evidence.
 */
export class SnapshotService {
  static captureDemoSnapshot(renderer, camId = 'cctvCanvas1') {
    if (!renderer?.canvas) {
      window.showToast?.('Visualisasi kamera simulasi belum siap.', 'warning');
      return null;
    }

    const pngDataUrl = renderer.captureSnapshot();
    if (!pngDataUrl) {
      window.showToast?.('Cuplikan demo tidak dapat dibuat.', 'warning');
      return null;
    }

    const capturedAt = new Date();
    const captureId = `SIM-${capturedAt.getTime()}`;
    const safeCamId = String(camId).replace(/[^a-z0-9_-]/gi, '-');
    const filename = `OmniTRAF-Simulasi-${safeCamId}-${capturedAt.toISOString().replace(/[:.]/g, '-')}.png`;
    const download = document.createElement('a');
    download.href = pngDataUrl;
    download.download = filename;
    download.hidden = true;
    document.body.appendChild(download);
    download.click();
    download.remove();

    window.showToast?.('Cuplikan visual simulasi disimpan. File ini bukan bukti ETLE.');
    return {
      id: captureId,
      cameraId: safeCamId,
      capturedAt: capturedAt.toISOString(),
      filename,
      provenance: 'SIMULATED'
    };
  }
}
