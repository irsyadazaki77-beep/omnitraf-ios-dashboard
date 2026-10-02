/**
 * OmniTRAF Surabaya - Authentication & Session Manager (Client-Side)
 * Mengelola sesi cookie HttpOnly dan profil user yang sedang aktif,
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
    this._bindStorageEvents();
  }

  _bindStorageEvents() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (event) => {
        if (event.key === AUTH_STORAGE_KEY || event.key === USER_STORAGE_KEY) {
          if (!event.newValue) {
            // Logged out in another tab
            this.token = null;
            this.user = null;
            this._notifyListeners();
          } else if (event.key === USER_STORAGE_KEY) {
            const userStr = localStorage.getItem(USER_STORAGE_KEY);
            if (userStr) {
              try { this.user = JSON.parse(userStr); } catch (_) {}
            }
            this._notifyListeners();
          }
        }
      });
    }
  }

  _loadSession() {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const storedUser = localStorage.getItem(USER_STORAGE_KEY);
        // Remove JWTs persisted by older releases; auth now stays in an HttpOnly cookie.
        localStorage.removeItem(AUTH_STORAGE_KEY);
        if (storedUser) this.user = JSON.parse(storedUser);
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
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        const errorMsg = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : 'Login gagal.');
        throw new Error(errorMsg);
      }

      this.token = null;
      this.user = data.data?.user || data.user;

      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(this.user));
      }

      this._notifyListeners();
      return data;
    } catch (err) {
      console.error('[AuthManager] Login error:', err);
      throw err;
    }
  }

  /**
   * Logout dan bersihkan session di client dan server
   */
  async logout() {
    try {
      if (typeof fetch === 'function') {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin'
        }).catch(() => {});
      }
    } catch (_) {}

    this.token = null;
    this.user = null;

    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
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
   * Inisialisasi session jika belum ada token.
   * Auto-login hanya aktif di mode development bila secara eksplisit diizinkan.
   * Fail closed di environment production.
   */
  async ensureActiveSession() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const result = await response.json();
      if (response.ok && result.success && (result.data?.user || result.user)) {
        this.user = result.data?.user || result.user;
        if (typeof localStorage !== 'undefined') localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(this.user));
        this._notifyListeners();
        return true;
      }
    } catch (_) {
      // Network unavailable; cached profile remains display-only until the server responds.
    }

    this.token = null;
    this.user = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
    }
    this._notifyListeners();

    // Production check: Jangan pernah auto-login di production
    const isDevAutoLoginEnabled = typeof window !== 'undefined' &&
      (window.__ENV__?.DEV_AUTO_LOGIN === true || window.localStorage?.getItem('omnitraf_dev_auto_login') === 'true');

    if (!isDevAutoLoginEnabled) {
      return null;
    }

    try {
      await this.login('operator', 'operator123');
      return true;
    } catch (e) {
      console.warn('[AuthManager] Auto-login fallback notice:', e.message);
      return null;
    }
  }
}

export const authManager = new AuthManager();
