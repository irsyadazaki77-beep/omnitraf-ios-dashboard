/**
 * OmniTRAF Surabaya - Dynamic View & Component Template Loader
 * Memuat dan menginjeksi view partials dan modal components secara on-demand (Lazy View Mounting)
 * dengan template caching, deterministic DOM insertion, dan zero dangling reference guards.
 */

export class ViewLoader {
  constructor() {
    this.viewMap = {
      'dashboard': { file: '/src/views/dashboardView.html', id: 'view-dashboard' },
      'map': { file: '/src/views/mapView.html', id: 'view-map' },
      'cctv': { file: '/src/views/cctvView.html', id: 'view-cctv' },
      'signals': { file: '/src/views/signalsView.html', id: 'view-signals' },
      'emergency': { file: '/src/views/emergenciesView.html', id: 'view-emergency' },
      'emergencies': { file: '/src/views/emergenciesView.html', id: 'view-emergency' },
      'analytics': { file: '/src/views/analyticsView.html', id: 'view-analytics' },
      'prediction': { file: '/src/views/predictionView.html', id: 'view-prediction' },
      'incidents': { file: '/src/views/incidentsView.html', id: 'view-incidents' },
      'reports': { file: '/src/views/reportsView.html', id: 'view-reports' },
      'devices': { file: '/src/views/devicesView.html', id: 'view-devices' },
      'integration': { file: '/src/views/integrationView.html', id: 'view-integration' },
      'settings': { file: '/src/views/settingsView.html', id: 'view-settings' }
    };

    this.componentMap = {
      'marquee': { file: '/src/components/marquee.html', targetId: 'marqueeContainer' },
      'notifDrawer': { file: '/src/components/notifDrawer.html', targetId: 'drawersContainer' },
      'modals': [
        '/src/components/modals/reportModal.html',
        '/src/components/modals/engineInfoModal.html',
        '/src/components/modals/incidentDetailModal.html',
        '/src/components/modals/keyboardShortcutsModal.html',
        '/src/components/modals/staffChatPanel.html',
        '/src/components/modals/mobileTabBar.html',
        '/src/components/modals/mapContextMenu.html',
        '/src/components/modals/cctvZoomModal.html',
        '/src/components/modals/quickTourOverlay.html',
        '/src/components/modals/signalIntelModal.html',
        '/src/components/modals/aiRecommendationModal.html',
        '/src/components/modals/manualOverrideModal.html',
        '/src/components/modals/greenWaveConfirmModal.html',
        '/src/components/modals/esgMethodologyModal.html'
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
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`);
      const html = await res.text();
      this.templateCache.set(url, html);
      return html;
    } catch (err) {
      console.error(`[ViewLoader] Failed to fetch template from ${url}:`, err);
      throw err;
    }
  }

  /**
   * Mount shell components & modals sekali saat app boot
   */
  async mountShellComponents() {
    if (this.isComponentsMounted) return;
    this.isComponentsMounted = true;

    try {
      // 1. Mount Marquee
      const marqueeTarget = document.getElementById(this.componentMap.marquee.targetId) || document.body;
      const marqueeHtml = await this.fetchTemplate(this.componentMap.marquee.file);
      const marqueeWrap = document.createElement('div');
      marqueeWrap.innerHTML = marqueeHtml.trim();
      if (marqueeTarget.id === this.componentMap.marquee.targetId) {
        marqueeTarget.replaceWith(...marqueeWrap.childNodes);
      } else {
        document.body.prepend(...marqueeWrap.childNodes);
      }

      // 2. Mount Notif Drawer
      const drawersTarget = document.getElementById(this.componentMap.notifDrawer.targetId) || document.body;
      const notifHtml = await this.fetchTemplate(this.componentMap.notifDrawer.file);
      const notifWrap = document.createElement('div');
      notifWrap.innerHTML = notifHtml.trim();
      drawersTarget.append(...notifWrap.childNodes);

      // 3. Mount Modals & Floating Shell Overlays
      const modalsTarget = document.getElementById('modalsContainer') || document.body;
      for (const modalUrl of this.componentMap.modals) {
        try {
          const mHtml = await this.fetchTemplate(modalUrl);
          const mWrap = document.createElement('div');
          mWrap.innerHTML = mHtml.trim();
          modalsTarget.append(...mWrap.childNodes);
        } catch (mErr) {
          console.warn(`[ViewLoader] Skipping modal ${modalUrl}:`, mErr);
        }
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
  async mountView(viewKey) {
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
      } else {
        link.classList.remove('active');
      }
    });

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
