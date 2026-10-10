/** Encode untrusted values safely for spreadsheet-compatible CSV export. */
export function encodeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const spreadsheetSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
}

export function buildIncidentCsv(incidents, provenance = 'SIMULATED', snapshot = null) {
  const headers = ['ID', 'Waktu', 'Lokasi', 'Judul', 'Kategori', 'Severity', 'Status', 'Unit simulasi', 'Provenance'];
  if (snapshot) headers.push('Snapshot ID', 'Waktu snapshot');
  const rows = Array.isArray(incidents) ? incidents : [];
  const lines = [headers.map(encodeCsvCell).join(',')];
  for (const incident of rows) {
    lines.push([
      incident?.id,
      incident?.reportedAt || incident?.createdAt,
      incident?.location,
      incident?.title,
      incident?.category,
      incident?.severity || incident?.priority,
      incident?.status,
      incident?.assignedUnit,
      provenance,
      ...(snapshot ? [snapshot.id, snapshot.timestamp] : [])
    ].map(encodeCsvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
