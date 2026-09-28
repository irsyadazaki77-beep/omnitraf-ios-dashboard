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
          } else if (event.key === AUTH_STORAGE_KEY) {
            this.token = event.newValue;
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
        const storedToken = localStorage.getItem(AUTH_STORAGE_KEY);
        const storedUser = localStorage.getItem(USER_STORAGE_KEY);

        if (storedToken && storedUser) {
          if (this.isTokenExpired(storedToken)) {
            console.warn('[AuthManager] Sesi tersimpan telah kedaluwarsa. Membersihkan...');
            this.logout();
          } else {
            this.token = storedToken;
            this.user = JSON.parse(storedUser);
          }
        }
      }
    } catch (e) {
      console.warn('[AuthManager] Gagal memuat session dari storage:', e);
    }
  }

  /**
   * Mengecek apakah JWT token telah kedaluwarsa
   * @param {string} token
   * @returns {boolean}
   */
  isTokenExpired(token) {
    if (!token) return true;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      const payload = JSON.parse(jsonPayload);
      if (payload && typeof payload.exp === 'number') {
        const nowSec = Math.floor(Date.now() / 1000);
        // Berikan toleransi waktu 10 detik
        return payload.exp < (nowSec + 10);
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Mengambil token autentikasi saat ini
   * @returns {string|null}
   */
  getToken() {
    if (this.token) {
      if (this.isTokenExpired(this.token)) {
        this.logout();
        return null;
      }
      return this.token;
    }
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const storedToken = localStorage.getItem(AUTH_STORAGE_KEY);
      if (storedToken) {
        if (this.isTokenExpired(storedToken)) {
          this.logout();
          return null;
        }
        return storedToken;
      }
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
        const errorMsg = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : 'Login gagal.');
        throw new Error(errorMsg);
      }

      this.token = data.data?.token || data.token;
      this.user = data.data?.user || data.user;

      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(AUTH_STORAGE_KEY, this.token);
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
   * Logout dan bersihkan session
   */
  logout() {
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
