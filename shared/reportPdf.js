import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function generateReportPdf(snapshot) {
  const doc = await PDFDocument.create();
  doc.setTitle('OmniTRAF - Snapshot simulasi');
  doc.setSubject(`Snapshot ${snapshot.id}; data sintetis, bukan laporan resmi`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(.07, .13, .24), muted = rgb(.32, .39, .48), accent = rgb(.12, .38, .68);
  const clean = value => String(value ?? 'Tidak tersedia').replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
  const metric = (value, unit = '') => value == null ? 'Tidak tersedia' : `${Number(value).toLocaleString('id-ID')}${unit}`;
  let page, y;
  const newPage = () => {
    page = doc.addPage([595.28, 841.89]); y = 782;
    page.drawText('OMNITRAF | SNAPSHOT SIMULASI', { x: 42, y, size: 17, font: bold, color: navy }); y -= 26;
    page.drawText('DATA SINTETIS - BUKAN DOKUMEN RESMI', { x: 42, y, size: 10, font: bold, color: accent }); y -= 30;
  };
  const line = (text, { heading = false, size = 11 } = {}) => {
    const words = clean(text).split(/\s+/); let row = '';
    const usedFont = heading ? bold : font;
    const draw = value => {
      if (y < 65) newPage();
      page.drawText(value, { x: 42, y, size, font: usedFont, color: heading ? navy : muted }); y -= size + 8;
    };
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (usedFont.widthOfTextAtSize(next, size) > 505 && row) { draw(row); row = word; }
      else row = next;
    }
    if (row) draw(row);
  };
  newPage();
  line(`ID: ${snapshot.id}`); line(`Jenis: ${snapshot.type}`);
  line(`Waktu snapshot: ${new Date(snapshot.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`);
  line(`Sumber: ${snapshot.source} | Semua format menggunakan snapshot yang sama.`);
  y -= 12; line('RINGKASAN SNAPSHOT', { heading: true, size: 13 });
  const m = snapshot.metrics;
  line(`Volume pada penghitung simulator: ${metric(m.volume, ' kendaraan')}`);
  line(`Rata-rata waktu tunggu: ${metric(m.waitTime, ' detik')}`);
  line(`Estimasi reduksi emisi simulator: ${metric(m.co2Saved, ' kg CO2')}`);
  line(`Estimasi BBM dihemat: ${metric(m.fuelSaved, ' liter')}`);
  line(`Insiden selesai dalam snapshot: ${m.incidents}`);
  y -= 12; line('SIMPANG DALAM MODEL', { heading: true, size: 13 });
  if (!snapshot.intersections.length) line('Belum ada simpang pada snapshot ini.');
  snapshot.intersections.forEach(item => {
    // Keep a title with its two detail lines, including wrapped long names.
    const nameHeight = Math.ceil(bold.widthOfTextAtSize(clean(item.name), 11) / 505) * 19;
    if (y - nameHeight - 41 < 65) newPage();
    line(item.name, { heading: true });
    line(`Status: ${item.status} | Mode: ${item.controlMode}`, { size: 10 });
    line(`Volume: ${metric(item.volume)} | Kecepatan: ${metric(item.speed, ' km/jam')} | Tunggu: ${metric(item.waitTime, ' detik')}`, { size: 10 }); y -= 5;
  });
  if (y < 140) newPage();
  y -= 8; line('BATAS DATA', { heading: true });
  line('Snapshot sesi ini bukan histori harian/mingguan terverifikasi. Nilai kosong berarti belum tersedia; angka nol dipertahankan. Tidak ada APILL, CCTV, atau layanan darurat fisik yang dikendalikan.', { size: 10 });
  doc.getPages().forEach((p, index, pages) => {
    p.drawText(clean(`${snapshot.id} | ${index + 1}/${pages.length}`), { x: 42, y: 28, size: 8, font, color: muted });
  });
  return doc.save();
}
