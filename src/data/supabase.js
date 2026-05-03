/**
 * Supabase integration for Pinly
 * ===============================
 *
 * - Initializes a single Supabase client (anon/publishable key only).
 * - Persists Supabase Auth sessions in localStorage so logins survive reload.
 * - Handles realtime subscriptions with:
 *     * postgres_changes  (the "real" cross-device path; needs replication ON)
 *     * broadcast channel (low-cost fallback so two clients still sync even
 *                          when DB replication is OFF or rate-limited)
 *     * automatic resubscribe on disconnect / token refresh
 * - All write paths call into RLS-protected tables — the server is the
 *   final authority on who can write what.
 *
 * NOTE on keys: the `sb_publishable_*` (or legacy anon JWT) key is *meant*
 * to ship to browsers. Real auth comes from RLS + auth.uid().
 */

const DEFAULT_URL = 'https://ebpkewkqorvditwhgzuh.supabase.co';
const DEFAULT_KEY = 'sb_publishable_hH1Z65DBq4Zg0kVFSy-CuA_9BC1uuYS';

const SUPABASE_URL = (typeof window !== 'undefined' && window.PINLY_SUPABASE && window.PINLY_SUPABASE.url) || DEFAULT_URL;
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.PINLY_SUPABASE && window.PINLY_SUPABASE.key) || DEFAULT_KEY;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let supabaseClient = null;
let _initPromise = null;

/** Initialize Supabase. Idempotent + cached: callers can `await` it any number
 *  of times and get the same instance. Returns null when the SDK can't load. */
export async function initSupabase() {
  if (supabaseClient) return supabaseClient;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.log('[Pinly] Supabase not configured — local-only mode.');
        return null;
      }
      // Load the SDK at runtime (CSP allows esm.sh).
      const mod = await import('https://esm.sh/@supabase/supabase-js@2.45.4?bundle');
      const createClient = mod.createClient || (mod.default && mod.default.createClient);
      if (typeof createClient !== 'function') {
        throw new Error('Supabase createClient export not found');
      }

      supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // Persist auth sessions so users stay signed in across reloads.
          // The auth token never grants more than RLS lets it.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'pinly.auth.v1',
          flowType: 'pkce',
        },
        realtime: {
          params: { eventsPerSecond: 10 },
        },
        global: {
          headers: { 'x-client-info': 'pinly-web/0.2' },
        },
      });
      console.log('[Pinly] Supabase initialized:', SUPABASE_URL);
      return supabaseClient;
    } catch (err) {
      console.warn('[Pinly] Supabase init failed:', err && err.message);
      return null;
    }
  })();

  return _initPromise;
}

export function getSupabaseClient() { return supabaseClient; }

/* ============================================================
 *  Pin CRUD
 * ============================================================ */

/** Map a DB row to the Pinly client schema. We accept both `myreactions`
 *  (Postgres lower-cases identifiers) and `myReactions` for resilience. */
function rowToPin(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    cat: String(row.cat || 'misc'),
    text: String(row.text || '').slice(0, 50),
    ts: Number(row.ts) || 0,
    loc: row.loc ? String(row.loc).slice(0, 80) : '',
    author: String(row.author || 'anon'),
    reactions: row.reactions && typeof row.reactions === 'object' ? row.reactions : {},
    official: !!row.official,
    _reported: !!row._reported,
    _hidden: !!row._hidden,
  };
}

/** Pick only the columns we are allowed to send to the server. Drops local-
 *  only fields like `myReactions`. */
function pinForServer(pin) {
  return {
    id: pin.id,
    lat: pin.lat,
    lng: pin.lng,
    cat: pin.cat,
    text: pin.text,
    ts: pin.ts,
    loc: pin.loc || null,
    author: pin.author,
    reactions: pin.reactions || {},
    official: !!pin.official,
  };
}

/** Fetch recent, non-reported pins. Defaults to last 48h + official pins. */
export async function fetchPinsFromSupabase({ sinceSec } = {}) {
  if (!supabaseClient) return [];
  const cutoff = sinceSec || (Math.floor(Date.now() / 1000) - 48 * 3600);
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .select('*')
      .or(`ts.gte.${cutoff},official.eq.true`)
      .order('ts', { ascending: false })
      .limit(2000);
    if (error) throw error;
    return (data || []).map(rowToPin).filter(Boolean);
  } catch (err) {
    console.warn('[Pinly] fetchPins failed:', err && err.message);
    return [];
  }
}

export async function insertPinToSupabase(pin) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .insert([pinForServer(pin)])
      .select()
      .single();
    if (error) throw error;
    return rowToPin(data);
  } catch (err) {
    // 401/403 means RLS blocked us — surface as null so caller can warn user.
    console.warn('[Pinly] insertPin failed:', err && err.message);
    return null;
  }
}

export async function updatePinInSupabase(id, updates) {
  if (!supabaseClient || !id) return null;
  // Only allow whitelisted columns to be updated from the client.
  const safe = {};
  if ('reactions' in updates) safe.reactions = updates.reactions || {};
  if ('text' in updates) safe.text = String(updates.text || '').slice(0, 50);
  if ('cat' in updates) safe.cat = String(updates.cat || 'misc');
  if ('_reported' in updates) safe._reported = !!updates._reported;
  if (Object.keys(safe).length === 0) return null;
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .update(safe)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return rowToPin(data);
  } catch (err) {
    console.warn('[Pinly] updatePin failed:', err && err.message);
    return null;
  }
}

export async function deletePinFromSupabase(id) {
  if (!supabaseClient || !id) return false;
  try {
    const { error } = await supabaseClient.from('pins').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[Pinly] deletePin failed:', err && err.message);
    return false;
  }
}

/* ============================================================
 *  Realtime — robust cross-device sync
 * ============================================================
 *
 *  - Subscribes to `postgres_changes` for the canonical DB path.
 *  - Also listens on a `broadcast` channel `pin` so peers can echo writes
 *    directly (works even when DB replication is OFF for the pins table).
 *  - Tracks presence so the UI can show "X people online".
 *  - Auto-resubscribes if the channel errors out.
 *  - Heart-beats periodically to detect zombie connections.
 *
 *  The handle returned by `subscribeToSupabasePins` exposes:
 *      .channel              live RealtimeChannel
 *      .send(type, payload)  broadcast a write to other peers
 *      .presenceCount()      number of connected peers (incl. self)
 *      .destroy()            tear it down
 */
export function subscribeToSupabasePins(callback, opts = {}) {
  if (!supabaseClient || typeof callback !== 'function') return null;

  const onPresence = typeof opts.onPresence === 'function' ? opts.onPresence : null;
  const onStatus   = typeof opts.onStatus === 'function' ? opts.onStatus : null;

  let channel = null;
  let destroyed = false;
  let backoff = 1000;             // start 1s
  let backoffTimer = null;
  let presenceState = {};
  let lastEventAt = Date.now();
  let watchdog = null;

  const presenceKey = opts.presenceKey || 'anon-' + Math.random().toString(36).slice(2, 8);

  const dedupe = new Map();       // simple ring to drop echoes within 8s
  function isDuplicate(eventId) {
    if (!eventId) return false;
    const now = Date.now();
    // Cleanup
    for (const [k, t] of dedupe) {
      if (now - t > 8000) dedupe.delete(k);
    }
    if (dedupe.has(eventId)) return true;
    dedupe.set(eventId, now);
    return false;
  }

  function safeCb(payload) {
    lastEventAt = Date.now();
    try { callback(payload); } catch (err) { console.warn('[Pinly] realtime cb error:', err); }
  }

  function attach() {
    if (destroyed) return;
    try {
      channel = supabaseClient.channel('pinly:pins:v2', {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: presenceKey },
        },
      });

      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pins' }, (payload) => {
          const id = `${payload.eventType}:${payload.new && payload.new.id || payload.old && payload.old.id}:${payload.commit_timestamp || ''}`;
          if (isDuplicate(id)) return;
          safeCb({
            source: 'pg',
            eventType: payload.eventType,
            new: payload.new ? rowToPin(payload.new) : null,
            old: payload.old ? rowToPin(payload.old) : null,
          });
        })
        .on('broadcast', { event: 'pin' }, ({ payload }) => {
          if (!payload || !payload.t) return;
          const eid = payload.eid || `${payload.t}:${payload.pin && payload.pin.id}:${payload.ts || ''}`;
          if (isDuplicate(eid)) return;
          if (payload.t === 'add' && payload.pin) {
            safeCb({ source: 'bc', eventType: 'INSERT', new: rowToPin(payload.pin), old: null });
          } else if (payload.t === 'update' && payload.pin) {
            safeCb({ source: 'bc', eventType: 'UPDATE', new: rowToPin(payload.pin), old: null });
          } else if (payload.t === 'delete' && payload.pin) {
            safeCb({ source: 'bc', eventType: 'DELETE', new: null, old: rowToPin(payload.pin) });
          }
        })
        .on('presence', { event: 'sync' }, () => {
          presenceState = channel.presenceState();
          if (onPresence) {
            try { onPresence(Object.keys(presenceState).length); } catch {}
          }
        })
        .subscribe(async (status, err) => {
          if (onStatus) { try { onStatus(status, err); } catch {} }
          console.log('[Pinly] realtime status:', status, err ? err.message || err : '');
          if (status === 'SUBSCRIBED') {
            backoff = 1000; // reset backoff on success
            try {
              await channel.track({ online_at: Date.now(), key: presenceKey });
            } catch {}
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            scheduleReconnect();
          }
        });
    } catch (err) {
      console.warn('[Pinly] realtime attach failed:', err && err.message);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (destroyed) return;
    if (backoffTimer) return;
    const delay = Math.min(backoff, 30000);
    backoff = Math.min(backoff * 2, 30000);
    console.log(`[Pinly] realtime reconnect in ${delay}ms`);
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      try { if (channel) supabaseClient.removeChannel(channel); } catch {}
      channel = null;
      attach();
    }, delay);
  }

  // Watchdog: if no activity for 90s and we *should* be subscribed, force reconnect.
  watchdog = setInterval(() => {
    if (destroyed) return;
    if (!channel) return;
    const idleMs = Date.now() - lastEventAt;
    if (idleMs > 90000) {
      const state = channel.state;
      if (state !== 'joined') {
        scheduleReconnect();
      }
    }
  }, 30000);

  // Reconnect on focus / online
  const onVis = () => {
    if (document.visibilityState === 'visible' && channel && channel.state !== 'joined') {
      scheduleReconnect();
    }
  };
  const onOnline = () => scheduleReconnect();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', onOnline);

  attach();

  return {
    get channel() { return channel; },
    presenceCount() { return Object.keys(presenceState).length; },
    /** Send a broadcast write so peers see it instantly (BC fallback path). */
    async send(type, pin) {
      if (!channel) return;
      const eid = `${type}:${pin && pin.id}:${Date.now()}`;
      try {
        await channel.send({
          type: 'broadcast',
          event: 'pin',
          payload: { t: type, pin, eid, ts: Date.now() },
        });
      } catch (err) {
        console.warn('[Pinly] broadcast send failed:', err && err.message);
      }
    },
    destroy() {
      destroyed = true;
      if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      try { if (channel) supabaseClient.removeChannel(channel); } catch {}
      channel = null;
    },
  };
}

/** Convenience for callers that already have a handle. */
export async function broadcastPin(handle, type, pin) {
  if (!handle || typeof handle.send !== 'function') return;
  return handle.send(type, pin);
}
