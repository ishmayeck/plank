import type { SupabaseClient } from "@supabase/supabase-js";

export interface Smiley {
  code: string;
  smile_url: string;
  emoticon: string;
}

let cachedSmilies: Smiley[] | null = null;

/**
 * Load smilies from database (cached after first load).
 */
export async function loadSmilies(
  supabase: SupabaseClient
): Promise<Smiley[]> {
  if (cachedSmilies) return cachedSmilies;

  const { data } = await supabase
    .from("smilies")
    .select("code, smile_url, emoticon")
    .order("id");

  // Deduplicate by smile_url (keep first occurrence, matching phpBB2)
  const seen = new Set<string>();
  const unique: Smiley[] = [];
  for (const s of data ?? []) {
    if (!seen.has(s.smile_url)) {
      seen.add(s.smile_url);
      unique.push(s);
    }
  }

  cachedSmilies = unique;
  return cachedSmilies;
}

/**
 * Replace smiley codes in text with image tags.
 * Should be called on HTML output (after BBCode parsing).
 */
export function replaceSmilies(
  text: string,
  smilies: Smiley[],
  imagePath: string = "images/smiles"
): string {
  // Sort by longest code first so :-) is matched before :)
  const sorted = [...smilies].sort(
    (a, b) => b.code.length - a.code.length
  );

  for (const smiley of sorted) {
    const escaped = smiley.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "g");
    text = text.replace(
      regex,
      `<img src="${imagePath}/${smiley.smile_url}" alt="${smiley.emoticon}" title="${smiley.emoticon}" border="0" />`
    );
  }

  return text;
}

/**
 * Clear smilies cache (useful for tests or admin changes).
 */
export function clearSmiliesCache(): void {
  cachedSmilies = null;
}
