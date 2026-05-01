import maplibregl from 'maplibre-gl';
import { getCategory } from '../data/categories.js';

export class MarkerLayer {
  constructor(map, { onPinClick, onClusterClick }) {
    this.map = map;
    this.onPinClick = onPinClick;
    this.onClusterClick = onClusterClick;
    this.markers = new Map();   // id -> maplibregl.Marker
    this.clusters = [];         // array of cluster markers currently displayed
    this._allPins = [];
    this._activePins = [];

    // Use moveend and zoomend to re-render clusters/markers
    map.on('moveend', () => this._render());
    map.on('zoomend', () => this._render());
  }

  setPins(pins) {
    this._allPins = pins;
    this._activePins = pins;
    this._render();
  }

  setActive(pins) {
    this._activePins = pins;
    this._render();
  }

  addPinAnimated(pin) {
    if (!this._activePins.find(p => p.id === pin.id)) this._activePins = [pin, ...this._activePins];
    if (!this._allPins.find(p => p.id === pin.id)) this._allPins = [pin, ...this._allPins];
    this._render(pin.id);
  }

  updatePin(pin) {
    const existing = this.markers.get(pin.id);
    if (!existing) return;
    const cat = getCategory(pin.cat);
    const node = existing.getElement();
    node.style.setProperty('--pin-color', cat.color);
    const label = node.querySelector('.pinly-marker__label');
    if (label) label.textContent = pin.text;
  }

  _render(animateNewId = null) {
    const map = this.map;
    const zoom = map.getZoom();
    const cluster = zoom < 13;

    // Clear previous cluster markers
    this.clusters.forEach((m) => m.remove());
    this.clusters = [];

    if (cluster) {
      // Remove all individual markers when clustering
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
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onClusterClick && this.onClusterClick({ lat, lng, samples: b.samples });
          });
          const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
          this.clusters.push(m);
        }
      });
    } else {
      const desiredIds = new Set(this._activePins.map((p) => p.id));
      for (const [id, m] of this.markers) {
        if (!desiredIds.has(id)) {
          m.remove();
          this.markers.delete(id);
        }
      }
      for (const p of this._activePins) {
        if (this.markers.has(p.id)) {
            // Ensure position is correct even if it was slightly off due to anchor issues
            this.markers.get(p.id).setLngLat([p.lng, p.lat]);
            continue;
        }
        this._addMarker(p, p.id === animateNewId);
      }
    }
  }

  _addMarker(pin, animate = false) {
    const cat = getCategory(pin.cat);
    const el = document.createElement('div');

    const ageHours = pin.ts ? (Date.now() / 1000 - pin.ts) / 3600 : 0;
    const ageClass = ageHours >= 24 ? ' is-old' : ageHours >= 6 ? ' is-stale' : '';

    el.className = 'pinly-marker' + (animate ? ' is-new' : '') + (pin.official ? ' is-official' : '') + ageClass;
    el.style.setProperty('--pin-color', cat.color);
    
    // Freshness visual boost
    const ageSec = pin.ts ? (Date.now() / 1000 - pin.ts) : 0;
    if (ageSec < 3600) {
      el.style.filter = 'drop-shadow(0 0 8px var(--pin-color))';
    }
    el.style.opacity = Math.max(0.5, 1 - (ageSec / (86400 * 7)));

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
    
    // Create marker with 'bottom' anchor
    const m = new maplibregl.Marker({ 
        element: el, 
        anchor: 'bottom',
        offset: [0, 0] // Ensure no unexpected offset
    }).setLngLat([pin.lng, pin.lat]).addTo(this.map);
    
    this.markers.set(pin.id, m);
  }

  flyTo(pin) {
    this.map.flyTo({ 
        center: [pin.lng, pin.lat], 
        zoom: Math.max(this.map.getZoom(), 15), 
        speed: 1.4,
        essential: true 
    });
  }
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
