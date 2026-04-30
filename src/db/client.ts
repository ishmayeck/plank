import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;
let _serviceClient: SupabaseClient | null = null;

/**
 * Get the Supabase client using the anon key.
 * Used for client-side-like operations (respects RLS).
 */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
    }
    _client = createClient(url, key);
  }
  return _client;
}

/**
 * Get the Supabase client using the service role key.
 * Used for admin operations that bypass RLS.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_serviceClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    _serviceClient = createClient(url, key);
  }
  return _serviceClient;
}
