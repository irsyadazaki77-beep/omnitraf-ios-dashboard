/**
 * OmniTRAF Surabaya - Dynamic View & Component Template Loader
 * Memuat dan menginjeksi view partials dan modal components secara on-demand (Lazy View Mounting)
 * dengan template caching, deterministic DOM insertion, dan zero dangling reference guards.
 */

export class ViewLoader {
  constructor() {
    this.viewMap = {
      'dashboard': { file: '/views/dashboardView.html', id: 'view-dashboard', title: 'Dashboard' },
      'map': { file: '/views/mapView.html', id: 'view-map', title: 'City Map' },
      'cctv': { file: '/views/cctvView.html', id: 'view-cctv', title: 'CCTV Monitoring' },
      'signals': { file: '/views/signalsView.html', id: 'view-signals', title: 'Traffic Signals' },
      'emergency': { file: '/views/emergenciesView.html', id: 'view-emergency', title: 'Emergency Priority' },
      'emergencies': { file: '/views/emergenciesView.html', id: 'view-emergency', title: 'Emergency Priority' },
      'analytics': { file: '/views/analyticsView.html', id: 'view-analytics', title: 'Analytics' },
      'prediction': { file: '/views/predictionView.html', id: 'view-prediction', title: 'Prediction' },
      'incidents': { file: '/views/incidentsView.html', id: 'view-incidents', title: 'Incidents' },
      'reports': { file: '/views/reportsView.html', id: 'view-reports', title: 'Reports' },
      'devices': { file: '/views/devicesView.html', id: 'view-devices', title: 'Device Management' },
      'integration': { file: '/views/integrationView.html', id: 'view-integration', title: 'Integrations' },
      'settings': { file: '/views/settingsView.html', id: 'view-settings', title: 'Settings' }
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
  }

  /**
   * Fetch template HTML dengan in-memory cache
   * @param {string} url 
   * @returns {Promise<string>}
   */
  async fetchTemplate(url) {
    if (this.templateCache.has(url)) {
      return this.templateCache.get(url);
    }
    try {
      const pending = fetch(url).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`);
        return res.text();
      });
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
   * Mount shell components & modals sekali saat app boot
   */
  async mountShellComponents() {
    if (this.isComponentsMounted) return;
    this.isComponentsMounted = true;

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

      console.info("✓ [ViewLoader] Shell components & modals mounted successfully.");
    } catch (err) {
      console.error("[ViewLoader] Error mounting shell components:", err);
    }
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
      // Lazy Fetch & Inject HTML Partial
      isFirstMount = true;
      try {
        const html = await this.fetchTemplate(config.file);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html.trim();
        const node = tempDiv.firstElementChild;
        if (node) {
          container.appendChild(node);
          viewElement = node;
          this.mountedViews.add(cleanKey);
        }
      } catch (err) {
        console.error(`[ViewLoader] Failed to mount view "${cleanKey}":`, err);
        return { success: false, isFirstMount: false, element: null };
      }
    }

    if (!shouldActivate()) return { success: true, isFirstMount, element: viewElement };

    // Toggle active classes & visibility across view panes
    const allPanes = document.querySelectorAll('.view-pane');
    allPanes.forEach(pane => {
      if (pane.id === targetId) {
        pane.classList.add('active');
        pane.style.display = 'block';
      } else {
        pane.classList.remove('active');
        pane.style.display = 'none';
      }
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
