import { describe, it, expect } from "vitest";
import {
  fitWithin,
  exceedsDecodeBudget,
  MAX_DECODE_PIXELS,
} from "../../src/lib/imagefit.js";
import { avatarResizeScript } from "../../src/lib/avatar_client.js";

/**
 * Avatar resizing (Chunk 26).
 *
 * The scaling itself happens on a canvas in the user's browser, which vitest
 * has no DOM to exercise — so what's testable here is the arithmetic, which is
 * where the bugs actually live (rounding, degenerate inputs, the never-upscale
 * rule), plus the guard that keeps an absurd image away from any decoder.
 */

describe("fitWithin", () => {
  it("leaves an image already inside the box untouched", () => {
    expect(fitWithin(100, 80, 200, 200)).toEqual({ width: 100, height: 80 });
    expect(fitWithin(200, 200, 200, 200)).toEqual({ width: 200, height: 200 });
  });

  it("never scales up", () => {
    // "Maximum size" is a ceiling, not a target — a 32x32 avatar must not be
    // blown up to 200x200 and turned to mush.
    expect(fitWithin(32, 32, 200, 200)).toEqual({ width: 32, height: 32 });
  });

  it("scales a square down to the box", () => {
    expect(fitWithin(1000, 1000, 200, 200)).toEqual({ width: 200, height: 200 });
  });

  it("preserves aspect ratio on a landscape image", () => {
    // 4000x3000 is 4:3; the result must still be 4:3, not squashed to square.
    const out = fitWithin(4000, 3000, 200, 200);
    expect(out).toEqual({ width: 200, height: 150 });
    expect(out.width / out.height).toBeCloseTo(4 / 3, 5);
  });

  it("preserves aspect ratio on a portrait image", () => {
    const out = fitWithin(3000, 4000, 200, 200);
    expect(out).toEqual({ width: 150, height: 200 });
  });

  it("handles a non-square box", () => {
    expect(fitWithin(1000, 500, 100, 400)).toEqual({ width: 100, height: 50 });
    expect(fitWithin(500, 1000, 400, 100)).toEqual({ width: 50, height: 100 });
  });

  it("respects an extreme aspect ratio without collapsing to zero", () => {
    // A 10000x10 banner scaled to fit 200 wide is 0.2px tall; it must clamp
    // to 1, because a zero-height canvas throws.
    const out = fitWithin(10000, 10, 200, 200);
    expect(out.width).toBe(200);
    expect(out.height).toBe(1);
  });

  it("never returns a dimension above the box, even after rounding", () => {
    // Rounding can push a value one pixel over the limit it was computed
    // for — which the server-side check would then reject.
    for (let w = 201; w < 1200; w += 7) {
      for (const h of [199, 200, 201, 333, 999]) {
        const out = fitWithin(w, h, 200, 200);
        expect(out.width, `${w}x${h}`).toBeLessThanOrEqual(200);
        expect(out.height, `${w}x${h}`).toBeLessThanOrEqual(200);
        expect(out.width).toBeGreaterThan(0);
        expect(out.height).toBeGreaterThan(0);
      }
    }
  });

  it("returns zeroes for degenerate input rather than NaN", () => {
    expect(fitWithin(0, 100, 200, 200)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, 0, 200, 200)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, 100, 0, 200)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100, 200, 200)).toEqual({ width: 0, height: 0 });
  });
});

describe("decode budget guard", () => {
  it("allows anything a camera realistically produces", () => {
    expect(exceedsDecodeBudget(4032, 3024)).toBe(false); // 12MP phone
    expect(exceedsDecodeBudget(8000, 4000)).toBe(false); // 32MP
  });

  it("rejects images beyond what the CPU budget can decode", () => {
    // Edge Functions allow 2s of CPU; a bitmap this size is both slow to
    // decode and a large fraction of the 256MB memory cap.
    expect(exceedsDecodeBudget(20000, 20000)).toBe(true);
    expect(exceedsDecodeBudget(MAX_DECODE_PIXELS + 1, 1)).toBe(true);
  });

  it("treats the boundary as allowed", () => {
    expect(exceedsDecodeBudget(MAX_DECODE_PIXELS, 1)).toBe(false);
  });
});

describe("the client script's copy of the arithmetic", () => {
  /**
   * The browser script can't import from src/ — it's a string executed in the
   * page — so fitWithin is duplicated there. This runs the client's copy and
   * the server's over the same inputs so the duplication cannot drift
   * silently, which is the only real risk of writing it twice.
   */
  function clientFitWithin(): (w: number, h: number, mw: number, mh: number) => {
    width: number;
    height: number;
  } {
    const script = avatarResizeScript(200, 200).html;
    const body = script.match(
      /function fitWithin\(width, height, maxWidth, maxHeight\) \{([\s\S]*?)\n  \}/
    );
    expect(body, "could not find fitWithin in the client script").not.toBeNull();
    return new Function(
      "width",
      "height",
      "maxWidth",
      "maxHeight",
      body![1]!
    ) as any;
  }

  it("agrees with the server implementation across a range of inputs", () => {
    const clientFit = clientFitWithin();
    const cases: [number, number, number, number][] = [
      [100, 80, 200, 200],
      [1000, 1000, 200, 200],
      [4000, 3000, 200, 200],
      [3000, 4000, 200, 200],
      [10000, 10, 200, 200],
      [1000, 500, 100, 400],
      [32, 32, 200, 200],
      [201, 199, 200, 200],
      [0, 100, 200, 200],
    ];
    for (const [w, h, mw, mh] of cases) {
      expect(clientFit(w, h, mw, mh), `${w}x${h} in ${mw}x${mh}`).toEqual(
        fitWithin(w, h, mw, mh)
      );
    }
  });
});

describe("the injected script", () => {
  it("carries the configured maximum, not a hardcoded one", () => {
    const html = avatarResizeScript(120, 90).html;
    expect(html).toContain("MAX_W = 120");
    expect(html).toContain("MAX_H = 90");
  });

  it("coerces its bounds to integers", () => {
    // These are interpolated straight into executable source, so anything
    // other than a number has no business reaching it.
    const html = avatarResizeScript(200.7 as number, 0 as number).html;
    expect(html).toContain("MAX_W = 200");
    expect(html).toContain("MAX_H = 200"); // 0 falls back to the default
    expect(html).not.toMatch(/MAX_[WH] = [^0-9]/);
  });

  it("targets the avatar file input specifically", () => {
    expect(avatarResizeScript(200, 200).html).toContain(
      "input[type=file][name=avatar]"
    );
  });
});
