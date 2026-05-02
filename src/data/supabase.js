/**
 * Supabase integration for Pinly
 * 
 * This module provides persistent data storage for pins using Supabase.
 * It maintains backward compatibility with the local-only store.
 */

// Initialize Supabase client
// Prioritize settings from window.PINLY_SUPABASE (set in index.html)
const SUPABASE_URL = window.PINLY_SUPABASE?.url || 'https://ebpkewkqorvditwhgzuh.supabase.co';
const SUPABASE_ANON_KEY = window.PINLY_SUPABASE?.key || 'sb_publishable_hH1Z65DBq4Zg0kVFSy-CuA_9BC1uuYS';

// Check if Supabase is available
let supabaseClient = null;

async function initSupabase() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.log('Supabase not configured. Using local storage only.');
      return null;
    }

    // Dynamically import Supabase client from esm.sh (matches CSP)
    const mod = await import('https://esm.sh/@supabase/supabase-js@2.45.4?bundle');
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (typeof createClient !== 'function') {
      throw new Error('Supabase createClient not found in module');
    }

    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    console.log('[Pinly] Supabase initialized:', SUPABASE_URL);
    return supabaseClient;
  } catch (err) {
    console.warn('[Pinly] Supabase initialization failed:', err);
    return null;
  }
}

/**
 * Fetch all pins from Supabase
 */
async function fetchPinsFromSupabase() {
  if (!supabaseClient) return [];
  
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .select('*')
      .order('ts', { ascending: false });
    
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to fetch pins:', err);
    return [];
  }
}

/**
 * Insert a new pin to Supabase
 */
async function insertPinToSupabase(pin) {
  if (!supabaseClient) return null;
  
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .insert([pin])
      .select();
    
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.error('Failed to insert pin:', err);
    return null;
  }
}

/**
 * Update a pin in Supabase
 */
async function updatePinInSupabase(id, updates) {
  if (!supabaseClient) return null;
  
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .update(updates)
      .eq('id', id)
      .select();
    
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.error('Failed to update pin:', err);
    return null;
  }
}

/**
 * Delete a pin from Supabase
 */
async function deletePinFromSupabase(id) {
  if (!supabaseClient) return false;
  
  try {
    const { error } = await supabaseClient
      .from('pins')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Failed to delete pin:', err);
    return false;
  }
}

/**
 * Subscribe to real-time pin updates.
 * Combines:
 *  - postgres_changes (DB level INSERT/UPDATE/DELETE)
 *  - broadcast channel (cross-device fallback when pg replication is OFF)
 */
function subscribeToSupabasePins(callback) {
  if (!supabaseClient) return null;

  const channel = supabaseClient
    .channel('pins-realtime', {
      config: { broadcast: { self: false }, presence: { key: '' } },
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pins' },
      (payload) => {
        console.log('[Pinly] postgres_changes:', payload.eventType);
        callback(payload);
      }
    )
    .on('broadcast', { event: 'pin' }, ({ payload }) => {
      if (!payload || !payload.t) return;
      console.log('[Pinly] broadcast:', payload.t);
      if (payload.t === 'add' && payload.pin) {
        callback({ eventType: 'INSERT', new: payload.pin, old: null });
      } else if (payload.t === 'update' && payload.pin) {
        callback({ eventType: 'UPDATE', new: payload.pin, old: null });
      } else if (payload.t === 'delete' && payload.pin) {
        callback({ eventType: 'DELETE', new: null, old: payload.pin });
      }
    })
    .subscribe((status, err) => {
      console.log('[Pinly] realtime status:', status, err || '');
    });

  return channel;
}

/**
 * Send broadcast message (cross-device sync without pg replication).
 */
async function broadcastPin(channel, type, pin) {
  if (!channel) return;
  try {
    await channel.send({
      type: 'broadcast',
      event: 'pin',
      payload: { t: type, pin },
    });
  } catch (err) {
    console.warn('[Pinly] broadcast send failed:', err);
  }
}

function getSupabaseClient() {
  return supabaseClient;
}

export {
  initSupabase,
  fetchPinsFromSupabase,
  insertPinToSupabase,
  updatePinInSupabase,
  deletePinFromSupabase,
  subscribeToSupabasePins,
  broadcastPin,
  getSupabaseClient,
};
