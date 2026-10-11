/**
 * OmniTRAF Surabaya - Navigation, SPA Router & Shell Controller
 * Mengatur perutean halaman SPA (Hash & Data-view), sinkronisasi tab navigasi mobile iOS,
 * peralihan tema (Dark/Light), jam digital real-time WIB presisi tinggi, dan penutupan drawer otomatis.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { viewLoader } from '../core/viewLoader.js';
import { authManager } from '../core/authManager.js';

const SIDEBAR_PREFERENCE_KEY = 'omnitraf.sidebar.collapsed';

export class NavigationController {
  constructor() {
    this.clockInterval = null;
    this._isInitialized = false;
    this._sidebarReturnFocus = null;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._initRouter();
    this._initSidebarCollapse();
    this._initMobileNav();
    this._initCommandPalette();
    this._initShellOverflow();
    this._initShellProfile();
    this._initNotificationCount();
    this._initThemeToggle();
    this._initDensityPreference();
    this._initClock();
    this._initDrawersAndPanels();
  }

  /**
   * 1. SPA Router (Hash & Data-View)
   */
  _initRouter() {
    const closeMobileSidebar = () => this._setSidebarOpen(false, { returnFocus: true });

    const switchView = (targetViewId) => {
      let cleanId = (targetViewId || "dashboard").replace('#', '').replace('view-', '');
      if (!cleanId || cleanId === "about-engine") return;
      if (cleanId === "emergencies") cleanId = "emergency";
      if (!viewLoader.viewMap[cleanId]) return;

      // Sync active state on navigation elements
      document.querySelectorAll("[data-view]").forEach(link => {
        const v = link.dataset.view?.replace('view-', '');
        const isActive = v === cleanId;
        if (isActive) {
          link.classList.add("active");
          link.setAttribute("aria-current", "page");
        } else {
          link.classList.remove("active");
          link.removeAttribute("aria-current");
        }
      });

      document.querySelectorAll('[data-nav-group]').forEach(group => {
        group.classList.toggle('has-active', Boolean(group.querySelector(`[data-view="${cleanId}"]`)));
      });

      const pageTitle = viewLoader.viewMap[cleanId]?.title || viewLoader.viewMap.dashboard.title;
      document.title = `OmniTRAF — ${pageTitle}`;
      const shellTitle = document.getElementById('shellPageTitle');
      if (shellTitle) shellTitle.textContent = cleanId === 'dashboard' ? 'Ikhtisar' : pageTitle;

      // Trigger stateStore update which invokes app._handleViewTransition & viewLoader.mountView
      stateStore.setState({ currentView: cleanId });

      window.scrollTo({ top: 0, behavior: 'smooth' });
      closeMobileSidebar();
    };

    window.addEventListener("hashchange", () => {
      const hash = window.location.hash.slice(1);
      if (hash && hash !== "about-engine") {
        switchView(hash);
      }
    });

    document.addEventListener("click", (e) => {
      const link = e.target?.closest?.('a[href^="#"]');
      if (!link) return;
      const href = link.getAttribute("href");
      const dataView = link.dataset.view;
      const dataAction = link.dataset.action;
      if (href === '#mainContent') {
        e.preventDefault();
        const main = document.getElementById('mainContent');
        main?.setAttribute('tabindex', '-1');
        main?.focus({ preventScroll: true });
        return;
      }

      if (dataAction === "about-engine" || href === "#about-engine") {
        e.preventDefault();
        closeMobileSidebar();
        const engineModal = document.getElementById("engineInfoModal");
        if (engineModal) {
          engineModal.style.display = "flex";
          engineModal.classList.add("show");
          soundManager.play('click');
        }
        return;
      }

      const target = dataView || (href && href.startsWith("#") ? href.slice(1) : null);

      if (target && viewLoader.viewMap[target.replace('view-', '')]) {
        e.preventDefault();
        if (window.location.hash !== `#${target}`) {
          window.location.hash = target;
        }
        switchView(target);
        soundManager.play('click');
      }
    });

    // Initial View on Load
    const initialHash = window.location.hash.slice(1) || "dashboard";
    if (initialHash !== "about-engine") {
      switchView(initialHash);
    }
  }

  _initShellOverflow() {
    const overflow = document.querySelector('.topbar-overflow');
    const summary = overflow?.querySelector(':scope > summary');
    if (!overflow || !summary) return;
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !overflow.open) return;
      overflow.open = false;
      summary.focus();
      event.stopPropagation();
    });
    document.addEventListener('click', (event) => {
      if (!overflow.open) return;
      if (!overflow.contains(event.target) || event.target.closest('.topbar-overflow-menu button')) {
        overflow.open = false;
      }
    });
  }

  _initSidebarCollapse() {
    const shell = document.querySelector('.app-shell');
    const toggle = document.getElementById('sidebarCollapseToggle');
    if (!shell || !toggle) return;

    const media = window.matchMedia('(max-width: 1200px)');
    let savedPreference = null;
    try {
      const stored = window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
      if (stored === 'true' || stored === 'false') savedPreference = stored === 'true';
    } catch (_) {}

    const apply = (collapsed) => {
      const isCollapsed = Boolean(collapsed);
      shell.classList.toggle('sidebar-collapsed', isCollapsed);
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.setAttribute('aria-label', isCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar');
      toggle.setAttribute('title', isCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar');
    };

    apply(savedPreference ?? media.matches);
    toggle.addEventListener('click', () => {
      const collapsed = !shell.classList.contains('sidebar-collapsed');
      apply(collapsed);
      savedPreference = collapsed;
      try { window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(collapsed)); } catch (_) {}
    });

    media.addEventListener?.('change', (event) => {
      if (savedPreference === null) apply(event.matches);
    });

    document.addEventListener('omnitraf:reset-ui-preferences', () => {
      savedPreference = null;
      try { window.localStorage.removeItem(SIDEBAR_PREFERENCE_KEY); } catch (_) {}
      apply(media.matches);
    });

    document.querySelectorAll('.sidebar [data-view], .sidebar [data-action], .app-sidebar [data-view], .app-sidebar [data-action]').forEach(item => {
      const label = item.querySelector('.nav-label')?.textContent.trim() || item.getAttribute('aria-label') || '';
      if (label) {
        item.setAttribute('aria-label', label);
        item.setAttribute('title', label);
      }
    });
  }

  _initCommandPalette() {
    const palette = document.getElementById('navigationPalette');
    const openButton = document.getElementById('quickNavigationButton');
    const closeButton = document.getElementById('closeNavigationPalette');
    const search = document.getElementById('navigationPaletteSearch');
    const groups = [...(palette?.querySelectorAll('[data-palette-group]') || [])];
    const emptyState = document.getElementById('navigationPaletteEmpty');
    const entityGroup = document.getElementById('paletteEntityResults');
    const entityLinks = document.getElementById('paletteEntityLinks');
    if (!palette || !search || !openButton) return;

    let activeIndex = -1;
    const visibleResults = () => [...(palette?.querySelectorAll('[role="option"]') || [])]
      .filter((result) => !result.hidden && !result.closest('[hidden]'));
    const updateActiveResult = () => {
      const results = visibleResults();
      const active = activeIndex >= 0 ? results[activeIndex] : null;
      results.forEach((result) => {
        const selected = result === active;
        result.setAttribute('aria-selected', String(selected));
        result.classList.toggle('is-keyboard-active', selected);
      });
      search.setAttribute('aria-activedescendant', active?.id || '');
      if (active) {
        const announcement = document.getElementById('navigationPaletteAnnouncement');
        if (announcement) announcement.textContent = `${active.textContent.trim()}, ${activeIndex + 1} dari ${results.length}.`;
      }
    };

    const filterDestinations = () => {
      const query = search.value.trim().toLocaleLowerCase();
      entityLinks?.replaceChildren();
      if (query && entityLinks && entityGroup) {
        const state = stateStore.getState();
        const candidates = [
          ...(state.incidents || []).map((entity) => ({ kind: 'incident', label: 'Incident', id: entity.id, name: entity.title || entity.id, detail: entity.location, route: 'incidents', query: `${entity.id} ${entity.status} ${entity.severity}` })),
          ...(state.intersections || []).map((entity) => ({ kind: 'intersection', label: 'Intersection', id: entity.id, name: entity.name || entity.id, detail: entity.location || entity.state, route: 'signals', query: `${entity.id} ${entity.state} ${entity.density}` })),
          ...(state.devices || []).map((entity) => ({ kind: 'device', label: 'Device', id: entity.deviceId, name: entity.deviceName || entity.deviceId, detail: entity.location || entity.healthLevel, route: 'devices', query: `${entity.deviceId} ${entity.healthLevel}` })),
          ...Object.keys(state.cctvVisionData || {}).map((id) => ({ kind: 'cctv', label: 'CCTV', id, name: id, detail: 'Simulation camera', route: 'cctv', query: id }))
        ];
        const matches = candidates.filter((entity) => `${entity.label} ${entity.name} ${entity.detail || ''} ${entity.query || ''}`.toLocaleLowerCase().includes(query)).slice(0, 8);
        matches.forEach((entity) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'navigation-palette-link';
          button.setAttribute('role', 'option');
          button.id = `palette-entity-${entity.kind}-${entity.id}`;
          button.dataset.entityKind = entity.kind;
          button.dataset.entityId = String(entity.id);
          button.dataset.entityRoute = entity.route;
          button.textContent = `${entity.label} · ${entity.name}${entity.detail ? ` — ${entity.detail}` : ''}`;
          entityLinks.appendChild(button);
        });
        entityGroup.hidden = matches.length === 0;
      }
      let visibleCount = 0;
      groups.forEach(group => {
        let groupCount = 0;
        group.querySelectorAll('.navigation-palette-link').forEach(link => {
          const searchable = `${link.textContent} ${link.dataset.search || ''}`.toLocaleLowerCase();
          const visible = !query || searchable.includes(query);
          link.hidden = !visible;
          if (visible) groupCount += 1;
        });
        group.hidden = groupCount === 0;
        visibleCount += groupCount;
      });
      visibleCount += entityLinks?.children.length || 0;
      if (emptyState) emptyState.hidden = visibleCount > 0;
      const announcement = document.getElementById('navigationPaletteAnnouncement');
      if (announcement) announcement.textContent = visibleCount === 0 ? 'Tidak ada hasil.' : `${visibleCount} hasil tersedia.`;
      activeIndex = -1;
      updateActiveResult();
    };

    const openPalette = () => {
      if (!palette.open) palette.showModal();
      search.setAttribute('aria-expanded', 'true');
      search.value = '';
      filterDestinations();
      search.focus();
    };

    openButton.addEventListener('click', openPalette);
    document.getElementById('headerSearchButton')?.addEventListener('click', openPalette);
    closeButton?.addEventListener('click', () => palette.close());
    search.addEventListener('input', filterDestinations);
    entityLinks?.addEventListener('click', (event) => {
      const result = event.target.closest('[data-entity-route]');
      if (!result) return;
      const route = result.dataset.entityRoute;
      const focusRequest = { kind: result.dataset.entityKind, id: result.dataset.entityId, route };
      stateStore.setState({ pendingEntityFocus: focusRequest });
      palette.close();
      if (window.location.hash !== `#${route}`) window.location.hash = route;
      else {
        window.dispatchEvent(new CustomEvent('omnitraf:entity-focus', { detail: focusRequest }));
        stateStore.setState({ pendingEntityFocus: null });
      }
    });
    palette.querySelectorAll('.navigation-palette-link').forEach(link => {
      link.addEventListener('click', () => palette.close());
    });
    palette.addEventListener('close', () => {
      search.setAttribute('aria-expanded', 'false');
      search.setAttribute('aria-activedescendant', '');
      search.value = '';
      filterDestinations();
    });
    palette.addEventListener('keydown', (event) => {
      if (event.target === search && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const results = visibleResults();
        if (!results.length) return;
        event.preventDefault();
        if (event.key === 'Home') activeIndex = 0;
        else if (event.key === 'End') activeIndex = results.length - 1;
        else if (event.key === 'ArrowDown') activeIndex = (activeIndex + 1) % results.length;
        else activeIndex = activeIndex <= 0 ? results.length - 1 : activeIndex - 1;
        updateActiveResult();
        results[activeIndex].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.target === search && event.key === 'Enter') {
        const results = visibleResults();
        const result = results[activeIndex] || results[0];
        if (result) {
          event.preventDefault();
          result.click();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      palette.close();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      openPalette();
    });
  }

  /**
   * 2. Mobile Navigation & Sidebar Drawer Menu
   */
  _initMobileNav() {
    const btnMenu = document.getElementById("mobTabMenu");
    const menuToggle = document.getElementById("menuToggle");
    const closeDrawer = document.getElementById("closeDrawer");
    let drawerBackdrop = document.getElementById("drawerBackdrop");

    // Pastikan drawer backdrop tersedia di DOM
    if (!drawerBackdrop) {
      drawerBackdrop = document.createElement("div");
      drawerBackdrop.id = "drawerBackdrop";
      drawerBackdrop.className = "drawer-backdrop";
      (document.querySelector(".app-shell") || document.body).appendChild(drawerBackdrop);
    }

    document.querySelector(".app-shell")?.appendChild(drawerBackdrop);

    const toggleSidebar = () => {
      const sidebar = document.querySelector(".sidebar, .app-sidebar");
      if (!sidebar) return;
      const wasOpen = sidebar.classList.contains("open-mobile");
      this._setSidebarOpen(!wasOpen, { returnFocus: wasOpen });
      soundManager.play('click');
    };

    if (btnMenu) btnMenu.addEventListener("click", toggleSidebar);
    if (menuToggle) menuToggle.addEventListener("click", toggleSidebar);

    if (closeDrawer) closeDrawer.addEventListener("click", () => this._setSidebarOpen(false, { returnFocus: true }));

    if (drawerBackdrop) {
      drawerBackdrop.addEventListener("click", () => {
        this._setSidebarOpen(false, { returnFocus: true });
        soundManager.play('click');
      });
    }

    // Pastikan klik tab mobile bottom menutup drawer
    document.querySelectorAll(".mobile-tab-item").forEach(item => {
      if (item.id !== "mobTabMenu") {
        item.addEventListener("click", () => {
          this._setSidebarOpen(false, { returnFocus: true });
        });
      }
    });

    const sidebar = document.querySelector('.sidebar, .app-sidebar');
    if (sidebar) {
      const mobileQuery = window.matchMedia('(max-width: 768px)');
      const syncInert = () => {
        sidebar.inert = mobileQuery.matches && !sidebar.classList.contains('open-mobile');
      };
      syncInert();
      mobileQuery.addEventListener?.('change', syncInert);
      sidebar.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || !mobileQuery.matches || !sidebar.classList.contains('open-mobile')) return;
        const focusable = [...sidebar.querySelectorAll('a[href], button:not(:disabled), [tabindex="0"]')]
          .filter(element => !element.hidden && element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      });
    }
  }

  _setSidebarOpen(isOpen, { returnFocus = false } = {}) {
    const sidebar = document.querySelector(".sidebar, .app-sidebar");
    const backdrop = document.getElementById("drawerBackdrop");
    const menuToggle = document.getElementById("menuToggle");
    const mobileMenu = document.getElementById('mobTabMenu');
    if (!sidebar) return;

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) {
      sidebar.classList.remove('open-mobile');
      sidebar.inert = false;
      document.body.classList.remove('sidebar-drawer-open');
      if (backdrop) {
        backdrop.classList.remove('active');
        backdrop.style.display = 'none';
      }
      menuToggle?.setAttribute('aria-expanded', 'false');
      mobileMenu?.setAttribute('aria-expanded', 'false');
      return;
    }

    const wasOpen = sidebar.classList.contains("open-mobile");
    if (isOpen) this._sidebarReturnFocus = document.activeElement;
    sidebar.classList.toggle("open-mobile", isOpen);
    sidebar.inert = !isOpen;
    document.body.classList.toggle('sidebar-drawer-open', isOpen);
    if (backdrop) {
      backdrop.classList.toggle("active", isOpen);
      backdrop.style.display = isOpen ? "block" : "none";
    }
    menuToggle?.setAttribute("aria-expanded", String(isOpen));
    mobileMenu?.setAttribute('aria-expanded', String(isOpen));
    menuToggle?.setAttribute('aria-label', isOpen ? 'Tutup menu' : 'Buka menu');
    mobileMenu?.setAttribute('aria-label', isOpen ? 'Tutup menu tujuan' : 'Buka semua tujuan');

    if (isOpen) document.getElementById("closeDrawer")?.focus();
    else if (returnFocus && wasOpen) {
      const preferred = this._sidebarReturnFocus;
      const fallback = [menuToggle, mobileMenu].find(element => element && element.getClientRects().length > 0);
      (preferred && preferred.getClientRects().length > 0 ? preferred : fallback)?.focus();
      this._sidebarReturnFocus = null;
    }
  }

  closeMobileSidebar() {
    this._setSidebarOpen(false, { returnFocus: true });
  }

  _initShellProfile() {
    const nameNode = document.getElementById('profileDisplayName');
    const roleNode = document.getElementById('profileRoleLabel');
    const avatarNode = document.getElementById('profileAvatar');
    const profile = document.getElementById('operatorProfile');
    if (!nameNode || !roleNode || !avatarNode) return;

    const render = (user = authManager.getUser()) => {
      const name = String(user?.name || user?.username || '').trim();
      const role = String(user?.role || '').trim().toUpperCase();
      nameNode.textContent = name || 'Demo session';
      roleNode.textContent = ({ ADMIN: 'Admin', OPERATOR: 'Operator', VIEWER: 'Viewer' })[role] || 'Simulation session';
      const profileLabel = name ? `${name}, ${roleNode.textContent}` : 'Simulation session profile';
      profile?.setAttribute('aria-label', profileLabel);
      profile?.setAttribute('title', profileLabel);
      avatarNode.textContent = name
        ? name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase()
        : 'D';
    };

    render();
    this._profileUnsubscribe = authManager.onAuthChange(render);
  }

  _initNotificationCount() {
    const badge = document.getElementById('notifBadgeCount');
    const button = document.getElementById('notifToggle');
    if (!badge || !button) return;
    const update = (incidents = []) => {
      const count = (Array.isArray(incidents) ? incidents : [])
        .filter((incident) => !['RESOLVED', 'ARCHIVED'].includes(String(incident.status || '').toUpperCase())).length;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
      const label = count > 0 ? `Active scenario notifications: ${count}` : 'Incident notifications';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    };
    update(stateStore.getState().incidents);
    this._notificationUnsubscribe = stateStore.subscribe('state:incidents', ({ value }) => update(value));
  }

  /**
   * 3. Theme Toggle (Dark / Light)
   */
  _initThemeToggle() {
    const btnTheme = document.getElementById("themeToggle") || document.getElementById("btnToggleTheme");
    if (!btnTheme) return;

    const preferenceKey = 'omnitraf.theme';
    try {
      if (window.localStorage.getItem(preferenceKey) === 'light') document.body.classList.add('theme-light');
    } catch (_) {}
    stateStore.setState({ theme: document.body.classList.contains('theme-light') ? 'light' : 'dark' });
    const syncThemeControl = () => {
      const isLight = document.body.classList.contains('theme-light');
      btnTheme.setAttribute('aria-pressed', String(isLight));
      btnTheme.setAttribute('aria-label', isLight ? 'Ganti ke tema gelap' : 'Ganti ke tema terang');
      btnTheme.setAttribute('title', isLight ? 'Ganti ke tema gelap' : 'Ganti ke tema terang');
      const icon = btnTheme.querySelector('.theme-icon');
      if (icon) icon.textContent = isLight ? '☼' : '☾';
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor) themeColor.content = isLight ? '#f3f6fa' : '#0b1020';
    };
    syncThemeControl();

    document.addEventListener('omnitraf:reset-ui-preferences', () => {
      document.body.classList.remove('theme-light');
      stateStore.setState({ theme: 'dark' });
      try { window.localStorage.removeItem(preferenceKey); } catch (_) {}
      syncThemeControl();
    });

    btnTheme.addEventListener("click", () => {
      const isLight = document.body.classList.toggle("theme-light");
      stateStore.setState({ theme: isLight ? 'light' : 'dark' });
      try { window.localStorage.setItem(preferenceKey, isLight ? 'light' : 'dark'); } catch (_) {}
      syncThemeControl();
      soundManager.play('click');
      if (typeof window.showToast === "function") {
        window.showToast(`Tema diubah ke ${isLight ? 'Terang (Day Mode)' : 'Gelap (Night Radar)'}.`);
      }
    });
  }

  _initDensityPreference() {
    this.densityMode = 'compact';
    try {
      const storedDensity = window.localStorage.getItem('omnitraf.density');
      if (storedDensity === 'comfortable' || storedDensity === 'compact') this.densityMode = storedDensity;
    } catch (_) {}
    const root = document.documentElement;
    root.dataset.density = this.densityMode;
    const syncButtons = () => {
      document.querySelectorAll('[data-density-choice]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.densityChoice === this.densityMode));
      });
    };
    document.addEventListener('omnitraf:reset-ui-preferences', () => {
      this.densityMode = 'compact';
      root.dataset.density = this.densityMode;
      try { window.localStorage.removeItem('omnitraf.density'); } catch (_) {}
      syncButtons();
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-density-choice]');
      if (!button) return;
      this.densityMode = button.dataset.densityChoice === 'comfortable' ? 'comfortable' : 'compact';
      root.dataset.density = this.densityMode;
      try { window.localStorage.setItem('omnitraf.density', this.densityMode); } catch (_) {}
      syncButtons();
      soundManager.play('click');
    });
    const viewContainer = document.getElementById('viewContainer');
    if (viewContainer && typeof MutationObserver !== 'undefined') {
      this.densityObserver = new MutationObserver(syncButtons);
      this.densityObserver.observe(viewContainer, { childList: true });
    }
    syncButtons();
  }

  /**
   * 4. Real-Time WIB Digital Clock & Full Date
   */
  _initClock() {
    const clockEl = document.getElementById("clock") || document.getElementById("currentTime");
    const dateEl = document.getElementById("currentDate");

    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }

    const updateTime = () => {
      const now = new Date();
      
      const timeStr = now.toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB';

      const weekdayStr = now.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long'
      });

      const compactDateStr = now.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

      const fullDateTime = `${weekdayStr}, ${compactDateStr} | ${timeStr}`;

      if (dateEl) {
        dateEl.textContent = `${weekdayStr}, ${compactDateStr}`;
      }
      if (clockEl) {
        clockEl.textContent = fullDateTime;
      }
    };

    updateTime();
    this.clockInterval = setInterval(updateTime, 1000);
  }

  /**
   * 5. Chat & Notification Drawers
   */
  _initDrawersAndPanels() {
    const chatPanel = document.getElementById("staffChatPanel");
    const chatToggle = document.getElementById("btnToggleChatPanel");
    const chatHeader = document.getElementById("staffChatHeader");
    const grabHandle = document.getElementById("chatSheetGrabHandle");
    const chatOpeners = [document.getElementById('btnTopMobileChat'), document.getElementById('btnOpenMobileChat')].filter(Boolean);
    const notifToggle = document.getElementById("notifToggle");
    const notifDrawer = document.getElementById("notifDrawer");
    const closeNotifDrawer = document.getElementById("closeNotifDrawer");
    const notifBackdrop = document.getElementById("notifDrawerBackdrop");
    let chatReturnFocus = null;

    const setChatOpen = (isOpen, returnFocus = false) => {
      if (!chatPanel) return;
      chatPanel.classList.toggle("collapsed", !isOpen);
      chatPanel.setAttribute('aria-hidden', String(!isOpen));
      chatPanel.inert = !isOpen;
      chatToggle?.setAttribute('aria-expanded', String(isOpen));
      chatOpeners.forEach((button) => button.setAttribute('aria-expanded', String(isOpen)));
      if (isOpen) {
        chatReturnFocus = document.activeElement;
        document.getElementById('chatInputText')?.focus({ preventScroll: true });
      } else if (returnFocus) {
        chatReturnFocus?.focus?.({ preventScroll: true });
        chatReturnFocus = null;
      }
      soundManager.play('click');
    };

    const toggleChat = () => setChatOpen(Boolean(chatPanel?.classList.contains('collapsed')));
    chatOpeners.forEach((button) => button.addEventListener('click', () => setChatOpen(true)));

    if (chatToggle) chatToggle.addEventListener("click", toggleChat);
    if (chatHeader) {
      chatHeader.addEventListener("click", (e) => {
        if (!e.target.closest("button")) toggleChat();
      });
    }
    if (grabHandle) grabHandle.addEventListener("click", toggleChat);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && chatPanel && !chatPanel.classList.contains('collapsed')) {
        setChatOpen(false, true);
      }
    });

    // Notification Drawer
    const toggleNotifDrawer = () => {
      if (!notifDrawer) return;
      const isOpen = notifDrawer.classList.toggle("open");
      notifDrawer.setAttribute("aria-hidden", String(!isOpen));
      if (!isOpen) document.getElementById("notifToggle")?.focus();
      if (notifBackdrop) {
        notifBackdrop.style.display = isOpen ? "block" : "none";
        notifBackdrop.classList.toggle("active", isOpen);
      }
      soundManager.play('click');
    };

    const closeNotif = () => {
      if (notifDrawer) notifDrawer.classList.remove("open");
      if (notifDrawer) notifDrawer.setAttribute("aria-hidden", "true");
      document.getElementById("notifToggle")?.focus();
      if (notifBackdrop) {
        notifBackdrop.style.display = "none";
        notifBackdrop.classList.remove("active");
      }
      soundManager.play('click');
    };

    if (notifToggle) notifToggle.addEventListener("click", toggleNotifDrawer);
    if (closeNotifDrawer) closeNotifDrawer.addEventListener("click", closeNotif);
    if (notifBackdrop) notifBackdrop.addEventListener("click", closeNotif);
    document.addEventListener('click', (event) => {
      const dismiss = event.target?.closest('.resolve-notif-btn[data-notif-id]');
      if (!dismiss) return;
      const card = document.getElementById(dismiss.dataset.notifId);
      if (!card || !notifDrawer?.contains(card)) return;
      card.remove();
      soundManager.play('click');
      if (typeof window.showToast === 'function') window.showToast('Contoh notifikasi ditutup. Status insiden simulasi tidak diubah.');
    });
  }
}

export const navigationController = new NavigationController();
