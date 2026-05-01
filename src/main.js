import maplibregl from 'maplibre-gl';
import { getStyleForTheme } from './map/style.js';
import { MarkerLayer } from './map/markers.js';
import { PinStore } from './data/store.js';
import { CATEGORIES, CATS_FOR_COMPOSE, getCategory, suggestCategory } from './data/categories.js';
import { getModerationVerdict, sanitizeText } from './data/moderation.js';
import { checkRateLimit, recordPost } from './data/ratelimit.js';

/* ============================================================
   Pinly main controller v2
   ============================================================ */

const REACTION_EMOJIS = ['❤️', '🔥', '😂', '👍', '😮', '🙏', '✨'];
const THEME_KEY = 'pinly.theme';
const INTRO_KEY = 'pinly.introSeen.v2';

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
};

/* ---------------- Boot ---------------- */
async function boot() {
  // Theme
  STATE.theme = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(STATE.theme);

  STATE.store = new PinStore();
  await STATE.store.init();

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
  document.documentElement.setAttribute('data-theme', theme);
  STATE.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#1a1422' : '#ff6b9d');
  // If map exists, swap style preserving viewport
  if (STATE.map) {
    const center = STATE.map.getCenter();
    const zoom = STATE.map.getZoom();
    STATE.map.setStyle(getStyleForTheme(theme));
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

  // Live "ピン表示中" count for current viewport
  map.on('moveend', updateStrip);
  map.on('zoomend', updateStrip);
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
  catbar.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'catbar__btn' + (c.id === 'all' ? ' active' : '');
    b.dataset.cat = c.id;
    b.type = 'button';
    b.setAttribute('aria-pressed', c.id === 'all' ? 'true' : 'false');
    b.innerHTML = `<span aria-hidden="true">${c.emoji}</span><span>${c.label}</span>`;
    b.addEventListener('click', () => {
      STATE.filterCat = c.id;
      catbar.querySelectorAll('.catbar__btn').forEach((el) => {
        const on = el.dataset.cat === c.id;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      refreshActive();
    });
    catbar.appendChild(b);
  });
}

function initComposeCategorySelector() {
  const container = document.getElementById('composeCatSelector');
  if (!container) return;
  container.innerHTML = '';
  CATS_FOR_COMPOSE.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'catbar__btn' + (c.id === STATE.composeCat ? ' active' : '');
    b.dataset.cat = c.id;
    b.type = 'button';
    b.innerHTML = `<span aria-hidden="true">${c.emoji}</span><span>${c.label}</span>`;
    b.onclick = () => {
      STATE.composeCat = c.id;
      container.querySelectorAll('.catbar__btn').forEach((el) =>
        el.classList.toggle('active', el.dataset.cat === c.id));
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
      STATE.searchQuery = search.value;
      refreshActive();
    }, 200);
    updateClearVisibility();
  });
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      search.value = '';
      STATE.searchQuery = '';
      refreshActive();
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
          container.querySelectorAll('.catbar__btn').forEach((el) =>
            el.classList.toggle('active', el.dataset.cat === suggested));
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
    reportBtn.onclick = () => {
      if (!STATE.selectedPinId) return;
      if (confirm('この投稿を不適切なコンテンツとして報告しますか？\n報告後、すぐに非表示になります。')) {
        STATE.store.report(STATE.selectedPinId);
        showToast('報告ありがとうございます。運営が確認します。', 'ok');
        closeDetail();
      }
    };
  }

  const delBtn = document.getElementById('deleteOwnPin');
  if (delBtn) {
    delBtn.onclick = () => {
      if (!STATE.selectedPinId) return;
      if (confirm('自分のこの投稿を削除しますか？\nこの操作は取り消せません。')) {
        const ok = STATE.store.removeOwn(STATE.selectedPinId);
        if (ok) {
          STATE.layer && STATE.layer.removePin(STATE.selectedPinId);
          showToast('ピンを削除しました', 'ok');
          closeDetail();
        }
      }
    };
  }

  bindShareButtons();
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
      localStorage.setItem(INTRO_KEY, '1');
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
      if (p) p.classList.remove('is-open');
    });
  });
}

function openSidePanel(id, renderer) {
  // close all open panels first
  document.querySelectorAll('.side-panel.is-open').forEach((el) => {
    if (el.id !== id) el.classList.remove('is-open');
  });
  if (renderer) renderer();
  const p = document.getElementById(id);
  if (p) p.classList.add('is-open');
}

function initMenu() {
  document.querySelectorAll('[data-close-menu]').forEach((el) =>
    el.addEventListener('click', closeMenu));

  document.getElementById('menuMyPins')?.addEventListener('click', () => {
    closeMenu();
    openMyPins();
  });
  document.getElementById('menuTrend')?.addEventListener('click', () => {
    closeMenu();
    openSidePanel('trendPanel', renderTrends);
  });
  document.getElementById('menuRanking')?.addEventListener('click', () => {
    closeMenu();
    openSidePanel('rankingPanel', renderRanking);
  });
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
    } else {
      navigator.clipboard.writeText(`${text}\n${url}`).then(() => {
        showToast('Pinlyの紹介リンクをコピーしました📣', 'ok');
      });
    }
    closeMenu();
  });
  document.getElementById('menuClear')?.addEventListener('click', () => {
    if (confirm('ローカルに保存されたデータ（自分のピン・設定）をすべて削除しますか？\nこの操作は取り消せません。')) {
      STATE.store.clearLocal();
      try {
        localStorage.removeItem(INTRO_KEY);
        localStorage.removeItem(THEME_KEY);
        localStorage.removeItem('pinly.ratelimit.v2');
      } catch {}
      location.reload();
    }
  });
}

function openMenu() {
  const m = document.getElementById('menu');
  if (!m) return;
  // Update user info
  const totals = STATE.store.totals();
  const myReactSum = STATE.store.list()
    .filter((p) => p.author === STATE.store.self.id)
    .reduce((acc, p) => acc + Object.values(p.reactions || {}).reduce((a, b) => a + b, 0), 0);

  document.getElementById('menuUserId').textContent = STATE.store.self.id;
  document.getElementById('menuUserStat').textContent = `${totals.mine} 投稿 ・ 🔥 ${myReactSum} 反応`;
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
  if (!m || !list) return;
  const mine = STATE.store.myPins();
  count.textContent = `${mine.length} 件`;
  if (mine.length === 0) {
    list.innerHTML = `
      <div class="side-panel__empty">
        <span class="emoji">📭</span>
        まだ自分のピンはありません<br>＋ ボタンから投稿してみよう
      </div>`;
  } else {
    list.innerHTML = mine.map((p) => {
      const cat = getCategory(p.cat);
      return `
        <div class="my-pin" data-pin-id="${p.id}">
          <div class="my-pin__emoji">${cat.emoji}</div>
          <div class="my-pin__body">
            <p class="my-pin__text">${escapeHTML(p.text)}</p>
            <div class="my-pin__meta">${cat.label} ・ ${formatTime(p.ts)} ・ ${escapeHTML(p.loc || '')}</div>
          </div>
          <button class="my-pin__del" data-del="${p.id}" aria-label="削除">🗑️</button>
        </div>`;
    }).join('');

    list.querySelectorAll('.my-pin').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target && e.target.closest('[data-del]')) return;
        const id = el.dataset.pinId;
        m.hidden = true;
        const p = STATE.store.get(id);
        if (p) {
          STATE.layer.flyTo(p);
          setTimeout(() => openDetail(id), 600);
        }
      });
    });
    list.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.del;
        if (confirm('この投稿を削除しますか？')) {
          STATE.store.removeOwn(id);
          STATE.layer && STATE.layer.removePin(id);
          openMyPins(); // re-render
        }
      });
    });
  }
  m.hidden = false;
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('detail').hidden) closeDetail();
    else if (!document.getElementById('composeSheet').hidden) closeCompose();
    else if (!document.getElementById('menu').hidden) closeMenu();
    else if (!document.getElementById('myPins').hidden) document.getElementById('myPins').hidden = true;
    else if (STATE.composeTargetingMode) exitTargetingMode();
  });
}

/* ---------------- Service Worker ---------------- */
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = new URL('./sw.js', document.baseURI).toString();
      const scope = new URL('./', document.baseURI).pathname;
      navigator.serviceWorker.register(swUrl, { scope }).catch(() => {});
    });
  }
}

/* ---------------- Store events ---------------- */
function initStoreEvents() {
  STATE.store.addEventListener('add', (e) => {
    refreshActive(e.detail.id);
    updateStrip();
  });
  STATE.store.addEventListener('update', (e) => {
    STATE.layer && STATE.layer.updatePin(e.detail);
    refreshActive();
    updateStrip();
    // If detail panel is showing this pin, refresh reactions
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
  const totals = STATE.store.totals();
  const filtered = STATE.store.filter({ cat: STATE.filterCat, q: STATE.searchQuery });
  // Within current viewport
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
  document.getElementById('targetCross').hidden = false;
  document.getElementById('fab').classList.add('is-targeting');
  showToast('地図を動かして場所を合わせ、決定ボタンを押してね', 'info');
}

function exitTargetingMode() {
  STATE.composeTargetingMode = false;
  const cross = document.getElementById('targetCross');
  if (cross) cross.hidden = true;
  document.getElementById('fab').classList.remove('is-targeting');
}

function confirmTarget() {
  const c = STATE.map.getCenter();
  STATE.composeLngLat = [c.lng, c.lat];
  openCompose();
}

function openCompose() {
  document.getElementById('composeSheet').hidden = false;
  document.getElementById('targetCross').hidden = true;
  document.getElementById('fab').classList.remove('is-targeting');
  STATE.composeTargetingMode = false;

  const text = document.getElementById('composeText');
  if (text) {
    text.value = '';
    document.getElementById('composeCount').textContent = '0 / 50';
    setTimeout(() => text.focus(), 200);
  }

  // Show coordinates label
  const label = document.getElementById('composeLocLabel');
  if (label && STATE.composeLngLat) {
    const [lng, lat] = STATE.composeLngLat;
    label.textContent = `📍 緯度 ${lat.toFixed(4)} / 経度 ${lng.toFixed(4)}`;
  }
}

function closeCompose() {
  document.getElementById('composeSheet').hidden = true;
  exitTargetingMode();
}

async function submitPin() {
  const textEl = document.getElementById('composeText');
  const sendBtn = document.getElementById('composeSend');
  if (!textEl || !sendBtn) return;
  const text = textEl.value.trim();

  // Moderation
  const verdict = getModerationVerdict(text);
  if (verdict.status === 'rejected') {
    showToast(verdict.message, 'err');
    return;
  }
  if (verdict.status === 'warning') {
    if (!confirm(verdict.message)) return;
  }

  // Final user confirm (荒らし対策)
  if (!confirm('この内容で投稿しますか？\n\n「' + text + '」\n\n※誹謗中傷・個人情報は禁止されています。\n※48時間で自動的に消えます。')) {
    return;
  }

  if (!STATE.composeLngLat) {
    showToast('場所が指定されていません', 'err');
    return;
  }
  const [lng, lat] = STATE.composeLngLat;

  // Rate limit
  const limit = checkRateLimit(lat, lng, STATE.store.self.id);
  if (!limit.allowed) {
    showToast(limit.reason, 'err');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = '投稿中…';

  try {
    const cat = STATE.composeCat || suggestCategory(text, 'misc');
    const pin = STATE.store.add({ lat, lng, cat, text, loc: '' });
    recordPost(lat, lng, STATE.store.self.id);
    closeCompose();
    STATE.layer.flyTo(pin);
    showToast('ピンを刺しました！🎉', 'ok');
  } catch (err) {
    console.error(err);
    showToast('投稿に失敗しました。再度お試しください。', 'err');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = '投稿する 🎯';
  }
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
  const reactionCount = Object.values(p.reactions).reduce((a, b) => a + b, 0);

  document.getElementById('detailTitle').textContent = p.text;
  document.getElementById('detailCatEmoji').textContent = cat.emoji;
  document.getElementById('detailCatLabel').textContent = cat.label
    + (p.official ? ' ・ 公式' : '');
  document.getElementById('detailMeta').textContent =
    `${formatTime(p.ts)} ・ ${p.loc ? p.loc + ' ・ ' : ''}🔥 ${reactionCount}`;

  const panel = document.querySelector('.detail__panel');
  if (panel) {
    panel.style.borderTop = `8px solid ${cat.color}`;
  }

  // Reactions UI
  const reactionsEl = document.getElementById('detailReactions');
  if (reactionsEl) {
    const seen = new Set();
    // Show existing reactions first (sorted by count desc)
    const entries = Object.entries(p.reactions || {})
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    let html = '';
    entries.forEach(([emoji, count]) => {
      seen.add(emoji);
      const mine = p.myReactions.includes(emoji);
      html += `<button class="reaction-btn ${mine ? 'is-mine' : ''}" data-emoji="${emoji}" type="button">
        <span>${emoji}</span><span class="reaction-btn__count">${count}</span>
      </button>`;
    });
    // Show common emojis not already used
    REACTION_EMOJIS.forEach((emoji) => {
      if (seen.has(emoji)) return;
      const mine = p.myReactions.includes(emoji);
      html += `<button class="reaction-btn ${mine ? 'is-mine' : ''} reaction-btn--add" data-emoji="${emoji}" type="button">
        <span>${emoji}</span>
      </button>`;
    });
    reactionsEl.innerHTML = html;
    reactionsEl.querySelectorAll('.reaction-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        STATE.store.react(p.id, btn.dataset.emoji);
      });
    });
  }

  // Show / hide own delete
  const delBtn = document.getElementById('deleteOwnPin');
  if (delBtn) {
    delBtn.hidden = !(p.author === STATE.store.self.id);
  }
}

function closeDetail() {
  document.getElementById('detail').hidden = true;
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
  const p = STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  const text = `Pinlyで街の"今"を発見！「${p.text}」 #Pinly #街の声`;
  const url = buildShareURL(p.id);
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    '_blank', 'noopener');
}

function shareToInstagram() {
  const p = STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  const text = `Pinlyで街の"今"を発見！「${p.text}」 #Pinly #街の声 ${buildShareURL(p.id)}`;
  navigator.clipboard.writeText(text).then(() => {
    showToast('IG用テキストをコピーしました 📋', 'ok');
  }).catch(() => showToast('コピーに失敗しました', 'err'));
}

function shareToLine() {
  const p = STATE.store.get(STATE.selectedPinId);
  if (!p) return;
  const text = `Pinlyで街の"今"を発見！「${p.text}」`;
  const url = buildShareURL(p.id);
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text + '\n' + url)}`,
    '_blank', 'noopener');
}

function copyShareLink() {
  if (!STATE.selectedPinId) return;
  const url = buildShareURL(STATE.selectedPinId);
  navigator.clipboard.writeText(url)
    .then(() => showToast('リンクをコピーしました 🔗', 'ok'))
    .catch(() => showToast('コピーに失敗しました', 'err'));
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
  if (STATE.userMarker) STATE.userMarker.remove();
  const el = document.createElement('div');
  el.className = 'user-location-dot';
  STATE.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([lng, lat])
    .addTo(STATE.map);
}

/* ---------------- URL ---------------- */
function applyURLState() {
  const u = new URL(location.href);
  const pinId = u.searchParams.get('pin');
  const action = u.searchParams.get('action');

  if (pinId) {
    STATE.map.once('idle', () => {
      const p = STATE.store.get(pinId);
      if (p) {
        STATE.layer.flyTo(p);
        setTimeout(() => openDetail(pinId), 700);
      }
    });
  }

  if (action === 'compose') {
    setTimeout(() => enterTargetingMode(), 1200);
  } else if (action === 'trend') {
    setTimeout(() => openSidePanel('trendPanel', renderTrends), 1200);
  } else if (action === 'ranking') {
    setTimeout(() => openSidePanel('rankingPanel', renderRanking), 1200);
  }
}

/* ---------------- Util ---------------- */
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast toast--' + type;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2800);
}

function formatN(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function formatTime(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 30) return 'たった今';
  if (diff < 60) return diff + '秒前';
  if (diff < 3600) return Math.floor(diff / 60) + '分前';
  if (diff < 86400) return Math.floor(diff / 3600) + '時間前';
  return Math.floor(diff / 86400) + '日前';
}

function escapeHTML(s) {
  return sanitizeText(String(s ?? ''));
}

/* ---------------- Trend & Ranking ---------------- */
function renderTrends() {
  const list = document.getElementById('trendList');
  if (!list) return;
  const hot = STATE.store.hot(10);
  if (hot.length === 0) {
    list.innerHTML = `<div class="side-panel__empty"><span class="emoji">🌱</span>まだ盛り上がってるピンはありません<br>あなたが第一号になろう</div>`;
    return;
  }
  list.innerHTML = hot.map((p) => {
    const cat = getCategory(p.cat);
    const reactionCount = Object.values(p.reactions).reduce((a, b) => a + b, 0);
    return `
      <div class="trend-item" data-pin="${p.id}" role="button" tabindex="0">
        <div class="trend-item__emoji">${cat.emoji}</div>
        <div class="trend-item__content">
          <div class="trend-item__text">${escapeHTML(p.text)}</div>
          <div class="trend-item__meta">${cat.label} ・ ${formatTime(p.ts)} ・ 🔥 ${reactionCount}</div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.trend-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.pin;
      const p = STATE.store.get(id);
      if (!p) return;
      STATE.layer.flyTo(p);
      setTimeout(() => openDetail(id), 600);
      document.getElementById('trendPanel').classList.remove('is-open');
    });
  });
}

function renderRanking() {
  const list = document.getElementById('rankingList');
  if (!list) return;

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
    list.innerHTML = `<div class="side-panel__empty"><span class="emoji">🏅</span>まだランキングはありません</div>`;
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
  list.innerHTML = sorted.map((stat, idx) => {
    const display = stat.author === me ? `${stat.author} (あなた)`
      : stat.author === 'PinlyOfficial' ? '🌟 Pinly公式'
      : stat.author;
    return `
      <div class="ranking-item">
        <div class="ranking-item__rank">#${idx + 1}</div>
        <div class="ranking-item__badge">${stat.badge}</div>
        <div class="ranking-item__content">
          <div class="ranking-item__author">${escapeHTML(display)}</div>
          <div class="ranking-item__stats">投稿 ${stat.posts} ・ 🔥 ${stat.reactions}</div>
        </div>
      </div>`;
  }).join('');
}

/* ---------------- Boot ---------------- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
