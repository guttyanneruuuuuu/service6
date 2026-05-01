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

  // Compose Category Selector
  const composeCatContainer = document.getElementById('composeCatSelector');
  if (composeCatContainer) {
    composeCatContainer.innerHTML = '';
    CATS_FOR_COMPOSE.forEach(c => {
        const b = document.createElement('button');
        b.className = 'catbar__btn' + (c.id === STATE.composeCat ? ' active' : '');
        b.dataset.cat = c.id;
        b.innerHTML = `<span>${c.emoji}</span><span>${c.label}</span>`;
        b.onclick = () => {
            STATE.composeCat = c.id;
            composeCatContainer.querySelectorAll('.catbar__btn').forEach(el => el.classList.toggle('active', el.dataset.cat === c.id));
        };
        composeCatContainer.appendChild(b);
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

  // Trend Panel
  const trendToggle = document.getElementById('trendToggle');
  const trendPanel = document.getElementById('trendPanel');
  const trendClose = document.getElementById('trendClose');
  if (trendToggle && trendPanel) {
    trendToggle.onclick = () => {
      renderTrends();
      trendPanel.classList.add('is-open');
    };
  }
  if (trendClose) {
    trendClose.onclick = () => trendPanel.classList.remove('is-open');
  }

  // Share
  const shareX = document.getElementById('shareX');
  if (shareX) {
    shareX.onclick = () => {
      const p = STATE.store.get(STATE.selectedPinId);
      if (!p) return;
      const text = `Pinlyで街の"今"を発見！「${p.text}」 #Pinly #街の声`;
      const url = `${location.origin}${location.pathname}?pin=${p.id}`;
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`);
    };
  }
  const copyLink = document.getElementById('copyLink');
  if (copyLink) {
    copyLink.onclick = () => {
      const url = `${location.origin}${location.pathname}?pin=${STATE.selectedPinId}`;
      navigator.clipboard.writeText(url).then(() => showToast('リンクをコピーしました！'));
    };
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
  
  // Simple keyword-based category suggestion
  let cat = STATE.composeCat;
  const lowerText = text.toLowerCase();
  if (lowerText.match(/食|飲|ランチ|ディナー|旨|美味|カレー|ラーメン|カフェ/)) cat = 'food';
  else if (lowerText.match(/注意|危|工事|事故|渋滞/)) cat = 'warn';
  else if (lowerText.match(/遊|楽|ライブ|イベント|祭り/)) cat = 'fun';
  else if (lowerText.match(/綺麗|景色|スポット|公園|花/)) cat = 'spot';
  else if (lowerText.match(/便利|スーパー|病院|生活/)) cat = 'life';

  const [lng, lat] = STATE.composeLngLat;
  const pin = await STATE.store.add({
    lat, lng,
    cat: cat,
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
  const cat = getCategory(p.cat);
  document.getElementById('detailText').textContent = p.text;
  document.getElementById('detailAuthor').textContent = `${cat.emoji} ${cat.label} • ${p.author.slice(0, 8)}`;
  
  const panel = document.querySelector('.detail__panel');
  if (panel) {
      panel.style.borderTop = `8px solid ${cat.color}`;
  }
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
  }, (err) => {
      showToast('現在地を取得できませんでした');
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

function renderTrends() {
  const list = document.getElementById('trendList');
  if (!list) return;
  const hot = STATE.store.hot(10);
  list.innerHTML = hot.map(p => {
    const cat = getCategory(p.cat);
    const timeStr = formatTime(p.ts);
    return `
      <div class="trend-item" onclick="window.dispatchEvent(new CustomEvent('flyToPin', {detail: '${p.id}'}))">
        <div class="trend-item__emoji">${cat.emoji}</div>
        <div class="trend-item__content">
          <div class="trend-item__text">${p.text}</div>
          <div class="trend-item__meta">${cat.label} • ${timeStr} • 🔥 ${Object.values(p.reactions).reduce((a,b)=>a+b,0)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function formatTime(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return Math.floor(diff / 60) + '分前';
  if (diff < 86400) return Math.floor(diff / 3600) + '時間前';
  return Math.floor(diff / 86400) + '日前';
}

window.addEventListener('flyToPin', (e) => {
  const p = STATE.store.get(e.detail);
  if (p) {
    STATE.layer.flyTo(p);
    setTimeout(() => openDetail(p.id), 700);
    document.getElementById('trendPanel').classList.remove('is-open');
  }
});

document.addEventListener('DOMContentLoaded', () => { boot(); });
