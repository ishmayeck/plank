import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, escapeRegex } from "./escape.js";
import { markup, isMarkup, type MarkupString } from "./markup.js";

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
 * Accepts pre-rendered HTML (typically the output of parseBBCode) and
 * returns MarkupString. The smiley URL and emoticon text are escaped
 * before being embedded in the img tag's attributes.
 */
export function replaceSmilies(
  text: string | MarkupString,
  smilies: Smiley[],
  imagePath: string = "images/smiles"
): MarkupString {
  const source = isMarkup(text) ? text.html : text;
  // Sort by longest code first so :-) is matched before :)
  const sorted = [...smilies].sort(
    (a, b) => b.code.length - a.code.length
  );

  const substitute = (segment: string): string => {
    let out = segment;
    for (const smiley of sorted) {
      const regex = new RegExp(escapeRegex(smiley.code), "g");
      const safeUrl = escapeHtml(smiley.smile_url);
      const safeEmoticon = escapeHtml(smiley.emoticon);
      const replacement = `<img src="${escapeHtml(imagePath)}/${safeUrl}" alt="${safeEmoticon}" title="${safeEmoticon}" border="0" />`;
      // Replacer function so `$&`/`$'` in an admin-set smiley URL are not
      // treated as replacement patterns.
      out = out.replace(regex, () => replacement);
    }
    return out;
  };

  // Only substitute in text BETWEEN tags. Matching across raw HTML let a
  // smiley code placed inside an attacker-controlled URL inject an <img>
  // mid-attribute, terminating the href at the smiley's own src=" quote —
  // link spoofing today, and worse if an admin smiley URL flips quote parity.
  return markup(
    source.replace(/<[^>]*>|[^<]+/g, (chunk) =>
      chunk.startsWith("<") ? chunk : substitute(chunk)
    )
  );
}

/**
 * Clear smilies cache (useful for tests or admin changes).
 */
export function clearSmiliesCache(): void {
  cachedSmilies = null;
}
