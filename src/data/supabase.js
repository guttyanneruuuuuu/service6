/**
 * Supabase integration for Pinly (optional cloud sync).
 *
 * Configuration is read from (in order):
 *   1. localStorage('pinly.supabase.config') => { url, key }
 *   2. window.PINLY_SUPABASE = { url, key }
 *
 * If neither exists, the module gracefully no-ops and the app falls back
 * to local-only mode. The deployed site works without any server config,
 * while power-users can plug in their own Supabase project.
 *
 * Security: We validate that `url` is a `https://*.supabase.co` URL before
 * accepting it, to prevent localStorage injection from pointing the app at
 * an attacker-controlled endpoint.
 */

const STORAGE_KEY = 'pinly.supabase.config';

let supabaseClient = null;
let activeChannel = null;

/** Validate URL is a legitimate Supabase https endpoint. */
function isValidSupabaseUrl(url) {
  if (typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return /^[a-z0-9-]+\.supabase\.(co|in)$/i.test(u.hostname);
}

/** A Supabase anon/publishable key looks like a JWT. */
function isPlausibleKey(key) {
  if (typeof key !== 'string') return false;
  if (key.length < 40 || key.length > 1024) return false;
  // Allow JWT-like or base64 ish chars
  return /^[A-Za-z0-9._-]+$/.test(key);
}

function readConfig() {
  // 1. localStorage override
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && isValidSupabaseUrl(cfg.url) && isPlausibleKey(cfg.key)) return cfg;
    }
  } catch {}
  // 2. global injection
  if (typeof window !== 'undefined' && window.PINLY_SUPABASE) {
    const cfg = window.PINLY_SUPABASE;
    if (cfg && isValidSupabaseUrl(cfg.url) && isPlausibleKey(cfg.key)) return cfg;
  }
  return null;
}

export function setSupabaseConfig({ url, key }) {
  if (!url || !key) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return false;
  }
  if (!isValidSupabaseUrl(url) || !isPlausibleKey(key)) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, key }));
    return true;
  } catch { return false; }
}

export async function initSupabase() {
  const cfg = readConfig();
  if (!cfg) {
    // Quiet info — local-only mode is the default.
    return null;
  }
  try {
    const mod = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    supabaseClient = mod.createClient(cfg.url, cfg.key, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
    return supabaseClient;
  } catch (err) {
    console.warn('[Pinly] Supabase init failed:', err?.message || err);
    supabaseClient = null;
    return null;
  }
}

export function getSupabase() {
  return supabaseClient;
}

export async function fetchPinsFromSupabase(limit = 1000) {
  if (!supabaseClient) return [];
  const safeLimit = Math.max(1, Math.min(5000, limit | 0 || 1000));
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .select('*')
      .order('ts', { ascending: false })
      .limit(safeLimit);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[Pinly] fetch failed:', err?.message || err);
    return [];
  }
}

export async function insertPinToSupabase(pin) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.from('pins').insert([pin]).select();
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.warn('[Pinly] insert failed:', err?.message || err);
    return null;
  }
}

export async function updatePinInSupabase(id, updates) {
  if (!supabaseClient) return null;
  if (typeof id !== 'string' || id.length > 64) return null;
  try {
    const { data, error } = await supabaseClient.from('pins').update(updates).eq('id', id).select();
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.warn('[Pinly] update failed:', err?.message || err);
    return null;
  }
}

export async function deletePinFromSupabase(id) {
  if (!supabaseClient) return false;
  if (typeof id !== 'string' || id.length > 64) return false;
  try {
    const { error } = await supabaseClient.from('pins').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[Pinly] delete failed:', err?.message || err);
    return false;
  }
}

export function subscribeToSupabasePins(callback) {
  if (!supabaseClient) return null;
  if (activeChannel) {
    try { supabaseClient.removeChannel(activeChannel); } catch {}
  }
  activeChannel = supabaseClient
    .channel('pins-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pins' }, (payload) => {
      try { callback(payload); } catch (err) { console.warn('[Pinly] realtime cb failed:', err?.message || err); }
    })
    .on('subscribe', () => {
      console.log('[Pinly] Realtime subscribed successfully');
    })
    .on('error', (err) => {
      console.warn('[Pinly] Realtime subscription error:', err?.message || err);
    })
    .subscribe((status) => {
      console.log('[Pinly] Realtime subscription status:', status);
    });
  return activeChannel;
}
