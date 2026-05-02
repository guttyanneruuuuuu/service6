/**
 * Pinly data store.
 *
 * Layered storage:
 *   1. Supabase        — persistent cloud + realtime fan-out across devices.
 *   2. localStorage    — durable per-device cache (also works fully offline).
 *   3. BroadcastChannel — instant cross-tab sync within the same browser.
 *   4. Seed JSON        — public/pins.json bootstrap so a fresh visit is not empty.
 *
 * Pin schema (in-memory):
 *   {
 *     id, lat, lng, cat, text, ts, loc, author,
 *     reactions: { emoji: count },
 *     myReactions: string[],   // device-local only, never sent to DB
 *     official: boolean,
 *     _reported: boolean,
 *     _reportCount: number,
 *     _hidden: boolean,
 *   }
 *
 * NOTE: The Supabase `pins` table uses lowercase columns and does NOT have
 * a `myReactions` column — supabase.js strips that field before INSERT/UPDATE.
 */

import {
  initSupabase,
  fetchPinsFromSupabase,
  insertPinToSupabase,
  updatePinInSupabase,
  deletePinFromSupabase,
  subscribeToSupabasePins,
} from './supabase.js';

const LS_KEY    = 'pinly.pins.v2';
const LS_SELF   = 'pinly.self.v1';
const SEED_FLAG = 'pinly.seed.v3';
const BC_NAME   = 'pinly.bc.v1';

const EXPIRE_SEC = 48 * 3600;

export class PinStore extends EventTarget {
  constructor() {
    super();
    this.pins = new Map();
    this.self = this._loadSelf();
    this.bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(BC_NAME) : null;
    if (this.bc) this.bc.onmessage = (e) => this._onBC(e.data);
    this.supabase = null;
    this.supabaseSubscription = null;
    this._recentLocalOps = new Map(); // id -> expiresAtMs (echo guard)
  }

  /* ==================== init ==================== */
  async init() {
    // 1. localStorage first — instant render
    this._loadLS().forEach((p) => this.pins.set(p.id, p));

    // 2. Supabase
    this.supabase = await initSupabase();
    if (this.supabase) {
      try {
        const remote = await fetchPinsFromSupabase();
        remote.forEach((row) => {
          const norm = this._normalize(row);
          const existing = this.pins.get(norm.id);
          if (existing) norm.myReactions = existing.myReactions;
          this.pins.set(norm.id, norm);
        });
        this._saveLS();
        this.supabaseSubscription = subscribeToSupabasePins((payload) => {
          this._onSupabaseChange(payload);
        });
      } catch (err) {
        console.warn('[Pinly] supabase initial sync failed:', err);
      }
    }

    // 3. Seed pins on first visit
    if (!localStorage.getItem(SEED_FLAG)) {
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
              if (!this.pins.has(merged.id)) this.pins.set(merged.id, merged);
            });
            localStorage.setItem(SEED_FLAG, '1');
            this._saveLS();
          }
        }
      } catch {}
    }

    // 4. Refresh seed timestamps
    this._refreshSeedTimestamps();

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
        const ex = this.pins.get(seed.id);
        if (ex && ex.author === 'PinlyOfficial' && typeof seed.offsetSec === 'number') {
          const newTs = now - seed.offsetSec;
          if (Math.abs(newTs - ex.ts) > 60) { ex.ts = newTs; updated = true; }
        }
      });
      if (updated) {
        this._saveLS();
        this._emit('refresh', null);
      }
    } catch {}
  }

  /* ==================== self id ==================== */
  _loadSelf() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SELF) || '{}');
      if (s && s.id) return s;
    } catch {}
    const id = 'u_' + (crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10));
    const fresh = { id, joinedAt: Date.now() };
    localStorage.setItem(LS_SELF, JSON.stringify(fresh));
    return fresh;
  }

  /* ==================== LS ==================== */
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
      const arr = Array.from(this.pins.values());
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
    } catch {}
  }

  _normalize(p) {
    if (!p) p = {};
    return {
      id:   p.id || ('p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))),
      lat:  +p.lat,
      lng:  +p.lng,
      cat:  p.cat || 'misc',
      text: String(p.text || '').slice(0, 50),
      ts:   +p.ts || Math.floor(Date.now() / 1000),
      loc:  p.loc || '',
      author: p.author || 'anon',
      reactions: (p.reactions && typeof p.reactions === 'object') ? { ...p.reactions } : {},
      myReactions: Array.isArray(p.myReactions) ? [...p.myReactions] : [],
      official:  !!p.official,
      _reported: !!p._reported,
      _reportCount: +(p._reportCount ?? p._reportcount) || 0,
      _hidden:   !!p._hidden,
    };
  }

  /* ==================== local-op echo guard ==================== */
  _markLocalOp(id) {
    this._recentLocalOps.set(id, Date.now() + 5000);
    if (this._recentLocalOps.size > 64) {
      const now = Date.now();
      for (const [k, exp] of this._recentLocalOps) if (exp < now) this._recentLocalOps.delete(k);
    }
  }
  _isLocalEcho(id) {
    const exp = this._recentLocalOps.get(id);
    if (!exp) return false;
    if (exp < Date.now()) { this._recentLocalOps.delete(id); return false; }
    return true;
  }

  /* ==================== public API ==================== */
  list() { return Array.from(this.pins.values()); }
  get(id) { return this.pins.get(id); }

  add({ lat, lng, cat, text, loc }) {
    const pin = this._normalize({
      id:   'p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)),
      lat, lng, cat, text, loc,
      ts:     Math.floor(Date.now() / 1000),
      author: this.self.id,
      reactions: {},
      myReactions: [],
    });
    this.pins.set(pin.id, pin);
    this._saveLS();

    if (this.supabase) {
      this._markLocalOp(pin.id);
      insertPinToSupabase(pin).catch(() => {});
    }

    this._emit('add', pin);
    this._broadcast({ t: 'add', pin });
    return pin;
  }

  react(id, emoji) {
    const p = this.pins.get(id);
    if (!p) return null;
    const idx = p.myReactions.indexOf(emoji);
    if (idx >= 0) {
      p.myReactions.splice(idx, 1);
      p.reactions[emoji] = Math.max(0, (p.reactions[emoji] || 1) - 1);
      if (p.reactions[emoji] === 0) delete p.reactions[emoji];
    } else {
      p.myReactions.push(emoji);
      p.reactions[emoji] = (p.reactions[emoji] || 0) + 1;
    }
    this._saveLS();

    if (this.supabase) {
      this._markLocalOp(p.id);
      updatePinInSupabase(id, { reactions: p.reactions }).catch(() => {});
    }
    this._emit('update', p);
    this._broadcast({ t: 'update', pin: p });
    return p;
  }

  report(id) {
    const p = this.pins.get(id);
    if (!p) return;
    p._reported = true;
    p._reportCount = (p._reportCount || 0) + 1;
    this._saveLS();
    if (this.supabase) {
      this._markLocalOp(id);
      updatePinInSupabase(id, { _reported: true, _reportCount: p._reportCount }).catch(() => {});
    }
    this._emit('update', p);
  }

  removeOwn(id) {
    const p = this.pins.get(id);
    if (!p) return false;
    if (p.author !== this.self.id) return false;
    this.pins.delete(id);
    this._saveLS();
    if (this.supabase) {
      this._markLocalOp(id);
      deletePinFromSupabase(id).catch(() => {});
    }
    this._emit('delete', p);
    this._broadcast({ t: 'delete', id });
    return true;
  }

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
        const ageHrs   = Math.max(0.5, (now - p.ts) / 3600);
        const score    = (reactSum + 1) / Math.pow(ageHrs, 0.5);
        return { p, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.p);
  }

  newest(limit = 25) {
    return this._visible().sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  myPins() {
    return this.list()
      .filter((p) => p.author === this.self.id && !p._hidden)
      .sort((a, b) => b.ts - a.ts);
  }

  filter({ cat = 'all', q = '' } = {}) {
    const ql = (q || '').trim().toLowerCase();
    return this._visible().filter((p) => {
      if (cat !== 'all' && p.cat !== cat) return false;
      if (!ql) return true;
      return p.text.toLowerCase().includes(ql) || (p.loc || '').toLowerCase().includes(ql);
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
      if (!this.pins.has(p.id)) {
        this.pins.set(p.id, p);
        this._saveLS();
        this._emit('add', p);
      }
    } else if (msg.t === 'update' && msg.pin) {
      const p = this._normalize(msg.pin);
      const ex = this.pins.get(p.id);
      if (ex) p.myReactions = ex.myReactions;
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit('update', p);
    } else if (msg.t === 'delete' && msg.id) {
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
    if (!payload) return;
    const { eventType, new: n, old: o } = payload;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (!n) return;
      if (this._isLocalEcho(n.id)) return;
      const p = this._normalize(n);
      const ex = this.pins.get(p.id);
      if (ex) p.myReactions = ex.myReactions;
      const wasNew = !ex;
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit(wasNew ? 'add' : 'update', p);
    } else if (eventType === 'DELETE' && o) {
      if (this._isLocalEcho(o.id)) return;
      const ex = this.pins.get(o.id);
      if (ex) {
        this.pins.delete(o.id);
        this._saveLS();
        this._emit('delete', ex);
      }
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export const EXPIRE_SECONDS = EXPIRE_SEC;
