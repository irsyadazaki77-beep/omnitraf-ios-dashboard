/**
 * OmniTRAF Surabaya - Navigation, SPA Router & Shell Controller
 * Mengatur perutean halaman SPA (Hash & Data-view), sinkronisasi tab navigasi mobile iOS,
 * peralihan tema (Dark/Light), jam digital real-time WIB presisi tinggi, dan penutupan drawer otomatis.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { mapManager } from '../modules/mapManager.js';

export class NavigationController {
  constructor() {
    this.clockInterval = null;
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._initRouter();
    this._initMobileNav();
    this._initThemeToggle();
    this._initClock();
    this._initDrawersAndPanels();
  }

  /**
   * 1. SPA Router (Hash & Data-View)
   */
  _initRouter() {
    const navLinks = document.querySelectorAll("nav a[data-view], .sidebar a[data-view], .mobile-tab-item[data-view], a[href^='#']");
    const views = document.querySelectorAll(".view-pane");
    const sidebar = document.querySelector(".sidebar, .app-sidebar");
    const drawerBackdrop = document.getElementById("drawerBackdrop");

    const closeMobileSidebar = () => {
      if (sidebar) sidebar.classList.remove("open-mobile");
      if (drawerBackdrop) {
        drawerBackdrop.classList.remove("active");
        drawerBackdrop.style.display = "none";
      }
    };

    const switchView = (targetViewId) => {
      let cleanId = (targetViewId || "dashboard").replace('#', '').replace('view-', '');
      if (!cleanId || cleanId === "about-engine") return;

      // Sync active state on navigation elements
      document.querySelectorAll("[data-view]").forEach(link => {
        const v = link.dataset.view?.replace('view-', '');
        if (v === cleanId || (cleanId === 'emergencies' && v === 'emergency')) {
          link.classList.add("active");
        } else {
          link.classList.remove("active");
        }
      });

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

    navLinks.forEach(link => {
      link.addEventListener("click", (e) => {
        const href = link.getAttribute("href");
        const dataView = link.dataset.view;
        const dataAction = link.dataset.action;

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

        if (target) {
          e.preventDefault();
          if (window.location.hash !== `#${target}`) {
            window.location.hash = target;
          }
          switchView(target);
          soundManager.play('click');
        }
      });
    });

    // Initial View on Load
    const initialHash = window.location.hash.slice(1) || "dashboard";
    if (initialHash !== "about-engine") {
      switchView(initialHash);
    }
  }

  /**
   * 2. Mobile Navigation & Sidebar Drawer Menu
   */
  _initMobileNav() {
    const btnMenu = document.getElementById("mobTabMenu");
    const menuToggle = document.getElementById("menuToggle");
    const sidebar = document.querySelector(".sidebar, .app-sidebar");
    let drawerBackdrop = document.getElementById("drawerBackdrop");

    // Pastikan drawer backdrop tersedia di DOM
    if (!drawerBackdrop) {
      drawerBackdrop = document.createElement("div");
      drawerBackdrop.id = "drawerBackdrop";
      drawerBackdrop.className = "drawer-backdrop";
      document.body.appendChild(drawerBackdrop);
    }

    const toggleSidebar = () => {
      if (!sidebar) return;
      const isOpen = sidebar.classList.toggle("open-mobile");
      if (drawerBackdrop) {
        if (isOpen) {
          drawerBackdrop.classList.add("active");
          drawerBackdrop.style.display = "block";
        } else {
          drawerBackdrop.classList.remove("active");
          drawerBackdrop.style.display = "none";
        }
      }
      soundManager.play('click');
    };

    if (btnMenu) btnMenu.addEventListener("click", toggleSidebar);
    if (menuToggle) menuToggle.addEventListener("click", toggleSidebar);

    if (drawerBackdrop) {
      drawerBackdrop.addEventListener("click", () => {
        if (sidebar) sidebar.classList.remove("open-mobile");
        drawerBackdrop.classList.remove("active");
        drawerBackdrop.style.display = "none";
        soundManager.play('click');
      });
    }

    // Pastikan klik tab mobile bottom menutup drawer
    document.querySelectorAll(".mobile-tab-item").forEach(item => {
      if (item.id !== "mobTabMenu") {
        item.addEventListener("click", () => {
          if (sidebar) sidebar.classList.remove("open-mobile");
          if (drawerBackdrop) {
            drawerBackdrop.classList.remove("active");
            drawerBackdrop.style.display = "none";
          }
        });
      }
    });
  }

  /**
   * 3. Theme Toggle (Dark / Light)
   */
  _initThemeToggle() {
    const btnTheme = document.getElementById("themeToggle") || document.getElementById("btnToggleTheme");
    if (!btnTheme) return;

    btnTheme.addEventListener("click", () => {
      const isLight = document.body.classList.toggle("theme-light");
      stateStore.setState({ theme: isLight ? 'light' : 'dark' });
      soundManager.play('click');
      if (typeof window.showToast === "function") {
        window.showToast(`Tema diubah ke ${isLight ? 'Terang (Day Mode)' : 'Gelap (Night Radar)'}.`);
      }
    });
  }

  /**
   * 4. Real-Time WIB Digital Clock & Full Date
   */
  _initClock() {
    const clockEl = document.getElementById("clock") || document.getElementById("currentTime");
    const dateEl = document.getElementById("currentDate");

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
    const notifToggle = document.getElementById("notifToggle");
    const notifDrawer = document.getElementById("notifDrawer");
    const closeNotifDrawer = document.getElementById("closeNotifDrawer");
    const notifBackdrop = document.getElementById("notifDrawerBackdrop");

    const toggleChat = () => {
      if (!chatPanel) return;
      chatPanel.classList.toggle("collapsed");
      soundManager.play('click');
    };

    if (chatToggle) chatToggle.addEventListener("click", toggleChat);
    if (chatHeader) {
      chatHeader.addEventListener("click", (e) => {
        if (!e.target.closest("button")) toggleChat();
      });
    }
    if (grabHandle) grabHandle.addEventListener("click", toggleChat);

    // Notification Drawer
    const toggleNotifDrawer = () => {
      if (!notifDrawer) return;
      const isOpen = notifDrawer.classList.toggle("open");
      if (notifBackdrop) {
        notifBackdrop.style.display = isOpen ? "block" : "none";
        notifBackdrop.classList.toggle("active", isOpen);
      }
      soundManager.play('click');
    };

    const closeNotif = () => {
      if (notifDrawer) notifDrawer.classList.remove("open");
      if (notifBackdrop) {
        notifBackdrop.style.display = "none";
        notifBackdrop.classList.remove("active");
      }
      soundManager.play('click');
    };

    if (notifToggle) notifToggle.addEventListener("click", toggleNotifDrawer);
    if (closeNotifDrawer) closeNotifDrawer.addEventListener("click", closeNotif);
    if (notifBackdrop) notifBackdrop.addEventListener("click", closeNotif);
  }
}

export const navigationController = new NavigationController();
