/**
 * OmniTRAF Surabaya - Map Controls & Viewport Manager
 * Bertanggung jawab khusus untuk zoom controls, reset viewport, flyTo,
 * layer mode filter, layer drawer deck, context menu, dan keyboard navigation accessibility.
 */

import { SURABAYA_CENTER, SITS_INTERSECTIONS_GEOJSON } from '../../config/surabayaCoords.js';
import { soundManager } from '../../core/soundManager.js';
import { stateStore, escapeHtml } from '../../core/stateStore.js';

export class MapControls {
  constructor() {
    this._lastRightClickLatLng = null;
  }

  /**
   * Pan dan Zoom ke Lokasi Spesifik
   */
  flyToLocation(maps, locationName) {
    let target = [SURABAYA_CENTER.lat, SURABAYA_CENTER.lng];
    let targetZoom = 15;

    const locLower = (locationName || '').toLowerCase();
    if (locLower.includes('wonokromo')) target = [-7.2985, 112.7345];
    else if (locLower.includes('tunjungan') || locLower.includes('siola')) target = [-7.2625, 112.7375];
    else if (locLower.includes('darmo')) target = [-7.2810, 112.7395];
    else if (locLower.includes('soetomo') || locLower.includes('rsud')) target = [-7.2690, 112.7635];
    else if (locLower.includes('merr')) target = [-7.2740, 112.7815];

    maps.forEach(map => {
      map.flyTo(target, targetZoom, { duration: 1.5, easeLinearity: 0.25 });
    });
  }

  /**
   * Reset peta ke viewport pusat Surabaya
   */
  resetViewport(maps, containerId = null, onClearSelection = null) {
    const target = [SURABAYA_CENTER.lat, SURABAYA_CENTER.lng];
    const targetZoom = SURABAYA_CENTER.zoom || 13;

    if (containerId && maps.has(containerId)) {
      const map = maps.get(containerId);
      map.closePopup();
      map.flyTo(target, targetZoom, { duration: 1.2, easeLinearity: 0.25 });
    } else {
      maps.forEach(map => {
        map.closePopup();
        map.flyTo(target, targetZoom, { duration: 1.2, easeLinearity: 0.25 });
      });
    }

    if (typeof onClearSelection === 'function') {
      onClearSelection();
    }
  }

  /**
   * Zoom In helper
   */
  zoomIn(maps, containerId = null) {
    if (containerId && maps.has(containerId)) {
      maps.get(containerId).zoomIn();
    } else {
      maps.forEach(map => map.zoomIn());
    }
  }

  /**
   * Zoom Out helper
   */
  zoomOut(maps, containerId = null) {
    if (containerId && maps.has(containerId)) {
      maps.get(containerId).zoomOut();
    } else {
      maps.forEach(map => map.zoomOut());
    }
  }

  /**
   * Smooth fly to intersection by ID or name
   */
  flyToIntersection(maps, layerGroupsMap, intersectionMarkersMap, idOrName) {
    if (!idOrName) return;

    let targetCoord = null;
    let targetProp = null;

    for (const feature of SITS_INTERSECTIONS_GEOJSON.features) {
      const p = feature.properties;
      if (p.id === idOrName || p.name.toLowerCase().includes(String(idOrName).toLowerCase())) {
        targetCoord = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
        targetProp = p;
        break;
      }
    }

    if (!targetCoord) {
      this.flyToLocation(maps, idOrName);
      return;
    }

    maps.forEach((map, containerId) => {
      map.flyTo(targetCoord, 17, { duration: 1.2, easeLinearity: 0.25 });

      setTimeout(() => {
        const stored = intersectionMarkersMap.get(targetProp.id);
        if (stored && stored.marker) {
          try {
            const group = layerGroupsMap.get(containerId)?.['master-cluster'];
            if (group && typeof group.zoomToShowLayer === 'function') {
              group.zoomToShowLayer(stored.marker, () => {
                stored.marker.openPopup();
              });
            } else {
              stored.marker.openPopup();
            }
          } catch {
            stored.marker.openPopup();
          }
        }
      }, 700);
    });
  }

  /**
   * Fly to incident coordinates or location name
   */
  flyToIncident(maps, layerGroupsMap, locationOrCoords, title = "Insiden Lalu Lintas") {
    // 1. Switch to Map tab
    stateStore.setState({ currentView: 'map' });
    const mapNav = document.querySelector('[data-view="map"]');
    if (mapNav) {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      mapNav.classList.add('active');
    }

    // 2. Resolve target coordinate
    let latlng = [-7.2985, 112.7345];
    if (Array.isArray(locationOrCoords) && locationOrCoords.length === 2 && !isNaN(locationOrCoords[0])) {
      latlng = locationOrCoords;
    } else if (typeof locationOrCoords === 'string') {
      const locLower = locationOrCoords.toLowerCase();
      if (locLower.includes('wonokromo')) latlng = [-7.2985, 112.7345];
      else if (locLower.includes('diponegoro')) latlng = [-7.2880, 112.7380];
      else if (locLower.includes('darmo')) latlng = [-7.2810, 112.7395];
      else if (locLower.includes('pemuda')) latlng = [-7.2650, 112.7480];
      else if (locLower.includes('kupang') || locLower.includes('kembang')) latlng = [-7.2680, 112.7280];
      else if (locLower.includes('manyar')) latlng = [-7.2725, 112.7690];
      else if (locLower.includes('jemursari')) latlng = [-7.3180, 112.7330];
      else if (locLower.includes('tunjungan') || locLower.includes('siola')) latlng = [-7.2625, 112.7375];
      else if (locLower.includes('waru')) latlng = [-7.3510, 112.7290];
    }

    // 3. Execute flyTo animation across all active maps
    maps.forEach((map, containerId) => {
      map.flyTo(latlng, 17, { duration: 1.4, easeLinearity: 0.25 });

      setTimeout(() => {
        const incidentGroup = layerGroupsMap.get(containerId)?.['warn-points'];
        let opened = false;

        if (incidentGroup) {
          incidentGroup.eachLayer(layer => {
            if (layer.getLatLng && layer.getLatLng().distanceTo(L.latLng(latlng)) < 350) {
              const masterCluster = layerGroupsMap.get(containerId)?.['master-cluster'];
              if (masterCluster && typeof masterCluster.zoomToShowLayer === 'function') {
                try {
                  masterCluster.zoomToShowLayer(layer, () => {
                    layer.openPopup();
                  });
                } catch {
                  layer.openPopup();
                }
              } else {
                layer.openPopup();
              }
              opened = true;
            }
          });
        }

        if (!opened) {
          const safeTitle = escapeHtml(title || 'Skenario demo');
          const safeLocation = escapeHtml(typeof locationOrCoords === 'string' ? locationOrCoords : 'Area demo');
          const popupContent = `
            <div class="ios-popup-card incident-popup">
              <div class="ios-popup-header alert">
                <span class="alert-pill" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-weight: bold;">⚠️ SKENARIO DEMO</span>
                <span class="ios-popup-subtitle">SIMULASI</span>
              </div>
              <h4 class="ios-popup-title">${safeTitle}</h4>
              <p style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px; line-height: 1.4;">
                Lokasi contoh: <strong>${safeLocation}</strong><br/>
                Status: Contoh skenario; tidak ada tim SITS atau layanan 112 yang dihubungi.
              </p>
            </div>
          `;
          L.popup({ maxWidth: 300 })
            .setLatLng(latlng)
            .setContent(popupContent)
            .openOn(map);
        }
      }, 800);
    });

    soundManager.play('click');
  }

  /**
   * Bind toolbar and drawer handlers using clean Disposer lifecycle
   */
  bindToolbarAndDrawer(disposer, maps, layerManager, startEmergency112SimFn) {
    // Fullscreen toggle
    const fsBtn = document.getElementById('btnFullMapFullscreen');
    if (fsBtn) {
      disposer.addEventListener(fsBtn, 'click', () => {
        const target = document.getElementById('fullMapContainerWrapper') || document.getElementById('view-map');
        if (target) {
          if (!document.fullscreenElement) {
            if (target.requestFullscreen) target.requestFullscreen();
          } else {
            if (document.exitFullscreen) document.exitFullscreen();
          }
        }
        soundManager.play('click');
      });
    }

    // Layer drawer deck toggle
    const toggleLayerBtn = document.getElementById('btnToggleFullMapLayers');
    const closeLayerBtn = document.getElementById('btnCloseFullMapLayers');
    const layerDeck = document.getElementById('fullMapLayerDeck');
    const setDeckOpen = (open) => {
      if (!layerDeck) return;
      layerDeck.classList.toggle('open', open);
      layerDeck.inert = !open;
      layerDeck.setAttribute('aria-hidden', String(!open));
      toggleLayerBtn?.setAttribute('aria-expanded', String(open));
      if (open) closeLayerBtn?.focus();
      else toggleLayerBtn?.focus();
    };
    if (layerDeck) {
      layerDeck.inert = !layerDeck.classList.contains('open');
      disposer.addEventListener(layerDeck, 'keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); setDeckOpen(false); }
      });
    }

    if (toggleLayerBtn && layerDeck) {
      disposer.addEventListener(toggleLayerBtn, 'click', (e) => {
        e.stopPropagation();
        setDeckOpen(!layerDeck.classList.contains('open'));
        soundManager.play('click');
      });
    }

    if (closeLayerBtn && layerDeck) {
      disposer.addEventListener(closeLayerBtn, 'click', () => {
        setDeckOpen(false);
        soundManager.play('click');
      });
    }

    // Legend collapse toggle
    const legendToggleBtn = document.getElementById('btnToggleLegendCollapse');
    const legendItemsRow = document.getElementById('legendItemsRow');
    if (legendToggleBtn && legendItemsRow) {
      disposer.addEventListener(legendToggleBtn, 'click', () => {
        legendItemsRow.classList.toggle('collapsed');
        legendToggleBtn.classList.toggle('rotated');
        soundManager.play('click');
      });
    }

    // Layer mode quick buttons
    const modeBtns = document.querySelectorAll('.spatial-tool-btn[data-layer-mode], .map-layer-pill-btn[data-layer-mode]');
    modeBtns.forEach(btn => {
      disposer.addEventListener(btn, 'click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.layerMode;
        if (mode) layerManager.setMode(maps, mode);
        soundManager.play('click');
      });
    });

    // Layer checkboxes inside drawer
    document.querySelectorAll('.layer-toggle-checkbox').forEach(chk => {
      disposer.addEventListener(chk, 'change', (e) => {
        const layerKey = e.target.dataset.layer;
        if (layerKey) {
          layerManager.toggleLayer(maps, layerKey, e.target.checked);
          soundManager.play('click');
        }
      });
    });

    // Custom Context Menu Actions
    const contextMenu = document.getElementById('mapContextMenu');
    if (contextMenu) {
      const closeContextMenu = () => {
        contextMenu.style.display = 'none';
        contextMenu.setAttribute('aria-hidden', 'true');
      };
      contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        disposer.addEventListener(item, 'click', async (e) => {
          e.stopPropagation();
          const action = item.dataset.action;
          closeContextMenu();

          if (action === 'center-here' && this._lastRightClickLatLng) {
            maps.forEach(map => map.flyTo(this._lastRightClickLatLng, 16));
            if (typeof window.showToast === 'function') window.showToast('📍 Tampilan dipusatkan.');
          } else if (action === 'filter-incidents' && this._lastRightClickLatLng) {
            layerManager.setMode(maps, 'all');
            if (typeof window.showToast === 'function') window.showToast('Semua lapisan simulasi ditampilkan. Filter insiden per area belum tersedia.');
          } else if (action === 'filter-cctv' && this._lastRightClickLatLng) {
            layerManager.setMode(maps, 'nodes');
            if (typeof window.showToast === 'function') window.showToast('📷 Menampilkan node CCTV SITS.');
          } else if (action === 'sim-112') {
            if (typeof startEmergency112SimFn === 'function') startEmergency112SimFn();
          } else if (action === 'copy-coords' && this._lastRightClickLatLng) {
            const str = `${this._lastRightClickLatLng.lat.toFixed(5)}, ${this._lastRightClickLatLng.lng.toFixed(5)}`;
            try {
              if (!navigator.clipboard?.writeText) throw new Error('Clipboard tidak tersedia.');
              await navigator.clipboard.writeText(str);
              if (typeof window.showToast === 'function') window.showToast(`Koordinat simulasi disalin: ${str}`);
            } catch (error) {
              if (typeof window.showToast === 'function') window.showToast(`Gagal menyalin koordinat: ${error.message}`, 'danger');
            }
          }
          soundManager.play('click');
        });
      });

      disposer.addEventListener(document, 'click', () => {
        closeContextMenu();
      });
    }
  }

  setLastRightClickLatLng(latlng) {
    this._lastRightClickLatLng = latlng;
  }
}

export const mapControls = new MapControls();
