/**
 * Aspect-preserving fit arithmetic, shared by the server guard and the
 * browser-side resizer (Chunk 26).
 *
 * Lives on its own because it is the only part of avatar resizing that can be
 * tested without a browser: the actual scaling happens on a canvas in the
 * user's page, where there is no DOM to assert against in vitest. Keeping the
 * arithmetic here means the part most likely to be wrong — the rounding, the
 * degenerate cases — is covered by ordinary unit tests, and the client script
 * inlines this exact function rather than reimplementing it.
 */

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Largest size that fits inside maxW × maxH with the aspect ratio preserved.
 *
 * Never scales UP: an image already within the box is returned untouched
 * rather than stretched, which is what "maximum size" should mean.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): Dimensions {
  if (!(width > 0) || !(height > 0) || !(maxWidth > 0) || !(maxHeight > 0)) {
    return { width: 0, height: 0 };
  }
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }

  const scale = Math.min(maxWidth / width, maxHeight / height);
  // Round, then clamp: rounding can push a dimension one pixel over the box
  // (e.g. 201 from 200.5), and a result that violates the limit it was
  // computed for would be rejected by the very check this feeds.
  return {
    width: Math.max(1, Math.min(maxWidth, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxHeight, Math.round(height * scale))),
  };
}

/**
 * Upper bound on pixels we're willing to decode.
 *
 * Decoding is pure CPU and Supabase Edge Functions allow 2 seconds of it per
 * request, with a 256MB memory cap; a 24-megapixel photo is ~96MB as an RGBA
 * bitmap before any resizing happens. Dimensions come from the file header
 * without decoding anything (image-size), so this check is nearly free and
 * turns an unbounded cost into a bounded one.
 *
 * 40MP is comfortably above any phone camera and far below the point where
 * decoding threatens the budget.
 */
export const MAX_DECODE_PIXELS = 40_000_000;

/** True if this image is too large to be worth attempting to process. */
export function exceedsDecodeBudget(width: number, height: number): boolean {
  return width * height > MAX_DECODE_PIXELS;
}
