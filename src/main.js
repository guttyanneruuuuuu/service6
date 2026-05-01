import maplibregl from 'maplibre-gl';
import { DARK_STYLE } from './map/style.js';
import { MarkerLayer } from './map/markers.js';
import { PinStore } from './data/store.js';
import { CATEGORIES, CATS_FOR_COMPOSE, getCategory } from './data/categories.js';

/* ============================================================
   Pinly main controller
   ============================================================ */

const STATE = {
  map: null,
  layer: null,
  store: null,
  filterCat: 'all',
  searchQuery: '',
  composeCat: 'spot',
  composeTargetingMode: false,
  composeLngLat: null,
  selectedPinId: null,
  userLocation: null,
  userMarker: null,
};

/* ---------------- Boot ---------------- */
async function boot() {
  STATE.store = new PinStore();
  await STATE.store.init();

  initMap();
  initUI();
  initStoreEvents();

  // Hide boot
  setTimeout(() => {
    const b = document.getElementById('boot');
    if (b) b.classList.add('boot--hide');
  }, 800);

  // First-run intro
  if (!localStorage.getItem('pinly.introSeen')) {
    setTimeout(() => {
      const intro = document.getElementById('intro');
      if (intro) intro.hidden = false;
    }, 1000);
  }

  applyURLState();
}

/* ---------------- Map ---------------- */
function initMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: DARK_STYLE,
    center: [139.7005, 35.6595],   // Shibuya as default
    zoom: 14,
    minZoom: 2,
    maxZoom: 19,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
  });
  STATE.map = map;

  map.on('load', () => {
    STATE.layer = new MarkerLayer(map, {
      onPinClick: (p) => openDetail(p.id),
      onClusterClick: ({ lat, lng }) => {
        map.flyTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 3, 17), speed: 1.5 });
      },
    });
    refreshActive();
    updateStrip();
  });

  map.on('click', (e) => {
    if (STATE.composeTargetingMode) {
      STATE.composeLngLat = [e.lngLat.lng, e.lngLat.lat];
      openCompose();
    }
  });

  map.on('moveend', () => updateStrip());
}

/* ---------------- UI ---------------- */
function initUI() {
  // Category bar
  const catbar = document.getElementById('catbar');
  if (catbar) {
    catbar.innerHTML = '';
    CATEGORIES.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'catbar__btn' + (c.id === 'all' ? ' active' : '');
      b.dataset.cat = c.id;
      b.innerHTML = `<span>${c.emoji || '📍'}</span><span>${c.label}</span>`;
      b.addEventListener('click', () => {
        STATE.filterCat = c.id;
        catbar.querySelectorAll('.catbar__btn').forEach((el) => el.classList.toggle('active', el.dataset.cat === c.id));
        refreshActive();
      });
      catbar.appendChild(b);
    });
  }

  // Search
  const search = document.getElementById('searchInput');
  if (search) {
    let searchTimer;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        STATE.searchQuery = search.value;
        refreshActive();
      }, 300);
    });
  }

  // Locate
  const locateBtn = document.getElementById('locateBtn');
  if (locateBtn) locateBtn.addEventListener('click', locateMe);

  // New pin
  const newPinBtn = document.getElementById('newPinBtn');
  if (newPinBtn) newPinBtn.addEventListener('click', enterTargetingMode);
  
  const fab = document.getElementById('fab');
  if (fab) fab.onclick = enterTargetingMode;

  // Compose
  document.querySelectorAll('[data-close-compose]').forEach((el) => el.addEventListener('click', closeCompose));
  const composeText = document.getElementById('composeText');
  const composeCount = document.getElementById('composeCount');
  if (composeText && composeCount) {
    composeText.addEventListener('input', () => {
      const n = composeText.value.length;
      composeCount.textContent = `${n} / 50`;
    });
  }
  const composeSend = document.getElementById('composeSend');
  if (composeSend) composeSend.addEventListener('click', submitPin);

  // Detail
  document.querySelectorAll('[data-close-detail]').forEach((el) => el.addEventListener('click', closeDetail));

  // Intro
  const introGo = document.getElementById('introGo');
  if (introGo) {
    introGo.addEventListener('click', () => {
      document.getElementById('intro').hidden = true;
      localStorage.setItem('pinly.introSeen', '1');
    });
  }

  // Esc
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('detail').hidden) closeDetail();
    else if (!document.getElementById('composeSheet').hidden) closeCompose();
    else if (STATE.composeTargetingMode) exitTargetingMode();
  });
}

/* ---------------- Store events ---------------- */
function initStoreEvents() {
  STATE.store.addEventListener('add', (e) => {
    refreshActive(e.detail.id);
    updateStrip();
  });
  STATE.store.addEventListener('update', (e) => {
    STATE.layer && STATE.layer.updatePin(e.detail);
    updateStrip();
  });
}

function refreshActive(animateId = null) {
  if (!STATE.layer) return;
  const filtered = STATE.store.filter({ cat: STATE.filterCat, q: STATE.searchQuery });
  STATE.layer.setActive(filtered);
  if (animateId) {
    const p = STATE.store.get(animateId);
    if (p) STATE.layer.addPinAnimated(p);
  }
}

function updateStrip() {
  const all = STATE.store.list();
  const countEl = document.getElementById('stripCount');
  if (countEl) countEl.textContent = formatN(all.length);
}

/* ---------------- Compose ---------------- */
function enterTargetingMode() {
  STATE.composeTargetingMode = true;
  document.getElementById('targetCross').hidden = false;
  document.getElementById('fab').classList.add('is-targeting');
  showToast('地図を動かして場所を合わせ、決定');
  const fab = document.getElementById('fab');
  fab.onclick = confirmTarget;
}

function exitTargetingMode() {
  STATE.composeTargetingMode = false;
  document.getElementById('targetCross').hidden = true;
  const fab = document.getElementById('fab');
  fab.classList.remove('is-targeting');
  fab.onclick = enterTargetingMode;
}

function confirmTarget() {
  const c = STATE.map.getCenter();
  STATE.composeLngLat = [c.lng, c.lat];
  openCompose();
}

async function openCompose() {
  document.getElementById('composeSheet').hidden = false;
  document.getElementById('targetCross').hidden = true;
  document.getElementById('fab').classList.remove('is-targeting');
  STATE.composeTargetingMode = false;
  
  const text = document.getElementById('composeText');
  if (text) {
    text.value = '';
    setTimeout(() => text.focus(), 200);
  }
}

function closeCompose() {
  document.getElementById('composeSheet').hidden = true;
  exitTargetingMode();
}

async function submitPin() {
  const text = document.getElementById('composeText').value.trim();
  if (!text) return;
  
  const [lng, lat] = STATE.composeLngLat;
  const pin = await STATE.store.add({
    lat, lng,
    cat: STATE.composeCat,
    text,
    loc: '現在地付近'
  });
  
  closeCompose();
  STATE.layer.flyTo(pin);
}

/* ---------------- Detail ---------------- */
function openDetail(id) {
  const p = STATE.store.get(id);
  if (!p) return;
  STATE.selectedPinId = id;
  renderDetail(p);
  document.getElementById('detail').hidden = false;
}

function renderDetail(p) {
  document.getElementById('detailText').textContent = p.text;
  document.getElementById('detailAuthor').textContent = p.author.slice(0, 8);
}

function closeDetail() {
  document.getElementById('detail').hidden = true;
  STATE.selectedPinId = null;
}

/* ---------------- Actions ---------------- */
function locateMe() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const { longitude, latitude } = pos.coords;
    STATE.map.flyTo({ center: [longitude, latitude], zoom: 15 });
  });
}

/* ---------------- URL ---------------- */
function applyURLState() {
  const u = new URL(location.href);
  const pinId = u.searchParams.get('pin');
  if (pinId) {
    STATE.map.once('idle', () => {
      const p = STATE.store.get(pinId);
      if (p) {
        STATE.layer.flyTo(p);
        setTimeout(() => openDetail(pinId), 700);
      }
    });
  }
}

/* ---------------- Util ---------------- */
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2400);
}

function formatN(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

document.addEventListener('DOMContentLoaded', () => { boot(); });
