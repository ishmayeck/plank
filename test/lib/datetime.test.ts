import { describe, it, expect } from "vitest";
import {
  formatPhpDate,
  makeDateFormatter,
  resolveTimeZone,
  DEFAULT_DATE_FORMAT,
} from "../../src/lib/datetime.js";

/**
 * The roadmap's acceptance criterion for Chunk 20: the same UTC instant must
 * render differently for users in UTC, America/Los_Angeles and Asia/Tokyo.
 */

// 2026-03-14T15:45:30Z — a Saturday afternoon UTC. Chosen so the Tokyo
// rendering lands on the NEXT day and the LA one on the same day in the
// morning, which catches sign errors in both directions.
const INSTANT = "2026-03-14T15:45:30.000Z";

describe("resolveTimeZone", () => {
  it("passes IANA names through", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("defaults empty or missing values to UTC", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone("   ")).toBe("UTC");
  });

  it("falls back to UTC for a name Intl rejects", () => {
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
  });

  it("accepts phpBB2-style numeric offsets", () => {
    // Etc/GMT signs are POSIX-inverted: Etc/GMT+5 is UTC-5.
    expect(resolveTimeZone("0")).toBe("UTC");
    expect(resolveTimeZone("-5")).toBe("Etc/GMT+5");
    expect(resolveTimeZone("+9")).toBe("Etc/GMT-9");
  });

  it("renders a numeric offset at the right actual hour", () => {
    // The real check on the sign inversion above.
    expect(formatPhpDate(INSTANT, "H:i", "-5")).toBe("10:45");
    expect(formatPhpDate(INSTANT, "H:i", "9")).toBe("00:45");
  });

  it("refuses half-hour offsets rather than rounding someone's clock", () => {
    // Etc/GMT has no half-hour zones; silently rounding would be worse.
    expect(resolveTimeZone("5.5")).toBe("UTC");
    expect(resolveTimeZone("99")).toBe("UTC");
  });
});

describe("formatPhpDate — the same instant in three zones", () => {
  it("renders UTC", () => {
    expect(formatPhpDate(INSTANT, DEFAULT_DATE_FORMAT, "UTC")).toBe(
      "Sat Mar 14, 2026 3:45 pm"
    );
  });

  it("renders America/Los_Angeles (same day, morning)", () => {
    expect(formatPhpDate(INSTANT, DEFAULT_DATE_FORMAT, "America/Los_Angeles")).toBe(
      "Sat Mar 14, 2026 8:45 am"
    );
  });

  it("renders Asia/Tokyo (next day)", () => {
    expect(formatPhpDate(INSTANT, DEFAULT_DATE_FORMAT, "Asia/Tokyo")).toBe(
      "Sun Mar 15, 2026 12:45 am"
    );
  });

  it("handles a DST transition rather than a fixed offset", () => {
    // US DST began 2026-03-08, so March is EDT (UTC-4), not EST (UTC-5).
    expect(formatPhpDate(INSTANT, "H:i", "America/New_York")).toBe("11:45");
    // And in January the same zone is UTC-5.
    expect(formatPhpDate("2026-01-14T15:45:30Z", "H:i", "America/New_York")).toBe(
      "10:45"
    );
  });
});

describe("formatPhpDate — token coverage", () => {
  const f = (format: string) => formatPhpDate(INSTANT, format, "UTC");

  it("formats day tokens", () => {
    expect(f("d")).toBe("14");
    expect(f("j")).toBe("14");
    expect(f("D")).toBe("Sat");
    expect(f("l")).toBe("Saturday");
    expect(f("N")).toBe("6");
    expect(f("w")).toBe("6");
  });

  it("formats the ordinal suffix, including the 11th-13th exceptions", () => {
    const ord = (iso: string) => formatPhpDate(iso, "jS", "UTC");
    expect(ord("2026-03-01T12:00:00Z")).toBe("1st");
    expect(ord("2026-03-02T12:00:00Z")).toBe("2nd");
    expect(ord("2026-03-03T12:00:00Z")).toBe("3rd");
    expect(ord("2026-03-04T12:00:00Z")).toBe("4th");
    expect(ord("2026-03-11T12:00:00Z")).toBe("11th");
    expect(ord("2026-03-12T12:00:00Z")).toBe("12th");
    expect(ord("2026-03-13T12:00:00Z")).toBe("13th");
    expect(ord("2026-03-21T12:00:00Z")).toBe("21st");
    expect(ord("2026-03-22T12:00:00Z")).toBe("22nd");
    expect(ord("2026-03-23T12:00:00Z")).toBe("23rd");
  });

  it("formats month tokens", () => {
    expect(f("m")).toBe("03");
    expect(f("n")).toBe("3");
    expect(f("M")).toBe("Mar");
    expect(f("F")).toBe("March");
  });

  it("formats year tokens", () => {
    expect(f("Y")).toBe("2026");
    expect(f("y")).toBe("26");
  });

  it("formats time tokens", () => {
    expect(f("H:i:s")).toBe("15:45:30");
    expect(f("g")).toBe("3");
    expect(f("G")).toBe("15");
    expect(f("h")).toBe("03");
    expect(f("a")).toBe("pm");
    expect(f("A")).toBe("PM");
  });

  it("renders midnight as 12, not 0, in 12-hour tokens", () => {
    // The classic off-by-twelve.
    const midnight = "2026-03-14T00:20:00Z";
    expect(formatPhpDate(midnight, "g:i a", "UTC")).toBe("12:20 am");
    expect(formatPhpDate(midnight, "h", "UTC")).toBe("12");
    expect(formatPhpDate(midnight, "H", "UTC")).toBe("00");
  });

  it("renders noon as 12 pm", () => {
    expect(formatPhpDate("2026-03-14T12:00:00Z", "g:i a", "UTC")).toBe("12:00 pm");
  });

  it("emits the epoch for U", () => {
    expect(f("U")).toBe(String(Math.floor(Date.parse(INSTANT) / 1000)));
  });

  it("treats a backslash as escaping the next character", () => {
    // "\M" must be a literal M, not the month name.
    expect(f("\\M M")).toBe("M Mar");
    expect(f("\\Y\\e\\a\\r: Y")).toBe("Year: 2026");
  });

  it("passes unrecognised characters through literally", () => {
    expect(f("Y-m-d")).toBe("2026-03-14");
    expect(f("[Y]")).toBe("[2026]");
  });

  it("returns empty string for an unparseable date", () => {
    expect(formatPhpDate("not a date", "Y", "UTC")).toBe("");
  });
});

describe("makeDateFormatter", () => {
  it("binds a viewer's zone and format", () => {
    const fmt = makeDateFormatter("Asia/Tokyo", "Y-m-d H:i");
    expect(fmt(INSTANT)).toBe("2026-03-15 00:45");
  });

  it("exposes a date-only rendering for join dates", () => {
    const fmt = makeDateFormatter("UTC", "Y-m-d H:i");
    expect(fmt.dateOnly(INSTANT)).toBe("14 Mar 2026");
  });

  it("falls back to the default format when the preference is blank", () => {
    const fmt = makeDateFormatter("UTC", "   ");
    expect(fmt(INSTANT)).toBe("Sat Mar 14, 2026 3:45 pm");
  });

  it("falls back to UTC when the preference is unusable", () => {
    const fmt = makeDateFormatter("Mars/Olympus_Mons", null);
    expect(fmt.timeZone).toBe("UTC");
    expect(fmt(INSTANT)).toBe("Sat Mar 14, 2026 3:45 pm");
  });

  it("reports an abbreviation for the footer", () => {
    expect(makeDateFormatter("UTC", null).abbreviation()).toBeTruthy();
  });
});
