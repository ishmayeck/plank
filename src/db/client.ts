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
export interface AvatarConfig {
  maxWidth: number;
  maxHeight: number;
  maxFilesize: number;
}

const AVATAR_DEFAULTS: AvatarConfig = {
  maxWidth: 200,
  maxHeight: 200,
  maxFilesize: 6144,
};

/**
 * Fetch avatar settings from the config table.
 * Falls back to defaults if not configured.
 */
export async function getAvatarConfig(
  supabase: SupabaseClient
): Promise<AvatarConfig> {
  const { data: rows } = await supabase
    .from("config")
    .select("config_name, config_value")
    .in("config_name", [
      "avatar_max_width",
      "avatar_max_height",
      "avatar_filesize",
    ]);

  const cfg: Record<string, string> = {};
  if (rows) {
    for (const row of rows) {
      cfg[row.config_name] = row.config_value;
    }
  }

  return {
    maxWidth: parseInt(cfg.avatar_max_width ?? "", 10) || AVATAR_DEFAULTS.maxWidth,
    maxHeight: parseInt(cfg.avatar_max_height ?? "", 10) || AVATAR_DEFAULTS.maxHeight,
    maxFilesize: parseInt(cfg.avatar_filesize ?? "", 10) || AVATAR_DEFAULTS.maxFilesize,
  };
}

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
