/**
 * OmniTRAF Surabaya - Dynamic View & Component Template Loader
 * Memuat dan menginjeksi view partials dan modal components secara on-demand (Lazy View Mounting)
 * dengan template caching, deterministic DOM insertion, dan zero dangling reference guards.
 */

export class ViewLoader {
  constructor() {
    this.viewMap = {
      'dashboard': { file: '/views/dashboardView.html', id: 'view-dashboard', title: 'Ikhtisar' },
      'map': { file: '/views/mapView.html', id: 'view-map', title: 'Peta kota' },
      'city3d': { file: '/views/city3dView.html', id: 'view-city3d', title: 'Digital Twin 3D' },
      'cctv': { file: '/views/cctvView.html', id: 'view-cctv', title: 'Pemantauan CCTV' },
      'signals': { file: '/views/signalsView.html', id: 'view-signals', title: 'Sinyal lalu lintas' },
      'emergency': { file: '/views/emergenciesView.html', id: 'view-emergency', title: 'Prioritas darurat' },
      'emergencies': { file: '/views/emergenciesView.html', id: 'view-emergency', title: 'Prioritas darurat' },
      'analytics': { file: '/views/analyticsView.html', id: 'view-analytics', title: 'Analitik' },
      'prediction': { file: '/views/predictionView.html', id: 'view-prediction', title: 'Scenario Lab' },
      'incidents': { file: '/views/incidentsView.html', id: 'view-incidents', title: 'Insiden' },
      'reports': { file: '/views/reportsView.html', id: 'view-reports', title: 'Laporan' },
      'devices': { file: '/views/devicesView.html', id: 'view-devices', title: 'Perangkat' },
      'integration': { file: '/views/integrationView.html', id: 'view-integration', title: 'Integrasi' },
      'settings': { file: '/views/settingsView.html', id: 'view-settings', title: 'Pengaturan' }
    };

    this.componentMap = {
      'marquee': { file: '/components/marquee.html', targetId: 'marqueeContainer' },
      'notifDrawer': { file: '/components/notifDrawer.html', targetId: 'drawersContainer' },
      'modals': [
        '/components/modals/reportModal.html',
        '/components/modals/engineInfoModal.html',
        '/components/modals/incidentDetailModal.html',
        '/components/modals/keyboardShortcutsModal.html',
        '/components/modals/staffChatPanel.html',
        '/components/modals/mobileTabBar.html',
        '/components/modals/mapContextMenu.html',
        '/components/modals/cctvZoomModal.html',
        '/components/modals/quickTourOverlay.html',
        '/components/modals/signalIntelModal.html',
        '/components/modals/aiRecommendationModal.html',
        '/components/modals/manualOverrideModal.html',
        '/components/modals/greenWaveConfirmModal.html',
        '/components/modals/esgMethodologyModal.html'
      ]
    };

    this.templateCache = new Map();
    this.mountedViews = new Set();
    this.isComponentsMounted = false;
    this._shellMountPromise = null;
    this._viewMountPromises = new Map();
  }

  /**
   * Fetch template HTML dengan in-memory cache dan controlled retry
   * @param {string} url 
   * @param {number} [retries=2]
   * @returns {Promise<string>}
   */
  async fetchTemplate(url, retries = 2) {
    if (this.templateCache.has(url)) {
      return this.templateCache.get(url);
    }

    const executeFetch = async (attempt = 0) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`);
        return await res.text();
      } catch (err) {
        if (attempt < retries) {
          const delay = Math.min(200 * Math.pow(2, attempt), 1000);
          await new Promise(r => setTimeout(r, delay));
          return executeFetch(attempt + 1);
        }
        throw err;
      }
    };

    try {
      const pending = executeFetch();
      this.templateCache.set(url, pending);
      const html = await pending;
      this.templateCache.set(url, html);
      return html;
    } catch (err) {
      this.templateCache.delete(url);
      console.error(`[ViewLoader] Failed to fetch template from ${url}:`, err);
      throw err;
    }
  }

  async _fetchShellTemplates() {
    const modalRequests = this.componentMap.modals.map((modalUrl) =>
      this.fetchTemplate(modalUrl).catch((err) => {
        console.warn(`[ViewLoader] Skipping modal ${modalUrl}:`, err);
        return null;
      })
    );
    const [marqueeHtml, notifHtml, ...modalHtmls] = await Promise.all([
      this.fetchTemplate(this.componentMap.marquee.file),
      this.fetchTemplate(this.componentMap.notifDrawer.file),
      ...modalRequests
    ]);
    return { marqueeHtml, notifHtml, modalHtmls };
  }

  /**
   * Mount shell components & modals sekali saat app boot dengan shared loading promise
   */
  mountShellComponents() {
    if (this.isComponentsMounted) return Promise.resolve();
    if (this._shellMountPromise) return this._shellMountPromise;

    this._shellMountPromise = (async () => {
      try {
        // Fetch independent shell templates concurrently, then preserve DOM order.
        const { marqueeHtml, notifHtml, modalHtmls } = await this._fetchShellTemplates();

        // 1. Mount Marquee
        const marqueeTarget = document.getElementById(this.componentMap.marquee.targetId) || document.body;
        const marqueeWrap = document.createElement('div');
        marqueeWrap.innerHTML = marqueeHtml.trim();
        if (marqueeTarget.id === this.componentMap.marquee.targetId) {
          marqueeTarget.replaceWith(...marqueeWrap.childNodes);
        } else {
          document.body.prepend(...marqueeWrap.childNodes);
        }

        // 2. Mount Notif Drawer
        const drawersTarget = document.getElementById(this.componentMap.notifDrawer.targetId) || document.body;
        const notifWrap = document.createElement('div');
        notifWrap.innerHTML = notifHtml.trim();
        drawersTarget.append(...notifWrap.childNodes);

        // 3. Mount Modals & Floating Shell Overlays
        const modalsTarget = document.getElementById('modalsContainer') || document.body;
        for (const mHtml of modalHtmls) {
          if (!mHtml) continue;
          const mWrap = document.createElement('div');
          mWrap.innerHTML = mHtml.trim();
          modalsTarget.append(...mWrap.childNodes);
        }

        this.isComponentsMounted = true;
        console.info("✓ [ViewLoader] Shell components & modals mounted successfully.");
      } catch (err) {
        this.isComponentsMounted = false;
        console.error("[ViewLoader] Error mounting shell components:", err);
        throw err;
      } finally {
        this._shellMountPromise = null;
      }
    })();

    return this._shellMountPromise;
  }

  /**
   * Mount dan tampilkan view yang diminta (Lazy View Mounting)
   * @param {string} viewKey (misal: 'dashboard', 'map', 'cctv', dll.)
   * @returns {Promise<{ success: boolean, isFirstMount: boolean, element: HTMLElement }>}
   */
  async mountView(viewKey, { shouldActivate = () => true } = {}) {
    const cleanKey = (viewKey || 'dashboard').replace('#', '').replace('view-', '');
    const config = this.viewMap[cleanKey] || this.viewMap['dashboard'];
    const targetId = config.id;

    const container = document.getElementById('viewContainer') || document.getElementById('mainContent');
    if (!container) {
      console.error("[ViewLoader] Main view container not found in DOM!");
      return { success: false, isFirstMount: false, element: null };
    }

    let viewElement = document.getElementById(targetId);
    let isFirstMount = false;

    if (!viewElement) {
      // Lazy Fetch & Inject HTML Partial with in-flight deduplication
      isFirstMount = true;
      if (!this._viewMountPromises.has(cleanKey)) {
        const mountPromise = (async () => {
          try {
            const html = await this.fetchTemplate(config.file);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html.trim();
            const node = tempDiv.firstElementChild;
            if (node) {
              // A lazily-mounted pane must never inherit an active state from its
              // template while its request is racing a newer navigation.
              node.classList.remove('active');
              node.hidden = true;
              node.inert = true;
              node.setAttribute('aria-hidden', 'true');
              container.appendChild(node);
              this.mountedViews.add(cleanKey);
              return node;
            }
            return null;
          } finally {
            this._viewMountPromises.delete(cleanKey);
          }
        })();
        this._viewMountPromises.set(cleanKey, mountPromise);
      }

      try {
        viewElement = await this._viewMountPromises.get(cleanKey);
        if (!viewElement) {
          viewElement = document.getElementById(targetId);
        }
      } catch (err) {
        console.error(`[ViewLoader] Failed to mount view "${cleanKey}":`, err);
        return { success: false, isFirstMount: false, element: null };
      }
    }

    if (!shouldActivate()) return { success: true, isFirstMount, element: viewElement };

    // Keep visibility in the DOM contract; CSS owns the display mode for each
    // active pane (Dashboard uses Grid, other workspaces may use Flex/Grid).
    const allPanes = document.querySelectorAll('.view-pane');
    allPanes.forEach(pane => {
      const isActive = pane.id === targetId;
      pane.classList.toggle('active', isActive);
      pane.hidden = !isActive;
      pane.inert = !isActive;
      pane.setAttribute('aria-hidden', String(!isActive));
    });

    // Update navigation active states
    document.querySelectorAll('[data-view]').forEach(link => {
      const v = link.dataset.view?.replace('view-', '');
      if (v === cleanKey || (cleanKey === 'emergencies' && v === 'emergency')) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });

    document.title = `OmniTRAF — ${config.title || 'Dashboard'}`;

    return {
      success: true,
      isFirstMount,
      element: viewElement
    };
  }

  isViewMounted(viewKey) {
    const cleanKey = (viewKey || '').replace('#', '').replace('view-', '');
    const config = this.viewMap[cleanKey];
    if (!config) return false;
    return !!document.getElementById(config.id);
  }
}

export const viewLoader = new ViewLoader();
