/**
 * Supabase integration for Pinly.
 *
 * Important constraints:
 *   - The `pins` table columns are all lowercase.
 *   - `myReactions` is per-device localStorage only; strip before DB operations.
 *   - CSP only allows script imports from `esm.sh`.
 */

const STORAGE_KEY = 'pinly.supabase.config';

// Public defaults — anon "publishable" key is safe to expose; RLS protects writes.
const DEFAULT_URL = 'https://ebpkewkqorvditwhgzuh.supabase.co';
const DEFAULT_KEY = 'sb_publishable_hH1Z65DBq4Zg0kVFSy-CuA_9BC1uuYS';

let supabaseClient = null;
let activeChannel  = null;
let pollingInterval = null;

function readConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && cfg.url && cfg.key) return cfg;
    }
  } catch {}
  
  if (typeof window !== 'undefined' && window.PINLY_SUPABASE) {
    const cfg = window.PINLY_SUPABASE;
    if (cfg && cfg.url && cfg.key) return cfg;
  }
  
  return { url: DEFAULT_URL, key: DEFAULT_KEY };
}

export function setSupabaseConfig({ url, key }) {
  if (!url || !key) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, key })); } catch {}
}

function toRow(pin) {
  if (!pin) return pin;
  return {
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
}

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
    console.warn('[Pinly] insertPin failed:', err);
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

export function subscribeToSupabasePins(callback) {
  if (!supabaseClient) return null;

  if (activeChannel) {
    try { supabaseClient.removeChannel(activeChannel); } catch {}
  }

  console.log('[Pinly] Setting up dual-mode realtime (Broadcast + Postgres)...');
  
  activeChannel = supabaseClient
    .channel('pins-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pins' },
      (payload) => {
        console.log('[Pinly] Real-time (Postgres):', payload.eventType);
        callback(payload);
      }
    )
    .on(
      'broadcast',
      { event: 'pin_change' },
      (payload) => {
        console.log('[Pinly] Real-time (Broadcast):', payload.type);
        const mappedPayload = {
          eventType: payload.type,
          new: payload.pin,
          old: payload.oldPin
        };
        callback(mappedPayload);
      }
    )
    .subscribe((status) => {
      console.info('[Pinly] Realtime subscription status:', status);
      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        console.warn('[Pinly] Realtime connection failed. Falling back to polling mode.');
        startPollingFallback(callback);
      }
    });

  return activeChannel;
}

function startPollingFallback(callback) {
  if (pollingInterval) return;
  
  console.log('[Pinly] Polling fallback active (every 10s)');
  pollingInterval = setInterval(async () => {
    try {
      const pins = await fetchPinsFromSupabase();
      callback({ eventType: 'POLL', pins });
    } catch (err) {
      console.error('[Pinly] Polling failed:', err);
    }
  }, 10000);
}

export function broadcastPinChange(type, pin, oldPin = null) {
  if (!supabaseClient || !activeChannel) return;
  
  activeChannel.send({
    type: 'broadcast',
    event: 'pin_change',
    payload: { type, pin, oldPin },
  }).then((resp) => {
    if (resp === 'ok') {
      console.log(`[Pinly] Broadcasted: ${type} ${pin.id}`);
    } else {
      console.warn('[Pinly] Broadcast failed:', resp);
    }
  });
}

export function getSupabaseClient() {
  return supabaseClient;
}
