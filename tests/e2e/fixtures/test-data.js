/**
 * Test credentials matching DEV_USERS in server/config/constants.js
 */
export const TEST_USERS = {
  ADMIN: {
    username: 'admin',
    password: 'admin123',
    role: 'ADMIN',
    name: 'Administrator Demo'
  },
  OPERATOR: {
    username: 'operator',
    password: 'operator123',
    role: 'OPERATOR',
    name: 'Operator Demo'
  },
  VIEWER: {
    username: 'viewer',
    password: 'viewer123',
    role: 'VIEWER',
    name: 'Viewer Demo'
  }
};

export const ROUTES = [
  { path: '#dashboard', id: 'view-dashboard', label: 'Ikhtisar' },
  { path: '#map', id: 'view-map', label: 'Peta kota' },
  { path: '#incidents', id: 'view-incidents', label: 'Insiden' },
  { path: '#emergency', id: 'view-emergency', label: 'Prioritas darurat' },
  { path: '#cctv', id: 'view-cctv', label: 'CCTV' },
  { path: '#signals', id: 'view-signals', label: 'Sinyal lalu lintas' },
  { path: '#devices', id: 'view-devices', label: 'Perangkat' },
  { path: '#analytics', id: 'view-analytics', label: 'Analitik' },
  { path: '#prediction', id: 'view-prediction', label: 'Prediksi' },
  { path: '#reports', id: 'view-reports', label: 'Laporan' },
  { path: '#integration', id: 'view-integration', label: 'Integrasi' },
  { path: '#settings', id: 'view-settings', label: 'Pengaturan' }
];
