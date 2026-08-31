import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Confirm the bytes really are one of the three formats we accept, by magic
 * number, before anything else parses them.
 *
 * The declared multipart content-type is attacker-controlled and proves
 * nothing. image-size sniffs the format from the bytes and dispatches to a
 * per-format parser — and it has published, currently UNFIXED advisories for
 * infinite loops in its ICNS, JXL and HEIF parsers. So "declare image/png,
 * send ICNS bytes" reached a hanging parser and burned the request (on Edge,
 * the isolate's CPU budget) for the cost of one upload.
 *
 * Checking the header ourselves means image-size only ever sees a format we
 * intend it to handle.
 */
export function sniffImageFormat(
  bytes: Uint8Array
): "jpeg" | "png" | "gif" | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) {
    return "png";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }
  return null;
}

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
