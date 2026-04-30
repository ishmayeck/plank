import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeRegex } from "./escape.js";

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
 */
export function applyCensors(
  text: string,
  censors: WordCensor[]
): string {
  for (const censor of censors) {
    // Convert phpBB-style wildcards to regex
    const pattern = escapeRegex(censor.word).replace(/\\\*/g, "\\S*");
    const regex = new RegExp(`\\b${pattern}\\b`, "gi");
    text = text.replace(regex, censor.replacement);
  }
  return text;
}

export function clearCensorCache(): void {
  cachedCensors = null;
}
