/**
 * Supabase integration for Pinly.
 *
 * Important constraints we discovered while talking to the live DB:
 *   - The `pins` table columns are all lowercase: id, lat, lng, cat, text,
 *     ts, loc, author, reactions, official, _reported, _reportcount, _hidden.
 *   - There is NO `myReactions` / `myreactions` column. That field is purely
 *     a per-device flag tracked in localStorage; we MUST strip it before
 *     INSERT / UPDATE or PostgREST returns PGRST204.
 *   - The CSP on the page only whitelists script imports from `esm.sh`,
 *     so we cannot use `cdn.jsdelivr.net` for the Supabase client.
 *
 * Configuration sources (priority order):
 *   1. localStorage('pinly.supabase.config')  => { url, key }
 *   2. window.PINLY_SUPABASE                  => { url, key }
 *   3. baked-in fallback (the public anon key for this project)
 */

const STORAGE_KEY = 'pinly.supabase.config';

// Public defaults — anon "publishable" key is safe to expose; RLS protects writes.
const DEFAULT_URL = 'https://ebpkewkqorvditwhgzuh.supabase.co';
const DEFAULT_KEY = 'sb_publishable_hH1Z65DBq4Zg0kVFSy-CuA_9BC1uuYS';

let supabaseClient = null;
let activeChannel  = null;

function readConfig() {
  // 1. localStorage override
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && cfg.url && cfg.key) return cfg;
    }
  } catch {}
  // 2. global injection
  if (typeof window !== 'undefined' && window.PINLY_SUPABASE) {
    const cfg = window.PINLY_SUPABASE;
    if (cfg && cfg.url && cfg.key) return cfg;
  }
  // 3. baked-in default
  return { url: DEFAULT_URL, key: DEFAULT_KEY };
}

export function setSupabaseConfig({ url, key }) {
  if (!url || !key) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, key })); } catch {}
}

/**
 * Strip fields that don't exist in the DB schema OR that are
 * intentionally per-device (myReactions). Also coerces the keys we DO
 * persist into the lowercase column names PostgREST exposes.
 */
function toRow(pin) {
  if (!pin) return pin;
  const out = {
    id:        pin.id,
    lat:       +pin.lat,
    lng:       +pin.lng,
    cat:       pin.cat || 'misc',
    text:      String(pin.text || '').slice(0, 50),
    ts:        +pin.ts || Math.floor(Date.now() / 1000),
    loc:       pin.loc || '',
    author:    pin.author || 'anon',
    reactions: (pin.reactions && typeof pin.reactions === 'object') ? pin.reactions : {},
    official:  !!pin.official,
  };
  if (typeof pin._reported === 'boolean') out._reported = pin._reported;
  // Accept either casing from the caller; column is lowercase.
  const rc = (typeof pin._reportCount === 'number') ? pin._reportCount
           : (typeof pin._reportcount === 'number') ? pin._reportcount
           : null;
  if (rc !== null) out._reportcount = rc;
  if (typeof pin._hidden === 'boolean') out._hidden = pin._hidden;
  return out;
}

/** Same idea but for partial updates — only forward fields that exist in DB. */
function toUpdates(updates) {
  if (!updates || typeof updates !== 'object') return {};
  const out = {};
  const allow = new Set([
    'lat','lng','cat','text','ts','loc','author','reactions','official',
    '_reported','_hidden',
  ]);
  for (const k of Object.keys(updates)) {
    if (allow.has(k)) out[k] = updates[k];
    else if (k === '_reportCount' || k === '_reportcount') {
      out._reportcount = updates[k];
    }
  }
  return out;
}

export async function initSupabase() {
  const cfg = readConfig();
  if (!cfg) {
    console.info('[Pinly] Supabase not configured — running in local-only mode.');
    return null;
  }
  try {
    // CSP only allows esm.sh for dynamic imports — DO NOT switch to jsdelivr.
    const mod = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (!createClient) throw new Error('createClient not found in @supabase/supabase-js');
    supabaseClient = createClient(cfg.url, cfg.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    console.info('[Pinly] Supabase client ready.');
    return supabaseClient;
  } catch (err) {
    console.warn('[Pinly] Supabase init failed:', err);
    supabaseClient = null;
    return null;
  }
}

export async function fetchPinsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .select('*')
      .order('ts', { ascending: false })
      .limit(2000);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Pinly] fetchPins failed:', err);
    return [];
  }
}

export async function insertPinToSupabase(pin) {
  if (!supabaseClient) return null;
  try {
    const row = toRow(pin);
    const { data, error } = await supabaseClient
      .from('pins')
      .insert([row])
      .select();
    if (error) throw error;
    return (data && data[0]) || null;
  } catch (err) {
    // RLS rejection is the most common failure mode here.
    if (err && (err.code === '42501' || /row-level security/i.test(err.message || ''))) {
      console.warn(
        '[Pinly] Supabase INSERT blocked by RLS. ' +
        'Run SUPABASE_FIX.sql in the SQL editor to allow anon inserts. ' +
        'Falling back to local + BroadcastChannel only for now.'
      );
    } else {
      console.warn('[Pinly] insertPin failed:', err);
    }
    return null;
  }
}

export async function updatePinInSupabase(id, updates) {
  if (!supabaseClient) return null;
  try {
    const patch = toUpdates(updates);
    if (Object.keys(patch).length === 0) return null;
    const { data, error } = await supabaseClient
      .from('pins')
      .update(patch)
      .eq('id', id)
      .select();
    if (error) throw error;
    return (data && data[0]) || null;
  } catch (err) {
    console.warn('[Pinly] updatePin failed:', err);
    return null;
  }
}

export async function deletePinFromSupabase(id) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from('pins')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[Pinly] deletePin failed:', err);
    return false;
  }
}

/**
 * Subscribe to realtime changes on the `pins` table.
 *
 * Returns the channel handle (so callers can unsubscribe later).
 * The callback receives the raw `payload` from Supabase Realtime,
 * with `eventType`, `new`, `old`.
 */
export function subscribeToSupabasePins(callback) {
  if (!supabaseClient) return null;

  // Tear down any previous channel — multiple subscriptions cause duplicate
  // events, which is a common cause of "the same pin appears twice" bugs.
  if (activeChannel) {
    try { supabaseClient.removeChannel(activeChannel); } catch {}
    activeChannel = null;
  }

  activeChannel = supabaseClient
    .channel('pinly-pins-' + Math.random().toString(36).slice(2, 8))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pins' },
        (payload) => {
          try { callback(payload); } catch (e) { console.warn('[Pinly] realtime cb error', e); }
        })
    .subscribe((status) => {
      console.info('[Pinly] Realtime subscription status:', status);
    });

  return activeChannel;
}

export function getSupabaseClient() {
  return supabaseClient;
}
