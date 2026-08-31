import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _serviceClient: SupabaseClient | null = null;

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
