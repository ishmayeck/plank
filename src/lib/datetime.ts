/**
 * Timezone-aware date formatting with a documented subset of PHP's `date()`
 * tokens (Chunk 20).
 *
 * phpBB2 stored each user's preferred format as a PHP `date()` string and
 * their timezone alongside it, and the profile form still tells the user that
 * is the syntax. Plank collected both fields and then rendered every date as
 * UTC in one hardcoded format, so the preferences were decorative.
 *
 * Two deliberate decisions:
 *
 * 1. **A subset, not an interpreter.** PHP's date() has ~40 tokens, most of
 *    which no forum ever used (Swatch internet time, ISO week-numbering year).
 *    The ones below cover phpBB2's shipped formats and anything a user is
 *    plausibly going to type. An unrecognised letter is emitted literally,
 *    which is the forgiving behaviour for a free-text field.
 *
 * 2. **Intl, not manual offset arithmetic.** Resolving a zone through
 *    Intl.DateTimeFormat gets DST right for free and works identically on
 *    Node, Deno and Workers. Doing it by hand would mean shipping a tz
 *    database or being wrong twice a year.
 */

/** phpBB2's default, and what the registration form has always displayed. */
export const DEFAULT_DATE_FORMAT = "D M d, Y g:i a";
export const DEFAULT_TIMEZONE = "UTC";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
  tzAbbr: string;
}

/**
 * Normalise a stored timezone into something Intl accepts.
 *
 * Accepts IANA names ("America/New_York") and, for compatibility with data
 * imported from phpBB2, a numeric UTC offset in hours ("-5", "+5.5", "0").
 * Fixed offsets become an Etc/GMT zone; note those are POSIX-signed, so
 * Etc/GMT+5 is UTC-5 — inverting the sign here is correct, not a typo.
 */
export function resolveTimeZone(stored: string | null | undefined): string {
  const value = (stored ?? "").trim();
  if (!value) return DEFAULT_TIMEZONE;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric === 0) return "UTC";
    // Etc/GMT zones only exist at whole hours; a half-hour offset (India,
    // Newfoundland) can't be expressed this way, so fall back to UTC rather
    // than silently rounding someone into the wrong hour.
    if (!Number.isInteger(numeric) || Math.abs(numeric) > 14) {
      return DEFAULT_TIMEZONE;
    }
    return `Etc/GMT${numeric > 0 ? "-" : "+"}${Math.abs(numeric)}`;
  }

  // Trust it if Intl does.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let dtf = partsCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
      timeZoneName: "short",
    });
    partsCache.set(timeZone, dtf);
  }
  return dtf;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: Math.max(0, DAYS_SHORT.indexOf(get("weekday"))),
    tzAbbr: get("timeZoneName"),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** English ordinal suffix, PHP's `S` token: 1st, 2nd, 3rd, 4th... 11th-13th. */
function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/**
 * Format a date using a PHP `date()`-style format string, in the given zone.
 *
 * Supported: d j S D l N w  m n M F  Y y  g G h H i s A a  T U  and `\` to
 * escape the next character literally. Anything else passes through.
 */
export function formatPhpDate(
  date: Date | string,
  format: string = DEFAULT_DATE_FORMAT,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const zone = resolveTimeZone(timeZone);
  const p = zonedParts(d, zone);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;

  let out = "";
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]!;

    if (ch === "\\") {
      // Escaped literal: emit the next character as-is.
      i++;
      if (i < format.length) out += format[i];
      continue;
    }

    switch (ch) {
      // ── Day ──
      case "d": out += pad(p.day); break;
      case "j": out += String(p.day); break;
      case "D": out += DAYS_SHORT[p.weekday]; break;
      case "l": out += DAYS_LONG[p.weekday]; break;
      case "N": out += String(p.weekday === 0 ? 7 : p.weekday); break;
      case "w": out += String(p.weekday); break;
      case "S": out += ordinalSuffix(p.day); break;
      // ── Month ──
      case "m": out += pad(p.month); break;
      case "n": out += String(p.month); break;
      case "M": out += MONTHS_SHORT[p.month - 1]; break;
      case "F": out += MONTHS_LONG[p.month - 1]; break;
      // ── Year ──
      case "Y": out += String(p.year); break;
      case "y": out += pad(p.year % 100); break;
      // ── Time ──
      case "g": out += String(hour12); break;
      case "G": out += String(p.hour); break;
      case "h": out += pad(hour12); break;
      case "H": out += pad(p.hour); break;
      case "i": out += pad(p.minute); break;
      case "s": out += pad(p.second); break;
      case "A": out += p.hour >= 12 ? "PM" : "AM"; break;
      case "a": out += p.hour >= 12 ? "pm" : "am"; break;
      // ── Zone / epoch ──
      case "T": out += p.tzAbbr; break;
      case "U": out += String(Math.floor(d.getTime() / 1000)); break;
      default: out += ch;
    }
  }
  return out;
}

/** A bound formatter: the shape route handlers actually use. */
export interface DateFormatter {
  /** Full date+time in the viewer's preferences. */
  (date: Date | string): string;
  /** Date only, for join dates and similar. */
  dateOnly(date: Date | string): string;
  /** The resolved IANA zone, for the "All times are X" footer. */
  timeZone: string;
  /** Short zone abbreviation for the current moment, e.g. "GMT", "EDT". */
  abbreviation(): string;
}

/** Date-only rendering keeps phpBB2's "14 Mar 2026" shape. */
const DATE_ONLY_FORMAT = "d M Y";

/**
 * Build a formatter bound to one viewer's preferences. Created once per
 * request in the auth middleware and read off the Hono context, so nothing
 * has to thread the user through every render helper — and, critically, no
 * module-level mutable "current user" exists that concurrent requests could
 * read each other's value from.
 */
export function makeDateFormatter(
  timeZone: string | null | undefined,
  format: string | null | undefined
): DateFormatter {
  const zone = resolveTimeZone(timeZone);
  const fmt = (format ?? "").trim() || DEFAULT_DATE_FORMAT;

  const formatter = ((date: Date | string) =>
    formatPhpDate(date, fmt, zone)) as DateFormatter;
  formatter.dateOnly = (date: Date | string) =>
    formatPhpDate(date, DATE_ONLY_FORMAT, zone);
  formatter.timeZone = zone;
  formatter.abbreviation = () => zonedParts(new Date(), zone).tzAbbr;

  return formatter;
}
