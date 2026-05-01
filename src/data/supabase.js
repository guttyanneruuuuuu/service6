/**
 * Supabase integration for Pinly (optional cloud sync).
 *
 * Configuration is read from (in order):
 *   1. localStorage('pinly.supabase.config') => { url, key }
 *   2. window.PINLY_SUPABASE = { url, key }
 *
 * If neither exists, the module gracefully no-ops and the app falls back
 * to local-only mode. This means the public deployment works without any
 * server config, while power-users can plug in their own Supabase project.
 */

const STORAGE_KEY = 'pinly.supabase.config';

let supabaseClient = null;
let activeChannel = null;

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
  return null;
}

export function setSupabaseConfig({ url, key }) {
  if (!url || !key) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, key }));
}

export async function initSupabase() {
  const cfg = readConfig();
  if (!cfg) {
    console.info('[Pinly] Supabase not configured — running in local-only mode.');
    return null;
  }
  try {
    const mod = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    supabaseClient = mod.createClient(cfg.url, cfg.key, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
    console.info('[Pinly] Supabase initialized');
    return supabaseClient;
  } catch (err) {
    console.warn('[Pinly] Supabase init failed:', err);
    supabaseClient = null;
    return null;
  }
}

export function getSupabase() {
  return supabaseClient;
}

export async function fetchPinsFromSupabase(limit = 1000) {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .select('*')
      .order('ts', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Pinly] fetch failed:', err);
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
    console.warn('[Pinly] insert failed:', err);
    return null;
  }
}

export async function updatePinInSupabase(id, updates) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.from('pins').update(updates).eq('id', id).select();
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.warn('[Pinly] update failed:', err);
    return null;
  }
}

export async function deletePinFromSupabase(id) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('pins').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[Pinly] delete failed:', err);
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pins' }, callback)
    .subscribe();
  return activeChannel;
}
