import { escapeHtml } from "./escape.js";
import { markup, type MarkupString } from "./markup.js";
import { resolveTimeZone, DEFAULT_DATE_FORMAT } from "./datetime.js";

/**
 * Timezone and date-format choices for the profile form (Chunk 20).
 *
 * phpBB2 offered a fixed list of numeric UTC offsets, which is wrong twice a
 * year for everyone observing DST. This offers IANA zones instead, so the
 * board follows the user's actual clock. Stored values are still free text, so
 * a numeric offset imported from a phpBB2 database keeps working — see
 * resolveTimeZone.
 *
 * A curated list rather than the full ~600-zone IANA set: the long list is
 * unusable in a <select>, and these cover the populated world at the
 * granularity anyone actually needs.
 */

interface ZoneChoice {
  id: string;
  label: string;
}

const ZONES: { region: string; zones: ZoneChoice[] }[] = [
  {
    region: "Universal",
    zones: [{ id: "UTC", label: "UTC — Coordinated Universal Time" }],
  },
  {
    region: "Americas",
    zones: [
      { id: "America/Anchorage", label: "Anchorage" },
      { id: "America/Los_Angeles", label: "Los Angeles / Vancouver" },
      { id: "America/Denver", label: "Denver" },
      { id: "America/Phoenix", label: "Phoenix (no DST)" },
      { id: "America/Chicago", label: "Chicago / Mexico City" },
      { id: "America/New_York", label: "New York / Toronto" },
      { id: "America/Halifax", label: "Halifax" },
      { id: "America/St_Johns", label: "St. John's" },
      { id: "America/Sao_Paulo", label: "São Paulo" },
      { id: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
    ],
  },
  {
    region: "Europe & Africa",
    zones: [
      { id: "Atlantic/Reykjavik", label: "Reykjavík" },
      { id: "Europe/London", label: "London / Dublin / Lisbon" },
      { id: "Europe/Paris", label: "Paris / Berlin / Madrid / Rome" },
      { id: "Europe/Helsinki", label: "Helsinki / Athens / Kyiv" },
      { id: "Europe/Moscow", label: "Moscow" },
      { id: "Africa/Lagos", label: "Lagos" },
      { id: "Africa/Johannesburg", label: "Johannesburg" },
      { id: "Africa/Nairobi", label: "Nairobi" },
    ],
  },
  {
    region: "Asia & Pacific",
    zones: [
      { id: "Asia/Jerusalem", label: "Jerusalem" },
      { id: "Asia/Dubai", label: "Dubai" },
      { id: "Asia/Karachi", label: "Karachi" },
      { id: "Asia/Kolkata", label: "Kolkata / Mumbai" },
      { id: "Asia/Bangkok", label: "Bangkok / Jakarta" },
      { id: "Asia/Shanghai", label: "Shanghai / Singapore / Hong Kong" },
      { id: "Asia/Tokyo", label: "Tokyo / Seoul" },
      { id: "Australia/Perth", label: "Perth" },
      { id: "Australia/Adelaide", label: "Adelaide" },
      { id: "Australia/Sydney", label: "Sydney / Melbourne" },
      { id: "Pacific/Auckland", label: "Auckland" },
    ],
  },
];

/** Every selectable zone id, for validating what comes back from the form. */
const VALID_ZONES = new Set(ZONES.flatMap((g) => g.zones.map((z) => z.id)));

/**
 * True if this is a zone we're willing to store. Accepts anything Intl knows —
 * not just the curated list — so a value imported from elsewhere, or one a
 * future longer list offers, still round-trips. Rejects junk by checking that
 * resolveTimeZone didn't have to fall back.
 */
export function isValidTimeZone(value: string): boolean {
  if (VALID_ZONES.has(value)) return true;
  return resolveTimeZone(value) === value;
}

/** `<optgroup>`-grouped options for the profile form's timezone select. */
export function renderTimezoneOptions(current: string | null | undefined): MarkupString {
  // Match on the resolved zone so a stored phpBB2 numeric offset still
  // highlights the equivalent entry where one exists.
  const selected = resolveTimeZone(current);
  const html = ZONES.map((group) => {
    const options = group.zones
      .map(
        (z) =>
          `<option value="${escapeHtml(z.id)}"${
            z.id === selected ? ' selected="selected"' : ""
          }>${escapeHtml(z.label)}</option>`
      )
      .join("");
    return `<optgroup label="${escapeHtml(group.region)}">${options}</optgroup>`;
  }).join("");

  // A stored zone outside the curated list would otherwise silently reset to
  // UTC the next time the user saves their profile.
  const known = ZONES.some((g) => g.zones.some((z) => z.id === selected));
  const extra = known
    ? ""
    : `<optgroup label="Current"><option value="${escapeHtml(
        selected
      )}" selected="selected">${escapeHtml(selected)}</option></optgroup>`;

  return markup(extra + html);
}

/**
 * Presets for the date-format field, so nobody has to learn PHP's date().
 *
 * All 14 characters or fewer: profile_add_body.tpl declares
 * `maxlength="14"` on the input — exactly the length of phpBB2's default,
 * which is plainly where the number came from. We render themes unmodified,
 * so suggesting anything longer would be advice the form refuses to accept.
 */
export const DATE_FORMAT_PRESETS: { format: string; label: string }[] = [
  { format: DEFAULT_DATE_FORMAT, label: "Sat Mar 14, 2026 3:45 pm" },
  { format: "D M d, Y H:i", label: "Sat Mar 14, 2026 15:45" },
  { format: "d M Y, g:i a", label: "14 Mar 2026, 3:45 pm" },
  { format: "Y-m-d H:i", label: "2026-03-14 15:45" },
  { format: "jS M y H:i", label: "14th Mar 26 15:45" },
];

// Guard the constraint above at module load rather than trusting the comment.
for (const preset of DATE_FORMAT_PRESETS) {
  if (preset.format.length > 14) {
    throw new Error(
      `Date format preset "${preset.format}" exceeds the template's maxlength of 14`
    );
  }
}
