import bcrypt from 'bcryptjs';
import { IS_PRODUCTION } from './env.js';

// Definisi 3 Role Utama: VIEWER, OPERATOR, ADMIN
export const ROLES = {
  VIEWER: 'VIEWER',     // Hanya read telemetry/peta
  OPERATOR: 'OPERATOR', // Bisa resolve insiden & override sinyal per simpang
  ADMIN: 'ADMIN'        // Bisa aktifkan Green Wave, ubah config sensor, toggle chaos mode, terminal
};

// Database pengguna: default development credentials hanya aktif di development/testing.
// Di environment production, pengguna harus dikonfigurasi melalui server configuration / environment variables.
const DEV_USERS = [
  {
    id: 'usr-admin-01',
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10),
    role: ROLES.ADMIN,
    name: 'Administrator SITS Surabaya',
    email: 'admin@sits.surabaya.go.id'
  },
  {
    id: 'usr-operator-01',
    username: 'operator',
    passwordHash: bcrypt.hashSync('operator123', 10),
    role: ROLES.OPERATOR,
    name: 'Zaki Putra (Operator SITS)',
    email: 'zaki.putra@sits.surabaya.go.id'
  },
  {
    id: 'usr-viewer-01',
    username: 'viewer',
    passwordHash: bcrypt.hashSync('viewer123', 10),
    role: ROLES.VIEWER,
    name: 'Publik / Dishub Viewer',
    email: 'viewer@sits.surabaya.go.id'
  }
];

export const USERS_DB = IS_PRODUCTION
  ? (process.env.ADMIN_PASSWORD_HASH ? [
      {
        id: 'usr-admin-prod',
        username: process.env.ADMIN_USERNAME || 'admin',
        passwordHash: process.env.ADMIN_PASSWORD_HASH,
        role: ROLES.ADMIN,
        name: 'Production Administrator',
        email: 'admin@sits.surabaya.go.id'
      }
    ] : [])
  : DEV_USERS;


// Rute Jalur Prioritas Darurat (Ambulans / PMK Surabaya)
export const ROUTES_DB = {
  "route-soetomo": [
    { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
    { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
    { name: "Simpang Jemursari", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-jemursari" },
    { name: "Simpang Jemursari Waypoint", lat: -7.3100, lng: 112.7335 },
    { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, isIntersection: true, id: "node-wonokromo" },
    { name: "Marmoyo / KBD", lat: -7.2920, lng: 112.7370 },
    { name: "Simpang Raya Darmo - Diponegoro", lat: -7.2810, lng: 112.7395, isIntersection: true, id: "node-darmo" },
    { name: "Jl. Urip Sumoharjo", lat: -7.2760, lng: 112.7430 },
    { name: "Jl. Ngagel - Dinoyo", lat: -7.2720, lng: 112.7480 },
    { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
  ],
  "route-yani-darmo": [
    { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
    { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
    { name: "Simpang Jemursari", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-jemursari" },
    { name: "Simpang Jemursari Waypoint", lat: -7.3100, lng: 112.7335 },
    { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, isIntersection: true, id: "node-wonokromo" },
    { name: "Marmoyo / KBD", lat: -7.2920, lng: 112.7370 },
    { name: "Simpang Raya Darmo - Diponegoro", lat: -7.2810, lng: 112.7395, isIntersection: true, id: "node-darmo" },
    { name: "Jl. Urip Sumoharjo", lat: -7.2760, lng: 112.7430 },
    { name: "Jl. Ngagel - Dinoyo", lat: -7.2720, lng: 112.7480 },
    { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
  ],
  "route-merr-soetomo": [
    { name: "MERR Kertajaya", lat: -7.2850, lng: 112.7830 },
    { name: "Simpang MERR Kertajaya", lat: -7.2710, lng: 112.7565, isIntersection: true, id: "node-merr" },
    { name: "Gubeng", lat: -7.2645, lng: 112.7635 },
    { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
  ]
};
