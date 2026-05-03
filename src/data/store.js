/**
 * Pinly data store.
 * =================
 *
 * Layered storage:
 *   1. localStorage   — durable per-device cache + offline writes.
 *   2. BroadcastChannel — cross-tab sync within the same browser.
 *   3. Supabase realtime — cross-device sync (postgres_changes + broadcast).
 *   4. Polling fallback — if realtime is rate-limited / blocked, we still
 *      pull every 15s, so two phones in different rooms see each other's
 *      posts within the polling window.
 *   5. Seed JSON — public/pins.json bootstrap for an empty database.
 *
 * Identity:
 *   - When the user is signed in (anonymous Supabase auth or email magic
 *     link), `self.id` is the real `auth.uid()` and RLS enforces ownership.
 *   - When offline / signed out, `self.id` is the local device id `u_xxxx`,
 *     and writes are local-only until login.
 *
 * Pin schema (client side):
 *   {
 *     id, lat, lng, cat, text, ts, loc, author,
 *     reactions: { emoji: count },
 *     myReactions: string[]   // local-only — which emojis *I* tapped
 *     official: boolean,
 *     _reported?, _hidden?
 *   }
 */

import {
  initSupabase,
  fetchPinsFromSupabase,
  insertPinToSupabase,
  updatePinInSupabase,
  deletePinFromSupabase,
  subscribeToSupabasePins,
} from './supabase.js';
import { PinlyAuth } from './auth.js';

const LS_KEY = 'pinly.pins.v1';
const LS_MY_REACTIONS = 'pinly.myReactions.v1';
const SEED_FLAG = 'pinly.seed.v1';
const BC_NAME = 'pinly.bc.v1';
const POLL_INTERVAL_MS = 15000;
const EXPIRE_SEC = 48 * 3600;

export class PinStore extends EventTarget {
  constructor() {
    super();
    this.pins = new Map();
    this.bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(BC_NAME) : null;
    if (this.bc) this.bc.onmessage = (e) => this._onBC(e.data);
    this.supabase = null;
    this.auth = null;
    this.realtime = null;       // handle from subscribeToSupabasePins
    this._pollTimer = null;
    this._presenceCount = 0;
    this._myReactions = this._loadMyReactions();
    this._authUnsub = null;
    // Lightweight `self` for callers that read store.self.id immediately.
    this.self = { id: this._readBootstrapAuthorId() };
  }

  /* ============================================================
   *  Boot
   * ============================================================ */
  async init() {
    // 1) Show local cache immediately for instant rendering.
    const local = this._loadLS();
    local.forEach((p) => this.pins.set(p.id, p));

    // 2) Init Supabase client + Auth.
    this.supabase = await initSupabase();
    this.auth = new PinlyAuth(this.supabase);
    await this.auth.init();
    this.self = { id: this.auth.user.id };
    this._authUnsub = this.auth.onChange((user) => {
      this.self = { id: user.id };
      this._emit('auth', { user });
    });

    // 3) Sync from cloud + subscribe.
    if (this.supabase) {
      await this._initialCloudSync();
      this._subscribeRealtime();
      this._startPolling();
      document.addEventListener('visibilitychange', this._onVisibility);
    }

    // 4) Seed pins on first run / empty DB / empty cache.
    await this._maybeSeed();

    this._emit('ready', { count: this.pins.size });
    return this;
  }

  _onVisibility = () => {
    if (document.visibilityState === 'visible') this._pollRemote();
  };

  _readBootstrapAuthorId() {
    try {
      const raw = JSON.parse(localStorage.getItem('pinly.self.v1') || '{}');
      if (raw && typeof raw.id === 'string') return raw.id;
    } catch {}
    return 'u_' + Math.random().toString(36).slice(2, 12);
  }

  async _initialCloudSync() {
    try {
      const remote = await fetchPinsFromSupabase();
      remote.forEach((row) => {
        const p = this._normalize(row);
        const existing = this.pins.get(p.id);
        // Cloud wins unless our local is strictly newer (e.g. offline edit).
        if (!existing || p.ts >= existing.ts) {
          // preserve local-only myReactions
          if (existing) p.myReactions = existing.myReactions;
          else p.myReactions = this._myReactions[p.id] ? [...this._myReactions[p.id]] : [];
          this.pins.set(p.id, p);
        }
      });
      this._saveLS();
    } catch (err) {
      console.warn('[Pinly] initial cloud sync failed:', err && err.message);
    }
  }

  _subscribeRealtime() {
    this.realtime = subscribeToSupabasePins(
      (payload) => this._onRealtime(payload),
      {
        onPresence: (n) => {
          this._presenceCount = n;
          this._emit('presence', { count: n });
        },
        onStatus: (status) => {
          this._emit('connection', { status });
        },
      }
    );
  }

  _startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._pollRemote(), POLL_INTERVAL_MS);
  }

  async _maybeSeed() {
    if (this.pins.size > 0) {
      try { localStorage.setItem(SEED_FLAG, '1'); } catch {}
      return;
    }
    if (localStorage.getItem(SEED_FLAG)) return;
    try {
      const url = new URL('./pins.json', document.baseURI).toString();
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.pins)) {
        data.pins.forEach((p) => {
          const merged = this._normalize(p);
          if (!this.pins.has(merged.id)) this.pins.set(merged.id, merged);
        });
        try { localStorage.setItem(SEED_FLAG, '1'); } catch {}
        this._saveLS();
      }
    } catch { /* offline */ }
  }

  /* ============================================================
   *  Local persistence
   * ============================================================ */
  _loadLS() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map((p) => this._normalize(p)) : [];
    } catch { return []; }
  }
  _saveLS() {
    try {
      // Don't bloat storage forever — drop very old, non-official pins.
      const now = Math.floor(Date.now() / 1000);
      const arr = Array.from(this.pins.values()).filter(
        (p) => p.official || (now - p.ts) < EXPIRE_SEC * 2
      );
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
    } catch {}
  }

  _loadMyReactions() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_MY_REACTIONS) || '{}');
      if (raw && typeof raw === 'object') return raw;
    } catch {}
    return {};
  }
  _saveMyReactions() {
    try { localStorage.setItem(LS_MY_REACTIONS, JSON.stringify(this._myReactions)); } catch {}
  }
  _setMyReactions(pinId, arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      delete this._myReactions[pinId];
    } else {
      this._myReactions[pinId] = arr.slice(0, 16);
    }
    this._saveMyReactions();
  }

  _normalize(p) {
    const reactions = (p && p.reactions && typeof p.reactions === 'object') ? p.reactions : {};
    // Make sure reactions counts are clean numbers.
    const cleanReactions = {};
    Object.keys(reactions).forEach((k) => {
      const n = Math.max(0, Math.floor(Number(reactions[k]) || 0));
      if (n > 0) cleanReactions[k] = n;
    });
    const id = p && p.id ? String(p.id) : ('p_' + (crypto.randomUUID
      ? crypto.randomUUID() : Math.random().toString(36).slice(2)));
    return {
      id,
      lat: +p.lat,
      lng: +p.lng,
      cat: p.cat ? String(p.cat) : 'misc',
      text: String(p.text || '').slice(0, 50),
      ts: +p.ts || Math.floor(Date.now() / 1000),
      loc: p.loc ? String(p.loc).slice(0, 80) : '',
      author: p.author ? String(p.author).slice(0, 64) : 'anon',
      reactions: cleanReactions,
      myReactions: Array.isArray(p.myReactions)
        ? p.myReactions.slice(0, 16)
        : (this._myReactions[id] ? [...this._myReactions[id]] : []),
      official: !!p.official,
      _reported: !!p._reported,
      _hidden: !!p._hidden,
    };
  }

  /* ============================================================
   *  Public API
   * ============================================================ */
  list() { return Array.from(this.pins.values()); }
  get(id) { return this.pins.get(id); }
  presenceCount() { return this._presenceCount; }
  isCloudConnected() { return !!this.supabase && !!this.realtime; }

  myPins() {
    const me = this.self.id;
    return this.list()
      .filter((p) => p.author === me)
      .sort((a, b) => b.ts - a.ts);
  }

  totals() {
    const all = this.list();
    const visible = all.filter((p) => !p._reported && !p._hidden).length;
    const mine = all.filter((p) => p.author === this.self.id).length;
    return { visible, mine, total: all.length };
  }

  add({ lat, lng, cat, text, loc }) {
    const pin = this._normalize({
      id: 'p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)),
      lat, lng, cat, text, loc,
      ts: Math.floor(Date.now() / 1000),
      author: this.self.id,
      reactions: {},
      myReactions: [],
    });
    this.pins.set(pin.id, pin);
    this._saveLS();
    this._emit('add', pin);
    this._broadcast({ t: 'add', pin });

    // Push to cloud + broadcast to peers (best-effort, fire-and-forget).
    if (this.supabase) {
      insertPinToSupabase(pin).then((saved) => {
        if (!saved) {
          // RLS/Network failure — keep local but warn.
          this._emit('warning', { code: 'cloud_insert_failed', pinId: pin.id });
        }
      }).catch((err) => console.warn('[Pinly] insert failed:', err));
      if (this.realtime) this.realtime.send('add', pin);
    }
    return pin;
  }

  removeOwn(id) {
    const p = this.pins.get(id);
    if (!p || p.author !== this.self.id) return false;
    this.pins.delete(id);
    this._saveLS();
    this._setMyReactions(id, []);

    if (this.supabase) {
      deletePinFromSupabase(id).catch((err) => console.warn('[Pinly] delete failed:', err));
      if (this.realtime) this.realtime.send('delete', { id });
    }
    this._broadcast({ t: 'delete', id });
    this._emit('delete', { id });
    return true;
  }

  react(id, emoji) {
    const p = this.pins.get(id);
    if (!p) return null;
    const has = p.myReactions.includes(emoji);
    if (has) {
      p.myReactions = p.myReactions.filter((x) => x !== emoji);
      p.reactions[emoji] = Math.max(0, (p.reactions[emoji] || 1) - 1);
      if (p.reactions[emoji] === 0) delete p.reactions[emoji];
    } else {
      // limit how many reactions a single user can pile on a single pin
      if (p.myReactions.length >= 4) {
        return p;
      }
      p.myReactions = [...p.myReactions, emoji];
      p.reactions[emoji] = (p.reactions[emoji] || 0) + 1;
    }
    this._setMyReactions(id, p.myReactions);
    this._saveLS();

    // Cloud + broadcast
    if (this.supabase) {
      updatePinInSupabase(id, { reactions: p.reactions })
        .catch((err) => console.warn('[Pinly] react update failed:', err));
      if (this.realtime) this.realtime.send('update', p);
    }
    this._emit('update', p);
    this._broadcast({ t: 'update', pin: p });
    return p;
  }

  report(id) {
    const p = this.pins.get(id);
    if (!p) return;
    p._reported = true;
    this._saveLS();
    this._emit('update', p);
    // Also flag in DB so other devices stop showing it.
    if (this.supabase) {
      updatePinInSupabase(id, { _reported: true })
        .catch((err) => console.warn('[Pinly] report failed:', err));
    }
  }

  clearLocal() {
    try { localStorage.removeItem(LS_KEY); } catch {}
    try { localStorage.removeItem(SEED_FLAG); } catch {}
    try { localStorage.removeItem(LS_MY_REACTIONS); } catch {}
    this.pins.clear();
    this._myReactions = {};
  }

  /* ============================================================
   *  Polling fallback — works even when realtime is OFF.
   * ============================================================ */
  async _pollRemote() {
    if (!this.supabase) return;
    try {
      const remote = await fetchPinsFromSupabase();
      let changed = false;
      const remoteIds = new Set();
      for (const raw of remote) {
        const p = this._normalize(raw);
        remoteIds.add(p.id);
        const existing = this.pins.get(p.id);
        if (!existing) {
          this.pins.set(p.id, p);
          changed = true;
          this._emit('add', p);
        } else if (
          p.ts !== existing.ts ||
          JSON.stringify(p.reactions) !== JSON.stringify(existing.reactions) ||
          p._reported !== existing._reported
        ) {
          // preserve myReactions
          p.myReactions = existing.myReactions;
          this.pins.set(p.id, p);
          changed = true;
          this._emit('update', p);
        }
      }
      // We *don't* delete missing rows here — fetch is windowed (last 48h).
      if (changed) {
        this._saveLS();
        this._emit('refresh', { count: this.pins.size });
      }
    } catch (err) {
      console.warn('[Pinly] poll failed:', err && err.message);
    }
  }

  /* ============================================================
   *  Realtime handler
   * ============================================================ */
  _onRealtime(payload) {
    if (!payload) return;
    const { eventType, new: newRow, old: oldRow } = payload;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (!newRow) return;
      const p = this._normalize(newRow);
      const existing = this.pins.get(p.id);
      if (existing) {
        p.myReactions = existing.myReactions;
        // Skip noop updates
        if (existing.ts === p.ts &&
            JSON.stringify(existing.reactions) === JSON.stringify(p.reactions) &&
            existing._reported === p._reported) return;
      }
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit(existing ? 'update' : 'add', p);
    } else if (eventType === 'DELETE') {
      const id = oldRow && oldRow.id;
      if (!id) return;
      if (this.pins.delete(id)) {
        this._saveLS();
        this._emit('delete', { id });
      }
    }
  }

  /* ============================================================
   *  Cross-tab BroadcastChannel
   * ============================================================ */
  _broadcast(msg) {
    if (!this.bc) return;
    try { this.bc.postMessage(msg); } catch {}
  }
  _onBC(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'add' && msg.pin) {
      const p = this._normalize(msg.pin);
      if (!this.pins.has(p.id)) {
        this.pins.set(p.id, p);
        this._saveLS();
        this._emit('add', p);
      }
    } else if (msg.t === 'update' && msg.pin) {
      const p = this._normalize(msg.pin);
      const existing = this.pins.get(p.id);
      if (existing) p.myReactions = existing.myReactions;
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit('update', p);
    } else if (msg.t === 'delete' && msg.id) {
      if (this.pins.delete(msg.id)) {
        this._saveLS();
        this._emit('delete', { id: msg.id });
      }
    }
  }

  /* ============================================================
   *  Aggregations / queries
   * ============================================================ */
  hot(limit = 25) {
    const now = Math.floor(Date.now() / 1000);
    return this.list()
      .filter((p) => !p._reported && !p._hidden)
      .map((p) => {
        const reactSum = Object.values(p.reactions || {}).reduce((a, b) => a + b, 0);
        const ageHrs = Math.max(1, (now - p.ts) / 3600);
        const score = reactSum / Math.pow(ageHrs, 0.4);
        return { p, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.p);
  }

  newest(limit = 25) {
    return this.list()
      .filter((p) => !p._reported && !p._hidden)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  filter({ cat = 'all', q = '' } = {}) {
    const ql = q.trim().toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    return this.list().filter((p) => {
      if (p._reported || p._hidden) return false;
      if (now - p.ts > EXPIRE_SEC && !p.official) return false;
      if (cat !== 'all' && p.cat !== cat) return false;
      if (!ql) return true;
      return (
        p.text.toLowerCase().includes(ql) ||
        (p.loc || '').toLowerCase().includes(ql)
      );
    });
  }

  /* ============================================================
   *  Auth helpers (delegate)
   * ============================================================ */
  getUser() { return this.auth ? this.auth.user : { id: this.self.id, isAnonymous: true, isLocalOnly: true, displayName: '匿名さん' }; }
  async signInAnonymously() {
    if (!this.auth) return null;
    const u = await this.auth.signInAnonymously();
    this.self = { id: u.id };
    return u;
  }
  async signInWithEmail(email) {
    if (!this.auth) return { ok: false, message: 'サーバ未接続' };
    return this.auth.signInWithEmail(email);
  }
  async signOut() {
    if (!this.auth) return;
    await this.auth.signOut();
    this.self = { id: this.auth.user.id };
  }
  setDisplayName(name) {
    if (this.auth) this.auth.setDisplayName(name);
  }

  /* ============================================================ */
  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
