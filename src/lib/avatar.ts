import type { SupabaseClient } from "@supabase/supabase-js";

export interface AvatarConfig {
  maxWidth: number;
  maxHeight: number;
  maxFilesize: number;
}

const AVATAR_DEFAULTS: AvatarConfig = {
  maxWidth: 200,
  maxHeight: 200,
  maxFilesize: 6291456, // 6 MB
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
