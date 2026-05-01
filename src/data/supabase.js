/**
 * Supabase integration for Pinly
 * 
 * This module provides persistent data storage for pins using Supabase.
 * It maintains backward compatibility with the local-only store.
 */

// Initialize Supabase client
// Note: Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

// Check if Supabase is available
let supabaseClient = null;

async function initSupabase() {
  try {
    // Dynamically import Supabase client
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    
    if (!SUPABASE_URL || SUPABASE_URL.includes('your-project')) {
      console.warn('Supabase not configured. Using local storage only.');
      return null;
    }
    
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase initialized');
    return supabaseClient;
  } catch (err) {
    console.warn('Supabase initialization failed:', err);
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
 * Subscribe to real-time pin updates
 */
function subscribeToSupabasePins(callback) {
  if (!supabaseClient) return null;
  
  return supabaseClient
    .channel('pins-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pins' },
      (payload) => {
        callback(payload);
      }
    )
    .subscribe();
}

export {
  initSupabase,
  fetchPinsFromSupabase,
  insertPinToSupabase,
  updatePinInSupabase,
  deletePinFromSupabase,
  subscribeToSupabasePins,
};
