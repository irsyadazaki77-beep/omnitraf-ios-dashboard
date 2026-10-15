import bcrypt from 'bcryptjs';
import { IS_PRODUCTION } from './env.js';

// Definisi 3 Role Utama: VIEWER, OPERATOR, ADMIN
export const ROLES = {
  VIEWER: 'VIEWER',     // Hanya read telemetry/peta
  OPERATOR: 'OPERATOR', // Bisa resolve insiden & override sinyal per simpang
  ADMIN: 'ADMIN'        // Bisa aktifkan Green Wave, ubah config sensor, toggle chaos mode, terminal
};

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$1[0-5]\$[./A-Za-z0-9]{53}$/;

function failProductionUserConfig(message) {
  console.error(`[USERS_DB] FATAL: ${message}`);
  process.exit(1);
  throw new Error(`Invalid production user configuration: ${message}`);
}

// Database pengguna: default development credentials hanya aktif di development/testing.
// Di environment production, pengguna harus dikonfigurasi melalui server configuration / environment variables.
const DEV_USERS = [
  {
    id: 'usr-admin-01',
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10),
    role: ROLES.ADMIN,
    name: 'Administrator Demo',
    email: null
  },
  {
    id: 'usr-operator-01',
    username: 'operator',
    passwordHash: bcrypt.hashSync('operator123', 10),
    role: ROLES.OPERATOR,
    name: 'Operator Demo',
    email: null
  },
  {
    id: 'usr-viewer-01',
    username: 'viewer',
    passwordHash: bcrypt.hashSync('viewer123', 10),
    role: ROLES.VIEWER,
    name: 'Viewer Demo',
    email: null
  }
];

function loadProductionUsers() {
  const users = [];
  const addUser = (user) => {
    const normalized = {
      id: String(user.id || '').trim(),
      username: String(user.username || '').trim(),
      passwordHash: String(user.passwordHash || ''),
      role: user.role,
      name: String(user.name || user.username || '').trim(),
      email: user.email ? String(user.email).trim() : null
    };
    if (!normalized.id || !normalized.username || !normalized.name || !Object.values(ROLES).includes(normalized.role)) {
      failProductionUserConfig('each configured user must have a non-empty id, username, name, and supported role.');
    }
    if (!BCRYPT_HASH_PATTERN.test(normalized.passwordHash)) {
      failProductionUserConfig(`password hash for user '${normalized.username}' must be a bcrypt hash with cost 10–15.`);
    }
    if (users.some((existing) => existing.id === normalized.id || existing.username.toLowerCase() === normalized.username.toLowerCase())) {
      failProductionUserConfig(`duplicate production user id or username '${normalized.username}'.`);
    }
    users.push(normalized);
  };

  // 1. Production Admin
  if (process.env.ADMIN_PASSWORD_HASH) {
    addUser({
      id: 'usr-admin-prod',
      username: process.env.ADMIN_USERNAME || 'admin_sits_surabaya',
      passwordHash: process.env.ADMIN_PASSWORD_HASH,
      role: ROLES.ADMIN,
      name: 'Production Administrator',
      email: null
    });
  }

  // 2. Production Operator
  if (process.env.OPERATOR_PASSWORD_HASH) {
    addUser({
      id: 'usr-operator-prod',
      username: process.env.OPERATOR_USERNAME || 'operator_sits_surabaya',
      passwordHash: process.env.OPERATOR_PASSWORD_HASH,
      role: ROLES.OPERATOR,
      name: 'Production Operator',
      email: null
    });
  }

  // 3. Production Viewer
  if (process.env.VIEWER_PASSWORD_HASH) {
    addUser({
      id: 'usr-viewer-prod',
      username: process.env.VIEWER_USERNAME || 'viewer_sits_surabaya',
      passwordHash: process.env.VIEWER_PASSWORD_HASH,
      role: ROLES.VIEWER,
      name: 'Production Viewer',
      email: null
    });
  }

  // 4. Production Structured JSON User DB (opsional untuk banyak user)
  if (process.env.PRODUCTION_USERS_JSON) {
    let parsed;
    try {
      parsed = JSON.parse(process.env.PRODUCTION_USERS_JSON);
    } catch (e) {
      failProductionUserConfig(`could not parse PRODUCTION_USERS_JSON: ${e.message}`);
    }
    if (!Array.isArray(parsed)) failProductionUserConfig('PRODUCTION_USERS_JSON must contain an array.');
    for (const user of parsed) {
      if (!user || typeof user !== 'object' || Array.isArray(user)) failProductionUserConfig('PRODUCTION_USERS_JSON contains an invalid user entry.');
      addUser(user);
    }
  }

  if (!users.some((user) => user.role === ROLES.ADMIN)) {
    failProductionUserConfig('at least one valid ADMIN account must be configured.');
  }

  return users;
}

export const USERS_DB = IS_PRODUCTION
  ? loadProductionUsers()
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
