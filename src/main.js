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
    b.classList.add('boot--hide');
    setTimeout(() => { b.hidden = true; }, 500);
  }, 900);

  // First-run intro
  if (!localStorage.getItem('pinly.introSeen')) {
    setTimeout(() => {
      document.getElementById('intro').hidden = false;
    }, 1100);
  }

  // Sync URL deep-link if present
  applyURLState();
}

/* ---------------- Map ---------------- */
function initMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: DARK_STYLE,
    center: [139.7005, 35.6595],   // Shibuya as default
    zoom: 13,
    minZoom: 2,
    maxZoom: 19,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
  });
  STATE.map = map;
  map.addControl(new maplibregl.AttributionControl({ compact: true }));

  map.on('load', () => {
    STATE.layer = new MarkerLayer(map, {
      onPinClick: (p) => openDetail(p.id),
      onClusterClick: ({ lat, lng }) => {
        map.flyTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 17), speed: 1.5 });
      },
    });
    refreshActive();
    updateStrip();
  });

  // Tap / click on map to enter compose if targeting mode
  map.on('click', (e) => {
    if (STATE.composeTargetingMode) {
      STATE.composeLngLat = [e.lngLat.lng, e.lngLat.lat];
      openCompose();
    }
  });

  // Update strip people-count when zooming
  map.on('moveend', () => updateStrip());
}

/* ---------------- UI ---------------- */
function initUI() {
  // Category bar
  const catbar = document.getElementById('catbar');
  CATEGORIES.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'catbar__btn' + (c.id === 'all' ? ' active' : '');
    b.dataset.cat = c.id;
    b.innerHTML = c.id === 'all'
      ? `<span class="dot" style="background:${c.color}"></span><span>${c.label}</span>`
      : `<span style="font-size:14px">${c.emoji}</span><span>${c.label}</span>`;
    b.addEventListener('click', () => {
      STATE.filterCat = c.id;
      catbar.querySelectorAll('.catbar__btn').forEach((el) => el.classList.toggle('active', el.dataset.cat === c.id));
      refreshActive();
    });
    catbar.appendChild(b);
  });

  // Search
  const search = document.getElementById('searchInput');
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      STATE.searchQuery = search.value;
      refreshActive();
    }, 220);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = search.value.trim();
      if (q) tryGeocode(q);
    }
  });

  // Trending
  const trendBtn = document.getElementById('trendingBtn');
  const trend = document.getElementById('trend');
  trendBtn.addEventListener('click', () => { trend.hidden = !trend.hidden; if (!trend.hidden) renderTrend('hot'); });
  document.querySelectorAll('[data-close-trend]').forEach((el) => el.addEventListener('click', () => { trend.hidden = true; }));
  let trendTab = 'hot';
  document.querySelectorAll('.trend__tab').forEach((b) => {
    b.addEventListener('click', () => {
      trendTab = b.dataset.tab;
      document.querySelectorAll('.trend__tab').forEach((el) => el.classList.toggle('active', el === b));
      renderTrend(trendTab);
    });
  });

  // Locate
  document.getElementById('locateBtn').addEventListener('click', locateMe);

  // New pin (FAB + appbar +)
  const enterCompose = () => enterTargetingMode();
  document.getElementById('newPinBtn').addEventListener('click', enterCompose);
  document.getElementById('fab').addEventListener('click', enterCompose);

  // Compose sheet
  const composeSheet = document.getElementById('composeSheet');
  document.querySelectorAll('[data-close-compose]').forEach((el) => el.addEventListener('click', closeCompose));
  const composeText = document.getElementById('composeText');
  const composeCount = document.getElementById('composeCount');
  composeText.addEventListener('input', () => {
    const n = composeText.value.length;
    composeCount.textContent = `${n} / 50`;
    composeCount.classList.toggle('warn', n >= 40 && n < 50);
    composeCount.classList.toggle('over', n >= 50);
  });
  document.getElementById('composeSend').addEventListener('click', submitPin);

  // Compose category buttons
  const composeCats = document.getElementById('composeCats');
  composeCats.innerHTML = '';
  CATS_FOR_COMPOSE.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'compose__cat' + (c.id === STATE.composeCat ? ' active' : '');
    b.dataset.cat = c.id;
    b.style.setProperty('--cat', c.color);
    b.innerHTML = `<span style="font-size:14px">${c.emoji}</span><span>${c.label}</span>`;
    b.addEventListener('click', () => {
      STATE.composeCat = c.id;
      composeCats.querySelectorAll('.compose__cat').forEach((el) => {
        const cat = getCategory(el.dataset.cat);
        const active = el.dataset.cat === c.id;
        el.classList.toggle('active', active);
        el.style.background = active ? cat.color : '';
        el.style.color = active ? '#0a0d14' : '';
      });
    });
    composeCats.appendChild(b);
  });
  // initial styling
  setTimeout(() => composeCats.querySelector('.compose__cat.active')?.click(), 0);

  // Detail
  document.querySelectorAll('[data-close-detail]').forEach((el) => el.addEventListener('click', closeDetail));
  document.getElementById('detailShare').addEventListener('click', shareCurrent);
  document.getElementById('detailReport').addEventListener('click', reportCurrent);

  // Pro modal
  const proBtn = document.getElementById('proBtn');
  const pro = document.getElementById('pro');
  proBtn.addEventListener('click', () => { pro.hidden = false; });
  document.querySelectorAll('[data-close-pro]').forEach((el) => el.addEventListener('click', () => { pro.hidden = true; }));
  document.getElementById('proWaitlist').addEventListener('click', () => {
    pro.hidden = true;
    showToast('登録ありがとう！公開時に通知します。');
  });

  // Intro
  document.getElementById('introGo').addEventListener('click', () => {
    document.getElementById('intro').hidden = true;
    localStorage.setItem('pinly.introSeen', '1');
  });

  // Esc handlers
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('detail').hidden) closeDetail();
    else if (!document.getElementById('composeSheet').hidden) closeCompose();
    else if (!document.getElementById('pro').hidden) document.getElementById('pro').hidden = true;
    else if (!document.getElementById('trend').hidden) document.getElementById('trend').hidden = true;
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
    if (STATE.selectedPinId === e.detail.id) renderDetail(e.detail);
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
  document.getElementById('stripCount').textContent = formatN(all.length);
  // Estimate "people here" from unique authors recently active in viewport
  let people = 0;
  if (STATE.map) {
    const b = STATE.map.getBounds();
    const seen = new Set();
    const now = Math.floor(Date.now() / 1000);
    for (const p of all) {
      if (p.lat < b.getSouth() || p.lat > b.getNorth()) continue;
      if (p.lng < b.getWest()  || p.lng > b.getEast())  continue;
      if (now - p.ts > 86400 * 7) continue;
      seen.add(p.author);
    }
    // Add a small "live" baseline for nicer UX
    people = seen.size + Math.floor(3 + Math.random() * 6);
  }
  document.getElementById('stripPeople').textContent = formatN(people);
}

/* ---------------- Compose ---------------- */
function enterTargetingMode() {
  STATE.composeTargetingMode = true;
  document.getElementById('targetCross').hidden = false;
  document.getElementById('fab').classList.add('is-targeting');
  showToast('地図を動かして場所を合わせ、タップで決定');
  // Tap-to-decide via center: clicking the FAB confirms
  // Re-bind FAB to confirm in targeting mode
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
  // reset
  document.getElementById('composeText').value = '';
  document.getElementById('composeCount').textContent = '0 / 50';
  document.getElementById('composeCount').classList.remove('warn', 'over');
  setTimeout(() => document.getElementById('composeText').focus(), 200);

  // Try a reverse-geocode to show a friendly location
  const [lng, lat] = STATE.composeLngLat || [STATE.map.getCenter().lng, STATE.map.getCenter().lat];
  document.getElementById('composeLoc').textContent =
    `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)} （タップ位置）`;
  reverseGeocode(lat, lng).then((label) => {
    if (label) document.getElementById('composeLoc').textContent = `📍 ${label}`;
  });
}

function closeCompose() {
  document.getElementById('composeSheet').hidden = true;
  // Re-arm FAB to enter targeting next time
  const fab = document.getElementById('fab');
  fab.onclick = enterTargetingMode;
}

function submitPin() {
  const text = document.getElementById('composeText').value.trim();
  if (!text) { showToast('ひとことを入力してね'); return; }
  if (text.length > 50) { showToast('50字以内にしてね'); return; }
  const [lng, lat] = STATE.composeLngLat || [STATE.map.getCenter().lng, STATE.map.getCenter().lat];
  const loc = document.getElementById('composeLoc').textContent.replace(/^📍\s*/, '').replace(/\s*（タップ位置）$/, '');

  const pin = STATE.store.add({ lat, lng, cat: STATE.composeCat, text, loc });
  closeCompose();
  STATE.layer.flyTo(pin);
  setTimeout(() => openDetail(pin.id), 700);
  showToast('ピン、刺さった。');
}

/* ---------------- Detail ---------------- */
function openDetail(id) {
  const p = STATE.store.get(id);
  if (!p) return;
  STATE.selectedPinId = id;
  renderDetail(p);
  document.getElementById('detail').hidden = false;
  // Update URL share-state
  const url = new URL(location.href);
  url.searchParams.set('pin', id);
  history.replaceState(null, '', url.toString());
}

function closeDetail() {
  document.getElementById('detail').hidden = true;
  STATE.selectedPinId = null;
  const url = new URL(location.href);
  url.searchParams.delete('pin');
  history.replaceState(null, '', url.toString());
}

function renderDetail(p) {
  const cat = getCategory(p.cat);
  document.getElementById('detailCat').textContent = cat.emoji;
  document.getElementById('detailCat').style.background = `${cat.color}22`;
  document.getElementById('detailAuthor').textContent = p.official ? '公式ピン ✓' : '匿名のだれか';
  document.getElementById('detailWhen').textContent = relTime(p.ts);
  document.getElementById('detailText').textContent = p.text;
  document.getElementById('detailLoc').innerHTML =
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>` +
    ` ${p.loc || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}`;

  // Reactions
  const REACTIONS = ['🔥', '💯', '😂', '✨', '🤔', '⚠️'];
  const wrap = document.getElementById('detailReactions');
  wrap.innerHTML = '';
  REACTIONS.forEach((emoji) => {
    const count = p.reactions[emoji] || 0;
    const mine = p.myReactions.includes(emoji);
    const b = document.createElement('button');
    b.className = 'reaction' + (mine ? ' active' : '');
    b.innerHTML = `<span>${emoji}</span>${count > 0 ? `<span class="reaction__count">${count}</span>` : ''}`;
    b.addEventListener('click', () => {
      STATE.store.react(p.id, emoji);
    });
    wrap.appendChild(b);
  });
}

function shareCurrent() {
  const p = STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  const url = new URL(location.href);
  url.searchParams.set('pin', p.id);
  const shareText = `「${p.text}」 — ${p.loc || ''} #Pinly`;
  if (navigator.share) {
    navigator.share({ title: 'Pinly', text: shareText, url: url.toString() }).catch(() => {});
  } else {
    navigator.clipboard.writeText(`${shareText}\n${url.toString()}`).then(() => showToast('リンクをコピーしました'));
  }
}

function reportCurrent() {
  const p = STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  STATE.store.report(p.id);
  showToast('通報を受け付けました。確認します。');
  closeDetail();
}

/* ---------------- Trending panel ---------------- */
function renderTrend(tab) {
  const list = document.getElementById('trendList');
  list.innerHTML = '';
  let items = [];
  if (tab === 'hot') items = STATE.store.hot(30);
  else if (tab === 'new') items = STATE.store.newest(30);
  else if (tab === 'spots') items = STATE.store.spots(20);

  if (!items.length) {
    list.innerHTML = `<div class="trend__empty">まだピンがありません。<br/>最初のひとことを刺してみよう。</div>`;
    return;
  }

  if (tab === 'spots') {
    items.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'trend__item';
      item.innerHTML = `
        <div class="trend__row">
          <div class="trend__cat" style="background:rgba(255,46,109,.15)">📍</div>
          <span style="font-weight:600;color:var(--text)">${escapeHTML(s.loc || 'ホットスポット')}</span>
          <span style="margin-left:auto">${s.count} ピン</span>
        </div>
        <div class="trend__text">${s.samples.slice(0, 2).map((x) => escapeHTML(x.text)).join(' · ')}</div>
        <div class="trend__loc">合計リアクション ${s.reactions}</div>
      `;
      item.addEventListener('click', () => {
        STATE.map.flyTo({ center: [s.lng, s.lat], zoom: 15, speed: 1.4 });
        document.getElementById('trend').hidden = true;
      });
      list.appendChild(item);
    });
    return;
  }

  items.forEach((p) => {
    const cat = getCategory(p.cat);
    const reacts = Object.entries(p.reactions || {});
    const item = document.createElement('div');
    item.className = 'trend__item';
    item.innerHTML = `
      <div class="trend__row">
        <div class="trend__cat" style="background:${cat.color}22">${cat.emoji}</div>
        <span>${cat.label}</span>
        <span style="margin-left:auto">${relTime(p.ts)}</span>
      </div>
      <div class="trend__text">${escapeHTML(p.text)}</div>
      <div class="trend__loc">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        ${escapeHTML(p.loc || `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`)}
      </div>
      ${reacts.length ? `<div class="trend__reactions">${reacts.slice(0, 4).map(([e, n]) => `<span>${e} ${n}</span>`).join('')}</div>` : ''}
    `;
    item.addEventListener('click', () => {
      STATE.map.flyTo({ center: [p.lng, p.lat], zoom: 15, speed: 1.4 });
      document.getElementById('trend').hidden = true;
      setTimeout(() => openDetail(p.id), 600);
    });
    list.appendChild(item);
  });
}

/* ---------------- Locate me ---------------- */
function locateMe() {
  if (!navigator.geolocation) { showToast('位置情報が使えない端末です'); return; }
  showToast('現在地を取得中…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      STATE.userLocation = { lat: latitude, lng: longitude };
      STATE.map.flyTo({ center: [longitude, latitude], zoom: 15, speed: 1.4 });
      placeUserMarker();
      showToast('現在地を表示中');
    },
    () => showToast('現在地が取得できませんでした'),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

function placeUserMarker() {
  if (!STATE.userLocation) return;
  if (STATE.userMarker) { STATE.userMarker.remove(); STATE.userMarker = null; }
  const el = document.createElement('div');
  el.className = 'pinly-user';
  STATE.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([STATE.userLocation.lng, STATE.userLocation.lat])
    .addTo(STATE.map);
}

/* ---------------- Geocoding ---------------- */
async function tryGeocode(q) {
  // Use Nominatim's free public API (low rate limit, OK for sparse user use)
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'ja' } });
    if (!r.ok) return;
    const arr = await r.json();
    if (arr && arr[0]) {
      const { lat, lon, display_name } = arr[0];
      STATE.map.flyTo({ center: [+lon, +lat], zoom: 14, speed: 1.4 });
      showToast(`📍 ${display_name.split(',')[0]}`);
    } else {
      showToast('場所が見つかりませんでした');
    }
  } catch {
    showToast('検索に失敗しました');
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'ja' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.display_name) {
      // Use the most local part for clarity
      return j.name || j.display_name.split(',').slice(0, 2).join(', ');
    }
  } catch {}
  return null;
}

/* ---------------- URL deep-link ---------------- */
function applyURLState() {
  const u = new URL(location.href);
  const pinId = u.searchParams.get('pin');
  const q = u.searchParams.get('q');
  const center = u.searchParams.get('c');   // "lat,lng,zoom"
  if (center) {
    const [lat, lng, zoom] = center.split(',').map(Number);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      STATE.map.once('load', () => {
        STATE.map.jumpTo({ center: [lng, lat], zoom: Number.isFinite(zoom) ? zoom : 14 });
      });
    }
  }
  if (q) {
    document.getElementById('searchInput').value = q;
    STATE.searchQuery = q;
  }
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
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2400);
}
function relTime(tsSec) {
  const diff = Math.floor(Date.now() / 1000) - tsSec;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}日前`;
  const d = new Date(tsSec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function formatN(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- Go ---------------- */
document.addEventListener('DOMContentLoaded', () => { boot(); });
