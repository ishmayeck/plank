import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeRegex, escapeHtml } from "./escape.js";
import { markup, isMarkup, type MarkupString } from "./markup.js";

export interface WordCensor {
  word: string;
  replacement: string;
}

let cachedCensors: WordCensor[] | null = null;

/**
 * Load word censors from database (cached after first load).
 */
export async function loadWordCensors(
  supabase: SupabaseClient
): Promise<WordCensor[]> {
  if (cachedCensors) return cachedCensors;

  const { data } = await supabase
    .from("word_censors")
    .select("word, replacement");

  cachedCensors = data ?? [];
  return cachedCensors;
}

/**
 * Apply word censoring to text.
 * Supports wildcards: * matches any characters.
 *
 * Plain string input → plain string output (will be HTML-escaped by
 * the template engine). MarkupString input → MarkupString output, so
 * pre-rendered HTML retains its trusted-markup flag.
 */
export function applyCensors(
  text: string,
  censors: WordCensor[]
): string;
export function applyCensors(
  text: MarkupString,
  censors: WordCensor[]
): MarkupString;
export function applyCensors(
  text: string | MarkupString,
  censors: WordCensor[]
): string | MarkupString {
  const wasMarkup = isMarkup(text);
  const source = wasMarkup ? text.html : text;

  const censorSegment = (segment: string): string => {
    let out = segment;
    for (const censor of censors) {
      // Convert phpBB-style wildcards to regex
      const pattern = escapeRegex(censor.word).replace(/\\\*/g, "\\S*");
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");

      // Escape when substituting into HTML: an admin typing `<b>` in a
      // replacement should see literal text, not markup, and one typing a
      // quote character must not be able to open an attribute.
      const replacement = wasMarkup
        ? escapeHtml(censor.replacement)
        : censor.replacement;

      // Replacer FUNCTION, not a replacement string. String.replace treats
      // `$&`, `$\``, `$'` and `$1` in a replacement as patterns, so an admin
      // replacement containing them could duplicate surrounding markup.
      out = out.replace(regex, () => replacement);
    }
    return out;
  };

  if (!wasMarkup) return censorSegment(source);

  // Censor only the text BETWEEN tags. Running over raw HTML let a censored
  // word inside an attacker-chosen URL rewrite the attributes around it —
  // e.g. a censor of `darn` → `" onmouseover="alert(1)` turned
  // `[url=http://example.com/darn/x]` into a live event handler.
  const censored = source.replace(/<[^>]*>|[^<]+/g, (chunk) =>
    chunk.startsWith("<") ? chunk : censorSegment(chunk)
  );
  return markup(censored);
}

export function clearCensorCache(): void {
  cachedCensors = null;
}
