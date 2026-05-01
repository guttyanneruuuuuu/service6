/**
 * Pinly data store.
 *
 * Layered storage:
 *   1. localStorage  — durable per-device storage of all pins this user
 *      can see (including seed pins + locally created pins).
 *   2. BroadcastChannel — instant cross-tab sync within the same browser
 *      so demos with multiple tabs feel "real-time".
 *   3. Supabase       — optional persistent cloud storage for real-time sync
 *      across devices and users.
 *   4. Seed JSON      — public/pins.json bootstrap so a fresh visit is
 *      not an empty map. Loaded once and merged.
 *
 * The schema is intentionally simple so it could be backed by Supabase
 * (or any KV) later without changing the API.
 *
 * Pin schema:
 *   {
 *     id:       string (uuid)
 *     lat,lng:  number
 *     cat:      string  (categories.js id)
 *     text:     string  (<= 50 chars)
 *     ts:       number  (unix seconds)
 *     loc:      string  (optional human-readable location)
 *     author:   string  (anonymous device id)
 *     reactions:{ emoji: count }
 *     myReactions: string[]   (emojis the local user has added)
 *     official: boolean       (paid pro pin)
 *   }
 */

import { 
  initSupabase, 
  fetchPinsFromSupabase, 
  insertPinToSupabase,
  updatePinInSupabase,
  subscribeToSupabasePins 
} from './supabase.js';

const LS_KEY = 'pinly.pins.v1';
const LS_SELF = 'pinly.self.v1';
const SEED_FLAG = 'pinly.seed.v1';
const BC_NAME = 'pinly.bc.v1';

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

  async init() {
    // 0. Initialize Supabase
    this.supabase = await initSupabase();
    
    // 1. Load from Supabase if available
    if (this.supabase) {
      try {
        const remotePins = await fetchPinsFromSupabase();
        remotePins.forEach((p) => {
          const normalized = this._normalize(p);
          this.pins.set(normalized.id, normalized);
        });
        
        // Subscribe to real-time updates
        this.supabaseSubscription = subscribeToSupabasePins((payload) => {
          this._onSupabaseChange(payload);
        });
      } catch (err) {
        console.warn('Supabase sync failed, using local storage:', err);
      }
    }
    
    // 2. Load from localStorage
    const local = this._loadLS();
    local.forEach((p) => this.pins.set(p.id, p));

    // 3. Merge seed pins on first visit (or if local is empty)
    const seedNeeded = !localStorage.getItem(SEED_FLAG) || this.pins.size === 0;
    if (seedNeeded) {
      try {
        const url = new URL('./pins.json', document.baseURI).toString();
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.pins)) {
            data.pins.forEach((p) => {
              const merged = this._normalize(p);
              // Don't overwrite a locally edited pin
              if (!this.pins.has(merged.id)) {
                this.pins.set(merged.id, merged);
              }
            });
            localStorage.setItem(SEED_FLAG, '1');
            this._saveLS();
          }
        }
      } catch {
        /* offline / ignore */
      }
    }

    this._emit('ready', { count: this.pins.size });
  }

  /* ---------- self ---------- */
  _loadSelf() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SELF) || '{}');
      if (s && s.id) return s;
    } catch {}
    const id = 'u_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
    const fresh = { id, joinedAt: Date.now() };
    localStorage.setItem(LS_SELF, JSON.stringify(fresh));
    return fresh;
  }

  /* ---------- LS ---------- */
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
    return {
      id: p.id || ('p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))),
      lat: +p.lat, lng: +p.lng,
      cat: p.cat || 'misc',
      text: String(p.text || '').slice(0, 50),
      ts: +p.ts || Math.floor(Date.now() / 1000),
      loc: p.loc || '',
      author: p.author || 'anon',
      reactions: p.reactions && typeof p.reactions === 'object' ? { ...p.reactions } : {},
      myReactions: Array.isArray(p.myReactions) ? [...p.myReactions] : [],
      official: !!p.official,
    };
  }

  /* ---------- public API ---------- */
  list() {
    return Array.from(this.pins.values());
  }

  get(id) { return this.pins.get(id); }

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
    
    // Save to Supabase
    if (this.supabase) {
      insertPinToSupabase(pin).catch(err => console.error('Failed to save to Supabase:', err));
    }
    
    this._emit('add', pin);
    this._broadcast({ t: 'add', pin });
    return pin;
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
      p.myReactions.push(emoji);
      p.reactions[emoji] = (p.reactions[emoji] || 0) + 1;
    }
    this._saveLS();
    
    // Update in Supabase
    if (this.supabase) {
      updatePinInSupabase(id, { reactions: p.reactions }).catch(err => console.error('Failed to update reactions:', err));
    }
    
    this._emit('update', p);
    this._broadcast({ t: 'update', pin: p });
    return p;
  }

  report(id) {
    // Local-only report flag (would post to server in production)
    const p = this.pins.get(id);
    if (!p) return;
    p._reported = true;
    this._saveLS();
    this._emit('update', p);
  }

  /* ---------- queries / aggregations ---------- */
  hot(limit = 25) {
    // weighted: total reactions + recent boost
    const now = Math.floor(Date.now() / 1000);
    return this.list()
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
    return this.list().sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  // Group pins by ~rounded lat/lng to find "spots"
  spots(limit = 15) {
    const buckets = new Map();
    for (const p of this.list()) {
      const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      let b = buckets.get(key);
      if (!b) {
        b = { key, lat: 0, lng: 0, n: 0, samples: [], reactSum: 0, locCounts: new Map() };
        buckets.set(key, b);
      }
      b.lat += p.lat; b.lng += p.lng; b.n += 1;
      b.samples.push(p);
      b.reactSum += Object.values(p.reactions || {}).reduce((a, b2) => a + b2, 0);
      if (p.loc) b.locCounts.set(p.loc, (b.locCounts.get(p.loc) || 0) + 1);
    }
    const arr = Array.from(buckets.values()).map((b) => {
      let bestLoc = '', bestN = 0;
      b.locCounts.forEach((n, name) => { if (n > bestN) { bestN = n; bestLoc = name; } });
      return {
        lat: b.lat / b.n, lng: b.lng / b.n,
        count: b.n, reactions: b.reactSum,
        loc: bestLoc || `${b.lat.toFixed(2) / b.n}, ${b.lng.toFixed(2) / b.n}`,
        samples: b.samples,
      };
    });
    return arr.sort((a, b) => (b.count * 2 + b.reactions) - (a.count * 2 + a.reactions)).slice(0, limit);
  }

  filter({ cat = 'all', q = '' } = {}) {
    const ql = q.trim().toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const EXPIRE_SEC = 48 * 3600; // 48 hours

    return this.list().filter((p) => {
      if (p._reported) return false; // Hide reported pins
      if (now - p.ts > EXPIRE_SEC && !p.official) return false; // Hide expired pins (except official)
      if (cat !== 'all' && p.cat !== cat) return false;
      if (!ql) return true;
      return (
        p.text.toLowerCase().includes(ql) ||
        (p.loc || '').toLowerCase().includes(ql)
      );
    });
  }

  /* ---------- BroadcastChannel ---------- */
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
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit('update', p);
    }
  }

  /* ---------- Supabase handlers ---------- */
  _onSupabaseChange(payload) {
    // Handle real-time updates from Supabase
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const p = this._normalize(newRecord);
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit(eventType === 'INSERT' ? 'add' : 'update', p);
    } else if (eventType === 'DELETE') {
      this.pins.delete(oldRecord.id);
      this._saveLS();
      this._emit('delete', oldRecord);
    }
  }

  /* ---------- emit ---------- */
  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
