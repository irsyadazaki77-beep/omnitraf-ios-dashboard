# OmniTRAF Surabaya — Security Architecture & Production Hardening Policy

Dokumen ini mendefinisikan postur keamanan, arsitektur otentikasi/otorisasi, batas kepercayaan (*trust boundaries*), dan tata kelola kredensial untuk **OmniTRAF SITS Command Center Surabaya** (Fase 4 Hardening).

---

## 1. Arsitektur Otentikasi & Batas Kepercayaan (Defense in Depth)

OmniTRAF membedakan secara tegas antara identitas pengguna (**Authentication**) dan kapabilitas tindakan (**Authorization**).

```text
User Request (REST / Socket.io)
       │
       ▼
[1. Network Trust Boundary]
   • Explicit CORS Whitelist (Wildcard '*' Ditolak di Production)
   • Strict CSP Directives (no unsafe eval/scripts)
   • Tiered per-process Rate Limiting (login max 20 req/min; commands are limited across REST and Socket.IO; trusted proxy IPs must be explicit)
   • Path Traversal Normalizer (Decoded & Double-Encoded Check)
       │
       ▼
[2. Authentication Layer]
   • Bearer JWT Header ATAU HttpOnly SameSite=Lax Session Cookie
   • Strict Signature Verification (HS256 Canonical Only)
   • Strict Issuer & Audience Check ('omnitraf-sits-surabaya' / 'omnitraf-api')
   • Zero Clock Tolerance Expiration Check
   • Production Fail-Closed: Missing JWT Secret = Immediate Startup Abort
       │
       ▼
[3. Session & Identity Lifecycle]
   • Principal Derivation strictly from verified JWT claims
   • Client-forged body actor properties are ignored
   • Logout clears the browser's HttpOnly session cookie; separately copied JWTs remain valid until expiry
       │
       ▼
[4. Server-Side RBAC & Capability Matrix]
   • Role Hierarchy: VIEWER → OPERATOR → ADMIN
   • Granular Capability Check before execution
   • UI state / button visibility is NEVER a security boundary
       │
       ▼
[5. Input Validation & Mass-Assignment Defense]
   • Canonical Contract Validation (`contracts.js`)
   • Whitelisted payload properties; unexpected / forged properties stripped
   • Sanitization of control characters & newlines (Log Injection Defense)
       │
       ▼
[6. Authoritative Command Execution & Idempotency]
   • Execution Gateway (`commandExecutor.js`)
   • In-Flight Locking + Monotonic Replay Protection
       │
       ▼
[7. Authoritative Audit Trail]
   • Secure audit log (Who, What, Where, When, Result, CorrelationId)
   • Zero logging of passwords, secrets, or raw JWTs
```

---

## 2. Role-Based Access Control (RBAC) & Capabilities Matrix

Sistem menerapkan 3 peran utama dengan kapabilitas berikut:

| Kapabilitas / Action | Deskripsi Tindakan | Role Minimal | Saluran Akses |
| :--- | :--- | :--- | :--- |
| `health:liveness` | Pemeriksaan kesehatan layanan dasar | `PUBLIC` | `GET /healthz` |
| `auth:login` | Masuk ke sistem & penertiban token | `PUBLIC` | `POST /api/auth/login` |
| `auth:logout` | Akhiri sesi & bersihkan cookie | `PUBLIC` | `POST /api/auth/logout` |
| `traffic:read` | Streaming telemetri lalu lintas | `VIEWER`, `OPERATOR`, `ADMIN` | REST & SSE |
| `devices:read` | Pembacaan status sensor & CCTV | `VIEWER`, `OPERATOR`, `ADMIN` | REST |
| `incidents:read` | Pembacaan daftar insiden aktif | `VIEWER`, `OPERATOR`, `ADMIN` | REST |
| `emergencies:read` | Pemantauan rute darurat 112 | `VIEWER`, `OPERATOR`, `ADMIN` | REST |
| `identity:read` | Profil autentikasi pengguna saat ini | `VIEWER`, `OPERATOR`, `ADMIN` | `GET /api/auth/me` |
| `signal:override` | Intervensi manual durasi lampu sinyal | `OPERATOR`, `ADMIN` | REST & Socket.io |
| `green-split:update` | Penyesuaian rasio waktu hijau (split) | `OPERATOR`, `ADMIN` | REST & Socket.io |
| `emergency:activate` | Pengaktifan prioritas darurat (Ambulans/PMK) | `OPERATOR`, `ADMIN` | REST & Socket.io |
| `emergency:cancel` | Pembatalan prioritas darurat | `OPERATOR`, `ADMIN` | REST & Socket.io |
| `incident:create` | Pendaftaran laporan insiden baru | `OPERATOR`, `ADMIN` | REST |
| `incident:update-status` | Pembaruan status penanganan insiden | `OPERATOR`, `ADMIN` | REST |
| `incident:resolve` | Penyelesaian insiden lalu lintas | `OPERATOR`, `ADMIN` | REST |
| `device:ping` | Uji latensi edge node sensor | `OPERATOR`, `ADMIN` | REST & Socket.io |
| `audit:read` | Pembacaan riwayat log audit otoritatif | `OPERATOR`, `ADMIN` | REST |
| `diagnostics:read` | Inspeksi telemetri dan kesiapan sistem | `OPERATOR`, `ADMIN` | REST (`/ready`, `/diagnostics`) |
| `green-wave:toggle` | Aktivasi koridor gelombang hijau | `ADMIN` | REST & Socket.io |
| `device:config` | Konfigurasi resolusi & FPS sensor | `ADMIN` | REST & Socket.io |
| `device:fault` | Injeksi gangguan teknis perangkat edge | `ADMIN` | REST & Socket.io |
| `chaos:toggle` | Pengendalian mode chaos sistem | `ADMIN` | REST & Socket.io |
| `chaos:fault-inject` | Injeksi kegagalan terukur | `ADMIN` | REST |
| `chaos:fault-clear` | Pemulihan gangguan sistem terinjeksi | `ADMIN` | REST |
| `terminal:execute` | Eksekusi perintah administratif gateway | `ADMIN` | REST |

---

## 3. Kebijakan Kredensial & Pemisahan Lingkungan (Environment Separation)

1. **Development (`development`)**:
   - Seed credentials pengguna (`operator`, `admin`, `viewer`) tersedia untuk kenyamanan pengujian lokal.
   - Fitur `DEV_AUTO_LOGIN` diaktifkan secara opsional via konfigurasi `.env`.
   - Fallback secret development diperbolehkan hanya untuk kemudahan developer lokal.

2. **Testing (`test`)**:
   - Berjalan pada database terisolasi (`sqlite:memory` atau database test terpisah).
   - Pengujian terisolasi dengan bypass query-token hanya jika `ALLOW_TEST_QUERY_TOKEN_AUTH=true`.

3. **Production (`production`)**:
   - **FAIL-CLOSED:** Jika `process.env.JWT_SECRET` kosong, bernilai default dev, atau panjangnya kurang dari 32 karakter, server **segera membatalkan proses startup (`process.exit(1)`)**.
   - **NO AUTO LOGIN:** `DEV_AUTO_LOGIN` dipaksa bernilai `false`.
   - **NO DEFAULT CREDENTIALS:** Pengguna default dev (`DEV_USERS`) tidak dimuat di mode production; akun administratif wajib diinjeksi melalui environment variable `ADMIN_USERNAME` dan `ADMIN_PASSWORD_HASH` (Bcrypt terenkripsi).
- **NO WILDCARD CORS:** `ALLOWED_ORIGINS` wajib terdefinisi secara eksplisit dan tidak boleh berisi `*`.
- Rate limiter berjalan per proses. Untuk beberapa instance, pasang limit yang sama pada gateway/reverse proxy atau gunakan shared rate-limit store; `TRUST_PROXY=true` saja tidak membuat `X-Forwarded-For` tepercaya. Daftarkan IP peer reverse proxy tepat di `TRUSTED_PROXY_IPS`.
- Semua perintah melalui REST maupun Socket.IO juga dibatasi 60 per operator per 10 detik di command gateway. Batas ini adalah lapisan per proses tambahan, bukan pengganti limiter bersama pada deployment multi-instance.

---

## 4. Keamanan JWT & Token Storage

- **Algoritma:** Terkunci secara kanonikal ke `HS256` (`ALLOWED_JWT_ALGORITHMS = ['HS256']`). Permintaan dengan header algoritma `none` atau algoritma lain ditolak seketika.
- **Penyimpanan:**
  - REST & Socket.io mendukung autentikasi ganda: Header `Authorization: Bearer <token>` dan cookie terenkripsi `omnitraf_session` berflag `HttpOnly; SameSite=Lax; Path=/; Secure`.
  - Pada saat pengguna melakukan logout (`POST /api/auth/logout`), cookie `omnitraf_session` dihapus dan state lokal dibersihkan. JWT self-contained yang telah disalin di luar alur browser tetap valid sampai kedaluwarsa; flow login saat ini tidak mengekspos token ke JavaScript.
- **Validasi Klaim:** Issuer (`omnitraf-sits-surabaya`), Audience (`omnitraf-api`), Subject (`user.id`), serta timestamp kadaluarsa divalidasi ketat dengan toleransi waktu 0 detik.

---

## 5. Pertahanan Terhadap Kerentanan Umum (OWASP Top 10)

1. **Cross-Site Scripting (XSS):**
   - Render data dinamis yang telah ditinjau memakai `textContent` atau enkoding `escapeHtml()` pada template HTML; kebijakan CSP juga menolak skrip inline dan event handler inline. Sebagian template lama masih memakai style inline, sehingga `style-src 'unsafe-inline'` tetap dibutuhkan dan sink HTML harus terus diaudit.
2. **Log Injection & CRLF Injection:**
   - Parameter input tekstual yang dapat dikontrol oleh pengguna disanitasi dari karakter kontrol ASCII (`\x00-\x1F\x7F`) serta pemisah baris (`\r`, `\n`).
3. **Path Traversal & Static Exposure:**
   - Normalisasi jalur URL menangani *URL-decoding* dan *double-decoding* (`%252e%252e%252f`).
   - Direktori sensitif (`.env`, `.git`, `.sqlite`, `/server/`, `/data/`, `/test/`, `package.json`) diblokir secara eksplisit dengan HTTP 403 Forbidden.
4. **Mass Assignment:**
   - Seluruh payload mutasi dipetakan secara selektif (*whitelisted attributes*) pada level controller dan divalidasi secara kanonikal oleh skema kontrak (`contracts.js`).
5. **Rate Limiting & Anti Brute Force:**
   - Endpoint autentikasi diproteksi dengan kuota ketat (maksimal 20 percobaan per menit).
   - Rate limiter global membatasi permintaan HTTP secara proporsional.

---

## 6. Prosedur Pelaporan Kerentanan Keamanan

Jika Anda menemukan potensi kerentanan keamanan pada sistem OmniTRAF SITS Surabaya:
- **JANGAN** membuat isu terbuka di publik GitHub Issues.
- Laporkan secara langsung melalui kanal pengamanan informasi Dinas Perhubungan Kota Surabaya atau kontak administrator: `security@sits.surabaya.go.id`.
- Sertakan langkah-langkah reproduksi (PoC), dampak teknis, dan lingkungan yang terpengaruh. Tim rekayasa keamanan akan memvalidasi dan menerbitkan patch perbaikan dalam batas waktu 24-48 jam.
