/**
 * Brand wrapper for pre-rendered HTML strings that the template engine
 * should pass through verbatim instead of HTML-escaping. Use for
 * generated markup like jumpboxes, paginators, error boxes — anywhere
 * the value is HTML the route already produced and trusts.
 *
 * Plain strings passed to assignVars/assignBlockVars are escaped by
 * default; wrap with markup() only when you mean it.
 */
export class MarkupString {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
  toString(): string {
    return this.html;
  }
}

export function markup(html: string): MarkupString {
  return new MarkupString(html);
}

export function isMarkup(value: unknown): value is MarkupString {
  return value instanceof MarkupString;
}

/** Convenience type for assignVars values. */
export type TemplateValue = string | MarkupString;
