import { escapeHtml } from "./escape.js";
import { markup, type MarkupString } from "./markup.js";

/**
 * Browser-side avatar downscaling (Chunk 26).
 *
 * The server used to reject any avatar over the configured maximum, so a
 * member uploading a photo straight off their phone simply could not set one.
 * Rather than decode the image on the server — Supabase Edge Functions allow
 * 2 seconds of CPU per request and a 24MP decode is a large fraction of that —
 * the browser scales it down before it is ever uploaded. A 6MB photo becomes
 * roughly 20KB, which is also markedly faster for someone on mobile data.
 *
 * **The client is an optimisation, never the check.** Everything the server
 * validated before, it still validates: someone POSTing arbitrary bytes
 * straight at the endpoint is unaffected by any of this. What the script buys
 * is that ordinary users stop hitting a rejection they can't do anything
 * about.
 *
 * Injected through `S_HIDDEN_FIELDS`, which sits inside the form and after the
 * file input in profile_add_body.tpl. That is the only hook available: Plank
 * renders phpBB2 themes unmodified, so there is no adding a <script> tag to
 * the template itself.
 *
 * With JavaScript off, nothing runs and the previous behaviour applies —
 * the upload is rejected with the same message as before.
 */

/**
 * The client script.
 *
 * `fitWithin` is duplicated here rather than imported because this string is
 * executed in the browser, not bundled with the server. It is kept
 * byte-identical to src/lib/imagefit.ts and a test asserts the two agree, so
 * the duplication can't drift silently.
 */
function scriptSource(maxWidth: number, maxHeight: number): string {
  return `
(function () {
  var MAX_W = ${maxWidth}, MAX_H = ${maxHeight};
  var input = document.querySelector('input[type=file][name=avatar]');
  if (!input || typeof HTMLCanvasElement === 'undefined') return;

  function fitWithin(width, height, maxWidth, maxHeight) {
    if (!(width > 0) || !(height > 0) || !(maxWidth > 0) || !(maxHeight > 0)) {
      return { width: 0, height: 0 };
    }
    if (width <= maxWidth && height <= maxHeight) return { width: width, height: height };
    var scale = Math.min(maxWidth / width, maxHeight / height);
    return {
      width: Math.max(1, Math.min(maxWidth, Math.round(width * scale))),
      height: Math.max(1, Math.min(maxHeight, Math.round(height * scale)))
    };
  }

  function status(message) {
    var el = document.getElementById('plank-avatar-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'plank-avatar-status';
      el.className = 'gensmall';
      if (input.parentNode) input.parentNode.appendChild(el);
    }
    el.textContent = message || '';
  }

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file || file.type.indexOf('image/') !== 0) return;

    var url = URL.createObjectURL(file);
    var img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(url);
      var target = fitWithin(img.naturalWidth, img.naturalHeight, MAX_W, MAX_H);
      if (!target.width) return;

      // Already small enough — leave the user's file exactly as it is rather
      // than re-encoding it and losing quality for no reason.
      if (target.width === img.naturalWidth && target.height === img.naturalHeight) {
        status('');
        return;
      }

      var canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, target.width, target.height);

      // GIFs would lose animation through a canvas, so re-encode as PNG;
      // everything else becomes JPEG, which is far smaller for photographs.
      var asPng = file.type === 'image/png' || file.type === 'image/gif';
      canvas.toBlob(function (blob) {
        if (!blob) return;
        try {
          var name = file.name.replace(/\\.[^.]+$/, '') + (asPng ? '.png' : '.jpg');
          var resized = new File([blob], name, { type: blob.type });
          var dt = new DataTransfer();
          dt.items.add(resized);
          input.files = dt.files;
          status(
            'Image resized to ' + target.width + '\\u00d7' + target.height +
            ' (' + Math.max(1, Math.round(blob.size / 1024)) + ' KB) before upload.'
          );
        } catch (e) {
          // Older browsers may not allow assigning input.files. The upload
          // proceeds with the original file and the server decides — exactly
          // the behaviour before this script existed.
          status('');
        }
      }, asPng ? 'image/png' : 'image/jpeg', 0.9);
    };

    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
  });
})();
`.trim();
}

/**
 * A `<script>` to inject into the profile form's hidden-fields slot.
 *
 * Returned as MarkupString because it is markup we constructed; the only
 * interpolated values are the two integers from board config, and they are
 * coerced with Math.trunc before they get anywhere near the output.
 */
export function avatarResizeScript(
  maxWidth: number,
  maxHeight: number
): MarkupString {
  const w = Math.max(1, Math.trunc(maxWidth) || 200);
  const h = Math.max(1, Math.trunc(maxHeight) || 200);
  return markup(`<script type="text/javascript">${scriptSource(w, h)}</script>`);
}

/** Explanatory line for the avatar panel, so the behaviour isn't a surprise. */
export function avatarResizeNotice(
  maxWidth: number,
  maxHeight: number
): MarkupString {
  return markup(
    `<br />Larger images are scaled down to ${escapeHtml(
      String(maxWidth)
    )}&times;${escapeHtml(String(maxHeight))} in your browser before uploading.`
  );
}
