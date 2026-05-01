/**
 * Pinly data store.
 *
 * Storage layers (in priority order):
 *   1. Supabase  (optional, if configured) — persistent cloud + realtime
 *   2. localStorage — durable on-device store (always on)
 *   3. BroadcastChannel — instant cross-tab sync within the same browser
 *   4. Seed JSON — public/pins.json bootstrap so a fresh visit isn't empty
 *
 * Pin schema:
 *   {
 *     id:       string  (matches /^[a-z0-9_-]{1,64}$/)
 *     lat,lng:  number  (validated to be finite & within world bounds)
 *     cat:      string  (one of CATEGORIES ids)
 *     text:     string  (<=50, control chars stripped)
 *     ts:       number  (unix seconds)
 *     loc:      string  (<=80)
 *     author:   string  (<=64)
 *     reactions: { emoji: count }
 *     myReactions: string[]
 *     official: boolean
 *     _reported: boolean
 *     _reportCount: number
 *     _hidden: boolean (locally hidden, e.g. own deleted)
 *   }
 */

import {
  initSupabase,
  fetchPinsFromSupabase,
  insertPinToSupabase,
  updatePinInSupabase,
  deletePinFromSupabase,
  subscribeToSupabasePins,
  broadcastPinChange,
} from './supabase.js';

const LS_KEY    = 'pinly.pins.v2';
const LS_SELF   = 'pinly.self.v1';
const SEED_FLAG = 'pinly.seed.v3';
const BC_NAME   = 'pinly.bc.v1';

const EXPIRE_SEC = 48 * 3600; // 48 hours
const MAX_PINS   = 5000;       // hard cap to bound memory/storage
const ID_RE      = /^[a-zA-Z0-9_-]{1,64}$/;

// Strip control characters and limit length.
function safeStr(v, max = 50) {
  if (v == null) return '';
  let s = String(v);
  // strip control chars but keep spaces / newlines
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, '');
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function safeId(v, prefix = 'p_') {
  const s = String(v ?? '');
  if (ID_RE.test(s)) return s;
  return prefix + (crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 14));
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export class PinStore extends EventTarget {
  constructor() {
    super();
    this.pins = new Map();
    this.self = this._loadSelf();
    this.bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(BC_NAME) : null;
    if (this.bc) this.bc.onmessage = (e) => this._onBC(e.data);
    this.supabase = null;
    this.supabaseSubscription = null;
  }

  /* ==================== init ==================== */
  async init() {
    // 1. Load from localStorage first (instant)
    this._loadLS().forEach((p) => this.pins.set(p.id, p));

    // 2. Try Supabase (async, non-blocking)
    try {
      this.supabase = await initSupabase();
    } catch {
      this.supabase = null;
    }
    if (this.supabase) {
      try {
        const remote = await fetchPinsFromSupabase();
        remote.forEach((p) => {
          const norm = this._normalize(p);
          if (norm) this.pins.set(norm.id, norm);
        });
        this.supabaseSubscription = subscribeToSupabasePins((payload) => {
          this._onSupabaseChange(payload);
        });
      } catch (err) {
        console.warn('[Pinly] supabase sync failed:', err?.message || err);
      }
    }

    // 3. Merge seed pins on first visit
    const seedNeeded = !localStorage.getItem(SEED_FLAG);
    if (seedNeeded) {
      try {
        const url = new URL('./pins.json', document.baseURI).toString();
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.pins)) {
            const now = Math.floor(Date.now() / 1000);
            data.pins.forEach((p) => {
              const ts = (typeof p.offsetSec === 'number') ? (now - p.offsetSec) : (p.ts || now);
              const merged = this._normalize({ ...p, ts });
              if (merged && !this.pins.has(merged.id)) {
                this.pins.set(merged.id, merged);
              }
            });
            localStorage.setItem(SEED_FLAG, '1');
            this._saveLS();
          }
        }
      } catch {
        // Offline / file missing — okay, just no seed.
      }
    }

    // 4. Refresh seed timestamps each load
    this._refreshSeedTimestamps();

    this._enforceCap();
    this._emit('ready', { count: this.pins.size });
  }

  async _refreshSeedTimestamps() {
    try {
      const url = new URL('./pins.json', document.baseURI).toString();
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !Array.isArray(data.pins)) return;
      const now = Math.floor(Date.now() / 1000);
      let updated = false;
      data.pins.forEach((seed) => {
        const id = safeId(seed.id);
        const existing = this.pins.get(id);
        if (existing && existing.author === 'PinlyOfficial' && typeof seed.offsetSec === 'number') {
          const newTs = now - seed.offsetSec;
          if (Math.abs(newTs - existing.ts) > 60) {
            existing.ts = newTs;
            updated = true;
          }
        }
      });
      if (updated) {
        this._saveLS();
        this._emit('refresh', null);
      }
    } catch {}
  }

  /* ==================== self ==================== */
  _loadSelf() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SELF) || '{}');
      if (s && typeof s.id === 'string' && /^u_[a-z0-9_-]{4,32}$/i.test(s.id)) return s;
    } catch {}
    const id = 'u_' + (crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10));
    const fresh = { id, joinedAt: Date.now() };
    try { localStorage.setItem(LS_SELF, JSON.stringify(fresh)); } catch {}
    return fresh;
  }

  /* ==================== LS ==================== */
  _loadLS() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (const p of arr) {
        const n = this._normalize(p);
        if (n) out.push(n);
      }
      return out;
    } catch { return []; }
  }

  _saveLS() {
    try {
      const arr = Array.from(this.pins.values());
      // bound size: keep newest MAX_PINS (already enforced, but safe-guard)
      const trimmed = arr.length > MAX_PINS ? arr.slice(-MAX_PINS) : arr;
      localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
    } catch {
      // Quota exceeded — try shrinking by half and retry once.
      try {
        const half = Array.from(this.pins.values()).slice(-Math.floor(MAX_PINS / 2));
        localStorage.setItem(LS_KEY, JSON.stringify(half));
      } catch {}
    }
  }

  /** Validate & normalize an incoming pin. Returns null if invalid. */
  _normalize(p) {
    if (!p || typeof p !== 'object') return null;

    const lat = safeNum(p.lat, NaN);
    const lng = safeNum(p.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    const id = safeId(p.id);
    const cat = typeof p.cat === 'string' ? p.cat.replace(/[^a-z]/gi, '').slice(0, 12).toLowerCase() : 'misc';
    const text = safeStr(p.text, 50);
    const loc  = safeStr(p.loc, 80);
    const author = safeStr(p.author || 'anon', 64);
    const ts = clamp(safeNum(p.ts, Math.floor(Date.now() / 1000)), 0, 1e12);

    // Sanitize reactions: only allow short emoji-like keys, integer values 0..1e6
    let reactions = {};
    if (p.reactions && typeof p.reactions === 'object') {
      let count = 0;
      for (const [k, v] of Object.entries(p.reactions)) {
        if (count++ > 24) break;
        if (typeof k !== 'string' || k.length === 0 || k.length > 8) continue;
        const num = Math.floor(safeNum(v, 0));
        if (num <= 0 || num > 1e6) continue;
        reactions[k] = num;
      }
    }

    let myReactions = [];
    if (Array.isArray(p.myReactions)) {
      myReactions = p.myReactions
        .filter((e) => typeof e === 'string' && e.length > 0 && e.length <= 8)
        .slice(0, 24);
    }

    return {
      id,
      lat, lng,
      cat: cat || 'misc',
      text,
      ts,
      loc,
      author,
      reactions,
      myReactions,
      official: !!p.official,
      _reported: !!p._reported,
      _reportCount: clamp(Math.floor(safeNum(p._reportCount, 0)), 0, 1e6),
      _hidden: !!p._hidden,
    };
  }

  _enforceCap() {
    if (this.pins.size <= MAX_PINS) return;
    // Drop oldest (smallest ts) until under cap
    const arr = Array.from(this.pins.values()).sort((a, b) => a.ts - b.ts);
    const toRemove = arr.length - MAX_PINS;
    for (let i = 0; i < toRemove; i++) {
      this.pins.delete(arr[i].id);
    }
  }

  /* ==================== public API ==================== */
  list() { return Array.from(this.pins.values()); }

  get(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return undefined;
    return this.pins.get(id);
  }

  add({ lat, lng, cat, text, loc }) {
    const pin = this._normalize({
      id: 'p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 14)),
      lat, lng, cat, text, loc,
      ts: Math.floor(Date.now() / 1000),
      author: this.self.id,
      reactions: {},
      myReactions: [],
    });
    if (!pin) throw new Error('invalid pin');

    this.pins.set(pin.id, pin);
    this._enforceCap();
    this._saveLS();

    if (this.supabase) {
      // strip the leading underscore-prefixed local fields before sending
      const { _reported, _reportCount, _hidden, myReactions, ...remote } = pin;
      insertPinToSupabase(remote).catch(() => {});
      // Broadcast to other connected clients for instant sync
      broadcastPinChange('INSERT', remote);
    }

    this._emit('add', pin);
    this._broadcast({ t: 'add', pin });
    return pin;
  }

  react(id, emoji) {
    const p = this.get(id);
    if (!p) return null;
    if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 8) return null;

    const idx = p.myReactions.indexOf(emoji);
    if (idx >= 0) {
      p.myReactions.splice(idx, 1);
      p.reactions[emoji] = Math.max(0, (p.reactions[emoji] || 1) - 1);
      if (p.reactions[emoji] === 0) delete p.reactions[emoji];
    } else {
      // Cap distinct reactions per pin.
      if (Object.keys(p.reactions).length >= 24 && !p.reactions[emoji]) return null;
      p.myReactions.push(emoji);
      p.reactions[emoji] = (p.reactions[emoji] || 0) + 1;
    }
    this._saveLS();

    if (this.supabase) {
      updatePinInSupabase(id, { reactions: p.reactions }).catch(() => {});
      // Broadcast reaction update to other clients
      broadcastPinChange('UPDATE', { id, reactions: p.reactions });
    }
    this._emit('update', p);
    this._broadcast({ t: 'update', pin: p });
    return p;
  }

  report(id) {
    const p = this.get(id);
    if (!p) return false;
    p._reported = true;
    p._reportCount = (p._reportCount || 0) + 1;
    this._saveLS();
    if (this.supabase) {
      updatePinInSupabase(id, { _reported: true, _reportCount: p._reportCount }).catch(() => {});
    }
    this._emit('update', p);
    return true;
  }

  /** Remove a pin you own locally. */
  removeOwn(id) {
    const p = this.get(id);
    if (!p) return false;
    if (p.author !== this.self.id) return false;
    this.pins.delete(id);
    this._saveLS();
    if (this.supabase) {
      deletePinFromSupabase(id).catch(() => {});
    }
    this._emit('delete', p);
    this._broadcast({ t: 'delete', id });
    return true;
  }

  /** Hard reset of local data (keeps device id). */
  clearLocal() {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(SEED_FLAG);
    } catch {}
    this.pins.clear();
    this._emit('reset', null);
  }

  /* ==================== queries ==================== */
  hot(limit = 25) {
    const now = Math.floor(Date.now() / 1000);
    return this._visible()
      .map((p) => {
        const reactSum = Object.values(p.reactions || {}).reduce((a, b) => a + b, 0);
        const ageHrs = Math.max(0.5, (now - p.ts) / 3600);
        const score = (reactSum + 1) / Math.pow(ageHrs, 0.5);
        return { p, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit | 0))
      .map((x) => x.p);
  }

  newest(limit = 25) {
    return this._visible().sort((a, b) => b.ts - a.ts).slice(0, Math.max(0, limit | 0));
  }

  myPins() {
    return this.list()
      .filter((p) => p.author === this.self.id && !p._hidden)
      .sort((a, b) => b.ts - a.ts);
  }

  filter({ cat = 'all', q = '' } = {}) {
    const ql = String(q || '').trim().toLowerCase();
    const safeCat = String(cat || 'all').replace(/[^a-z]/gi, '').toLowerCase() || 'all';
    return this._visible().filter((p) => {
      if (safeCat !== 'all' && p.cat !== safeCat) return false;
      if (!ql) return true;
      return (
        p.text.toLowerCase().includes(ql) ||
        (p.loc || '').toLowerCase().includes(ql)
      );
    });
  }

  _visible() {
    const now = Math.floor(Date.now() / 1000);
    return this.list().filter((p) => {
      if (p._reported || p._hidden) return false;
      if (!p.official && now - p.ts > EXPIRE_SEC) return false;
      return true;
    });
  }

  totals() {
    const now = Math.floor(Date.now() / 1000);
    let visible = 0, mine = 0;
    for (const p of this.pins.values()) {
      const expired = !p.official && now - p.ts > EXPIRE_SEC;
      if (!p._reported && !p._hidden && !expired) visible++;
      if (p.author === this.self.id && !p._hidden) mine++;
    }
    return { all: this.pins.size, visible, mine };
  }

  /* ==================== BroadcastChannel ==================== */
  _broadcast(msg) {
    if (!this.bc) return;
    try { this.bc.postMessage(msg); } catch {}
  }
  _onBC(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'add' && msg.pin) {
      const p = this._normalize(msg.pin);
      if (p && !this.pins.has(p.id)) {
        this.pins.set(p.id, p);
        this._enforceCap();
        this._saveLS();
        this._emit('add', p);
      }
    } else if (msg.t === 'update' && msg.pin) {
      const p = this._normalize(msg.pin);
      if (!p) return;
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit('update', p);
    } else if (msg.t === 'delete' && typeof msg.id === 'string' && ID_RE.test(msg.id)) {
      const p = this.pins.get(msg.id);
      if (p) {
        this.pins.delete(msg.id);
        this._saveLS();
        this._emit('delete', p);
      }
    }
  }

  /* ==================== Supabase realtime ==================== */
  _onSupabaseChange(payload) {
    const { eventType, new: n, old: o } = payload || {};
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (!n) return;
      const p = this._normalize(n);
      if (!p) return;
      this.pins.set(p.id, p);
      this._enforceCap();
      this._saveLS();
      this._emit(eventType === 'INSERT' ? 'add' : 'update', p);
    } else if (eventType === 'DELETE' && o && typeof o.id === 'string' && ID_RE.test(o.id)) {
      this.pins.delete(o.id);
      this._saveLS();
      this._emit('delete', o);
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export const EXPIRE_SECONDS = EXPIRE_SEC;
