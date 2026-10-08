/**
 * OmniTRAF Surabaya - Progressive Web App (PWA) & Offline Controller
 * Menangani instalasi in-app PWA prompt, registrasi Service Worker,
 * deteksi status offline/online jaringan, dan banner peringatan non-intrusif.
 */

import { soundManager } from '../core/soundManager.js';
import { stateStore } from '../core/stateStore.js';

export class PwaController {
  constructor() {
    this.deferredPrompt = null;
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._registerServiceWorker();
    this._bindInstallPrompt();
    this._bindNetworkStatusBanner();
  }

  _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            console.info('📦 [PWA] Service Worker terdaftar dengan scope:', reg.scope);
            this._watchForUpdates(reg);
          })
          .catch((err) => {
            console.warn('⚠️ [PWA] Gagal meregistrasi Service Worker:', err);
          });
      });
    }
  }

  _watchForUpdates(registration) {
    const announce = () => {
      if (registration.waiting && navigator.serviceWorker.controller) this._showUpdateNotice(registration.waiting);
    };
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') announce();
      });
    });
    announce();
  }

  _showUpdateNotice(worker) {
    if (document.getElementById('pwaUpdateNotice')) return;
    const notice = document.createElement('div');
    notice.id = 'pwaUpdateNotice';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;z-index:10000;right:16px;bottom:16px;display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface,#111827);color:var(--text,#fff);box-shadow:0 8px 24px rgba(0,0,0,.3);';
    const message = document.createElement('span');
    message.textContent = 'A new version is available.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Update';
    button.addEventListener('click', () => {
      button.disabled = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      worker.postMessage({ type: 'SKIP_WAITING' });
    }, { once: true });
    notice.append(message, button);
    document.body.append(notice);
  }

  _bindInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this._renderInstallButton();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      console.info("🎉 [PWA] OmniTRAF sukses diinstal ke Home Screen!");
      const installBtn = document.getElementById("pwaInstallBtn");
      if (installBtn) installBtn.remove();
      if (typeof window.showToast === "function") {
        window.showToast("🎉 OmniTRAF terpasang di perangkat Anda.");
      }
    });
  }

  _renderInstallButton() {
    if (document.getElementById("pwaInstallBtn")) return;

    const topBarActions = document.querySelector(".topbar-actions") || 
                          document.querySelector(".topbar-action-buttons");
    if (!topBarActions) return;

    const btn = document.createElement("button");
    btn.id = "pwaInstallBtn";
    btn.className = "btn btn-primary compact";
    btn.style.cssText = "display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; border-radius: 9999px; padding: 6px 12px; margin-right: 8px;";
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Install App</span>
    `;

    btn.addEventListener("click", async () => {
      if (!this.deferredPrompt) return;
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      if (outcome === "accepted") {
        btn.remove();
      }
      this.deferredPrompt = null;
    });

    topBarActions.insertBefore(btn, topBarActions.firstChild);
  }

  _bindNetworkStatusBanner() {
    const banner = document.getElementById("offlineNotificationBanner");
    const closeBtn = document.getElementById("btnDismissOfflineBanner");

    const updateOnlineStatus = () => {
      const isOnline = navigator.onLine;

      if (!isOnline) {
        stateStore.setState({ sseConnected: false });
        stateStore.publish("socket:status", "fallback");
        if (typeof window.showToast === 'function') {
          window.showToast("Jaringan terputus. Aplikasi beralih ke shell lokal; data tetap simulasi.", "warning");
        }
      }

    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    if (closeBtn && banner) {
      closeBtn.addEventListener('click', () => {
        banner.classList.add("is-hidden");
        soundManager.play('click');
      });
    }

    if (!navigator.onLine) updateOnlineStatus();
  }
}

export const pwaController = new PwaController();
