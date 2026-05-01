/**
 * Map marker layer for Pinly.
 *
 * Uses MapLibre's HTML markers (not native symbol layers) so each pin
 * is a real DOM node. This lets us:
 *   - animate a "pin drop" CSS keyframe on insertion
 *   - show preview labels on hover
 *   - keep CSS-driven theming
 *
 * For dense areas we cluster manually based on screen-space distance.
 */

import maplibregl from 'maplibre-gl';
import { getCategory } from '../data/categories.js';

export class MarkerLayer {
  constructor(map, { onPinClick, onClusterClick }) {
    this.map = map;
    this.onPinClick = onPinClick;
    this.onClusterClick = onClusterClick;
    this.markers = new Map();   // id -> maplibregl.Marker
    this.clusters = [];         // array of cluster markers currently displayed
    this._renderToken = 0;
    this._raf = null;
    this._allPins = [];
    this._activePins = [];

    map.on('moveend', () => this._scheduleRender());
    map.on('zoomend', () => this._scheduleRender());
  }

  setPins(pins) {
    this._allPins = pins;
    this._activePins = pins;
    this._scheduleRender(true);
  }

  setActive(pins) {
    this._activePins = pins;
    this._scheduleRender(true);
  }

  addPinAnimated(pin) {
    if (this._activePins.indexOf(pin) === -1) this._activePins = [pin, ...this._activePins];
    if (this._allPins.indexOf(pin) === -1) this._allPins = [pin, ...this._allPins];
    this._scheduleRender(true, pin.id);
  }

  updatePin(pin) {
    // No structural change needed — visuals identical unless category changes
    const existing = this.markers.get(pin.id);
    if (!existing) return;
    const data = pin;
    const cat = getCategory(data.cat);
    const node = existing.getElement();
    node.style.setProperty('--pin-color', cat.color);
    const label = node.querySelector('.pinly-marker__label');
    if (label) label.textContent = data.text;
  }

  _scheduleRender(force = false, animateNewId = null) {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this._render(force, animateNewId));
  }

  _render(force, animateNewId) {
    const map = this.map;
    const zoom = map.getZoom();
    const cluster = zoom < 12;

    // Clear previous cluster markers
    this.clusters.forEach((m) => m.remove());
    this.clusters = [];

    if (cluster) {
      // Hide all individual markers in clusters mode
      this.markers.forEach((m) => m.remove());
      this.markers.clear();

      // Build clusters by snapping to grid in screen space
      const gridPx = 60;
      const buckets = new Map();
      for (const p of this._activePins) {
        const proj = map.project([p.lng, p.lat]);
        const k = `${Math.floor(proj.x / gridPx)},${Math.floor(proj.y / gridPx)}`;
        let b = buckets.get(k);
        if (!b) { b = { lat: 0, lng: 0, n: 0, samples: [] }; buckets.set(k, b); }
        b.lat += p.lat; b.lng += p.lng; b.n += 1; b.samples.push(p);
      }
      buckets.forEach((b) => {
        const lat = b.lat / b.n, lng = b.lng / b.n;
        if (b.n === 1) {
          this._addMarker(b.samples[0]);
        } else {
          const el = document.createElement('div');
          el.className = 'pinly-cluster' + (b.n >= 10 ? ' is-large' : '');
          el.textContent = b.n > 99 ? '99+' : String(b.n);
          el.addEventListener('click', () => this.onClusterClick && this.onClusterClick({ lat, lng, samples: b.samples }));
          const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
          this.clusters.push(m);
        }
      });
    } else {
      // Individual markers
      const desiredIds = new Set(this._activePins.map((p) => p.id));

      // Remove markers that are no longer active
      for (const [id, m] of this.markers) {
        if (!desiredIds.has(id)) {
          m.remove();
          this.markers.delete(id);
        }
      }
      // Add new markers
      for (const p of this._activePins) {
        if (this.markers.has(p.id)) continue;
        this._addMarker(p, p.id === animateNewId);
      }
    }
  }

  _addMarker(pin, animate = false) {
    const cat = getCategory(pin.cat);
    const el = document.createElement('div');

    // Compute time-decay age class based on pin timestamp
    const ageHours = pin.ts ? (Date.now() / 1000 - pin.ts) / 3600 : 0;
    const ageClass = ageHours >= 24 ? ' is-old' : ageHours >= 6 ? ' is-stale' : '';

    el.className = 'pinly-marker' + (animate ? ' is-new' : '') + (pin.official ? ' is-official' : '') + ageClass;
    el.style.setProperty('--pin-color', cat.color);
    // Wrap content in __inner so hover lift transforms don't fight
    // MapLibre's inline `transform` that controls geographic positioning.
    el.innerHTML = `
      <div class="pinly-marker__inner">
        <div class="pinly-marker__pin"></div>
        <div class="pinly-marker__label">${escapeHTML(pin.text)}</div>
      </div>
    `;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPinClick && this.onPinClick(pin);
    });
    const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([pin.lng, pin.lat]).addTo(this.map);
    this.markers.set(pin.id, m);
  }

  flyTo(pin) {
    this.map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(this.map.getZoom(), 14), speed: 1.4 });
  }
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
