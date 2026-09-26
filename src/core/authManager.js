/**
 * OmniTRAF Surabaya - Authentication & Session Manager (Client-Side)
 * Mengelola penyimpanan JWT token, profil user yang sedang aktif,
 * otentikasi REST API / Socket.io, dan evaluasi izin berbasis Role (RBAC).
 */

const AUTH_STORAGE_KEY = 'omnitraf_auth_token';
const USER_STORAGE_KEY = 'omnitraf_auth_user';

class AuthManager {
  constructor() {
    this.token = null;
    this.user = null;
    this._listeners = new Set();
    this._loadSession();
  }

  _loadSession() {
    try {
      if (typeof window !== 'undefined') {
        const storedToken = localStorage.getItem(AUTH_STORAGE_KEY);
        const storedUser = localStorage.getItem(USER_STORAGE_KEY);

        if (storedToken && storedUser) {
          this.token = storedToken;
          this.user = JSON.parse(storedUser);
        }
      }
    } catch (e) {
      console.warn('[AuthManager] Gagal memuat session dari storage:', e);
    }
  }

  /**
   * Mengambil token autentikasi saat ini
   * @returns {string|null}
   */
  getToken() {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      return localStorage.getItem(AUTH_STORAGE_KEY);
    }
    return null;
  }

  /**
   * Mengambil profil user saat ini
   * @returns {Object|null}
   */
  getUser() {
    return this.user;
  }

  /**
   * Mengecek apakah user saat ini memiliki salah satu dari peran yang ditentukan
   * @param {string|string[]} roles
   * @returns {boolean}
   */
  hasRole(roles) {
    if (!this.user || !this.user.role) return false;
    const allowed = Array.isArray(roles) ? roles : [roles];
    return allowed.includes(this.user.role);
  }

  /**
   * Login ke backend menggunakan username & password
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Object>}
   */
  async login(username, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || data?.message || 'Login gagal.');
      }

      this.token = data.token;
      this.user = data.user;

      if (typeof window !== 'undefined') {
        localStorage.setItem(AUTH_STORAGE_KEY, data.token);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
      }

      this._notifyListeners();
      return data;
    } catch (err) {
      console.error('[AuthManager] Login error:', err);
      throw err;
    }
  }

  /**
   * Logout dan bersihkan session
   */
  logout() {
    this.token = null;
    this.user = null;

    if (typeof window !== 'undefined') {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
    }

    this._notifyListeners();
  }

  /**
   * Subscribe ke perubahan state otentikasi
   * @param {Function} callback
   * @returns {() => void}
   */
  onAuthChange(callback) {
    if (typeof callback !== 'function') return () => {};
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notifyListeners() {
    this._listeners.forEach(cb => {
      try {
        cb(this.user, this.token);
      } catch (e) {
        console.error('[AuthManager] Listener error:', e);
      }
    });
  }

  /**
   * Inisialisasi default dev session jika belum ada token
   */
  async ensureActiveSession() {
    if (this.getToken()) return this.getToken();

    try {
      // Default auto-login sebagai OPERATOR untuk pengalaman dev terintegrasi langsung
      const result = await this.login('operator', 'operator123');
      return result.token;
    } catch (e) {
      console.warn('[AuthManager] Auto-login fallback notice:', e.message);
      return null;
    }
  }
}

export const authManager = new AuthManager();
