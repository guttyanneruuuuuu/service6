import { ZeropointScene } from './scene/scene.js';
import { ZeroRoom } from './net/room.js';
import { PLACES, PLACE_TAGS, getPlace } from './data/places.js';
import { initMobileOptimizations, enableMobileScrollOptimization } from './mobile.js';

/* =========================================================
   Zeropoint main controller
   ========================================================= */

// Initialize mobile optimizations
initMobileOptimizations();
enableMobileScrollOptimization();

const AVATAR_COLORS = [
  '#7ce7ff', '#b794ff', '#ffd27c', '#ff9b7c',
  '#9ffcb4', '#ffa4e3', '#7cc4ff', '#ffe56b',
];

const STATE = {
  self: loadSelf(),
  currentPlaceId: null,
  scene: null,
  room: null,
  posSendTimer: null,
};

function loadSelf() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('zeropoint.self') || '{}'); } catch {}
  if (!s.id) s.id = 'user-' + Math.random().toString(36).slice(2, 10);
  if (!s.color) s.color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  return s;
}
function saveSelf() {
  try { localStorage.setItem('zeropoint.self', JSON.stringify(STATE.self)); } catch {}
}

/* ---------- Boot ---------- */
function boot() {
  // Simulated boot sequence feel
  const status = document.getElementById('bootStatus');
  const lines = [
    'initializing spacetime…',
    'aligning quantum channels…',
    'fetching doors…',
    'ready.',
  ];
  let i = 0;
  const int = setInterval(() => {
    i = Math.min(i + 1, lines.length - 1);
    if (status) status.textContent = lines[i];
  }, 520);

  setTimeout(() => {
    clearInterval(int);
    const boot = document.getElementById('boot');
    boot.classList.add('boot--hide');
    setTimeout(() => { boot.hidden = true; }, 620);
    document.getElementById('landing').hidden = false;
    initLanding();
    maybeAutoJoinFromURL();
  }, 1800);
}

/* ---------- Landing ---------- */
function initLanding() {
  // Hero background animated starfield (CSS-only fallback)
  buildHeroBg();

  renderPlacesGrid(document.getElementById('placesGrid'), PLACES.slice(0, 8));

  document.getElementById('heroEnter').addEventListener('click', () => openPicker());
  document.getElementById('navCta').addEventListener('click', () => openPicker());
  document.getElementById('heroWaitlist').addEventListener('click', () => openWaitlist('creator-rooms'));
  document.getElementById('heroHow').addEventListener('click', () => {
    document.getElementById('how').scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('proCta').addEventListener('click', () => {
    openWaitlist('door-pass');
  });

  // Live-ish stats
  document.getElementById('statPlaces').textContent = PLACES.length;
  document.getElementById('statOnline').textContent = simulateOnlineCount();
  document.getElementById('statDoorsToday').textContent = simulateDoorOpensToday();

  // Picker wiring
  initPicker();
  initWaitlist();
}

function buildHeroBg() {
  const host = document.getElementById('heroBg');
  if (!host) return;
  // CSS-generated starfield layer
  const stars = document.createElement('div');
  stars.style.position = 'absolute';
  stars.style.inset = '0';
  stars.style.background = `
    radial-gradient(1px 1px at 10% 20%, #fff, transparent 60%),
    radial-gradient(1px 1px at 80% 40%, #fff, transparent 60%),
    radial-gradient(1.5px 1.5px at 30% 80%, #fff, transparent 60%),
    radial-gradient(1px 1px at 60% 30%, #fff, transparent 60%),
    radial-gradient(2px 2px at 45% 60%, #7ce7ff, transparent 60%),
    radial-gradient(1.5px 1.5px at 25% 40%, #b794ff, transparent 60%),
    radial-gradient(1px 1px at 90% 70%, #fff, transparent 60%),
    radial-gradient(1.5px 1.5px at 70% 90%, #fff, transparent 60%)
  `;
  stars.style.backgroundSize = '600px 600px';
  stars.style.opacity = '0.55';
  stars.style.animation = 'starsDrift 80s linear infinite';
  host.appendChild(stars);
}

function simulateOnlineCount() {
  // Deterministic-ish, nice-looking fake number seeded by hour
  const base = 37 + ((new Date().getHours() * 13) % 26);
  return base + Math.floor(Math.random() * 8);
}

function simulateDoorOpensToday() {
  const d = new Date();
  const daySeed = d.getUTCDate() + d.getUTCMonth() * 31;
  const opens = 900 + ((daySeed * 137) % 1200);
  return opens.toLocaleString('en-US');
}

function renderPlacesGrid(host, places) {
  host.innerHTML = '';
  places.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'place-card';
    card.innerHTML = `
      <div class="place-card__img" style="background-image:url('${p.thumb}')"></div>
      <div class="place-card__overlay">
        <div class="place-card__live">live · ${fakeOccupancy(p.id)}</div>
        <div>
          <h3 class="place-card__name">${escapeHTML(p.name)}</h3>
          <div class="place-card__meta">
            <span class="place-card__country">${escapeHTML(p.country)}</span>
            <span>${p.tag.toUpperCase()}</span>
          </div>
        </div>
      </div>
      <div class="place-card__enter" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </div>
    `;
    card.addEventListener('click', () => requestEnter(p.id));
    host.appendChild(card);
  });
}

function fakeOccupancy(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 24) + 1;
}

/* ---------- Picker ---------- */
function initPicker() {
  const filters = document.getElementById('pickerFilters');
  const grid = document.getElementById('pickerGrid');
  const search = document.getElementById('pickerSearch');
  const picker = document.getElementById('picker');

  // filters
  filters.innerHTML = '';
  let activeFilter = 'all';
  PLACE_TAGS.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'picker__filter' + (t.id === 'all' ? ' active' : '');
    b.textContent = t.label;
    b.addEventListener('click', () => {
      activeFilter = t.id;
      filters.querySelectorAll('.picker__filter').forEach((el) => el.classList.remove('active'));
      b.classList.add('active');
      rerender();
    });
    filters.appendChild(b);
  });

  const rerender = () => {
    const q = (search.value || '').trim().toLowerCase();
    const filtered = PLACES.filter((p) => {
      if (activeFilter !== 'all' && p.tag !== activeFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q) ||
        p.tag.toLowerCase().includes(q)
      );
    });
    renderPlacesGrid(grid, filtered);
  };
  search.addEventListener('input', rerender);
  rerender();

  picker.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => closePicker());
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !picker.hidden) closePicker();
  });
}

function openPicker() {
  const picker = document.getElementById('picker');
  picker.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closePicker() {
  const picker = document.getElementById('picker');
  picker.hidden = true;
  document.body.style.overflow = '';
}

/* ---------- Waitlist ---------- */
function initWaitlist() {
  const waitlist = document.getElementById('waitlist');
  const form = document.getElementById('waitlistForm');
  const email = document.getElementById('waitlistEmail');

  waitlist.querySelectorAll('[data-waitlist-close]').forEach((el) => {
    el.addEventListener('click', () => closeWaitlist());
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const plan = document.getElementById('waitlistPlan').value;
    const mail = (email.value || '').trim();
    if (!mail) return;

    const entries = loadWaitlistEntries();
    entries.unshift({
      email: mail,
      plan,
      ts: Date.now(),
    });
    try { localStorage.setItem('zeropoint.waitlist', JSON.stringify(entries.slice(0, 100))); } catch {}

    closeWaitlist();
    showToast(`Saved. You're in the ${plan.replace('-', ' ')} queue.`);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !waitlist.hidden) closeWaitlist();
  });
}

function loadWaitlistEntries() {
  try {
    const data = JSON.parse(localStorage.getItem('zeropoint.waitlist') || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function openWaitlist(plan = 'door-pass') {
  const waitlist = document.getElementById('waitlist');
  const planEl = document.getElementById('waitlistPlan');
  const emailEl = document.getElementById('waitlistEmail');
  if (planEl) planEl.value = plan;
  waitlist.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => emailEl?.focus(), 20);
}

function closeWaitlist() {
  const waitlist = document.getElementById('waitlist');
  waitlist.hidden = true;
  document.body.style.overflow = '';
}

/* ---------- Onboard ---------- */
function ensureOnboarded() {
  return new Promise((resolve) => {
    if (STATE.self.name) { resolve(); return; }

    const onb = document.getElementById('onboard');
    const avatars = document.getElementById('onboardAvatars');
    const nameInput = document.getElementById('onboardName');
    const goBtn = document.getElementById('onboardGo');

    avatars.innerHTML = '';
    AVATAR_COLORS.forEach((c, i) => {
      const a = document.createElement('button');
      a.className = 'onboard__avatar' + (c === STATE.self.color ? ' active' : '');
      a.style.background = `radial-gradient(circle at 30% 30%, #fff, ${c} 60%, #000)`;
      a.addEventListener('click', () => {
        STATE.self.color = c;
        avatars.querySelectorAll('.onboard__avatar').forEach((el) => el.classList.remove('active'));
        a.classList.add('active');
      });
      avatars.appendChild(a);
    });

    nameInput.value = '';
    nameInput.focus();
    onb.hidden = false;

    goBtn.onclick = () => {
      const name = (nameInput.value || randomName()).trim().slice(0, 20);
      STATE.self.name = name;
      saveSelf();
      onb.hidden = true;
      resolve();
    };
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') goBtn.click(); };
  });
}

function randomName() {
  const adj = ['Quiet','Orbit','Drift','Lumen','Echo','Nova','Vector','Quantum','Relay','Zephyr'];
  const noun = ['Traveller','Voyager','Walker','Scout','Wanderer','Pilot','Observer','Ghost','Nomad','Node'];
  return adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)];
}

/* ---------- Enter place ---------- */
async function requestEnter(placeId) {
  closePicker();
  await ensureOnboarded();
  await teleportTo(placeId);
}

async function teleportTo(placeId) {
  const place = getPlace(placeId);
  STATE.currentPlaceId = place.id;
  updateURL(place.id);

  // Teleport overlay
  const overlay = document.getElementById('teleport');
  document.getElementById('teleportLabel').textContent = `Turning the handle to ${place.name}`;
  overlay.hidden = false;
  overlay.classList.remove('teleport--active');
  // force reflow so animation restarts each call
  void overlay.offsetWidth;
  overlay.classList.add('teleport--active');
  overlay.querySelector('.teleport__rings').style.animation = 'none';
  overlay.querySelector('.teleport__flash').style.animation = 'none';
  overlay.querySelector('.teleport__label').style.animation = 'none';
  void overlay.offsetWidth;
  overlay.querySelector('.teleport__rings').style.animation = '';
  overlay.querySelector('.teleport__flash').style.animation = '';
  overlay.querySelector('.teleport__label').style.animation = '';

  // Prepare scene
  const sceneRoot = document.getElementById('scene');
  const landing = document.getElementById('landing');
  if (!STATE.scene) {
    sceneRoot.hidden = false;
    STATE.scene = new ZeropointScene(document.getElementById('sceneCanvas'));
    STATE.scene.setHUDContainer(sceneRoot);
    STATE.scene.setSelfAvatar({ color: STATE.self.color });
  } else {
    sceneRoot.hidden = false;
  }
  landing.hidden = true;

  await STATE.scene.setPlace(place);

  // Update HUD
  document.querySelector('.scene__placeName').textContent = place.name;
  document.querySelector('.scene__placeMeta').textContent = place.country;

  // Start networking
  await startRoom(place.id);

  // Dismiss teleport overlay
  setTimeout(() => {
    overlay.hidden = true;
    overlay.classList.remove('teleport--active');
  }, 1500);

  showToast(`Arrived at ${place.name}`);
}

async function exitScene() {
  if (STATE.room) { STATE.room.stop(); STATE.room = null; }
  clearInterval(STATE.posSendTimer);
  STATE.posSendTimer = null;

  const sceneRoot = document.getElementById('scene');
  sceneRoot.hidden = true;
  const landing = document.getElementById('landing');
  landing.hidden = false;
  STATE.currentPlaceId = null;
  updateURL(null);
  document.getElementById('statOnline').textContent = simulateOnlineCount();
}

/* ---------- Room networking ---------- */
async function startRoom(placeId) {
  if (STATE.room) { STATE.room.stop(); STATE.room = null; }
  // Reset self id (each room = fresh peer identity) to avoid stale PeerJS ids
  STATE.self.id = 'zpnt-u-' + Math.random().toString(36).slice(2, 10);
  const room = new ZeroRoom({ roomId: placeId, self: { ...STATE.self } });
  STATE.room = room;

  room.addEventListener('peer-join', (e) => {
    const p = e.detail;
    STATE.scene.addPeer(p.id, { name: p.name, color: p.color });
    updateCount();
    showToast(`${p.name} joined`);
  });
  room.addEventListener('peer-leave', (e) => {
    STATE.scene.removePeer(e.detail.id);
    updateCount();
  });
  room.addEventListener('pos', (e) => {
    const { id, x, z } = e.detail;
    STATE.scene.updatePeer(id, { x, z });
  });
  room.addEventListener('chat', (e) => {
    const { id, text } = e.detail;
    STATE.scene.setPeerChat(id, text);
  });
  room.addEventListener('emote', (e) => {
    const { id, e: emote } = e.detail;
    STATE.scene.setPeerEmote(id, emote);
  });

  await room.start();
  updateCount();

  // Heartbeat position + compass
  STATE.posSendTimer = setInterval(() => {
    if (!STATE.scene || !STATE.room) return;
    const t = STATE.scene.getSelfTransform();
    STATE.room.sendPosition(t.x, t.z, t.yaw);
    updateCompass();
  }, 180);
}

function updateCount() {
  const el = document.getElementById('sceneCount');
  if (!el) return;
  const n = 1 + (STATE.room ? STATE.room.peerCount : 0);
  el.textContent = n;
}

function updateCompass() {
  const needle = document.querySelector('.scene__compass-needle');
  if (!needle || !STATE.scene) return;
  const deg = STATE.scene.getYawDegrees();
  needle.style.transform = `translateX(-50%) rotate(${-deg}deg)`;
}

/* ---------- Scene HUD actions ---------- */
function wireSceneHUD() {
  const exitBtn = document.getElementById('exitBtn');
  const switchBtn = document.getElementById('switchBtn');
  const emoteBtn = document.getElementById('emoteBtn');
  const shareBtn = document.getElementById('shareBtn');
  const fsBtn = document.getElementById('fsBtn');
  const emoteRail = document.getElementById('emoteRail');
  const chatForm = document.getElementById('sceneChatForm');
  const chatInput = document.getElementById('sceneChatInput');

  exitBtn.addEventListener('click', exitScene);

  switchBtn.addEventListener('click', () => openPicker());

  emoteBtn.addEventListener('click', () => {
    emoteRail.hidden = !emoteRail.hidden;
  });
  emoteRail.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      const e = b.dataset.emote;
      STATE.scene?.selfEmote(e);
      STATE.room?.sendEmote(e);
      emoteRail.hidden = true;
    });
  });

  shareBtn.addEventListener('click', async () => {
    const url = location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Zeropoint', text: 'Meet me at this door on Zeropoint.', url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Link copied. Share it with anyone.');
      }
    } catch {}
  });

  fsBtn.addEventListener('click', () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = (chatInput.value || '').trim();
    if (!text) return;
    chatInput.value = '';
    // show bubble over self (simulate by emoting own position via scene)
    const selfPos = STATE.scene.avatarPos.clone();
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;
    document.getElementById('scene').appendChild(bubble);
    let expires = performance.now() + 5000;
    const anim = () => {
      const v = selfPos.clone().setY(1.6).project(STATE.scene.camera);
      const rect = STATE.scene.canvas.getBoundingClientRect();
      const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top - 20;
      bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      if (performance.now() < expires && v.z > -1 && v.z < 1) requestAnimationFrame(anim);
      else bubble.remove();
    };
    requestAnimationFrame(anim);

    STATE.room?.sendChat(text);
  });
}

/* ---------- URL & share ---------- */
function updateURL(placeId) {
  const url = new URL(location.href);
  if (placeId) url.searchParams.set('at', placeId);
  else url.searchParams.delete('at');
  history.replaceState(null, '', url.toString());
}
function maybeAutoJoinFromURL() {
  const at = new URLSearchParams(location.search).get('at');
  if (at && PLACES.find((p) => p.id === at)) {
    requestEnter(at);
  }
}

/* ---------- Toast ---------- */
function showToast(msg) {
  const sceneEl = document.getElementById('sceneToast');
  const globalEl = document.getElementById('globalToast');
  const inScene = STATE.currentPlaceId && !document.getElementById('scene')?.hidden;
  const el = inScene ? sceneEl : globalEl;
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- Misc ---------- */
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- Go ---------- */
document.addEventListener('DOMContentLoaded', () => {
  wireSceneHUD();
  boot();
});
