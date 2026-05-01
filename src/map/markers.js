import maplibregl from 'maplibre-gl';
import { getCategory } from '../data/categories.js';

/**
 * MarkerLayer
 *
 * Render pin markers + clusters on the map. Uses MapLibre custom DOM markers
 * and re-renders on move/zoom. Limits visible markers to those within the
 * current viewport (with margin) for performance.
 */
export class MarkerLayer {
  constructor(map, { onPinClick, onClusterClick }) {
    this.map = map;
    this.onPinClick = onPinClick;
    this.onClusterClick = onClusterClick;
    this.markers = new Map();   // id -> maplibregl.Marker
    this.clusters = [];         // array of cluster markers currently displayed
    this._activePins = [];

    this._renderScheduled = false;
    const sched = () => this.scheduleRender();
    map.on('moveend', sched);
    map.on('zoomend', sched);
  }

  setActive(pins) {
    this._activePins = pins;
    this.scheduleRender();
  }

  addPinAnimated(pin) {
    if (!this._activePins.find((p) => p.id === pin.id)) {
      this._activePins = [pin, ...this._activePins];
    }
    this._render(pin.id);
  }

  updatePin(pin) {
    const m = this.markers.get(pin.id);
    if (!m) return;
    const cat = getCategory(pin.cat);
    const node = m.getElement();
    node.style.setProperty('--pin-color', cat.color);
    const label = node.querySelector('.pinly-marker__label');
    if (label) label.textContent = pin.text;
    const emoji = node.querySelector('.pinly-marker__emoji');
    if (emoji) emoji.textContent = cat.emoji;
  }

  removePin(id) {
    const m = this.markers.get(id);
    if (m) { m.remove(); this.markers.delete(id); }
  }

  scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this._render();
    });
  }

  _withinViewport(pin) {
    const b = this.map.getBounds();
    const margin = 0.2;
    const w = b.getEast() - b.getWest();
    const h = b.getNorth() - b.getSouth();
    return (
      pin.lng >= b.getWest()  - w * margin &&
      pin.lng <= b.getEast()  + w * margin &&
      pin.lat >= b.getSouth() - h * margin &&
      pin.lat <= b.getNorth() + h * margin
    );
  }

  _render(animateNewId = null) {
    const map = this.map;
    const zoom = map.getZoom();
    const cluster = zoom < 13;

    // Clear cluster markers
    this.clusters.forEach((m) => m.remove());
    this.clusters = [];

    if (cluster) {
      // Remove all individual markers in cluster mode
      this.markers.forEach((m) => m.remove());
      this.markers.clear();

      const gridPx = 70;
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
          el.innerHTML = `<span>${b.n > 99 ? '99+' : b.n}</span>`;
          el.setAttribute('role', 'button');
          el.setAttribute('aria-label', `${b.n}件のピンが集まっています`);
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onClusterClick && this.onClusterClick({ lat, lng, samples: b.samples });
          });
          const m = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lng, lat])
            .addTo(map);
          this.clusters.push(m);
        }
      });
      return;
    }

    // Individual markers, viewport-culled
    const visiblePins = this._activePins.filter((p) => this._withinViewport(p));
    const desiredIds = new Set(visiblePins.map((p) => p.id));

    // Remove off-screen markers
    for (const [id, m] of this.markers) {
      if (!desiredIds.has(id)) {
        m.remove();
        this.markers.delete(id);
      }
    }

    // Add / keep visible markers
    for (const p of visiblePins) {
      const existing = this.markers.get(p.id);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
        continue;
      }
      this._addMarker(p, p.id === animateNewId);
    }
  }

  _addMarker(pin, animate = false) {
    const cat = getCategory(pin.cat);
    const ageSec  = pin.ts ? (Date.now() / 1000 - pin.ts) : 0;
    const ageHrs  = ageSec / 3600;
    const ageClass = ageHrs >= 24 ? ' is-old' : ageHrs >= 6 ? ' is-stale' : '';

    const el = document.createElement('div');
    el.className = 'pinly-marker'
      + (animate ? ' is-new' : '')
      + (pin.official ? ' is-official' : '')
      + ageClass;
    el.style.setProperty('--pin-color', cat.color);

    el.innerHTML = `
      <div class="pinly-marker__inner">
        <div class="pinly-marker__pin"></div>
        <span class="pinly-marker__emoji">${cat.emoji}</span>
        <div class="pinly-marker__label">${escapeHTML(pin.text)}</div>
      </div>
    `;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPinClick && this.onPinClick(pin);
    });

    const m = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, 0] })
      .setLngLat([pin.lng, pin.lat])
      .addTo(this.map);

    this.markers.set(pin.id, m);
  }

  flyTo(pin) {
    this.map.flyTo({
      center: [pin.lng, pin.lat],
      zoom: Math.max(this.map.getZoom(), 15),
      speed: 1.4,
      essential: true,
    });
  }
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
