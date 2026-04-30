import { escapeHtml } from "./escape.js";
import { markup, type MarkupString } from "./markup.js";

/**
 * phpBB2-compatible BBCode parser.
 *
 * Converts BBCode markup to HTML. Supports:
 * [b], [i], [u], [color=X], [size=X], [url], [url=X], [img],
 * [code], [quote], [quote="X"], [list], [list=X], [*]
 *
 * Also auto-links bare URLs and converts newlines to <br />.
 *
 * Returns a MarkupString — the engine will render it without further
 * escaping.
 */
export function parseBBCode(text: string): MarkupString {
  // Step 1: Extract code blocks to protect them from processing
  const codeBlocks: string[] = [];
  text = text.replace(
    /\[code\]([\s\S]*?)\[\/code\]/gi,
    (_match, content) => {
      codeBlocks.push(content);
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    }
  );

  // Step 2: Escape HTML in remaining text
  text = escapeHtml(text);

  // Step 3: Parse BBCode tags (order matters — do nested-capable tags first)

  // Bold, italic, underline
  text = text.replace(
    /\[b\]([\s\S]*?)\[\/b\]/gi,
    "<strong>$1</strong>"
  );
  text = text.replace(
    /\[i\]([\s\S]*?)\[\/i\]/gi,
    "<em>$1</em>"
  );
  text = text.replace(
    /\[u\]([\s\S]*?)\[\/u\]/gi,
    '<span style="text-decoration: underline;">$1</span>'
  );

  // Color
  text = text.replace(
    /\[color=([a-zA-Z]+|#[0-9a-fA-F]{3,6})\]([\s\S]*?)\[\/color\]/gi,
    '<span style="color: $1;">$2</span>'
  );

  // Size (allow numeric sizes only, sanitized)
  text = text.replace(
    /\[size=(\d{1,3})\]([\s\S]*?)\[\/size\]/gi,
    '<span style="font-size: $1px;">$2</span>'
  );

  // URL with text: [url=X]text[/url]
  text = text.replace(
    /\[url=((?:https?|ftp):\/\/[^\]]+)\]([\s\S]*?)\[\/url\]/gi,
    '<a href="$1" rel="nofollow">$2</a>'
  );

  // URL without text: [url]X[/url]
  text = text.replace(
    /\[url\]((?:https?|ftp):\/\/[^\[]+)\[\/url\]/gi,
    '<a href="$1" rel="nofollow">$1</a>'
  );

  // Reject non-http urls that might have slipped through (e.g. javascript:)
  // This handles [url=javascript:...] by stripping the href
  text = text.replace(
    /\[url=([^\]]*)\]([\s\S]*?)\[\/url\]/gi,
    "$2"
  );
  text = text.replace(
    /\[url\]([^\[]+)\[\/url\]/gi,
    "$1"
  );

  // Image
  text = text.replace(
    /\[img\]((?:https?|ftp):\/\/[^\[]+)\[\/img\]/gi,
    '<img src="$1" alt="" />'
  );
  // Strip remaining [img] with non-http URLs
  text = text.replace(/\[img\]([^\[]+)\[\/img\]/gi, "");

  // Quote with attribution (matches Solaris bbcode.tpl table layout)
  text = text.replace(
    /\[quote=&quot;([^&]*?)&quot;\]([\s\S]*?)\[\/quote\]/gi,
    '</span><table width="90%" cellspacing="1" cellpadding="3" border="0" align="center"><tr> \t  <td><span class="genmed"><b>$1 wrote:</b></span></td>\t</tr>\t<tr>\t  <td class="quote">$2</td>\t</tr></table><span class="postbody">'
  );

  // Simple quote
  text = text.replace(
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    '</span><table width="90%" cellspacing="1" cellpadding="3" border="0" align="center"><tr> \t  <td><span class="genmed"><b>Quote:</b></span></td>\t</tr>\t<tr>\t  <td class="quote">$1</td>\t</tr></table><span class="postbody">'
  );

  // Lists
  text = text.replace(
    /\[list=([1aAiI])\]([\s\S]*?)\[\/list\]/gi,
    (_match, type, content) => {
      const items = parseListItems(content);
      return `<ol type="${type}">${items}</ol>`;
    }
  );
  text = text.replace(
    /\[list\]([\s\S]*?)\[\/list\]/gi,
    (_match, content) => {
      const items = parseListItems(content);
      return `<ul>${items}</ul>`;
    }
  );

  // Auto-link bare URLs (not already inside href="..." or src="...")
  text = text.replace(
    /(?<!="|>)(https?:\/\/[^\s<\[\]]+)/g,
    '<a href="$1" rel="nofollow">$1</a>'
  );

  // Newlines to <br /> (but not inside code blocks)
  text = text.replace(/\n/g, "<br />\n");

  // Step 4: Restore code blocks
  text = text.replace(/\x00CODE(\d+)\x00/g, (_match, idx) => {
    const code = escapeHtml(codeBlocks[parseInt(idx, 10)]);
    return `</span><table width="90%" cellspacing="1" cellpadding="3" border="0" align="center"><tr> \t  <td><span class="genmed"><b>Code:</b></span></td>\t</tr>\t<tr>\t  <td class="code">${code}</td>\t</tr></table><span class="postbody">`;
  });

  return markup(text);
}

function parseListItems(content: string): string {
  // Split on [*] markers and create <li> tags
  const parts = content.split(/\[\*\]/);
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => `<li>${part}</li>`)
    .join("");
}

