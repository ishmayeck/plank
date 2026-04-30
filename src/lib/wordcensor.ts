import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeRegex } from "./escape.js";
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
  let out = wasMarkup ? text.html : text;
  for (const censor of censors) {
    // Convert phpBB-style wildcards to regex
    const pattern = escapeRegex(censor.word).replace(/\\\*/g, "\\S*");
    const regex = new RegExp(`\\b${pattern}\\b`, "gi");
    out = out.replace(regex, censor.replacement);
  }
  return wasMarkup ? markup(out) : out;
}

export function clearCensorCache(): void {
  cachedCensors = null;
}
