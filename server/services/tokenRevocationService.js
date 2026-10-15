/**
 * OmniTRAF - Server-Side Token & Session Revocation Service
 * Menyediakan mekanisme pencabutan token (session revocation) yang:
 * - Menyimpan revoked JWT identifiers (JTI / token signatures) dengan TTL (in-memory & Redis jika klaster)
 * - Mencegah token yang sudah logout digunakan kembali di REST API maupun Socket.IO
 * - Mendukung pencabutan per-user (revoking all sessions of a specific user id)
 */

import { redisManager } from '../infrastructure/redis/redisManager.js';
import { OMNITRAF_RUNTIME_MODE } from '../config/env.js';

class TokenRevocationService {
  constructor() {
    // In-memory set of revoked tokens/identifiers: tokenIdentifier -> expiryTimestampMs
    this._revokedTokens = new Map();
    // In-memory map of user session cutoff timestamps: userId -> cutoffTimestampMs
    this._userRevocationCutoffs = new Map();
    this._cleanupTimer = null;
    this._startCleanup();
  }

  _startCleanup() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    this._cleanupTimer = setInterval(() => {
      this._pruneExpired();
    }, 60000);
    this._cleanupTimer.unref?.();
  }

  _pruneExpired() {
    const now = Date.now();
    for (const [key, exp] of this._revokedTokens.entries()) {
      if (exp <= now) {
        this._revokedTokens.delete(key);
      }
    }
    // Cutoffs older than 48 hours can be pruned (max JWT duration is 24h)
    const cutoffRetention = now - (48 * 60 * 60 * 1000);
    for (const [userId, timestamp] of this._userRevocationCutoffs.entries()) {
      if (timestamp < cutoffRetention) {
        this._userRevocationCutoffs.delete(userId);
      }
    }
  }

  /**
   * Mendapatkan identitas unik dari token string atau payload
   * Gunakan signature bagian terakhir JWT atau JTI jika ada
   */
  _getTokenIdentifier(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length === 3) {
      // Menggunakan signature token sebagai identifier unik yang ringkas
      return parts[2];
    }
    return token;
  }

  /**
   * Revoke spesifik token hingga waktu kedaluwarsa token tersebut
   * @param {string} token
   * @param {number} [expirySeconds=86400] Default 24 jam
   */
  async revokeToken(token, expirySeconds = 86400) {
    const id = this._getTokenIdentifier(token);
    if (!id) return false;

    const expiryMs = Date.now() + (expirySeconds * 1000);
    this._revokedTokens.set(id, expiryMs);

    // Jika berjalan dalam mode klaster atau Redis tersedia, simpan juga di Redis
    if (OMNITRAF_RUNTIME_MODE === 'cluster' && !redisManager?.isConnected()) {
      throw new Error('Token revocation store unavailable in cluster mode.');
    }
    if (redisManager && redisManager.isConnected()) {
      try {
        await redisManager.set(`revoked_token:${id}`, '1', 'EX', expirySeconds);
      } catch (err) {
        console.warn('[TokenRevocation] Gagal mencatat revocations ke Redis:', err.message);
        if (OMNITRAF_RUNTIME_MODE === 'cluster') throw err;
      }
    }

    return true;
  }

  /**
   * Revoke seluruh sesi dari user tertentu (misalnya saat password diganti atau role berubah)
   * @param {string} userId
   */
  async revokeUserSessions(userId) {
    if (!userId) return false;
    const now = Date.now();
    this._userRevocationCutoffs.set(String(userId), now);

    if (OMNITRAF_RUNTIME_MODE === 'cluster' && !redisManager?.isConnected()) {
      throw new Error('User session revocation store unavailable in cluster mode.');
    }
    if (redisManager && redisManager.isConnected()) {
      try {
        // Simpan cutoff timestamp di Redis selama 48 jam
        await redisManager.set(`user_revoked_cutoff:${userId}`, String(now), 'EX', 172800);
      } catch (err) {
        console.warn('[TokenRevocation] Gagal mencatat user revocation cutoff ke Redis:', err.message);
        if (OMNITRAF_RUNTIME_MODE === 'cluster') throw err;
      }
    }

    return true;
  }

  /**
   * Mengecek apakah token telah dicabut
   * @param {string} token
   * @param {Object} [principal] Informasi claims terdekripsi { id, iat }
   * @returns {Promise<boolean>} True jika token DICABUT (revoked)
   */
  async isTokenRevoked(token, principal = null) {
    const id = this._getTokenIdentifier(token);
    if (!id) return true;

    // 1. Cek in-memory revoked tokens
    const expiry = this._revokedTokens.get(id);
    if (expiry) {
      if (expiry > Date.now()) {
        return true;
      }
      this._revokedTokens.delete(id);
    }

    // 2. Cek cutoff revocations per-user
    if (principal && principal.id) {
      const cutoff = this._userRevocationCutoffs.get(String(principal.id));
      if (cutoff && principal.iat) {
        // principal.iat dalam detik; cutoff dalam ms
        const tokenIssuedAtMs = principal.iat * 1000;
        if (tokenIssuedAtMs < cutoff) {
          return true;
        }
      }
    }

    // 3. Cek Redis jika klaster
    if (OMNITRAF_RUNTIME_MODE === 'cluster' && !redisManager?.isConnected()) {
      throw new Error('Token revocation store unavailable in cluster mode.');
    }
    if (redisManager && redisManager.isConnected()) {
      try {
        const inRedis = await redisManager.get(`revoked_token:${id}`);
        if (inRedis) return true;

        if (principal && principal.id) {
          const redisCutoffStr = await redisManager.get(`user_revoked_cutoff:${principal.id}`);
          if (redisCutoffStr && principal.iat) {
            const redisCutoff = Number(redisCutoffStr);
            if ((principal.iat * 1000) < redisCutoff) {
              return true;
            }
          }
        }
      } catch (err) {
        console.warn('[TokenRevocation] Error querying Redis revocation status:', err.message);
        if (OMNITRAF_RUNTIME_MODE === 'cluster') throw err;
      }
    }

    return false;
  }

  /**
   * Reset in-memory maps (berguna untuk testing)
   */
  clear() {
    this._revokedTokens.clear();
    this._userRevocationCutoffs.clear();
  }
}

export const tokenRevocationService = new TokenRevocationService();
