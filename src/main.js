import maplibregl from 'maplibre-gl';
import './styles/main.css';
import { getStyleForTheme } from './map/style.js';
import { MarkerLayer } from './map/markers.js';
import { PinStore } from './data/store.js';
import { CATEGORIES, CATS_FOR_COMPOSE, getCategory, suggestCategory } from './data/categories.js';
import { getModerationVerdict, sanitizeText } from './data/moderation.js';
import { checkRateLimit, recordPost, checkReportRateLimit, recordReport } from './data/ratelimit.js';

/* ============================================================
   Pinly main controller v3 — hardened & polished
   ============================================================ */

const REACTION_EMOJIS = ['❤️', '🔥', '😂', '👍', '😮', '🙏', '✨'];
const THEME_KEY = 'pinly.theme';
const INTRO_KEY = 'pinly.introSeen.v2';
const ID_RE     = /^[a-zA-Z0-9_-]{1,64}$/;
const REPORTED_LOCAL_KEY = 'pinly.reported.v1';

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
  userMarker: null,
  theme: 'light',
  reactDebounceTs: 0,
  composeBusy: false,
};

/* ---------------- Boot ---------------- */
async function boot() {
  // Theme (validate stored value)
  const t = localStorage.getItem(THEME_KEY);
  STATE.theme = (t === 'dark' || t === 'light') ? t : (
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );
  applyTheme(STATE.theme);

  STATE.store = new PinStore();
  try {
    await STATE.store.init();
  } catch (err) {
    console.error('[Pinly] init failed:', err);
    showToast('データの読み込みに失敗しました。再読み込みしてください。', 'err');
  }

  initMap();
  initUI();
  initStoreEvents();
  registerSW();

  // Hide boot
  setTimeout(() => {
    const b = document.getElementById('boot');
    if (b) b.classList.add('boot--hide');
    setTimeout(() => { if (b) b.style.display = 'none'; }, 700);
  }, 700);

  // First-run intro
  if (!localStorage.getItem(INTRO_KEY)) {
    setTimeout(() => {
      const intro = document.getElementById('intro');
      if (intro) intro.hidden = false;
    }, 900);
  }

  applyURLState();
}

/* ---------------- Theme ---------------- */
function applyTheme(theme) {
  const safe = (theme === 'dark') ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', safe);
  STATE.theme = safe;
  try { localStorage.setItem(THEME_KEY, safe); } catch {}
  // theme-color metas (light/dark) are kept in HTML; nothing to update.
  if (STATE.map) {
    const center = STATE.map.getCenter();
    const zoom = STATE.map.getZoom();
    STATE.map.setStyle(getStyleForTheme(safe));
    STATE.map.once('styledata', () => {
      STATE.map.jumpTo({ center, zoom });
    });
  }
}

function toggleTheme() {
  applyTheme(STATE.theme === 'dark' ? 'light' : 'dark');
}

/* ---------------- Map ---------------- */
function initMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: getStyleForTheme(STATE.theme),
    center: [139.7005, 35.6595],
    zoom: 14,
    minZoom: 2,
    maxZoom: 19,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
    cooperativeGestures: false,
  });
  STATE.map = map;

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  map.on('load', () => {
    STATE.layer = new MarkerLayer(map, {
      onPinClick: (p) => openDetail(p.id),
      onClusterClick: ({ lat, lng }) => {
        map.flyTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 3, 17), speed: 1.4 });
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

  // Throttled strip updates via requestAnimationFrame
  let stripPending = false;
  const scheduleStrip = () => {
    if (stripPending) return;
    stripPending = true;
    requestAnimationFrame(() => {
      stripPending = false;
      updateStrip();
    });
  };
  map.on('moveend', scheduleStrip);
  map.on('zoomend', scheduleStrip);
}

/* ---------------- UI ---------------- */
function initUI() {
  initCategoryBar();
  initComposeCategorySelector();
  initSearch();
  initAppBarButtons();
  initFAB();
  initComposeForm();
  initDetailButtons();
  initIntro();
  initSidePanels();
  initMenu();
  initMyPins();
  initKeyboardShortcuts();
  initThemeButton();
}

function initCategoryBar() {
  const catbar = document.getElementById('catbar');
  if (!catbar) return;
  catbar.replaceChildren();
  CATEGORIES.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'catbar__btn' + (c.id === 'all' ? ' active' : '');
    b.dataset.cat = c.id;
    b.type = 'button';
    b.setAttribute('aria-pressed', c.id === 'all' ? 'true' : 'false');
    const ico = document.createElement('span');
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = c.emoji;
    const lbl = document.createElement('span');
    lbl.textContent = c.label;
    b.append(ico, lbl);
    b.addEventListener('click', () => {
      STATE.filterCat = c.id;
      catbar.querySelectorAll('.catbar__btn').forEach((el) => {
        const on = el.dataset.cat === c.id;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      refreshActive();
      updateStrip();
    });
    catbar.appendChild(b);
  });
}

function initComposeCategorySelector() {
  const container = document.getElementById('composeCatSelector');
  if (!container) return;
  container.replaceChildren();
  CATS_FOR_COMPOSE.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'catbar__btn' + (c.id === STATE.composeCat ? ' active' : '');
    b.dataset.cat = c.id;
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', c.id === STATE.composeCat ? 'true' : 'false');
    const ico = document.createElement('span');
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = c.emoji;
    const lbl = document.createElement('span');
    lbl.textContent = c.label;
    b.append(ico, lbl);
    b.onclick = () => {
      STATE.composeCat = c.id;
      container.querySelectorAll('.catbar__btn').forEach((el) => {
        const on = el.dataset.cat === c.id;
        el.classList.toggle('active', on);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    };
    container.appendChild(b);
  });
}

function initSearch() {
  const search = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  if (!search) return;
  let timer;
  const updateClearVisibility = () => {
    if (clearBtn) clearBtn.hidden = !search.value;
  };
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      STATE.searchQuery = search.value.slice(0, 80);
      refreshActive();
      updateStrip();
    }, 220);
    updateClearVisibility();
  });
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      search.value = '';
      STATE.searchQuery = '';
      refreshActive();
      updateStrip();
      updateClearVisibility();
      search.focus();
    });
  }
}

function initAppBarButtons() {
  const locateBtn = document.getElementById('locateBtn');
  if (locateBtn) locateBtn.addEventListener('click', locateMe);

  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) menuBtn.addEventListener('click', openMenu);

  const brand = document.getElementById('brandBtn');
  if (brand) brand.addEventListener('click', () => {
    window.location.href = './about.html';
  });
}

function initThemeButton() {
  const btn = document.getElementById('themeBtn');
  if (btn) btn.addEventListener('click', toggleTheme);
}

function initFAB() {
  const fab = document.getElementById('fab');
  if (fab) fab.addEventListener('click', () => {
    if (STATE.composeTargetingMode) {
      confirmTarget();
    } else {
      enterTargetingMode();
    }
  });
}

function initComposeForm() {
  document.querySelectorAll('[data-close-compose]').forEach((el) =>
    el.addEventListener('click', closeCompose));

  const composeText = document.getElementById('composeText');
  const composeCount = document.getElementById('composeCount');
  if (composeText && composeCount) {
    composeText.addEventListener('input', () => {
      const n = composeText.value.length;
      composeCount.textContent = `${n} / 50`;
      composeCount.style.color = n >= 45 ? 'var(--red)' : '';
      // live cat suggestion
      const suggested = suggestCategory(composeText.value, STATE.composeCat);
      if (suggested && suggested !== STATE.composeCat) {
        STATE.composeCat = suggested;
        const container = document.getElementById('composeCatSelector');
        if (container) {
          container.querySelectorAll('.catbar__btn').forEach((el) => {
            const on = el.dataset.cat === suggested;
            el.classList.toggle('active', on);
            el.setAttribute('aria-checked', on ? 'true' : 'false');
          });
        }
      }
    });
  }
  const composeSend = document.getElementById('composeSend');
  if (composeSend) composeSend.addEventListener('click', submitPin);
}

function initDetailButtons() {
  document.querySelectorAll('[data-close-detail]').forEach((el) =>
    el.addEventListener('click', closeDetail));

  const reportBtn = document.getElementById('reportPin');
  if (reportBtn) {
    reportBtn.onclick = handleReport;
  }

  const delBtn = document.getElementById('deleteOwnPin');
  if (delBtn) {
    delBtn.onclick = () => {
      if (!STATE.selectedPinId) return;
      const id = STATE.selectedPinId;
      if (confirm('自分のこの投稿を削除しますか？\nこの操作は取り消せません。')) {
        const ok = STATE.store.removeOwn(id);
        if (ok) {
          STATE.layer && STATE.layer.removePin(id);
          showToast('ピンを削除しました', 'ok');
          closeDetail();
        } else {
          showToast('削除できませんでした', 'err');
        }
      }
    };
  }

  bindShareButtons();
}

function handleReport() {
  if (!STATE.selectedPinId) return;
  const id = STATE.selectedPinId;

  // Already reported by this device? (defense-in-depth UX)
  const already = readReportedLocal();
  if (already.has(id)) {
    showToast('この投稿は既に報告済みです', 'info');
    return;
  }

  const limit = checkReportRateLimit();
  if (!limit.allowed) {
    showToast(limit.reason, 'err');
    return;
  }

  if (!confirm('この投稿を不適切なコンテンツとして報告しますか？\n報告後、すぐに非表示になります。')) return;
  STATE.store.report(id);
  recordReport(id);
  saveReportedLocal(id);
  showToast('報告ありがとうございます。運営が確認します。', 'ok');
  closeDetail();
}

function readReportedLocal() {
  try {
    const arr = JSON.parse(localStorage.getItem(REPORTED_LOCAL_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function saveReportedLocal(id) {
  const s = readReportedLocal();
  s.add(id);
  try { localStorage.setItem(REPORTED_LOCAL_KEY, JSON.stringify(Array.from(s).slice(-500))); } catch {}
}

function bindShareButtons() {
  const shareX = document.getElementById('shareX');
  if (shareX) shareX.onclick = shareToX;
  const shareIg = document.getElementById('shareInstagram');
  if (shareIg) shareIg.onclick = shareToInstagram;
  const shareLine = document.getElementById('shareLine');
  if (shareLine) shareLine.onclick = shareToLine;
  const copyLink = document.getElementById('copyLink');
  if (copyLink) copyLink.onclick = copyShareLink;
}

function initIntro() {
  const introGo = document.getElementById('introGo');
  const agree   = document.getElementById('introAgree');
  if (introGo) {
    introGo.addEventListener('click', () => {
      if (agree && !agree.checked) {
        showToast('利用規約への同意が必要です', 'err');
        return;
      }
      const el = document.getElementById('intro');
      if (el) el.hidden = true;
      try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
    });
  }
}

function initSidePanels() {
  const trendToggle = document.getElementById('trendToggle');
  if (trendToggle) trendToggle.onclick = () => openSidePanel('trendPanel', renderTrends);

  const rankingToggle = document.getElementById('rankingToggle');
  if (rankingToggle) rankingToggle.onclick = () => openSidePanel('rankingPanel', renderRanking);

  document.querySelectorAll('[data-close-panel]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-close-panel');
      const p = document.getElementById(id);
      if (p) {
        p.classList.remove('is-open');
        p.setAttribute('aria-hidden', 'true');
      }
    });
  });
}

function openSidePanel(id, renderer) {
  document.querySelectorAll('.side-panel.is-open').forEach((el) => {
    if (el.id !== id) {
      el.classList.remove('is-open');
      el.setAttribute('aria-hidden', 'true');
    }
  });
  if (renderer) renderer();
  const p = document.getElementById(id);
  if (p) {
    p.classList.add('is-open');
    p.setAttribute('aria-hidden', 'false');
  }
}

function initMenu() {
  document.querySelectorAll('[data-close-menu]').forEach((el) =>
    el.addEventListener('click', closeMenu));

  document.getElementById('menuMyPins')?.addEventListener('click', () => { closeMenu(); openMyPins(); });
  document.getElementById('menuTrend')?.addEventListener('click', () => { closeMenu(); openSidePanel('trendPanel', renderTrends); });
  document.getElementById('menuRanking')?.addEventListener('click', () => { closeMenu(); openSidePanel('rankingPanel', renderRanking); });
  document.getElementById('menuTutorial')?.addEventListener('click', () => {
    closeMenu();
    const intro = document.getElementById('intro');
    if (intro) intro.hidden = false;
  });
  document.getElementById('menuShare')?.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}`;
    const text = 'Pinly — 街の "今" が刺さる地図 📍\n登録不要・匿名・50字でつぶやけます';
    if (navigator.share) {
      navigator.share({ title: 'Pinly', text, url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${text}\n${url}`).then(() => {
        showToast('Pinlyの紹介リンクをコピーしました📣', 'ok');
      }).catch(() => showToast('コピーに失敗しました', 'err'));
    }
    closeMenu();
  });
  document.getElementById('menuClear')?.addEventListener('click', () => {
    if (confirm('ローカルに保存されたデータ（自分のピン・設定）をすべて削除しますか？\nこの操作は取り消せません。')) {
      try { STATE.store && STATE.store.clearLocal(); } catch {}
      try {
        localStorage.removeItem(INTRO_KEY);
        localStorage.removeItem(THEME_KEY);
        localStorage.removeItem('pinly.ratelimit.v2');
        localStorage.removeItem('pinly.ratelimit.reports.v1');
        localStorage.removeItem(REPORTED_LOCAL_KEY);
      } catch {}
      location.reload();
    }
  });
}

function openMenu() {
  const m = document.getElementById('menu');
  if (!m || !STATE.store) return;
  const totals = STATE.store.totals();
  const myReactSum = STATE.store.list()
    .filter((p) => p.author === STATE.store.self.id)
    .reduce((acc, p) => acc + Object.values(p.reactions || {}).reduce((a, b) => a + b, 0), 0);

  const idEl   = document.getElementById('menuUserId');
  const statEl = document.getElementById('menuUserStat');
  if (idEl)   idEl.textContent   = STATE.store.self.id;
  if (statEl) statEl.textContent = `${totals.mine} 投稿 ・ 🔥 ${myReactSum} 反応`;
  m.hidden = false;
}

function closeMenu() {
  const m = document.getElementById('menu');
  if (m) m.hidden = true;
}

function initMyPins() {
  document.querySelectorAll('[data-close-mypins]').forEach((el) =>
    el.addEventListener('click', () => {
      const m = document.getElementById('myPins');
      if (m) m.hidden = true;
    }));
}

function openMyPins() {
  const m = document.getElementById('myPins');
  const list = document.getElementById('myPinsList');
  const count = document.getElementById('myPinsCount');
  if (!m || !list || !STATE.store) return;
  const mine = STATE.store.myPins();
  if (count) count.textContent = `${mine.length} 件`;

  list.replaceChildren();
  if (mine.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'side-panel__empty';
    empty.innerHTML = `<span class="emoji" aria-hidden="true">📭</span>まだ自分のピンはありません<br>＋ ボタンから投稿してみよう`;
    list.appendChild(empty);
  } else {
    mine.forEach((p) => {
      const cat = getCategory(p.cat);
      const wrap = document.createElement('div');
      wrap.className = 'my-pin';
      wrap.dataset.pinId = p.id;

      const emoji = document.createElement('div');
      emoji.className = 'my-pin__emoji';
      emoji.textContent = cat.emoji;

      const body = document.createElement('div');
      body.className = 'my-pin__body';
      const txt = document.createElement('p');
      txt.className = 'my-pin__text';
      txt.textContent = p.text; // textContent is XSS-safe
      const meta = document.createElement('div');
      meta.className = 'my-pin__meta';
      meta.textContent = `${cat.label} ・ ${formatTime(p.ts)}${p.loc ? ' ・ ' + p.loc : ''}`;
      body.append(txt, meta);

      const del = document.createElement('button');
      del.className = 'my-pin__del';
      del.dataset.del = p.id;
      del.type = 'button';
      del.setAttribute('aria-label', '削除');
      del.textContent = '🗑️';

      wrap.append(emoji, body, del);
      list.appendChild(wrap);

      wrap.addEventListener('click', (e) => {
        if (e.target && e.target.closest('[data-del]')) return;
        m.hidden = true;
        const pp = STATE.store.get(p.id);
        if (pp) {
          STATE.layer.flyTo(pp);
          setTimeout(() => openDetail(p.id), 600);
        }
      });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('この投稿を削除しますか？')) {
          STATE.store.removeOwn(p.id);
          STATE.layer && STATE.layer.removePin(p.id);
          openMyPins();
        }
      });
    });
  }
  m.hidden = false;
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const detailEl = document.getElementById('detail');
    const composeEl = document.getElementById('composeSheet');
    const menuEl = document.getElementById('menu');
    const myPinsEl = document.getElementById('myPins');
    if (detailEl && !detailEl.hidden) closeDetail();
    else if (composeEl && !composeEl.hidden) closeCompose();
    else if (menuEl && !menuEl.hidden) closeMenu();
    else if (myPinsEl && !myPinsEl.hidden) myPinsEl.hidden = true;
    else if (STATE.composeTargetingMode) exitTargetingMode();
  });
}

/* ---------------- Service Worker ---------------- */
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      try {
        const swUrl = new URL('./sw.js', document.baseURI).toString();
        const scope = new URL('./', document.baseURI).pathname;
        navigator.serviceWorker.register(swUrl, { scope }).catch(() => {});
      } catch {}
    });
  }
}

/* ---------------- Store events ---------------- */
function initStoreEvents() {
  if (!STATE.store) return;
  STATE.store.addEventListener('add', (e) => {
    refreshActive(e.detail.id);
    updateStrip();
  });
  STATE.store.addEventListener('update', (e) => {
    STATE.layer && STATE.layer.updatePin(e.detail);
    refreshActive();
    updateStrip();
    if (STATE.selectedPinId === e.detail.id) {
      renderDetail(e.detail);
    }
  });
  STATE.store.addEventListener('delete', () => {
    refreshActive();
    updateStrip();
  });
  STATE.store.addEventListener('refresh', () => {
    refreshActive();
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
  if (!STATE.store) return;
  const totals = STATE.store.totals();
  const filtered = STATE.store.filter({ cat: STATE.filterCat, q: STATE.searchQuery });
  let visibleNow = 0;
  if (STATE.map) {
    const b = STATE.map.getBounds();
    visibleNow = filtered.filter((p) =>
      p.lng >= b.getWest() && p.lng <= b.getEast() &&
      p.lat >= b.getSouth() && p.lat <= b.getNorth()
    ).length;
  } else {
    visibleNow = filtered.length;
  }

  const countEl = document.getElementById('stripCount');
  const totalEl = document.getElementById('stripTotal');
  if (countEl) countEl.textContent = formatN(visibleNow);
  if (totalEl) totalEl.textContent = formatN(totals.visible);
}

/* ---------------- Compose ---------------- */
function enterTargetingMode() {
  STATE.composeTargetingMode = true;
  const cross = document.getElementById('targetCross');
  if (cross) cross.hidden = false;
  document.getElementById('fab')?.classList.add('is-targeting');
  showToast('地図を動かして場所を合わせ、決定ボタンを押してね', 'info');
}

function exitTargetingMode() {
  STATE.composeTargetingMode = false;
  const cross = document.getElementById('targetCross');
  if (cross) cross.hidden = true;
  document.getElementById('fab')?.classList.remove('is-targeting');
}

function confirmTarget() {
  if (!STATE.map) return;
  const c = STATE.map.getCenter();
  STATE.composeLngLat = [c.lng, c.lat];
  openCompose();
}

function openCompose() {
  const sheet = document.getElementById('composeSheet');
  if (sheet) sheet.hidden = false;
  const cross = document.getElementById('targetCross');
  if (cross) cross.hidden = true;
  document.getElementById('fab')?.classList.remove('is-targeting');
  STATE.composeTargetingMode = false;

  const text = document.getElementById('composeText');
  if (text) {
    text.value = '';
    const cnt = document.getElementById('composeCount');
    if (cnt) { cnt.textContent = '0 / 50'; cnt.style.color = ''; }
    setTimeout(() => text.focus(), 200);
  }

  const label = document.getElementById('composeLocLabel');
  if (label && STATE.composeLngLat) {
    const [lng, lat] = STATE.composeLngLat;
    label.textContent = `📍 緯度 ${lat.toFixed(4)} / 経度 ${lng.toFixed(4)}`;
  }
}

function closeCompose() {
  const s = document.getElementById('composeSheet');
  if (s) s.hidden = true;
  exitTargetingMode();
}

async function submitPin() {
  if (STATE.composeBusy) return;
  const textEl = document.getElementById('composeText');
  const sendBtn = document.getElementById('composeSend');
  if (!textEl || !sendBtn) return;
  const text = textEl.value.trim();

  // Moderation
  const verdict = await getModerationVerdict(text, true);
  if (verdict.status === 'rejected') {
    showToast(verdict.message, 'err');
    return;
  }
  if (verdict.status === 'warning') {
    if (!confirm(verdict.message)) return;
  }

  if (!confirm('この内容で投稿しますか？\n\n「' + text + '」\n\n※誹謗中傷・個人情報は禁止されています。\n※48時間で自動的に消えます。')) {
    return;
  }

  if (!STATE.composeLngLat || !Array.isArray(STATE.composeLngLat) || STATE.composeLngLat.length !== 2) {
    showToast('場所が指定されていません', 'err');
    return;
  }
  const [lng, lat] = STATE.composeLngLat;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showToast('場所が無効です', 'err');
    return;
  }

  // Rate limit
  const limit = checkRateLimit(lat, lng, STATE.store.self.id);
  if (!limit.allowed) {
    showToast(limit.reason, 'err');
    return;
  }

  STATE.composeBusy = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '投稿中…';

  try {
    const cat = STATE.composeCat || suggestCategory(text, 'misc');
    const pin = STATE.store.add({ lat, lng, cat, text, loc: '' });
    recordPost(lat, lng, STATE.store.self.id);
    closeCompose();
    if (STATE.layer) STATE.layer.flyTo(pin);
    showToast('ピンを刺しました！🎉', 'ok');
  } catch (err) {
    console.error(err);
    showToast('投稿に失敗しました。再度お試しください。', 'err');
  } finally {
    STATE.composeBusy = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '投稿する 🎯';
  }
}

/* ---------------- Detail ---------------- */
function openDetail(id) {
  if (!STATE.store) return;
  const p = STATE.store.get(id);
  if (!p) return;
  STATE.selectedPinId = id;
  renderDetail(p);
  const d = document.getElementById('detail');
  if (d) d.hidden = false;
}

function renderDetail(p) {
  const cat = getCategory(p.cat);
  const reactionCount = Object.values(p.reactions).reduce((a, b) => a + b, 0);

  const titleEl = document.getElementById('detailTitle');
  if (titleEl) titleEl.textContent = p.text; // safe
  const emojiEl = document.getElementById('detailCatEmoji');
  if (emojiEl) emojiEl.textContent = cat.emoji;
  const labelEl = document.getElementById('detailCatLabel');
  if (labelEl) labelEl.textContent = cat.label + (p.official ? ' ・ 公式' : '');
  const metaEl = document.getElementById('detailMeta');
  if (metaEl) metaEl.textContent = `${formatTime(p.ts)}${p.loc ? ' ・ ' + p.loc : ''} ・ 🔥 ${reactionCount}`;

  const panel = document.querySelector('.detail__panel');
  if (panel) panel.style.borderTop = `8px solid ${cat.color}`;

  // Reactions
  const reactionsEl = document.getElementById('detailReactions');
  if (reactionsEl) {
    reactionsEl.replaceChildren();
    const seen = new Set();
    const entries = Object.entries(p.reactions || {})
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    entries.forEach(([emoji, count]) => {
      seen.add(emoji);
      const mine = p.myReactions.includes(emoji);
      reactionsEl.appendChild(buildReactionBtn(p.id, emoji, count, mine, false));
    });
    REACTION_EMOJIS.forEach((emoji) => {
      if (seen.has(emoji)) return;
      const mine = p.myReactions.includes(emoji);
      reactionsEl.appendChild(buildReactionBtn(p.id, emoji, 0, mine, true));
    });
  }

  // Show/hide own delete button
  const delBtn = document.getElementById('deleteOwnPin');
  if (delBtn) delBtn.hidden = !(p.author === STATE.store.self.id);

  // Hide report if already reported
  const reportBtn = document.getElementById('reportPin');
  if (reportBtn) {
    const reported = readReportedLocal();
    reportBtn.hidden = reported.has(p.id);
  }
}

function buildReactionBtn(pinId, emoji, count, mine, isAdd) {
  const btn = document.createElement('button');
  btn.className = 'reaction-btn' + (mine ? ' is-mine' : '') + (isAdd ? ' reaction-btn--add' : '');
  btn.dataset.emoji = emoji;
  btn.type = 'button';
  btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
  btn.setAttribute('aria-label', `リアクション ${emoji}${count > 0 ? ' ' + count + '件' : ''}`);

  const e = document.createElement('span');
  e.textContent = emoji;
  btn.appendChild(e);
  if (count > 0) {
    const c = document.createElement('span');
    c.className = 'reaction-btn__count';
    c.textContent = String(count);
    btn.appendChild(c);
  }
  btn.addEventListener('click', () => {
    // simple debounce — prevent burst tapping
    const now = Date.now();
    if (now - STATE.reactDebounceTs < 250) return;
    STATE.reactDebounceTs = now;
    STATE.store.react(pinId, emoji);
  });
  return btn;
}

function closeDetail() {
  const d = document.getElementById('detail');
  if (d) d.hidden = true;
  STATE.selectedPinId = null;
}

/* ---------------- Share ---------------- */
function buildShareURL(pinId) {
  const u = new URL(location.href);
  u.searchParams.set('pin', pinId);
  u.hash = '';
  return u.toString();
}

function shareToX() {
  const p = STATE.store && STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  const text = `Pinlyで街の"今"を発見！「${p.text}」 #Pinly #街の声`;
  const url = buildShareURL(p.id);
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    '_blank', 'noopener,noreferrer');
}

function shareToInstagram() {
  const p = STATE.store && STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  const text = `Pinlyで街の"今"を発見！「${p.text}」 #Pinly #街の声 ${buildShareURL(p.id)}`;
  copyToClipboard(text)
    .then(() => showToast('IG用テキストをコピーしました 📋', 'ok'))
    .catch(() => showToast('コピーに失敗しました', 'err'));
}

function shareToLine() {
  const p = STATE.store && STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  const text = `Pinlyで街の"今"を発見！「${p.text}」`;
  const url = buildShareURL(p.id);
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text + '\n' + url)}`,
    '_blank', 'noopener,noreferrer');
}

function copyShareLink() {
  if (!STATE.selectedPinId) return;
  const url = buildShareURL(STATE.selectedPinId);
  copyToClipboard(url)
    .then(() => showToast('リンクをコピーしました 🔗', 'ok'))
    .catch(() => showToast('コピーに失敗しました', 'err'));
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    } catch (e) { reject(e); }
  });
}

/* ---------------- Locate ---------------- */
function locateMe() {
  if (!navigator.geolocation) {
    showToast('この端末は位置情報に対応していません', 'err');
    return;
  }
  if (!confirm('現在地周辺のピンを表示するため、位置情報を取得します。\n\n📍 取得した位置はサーバには送信されず、追跡にも使われません。\n\n許可しますか？')) {
    return;
  }
  showToast('現在地を取得中…', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { longitude, latitude } = pos.coords;
      if (!STATE.map) return;
      STATE.map.flyTo({ center: [longitude, latitude], zoom: 15, speed: 1.4 });
      addUserMarker(longitude, latitude);
      showToast('現在地に移動しました 📍', 'ok');
    },
    (err) => {
      const msg = err.code === 1 ? '位置情報の許可が必要です'
        : err.code === 2 ? '位置を取得できません'
        : err.code === 3 ? 'タイムアウトしました'
        : '取得に失敗しました';
      showToast(msg, 'err');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function addUserMarker(lng, lat) {
  if (!STATE.map) return;
  if (STATE.userMarker) STATE.userMarker.remove();
  const el = document.createElement('div');
  el.className = 'user-location-dot';
  STATE.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([lng, lat])
    .addTo(STATE.map);
}

/* ---------------- URL state ---------------- */
function applyURLState() {
  let u;
  try { u = new URL(location.href); } catch { return; }
  const pinId = u.searchParams.get('pin');
  const action = u.searchParams.get('action');

  if (pinId && ID_RE.test(pinId)) {
    if (STATE.map) {
      STATE.map.once('idle', () => {
        const p = STATE.store && STATE.store.get(pinId);
        if (p) {
          STATE.layer.flyTo(p);
          setTimeout(() => openDetail(pinId), 700);
        }
      });
    }
  }

  if (action === 'compose') setTimeout(() => enterTargetingMode(), 1200);
  else if (action === 'trend') setTimeout(() => openSidePanel('trendPanel', renderTrends), 1200);
  else if (action === 'ranking') setTimeout(() => openSidePanel('rankingPanel', renderRanking), 1200);
}

/* ---------------- Util ---------------- */
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast toast--' + (type === 'ok' || type === 'err' ? type : 'info');
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2800);
}

function formatN(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function formatTime(ts) {
  const diff = Math.floor(Date.now() / 1000) - (ts | 0);
  if (diff < 30) return 'たった今';
  if (diff < 60) return diff + '秒前';
  if (diff < 3600) return Math.floor(diff / 60) + '分前';
  if (diff < 86400) return Math.floor(diff / 3600) + '時間前';
  return Math.floor(diff / 86400) + '日前';
}

/** Defense-in-depth — most user-text uses textContent already. */
// eslint-disable-next-line no-unused-vars
function escapeHTML(s) { return sanitizeText(String(s ?? '')); }

/* ---------------- Trend & Ranking ---------------- */
function renderTrends() {
  const list = document.getElementById('trendList');
  if (!list || !STATE.store) return;
  list.replaceChildren();
  const hot = STATE.store.hot(10);
  if (hot.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'side-panel__empty';
    empty.innerHTML = `<span class="emoji" aria-hidden="true">🌱</span>まだ盛り上がってるピンはありません<br>あなたが第一号になろう`;
    list.appendChild(empty);
    return;
  }
  hot.forEach((p) => {
    const cat = getCategory(p.cat);
    const reactionCount = Object.values(p.reactions).reduce((a, b) => a + b, 0);

    const wrap = document.createElement('div');
    wrap.className = 'trend-item';
    wrap.dataset.pin = p.id;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');

    const e = document.createElement('div');
    e.className = 'trend-item__emoji';
    e.textContent = cat.emoji;

    const c = document.createElement('div');
    c.className = 'trend-item__content';
    const t = document.createElement('div');
    t.className = 'trend-item__text';
    t.textContent = p.text;
    const m = document.createElement('div');
    m.className = 'trend-item__meta';
    m.textContent = `${cat.label} ・ ${formatTime(p.ts)} ・ 🔥 ${reactionCount}`;
    c.append(t, m);

    wrap.append(e, c);
    list.appendChild(wrap);

    const open = () => {
      const pp = STATE.store.get(p.id);
      if (!pp) return;
      STATE.layer.flyTo(pp);
      setTimeout(() => openDetail(p.id), 600);
      const trendPanel = document.getElementById('trendPanel');
      if (trendPanel) {
        trendPanel.classList.remove('is-open');
        trendPanel.setAttribute('aria-hidden', 'true');
      }
    };
    wrap.addEventListener('click', open);
    wrap.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });
  });
}

function renderRanking() {
  const list = document.getElementById('rankingList');
  if (!list || !STATE.store) return;
  list.replaceChildren();

  const userStats = new Map();
  STATE.store.list().forEach((p) => {
    if (p._reported || p._hidden) return;
    if (!userStats.has(p.author)) {
      userStats.set(p.author, { author: p.author, posts: 0, reactions: 0, badge: '' });
    }
    const stat = userStats.get(p.author);
    stat.posts += 1;
    stat.reactions += Object.values(p.reactions).reduce((a, b) => a + b, 0);
  });

  const sorted = Array.from(userStats.values())
    .sort((a, b) => (b.reactions * 2 + b.posts) - (a.reactions * 2 + a.posts))
    .slice(0, 15);

  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'side-panel__empty';
    empty.innerHTML = `<span class="emoji" aria-hidden="true">🏅</span>まだランキングはありません`;
    list.appendChild(empty);
    return;
  }

  sorted.forEach((stat, idx) => {
    if (idx === 0) stat.badge = '🥇';
    else if (idx === 1) stat.badge = '🥈';
    else if (idx === 2) stat.badge = '🥉';
    else if (stat.posts >= 10) stat.badge = '⭐';
    else if (stat.reactions >= 20) stat.badge = '🔥';
    else stat.badge = '📍';
  });

  const me = STATE.store.self.id;
  sorted.forEach((stat, idx) => {
    const display = stat.author === me ? `${stat.author} (あなた)`
      : stat.author === 'PinlyOfficial' ? '🌟 Pinly公式'
      : stat.author;

    const wrap = document.createElement('div');
    wrap.className = 'ranking-item';

    const rank = document.createElement('div');
    rank.className = 'ranking-item__rank';
    rank.textContent = '#' + (idx + 1);

    const badge = document.createElement('div');
    badge.className = 'ranking-item__badge';
    badge.textContent = stat.badge;

    const content = document.createElement('div');
    content.className = 'ranking-item__content';
    const a = document.createElement('div');
    a.className = 'ranking-item__author';
    a.textContent = display;
    const s = document.createElement('div');
    s.className = 'ranking-item__stats';
    s.textContent = `投稿 ${stat.posts} ・ 🔥 ${stat.reactions}`;
    content.append(a, s);

    wrap.append(rank, badge, content);
    list.appendChild(wrap);
  });
}

/* ---------------- Boot ---------------- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
