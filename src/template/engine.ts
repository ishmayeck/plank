import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { escapeHtml, escapeRegex } from "../lib/escape.js";
import type { TemplateValue } from "../lib/markup.js";

/**
 * phpBB2-compatible template engine.
 *
 * Supports the three constructs of the phpBB2 template language:
 *   - Variable substitution: {VAR_NAME}
 *   - Block iteration: <!-- BEGIN name --> / <!-- END name -->
 *     with dot-scoped variables: {block.VAR}, {block.child.VAR}
 *   - Conditional switches: <!-- BEGIN switch_x --> / <!-- END switch_x -->
 *     (rendered when the block has been assigned at least once)
 *
 * Data model mirrors phpBB2's template.php:
 *   - Root variables: _tpldata['.'][0][VARNAME]
 *   - Block iterations: _tpldata['blockname.'][i][VARNAME]
 *   - Nested blocks: _tpldata['parent.'][i]['child.'][j][VARNAME]
 *
 * ── Compile / render split (Chunk 21) ──
 * Parsing template text into an AST (`compile`) is a pure function of the
 * input string, and rendering never mutates the AST. So the AST is cached
 * by content and shared across renders and Template instances — the same
 * `.tpl` is parsed at most once per process. File reads are separately
 * cached by path+mtime. The AST is plain data (text + block nodes, no
 * embedded code), which is what lets a non-Node runtime fetch a
 * pre-compiled AST instead of reading files. See `TemplateLoader`.
 */

// ─── AST types ──────────────────────────────────────────────────────
//
// The AST is the compiled artifact. It is plain JSON-serializable data:
// a TextNode carries a literal string; a BlockNode carries a name and its
// children. `AST_FORMAT_VERSION` is bumped whenever this shape changes so
// that persisted/precompiled ASTs from an older format are invalidated
// rather than silently mis-rendered.

// v2 added IncludeNode (phpBB2 `<!-- INCLUDE x.tpl -->`).
export const AST_FORMAT_VERSION = 2;

export type TemplateNode = TextNode | BlockNode | IncludeNode;

export interface TextNode {
  type: "text";
  content: string;
}

export interface BlockNode {
  type: "block";
  name: string;
  children: TemplateNode[];
}

/**
 * phpBB2 `<!-- INCLUDE filename.tpl -->`. Resolved at render time through the
 * Template's loader/root (not at compile time), so every template compiles to
 * a standalone, serializable AST with no compile-time dependency graph. The
 * included template shares the including template's variable namespace, as in
 * phpBB2. Cycles are detected at render time.
 */
export interface IncludeNode {
  type: "include";
  name: string;
}

/** A compiled template: the AST plus the format version it was built with. */
export interface CompiledTemplate {
  v: number;
  nodes: TemplateNode[];
}

/**
 * Resolves a template name (e.g. "overall_header.tpl") to its compiled AST.
 *
 * `resolve` is synchronous so that rendering stays synchronous (routes call
 * `tpl.render()` synchronously). A loader backed by a remote/async source
 * (Supabase Storage, Cloudflare KV) must fetch its data ahead of time via
 * `prime()` and then serve it from memory in `resolve()`. Filesystem and
 * in-memory loaders need no priming. See src/template/loader.ts.
 */
export interface TemplateLoader {
  /** Return the compiled AST for a template name. Throws if unavailable. */
  resolve(name: string): TemplateNode[];
  /**
   * Optionally pre-fetch/compile the named templates so subsequent
   * `resolve()` calls can be synchronous. No-op for synchronous sources.
   */
  prime?(names: string[]): Promise<void>;
}

/**
 * Serialize a compiled AST to a stable JSON string tagged with the format
 * version. This is the artifact a build/deploy step writes to Postgres /
 * Storage / KV so a non-Node runtime can render without parsing `.tpl`.
 */
export function serializeAst(nodes: TemplateNode[]): string {
  const payload: CompiledTemplate = { v: AST_FORMAT_VERSION, nodes };
  return JSON.stringify(payload);
}

/**
 * Parse a serialized AST back into nodes, rejecting a version mismatch so
 * stale precompiled output is regenerated rather than mis-rendered.
 */
export function deserializeAst(json: string): TemplateNode[] {
  const parsed = JSON.parse(json) as CompiledTemplate;
  if (!parsed || parsed.v !== AST_FORMAT_VERSION) {
    throw new Error(
      `Template AST format mismatch: got v${parsed?.v}, expected v${AST_FORMAT_VERSION}`
    );
  }
  return parsed.nodes;
}

interface BlockScope {
  currentBlock?: string;
  currentRow?: Record<string, TemplateValue>;
  ancestors?: { name: string; row: Record<string, TemplateValue> }[];
}

// ─── Caches (module-scoped, process-lifetime) ───────────────────────
//
// astCache:  template content string  → parsed AST
// fileCache: absolute path            → { mtimeMs, content }
//
// Both are naturally bounded by the number of distinct templates a board
// uses (small). They persist for the process lifetime, like the smiley
// and word-censor caches. `clearTemplateCaches()` resets them (tests,
// benchmarks, and theme hot-swaps).

const astCache = new Map<string, TemplateNode[]>();
const fileCache = new Map<string, { mtimeMs: number; content: string }>();

/** Reset the AST and file-read caches. Mainly for tests and benchmarks. */
export function clearTemplateCaches(): void {
  astCache.clear();
  fileCache.clear();
}

/** Cache-instrumentation snapshot, for benchmarks and diagnostics. */
export function templateCacheStats(): { astEntries: number; fileEntries: number } {
  return { astEntries: astCache.size, fileEntries: fileCache.size };
}

/**
 * Compile template text into an AST. Pure function of `code`; memoized by
 * content so identical text is parsed at most once per process. The
 * returned array is shared — callers must treat it as immutable (the
 * renderer does).
 */
export function compile(code: string): TemplateNode[] {
  const cached = astCache.get(code);
  if (cached !== undefined) return cached;
  const nodes = parseBlocks(code);
  astCache.set(code, nodes);
  return nodes;
}

/** Read a file with a path+mtime cache so unchanged files aren't re-read. */
function readTemplateFile(filepath: string): string {
  const mtimeMs = statSync(filepath).mtimeMs;
  const cached = fileCache.get(filepath);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) {
    return cached.content;
  }
  const content = readFileSync(filepath, "utf-8");
  fileCache.set(filepath, { mtimeMs, content });
  return content;
}

// ─── Parser (pure, module-level) ────────────────────────────────────

const INCLUDE_REGEX = /<!--\s*INCLUDE\s+(\S+?)\s*-->/g;

/**
 * Push a run of plain text, splitting out any `<!-- INCLUDE x.tpl -->`
 * directives into IncludeNodes. (INCLUDE never spans a block boundary in
 * phpBB2, so it's safe to resolve within a single text run.)
 */
function pushText(nodes: TemplateNode[], text: string): void {
  if (!text) return;
  INCLUDE_REGEX.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = INCLUDE_REGEX.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push({ type: "text", content: text.slice(last, m.index) });
    }
    nodes.push({ type: "include", name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push({ type: "text", content: text.slice(last) });
  }
}

function parseBlocks(code: string): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  const beginRegex = /<!--\s*BEGIN\s+(\S+?)\s*-->/g;

  let pos = 0;

  while (pos < code.length) {
    beginRegex.lastIndex = pos;
    const beginMatch = beginRegex.exec(code);

    if (!beginMatch) {
      // No more blocks — rest is plain text (may contain INCLUDEs)
      pushText(nodes, code.slice(pos));
      break;
    }

    // Text before this block
    if (beginMatch.index > pos) {
      pushText(nodes, code.slice(pos, beginMatch.index));
    }

    const blockName = beginMatch[1];
    const innerStart = beginMatch.index + beginMatch[0].length;

    // Find the matching END tag (handle nesting of same-name blocks)
    const endPos = findMatchingEnd(code, blockName, innerStart);
    if (endPos === -1) {
      // No matching end — treat as text
      pushText(nodes, code.slice(beginMatch.index));
      break;
    }

    const innerContent = code.slice(innerStart, endPos.innerEnd);
    const innerNodes = parseBlocks(innerContent);

    nodes.push({
      type: "block",
      name: blockName,
      children: innerNodes,
    });

    pos = endPos.outerEnd;
  }

  return nodes;
}

function findMatchingEnd(
  code: string,
  blockName: string,
  startPos: number
): { innerEnd: number; outerEnd: number } | -1 {
  const beginPattern = new RegExp(
    `<!--\\s*BEGIN\\s+${escapeRegex(blockName)}\\s*-->`,
    "g"
  );
  const endPattern = new RegExp(
    `<!--\\s*END\\s+${escapeRegex(blockName)}\\s*-->`,
    "g"
  );

  let depth = 1;
  let searchPos = startPos;

  while (depth > 0) {
    beginPattern.lastIndex = searchPos;
    endPattern.lastIndex = searchPos;

    const nextBegin = beginPattern.exec(code);
    const nextEnd = endPattern.exec(code);

    if (!nextEnd) return -1;

    if (nextBegin && nextBegin.index < nextEnd.index) {
      depth++;
      searchPos = nextBegin.index + nextBegin[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return {
          innerEnd: nextEnd.index,
          outerEnd: nextEnd.index + nextEnd[0].length,
        };
      }
      searchPos = nextEnd.index + nextEnd[0].length;
    }
  }

  return -1;
}

// ─── Renderer (pure, module-level) ──────────────────────────────────

/**
 * Per-render context: the block data plus the include resolver and the stack
 * of in-progress includes (for cycle detection). Bundled so INCLUDE support
 * doesn't thread extra positional params through every render function.
 */
interface RenderCtx {
  blockData: Record<string, Record<string, TemplateValue>[]>;
  resolveInclude: (name: string) => TemplateNode[];
  includeStack: string[];
}

function renderNodes(
  nodes: TemplateNode[],
  rootVars: Record<string, TemplateValue>,
  blockScope: BlockScope,
  ctx: RenderCtx
): string {
  let output = "";

  for (const node of nodes) {
    if (node.type === "text") {
      output += substituteVars(node.content, rootVars, blockScope);
    } else if (node.type === "include") {
      output += renderInclude(node, rootVars, blockScope, ctx);
    } else {
      output += renderBlock(node, rootVars, blockScope, ctx);
    }
  }

  return output;
}

function renderInclude(
  node: IncludeNode,
  rootVars: Record<string, TemplateValue>,
  scope: BlockScope,
  ctx: RenderCtx
): string {
  if (ctx.includeStack.includes(node.name)) {
    throw new Error(
      `Template INCLUDE cycle: ${[...ctx.includeStack, node.name].join(" -> ")}`
    );
  }
  const included = ctx.resolveInclude(node.name);
  // The included template shares the current variable namespace and scope
  // (phpBB2 behaviour). Push the name for cycle detection during its render.
  ctx.includeStack.push(node.name);
  try {
    return renderNodes(included, rootVars, scope, ctx);
  } finally {
    ctx.includeStack.pop();
  }
}

function renderBlock(
  node: BlockNode,
  rootVars: Record<string, TemplateValue>,
  parentScope: BlockScope,
  ctx: RenderCtx
): string {
  const blockName = node.name;

  // Determine the data rows for this block
  const rows = resolveBlockData(blockName, parentScope, ctx.blockData);

  if (!rows || rows.length === 0) {
    return "";
  }

  let output = "";
  for (const row of rows) {
    const newScope: BlockScope = {
      ...parentScope,
      currentBlock: blockName,
      currentRow: row,
      ancestors: [
        ...(parentScope.ancestors || []),
        ...(parentScope.currentBlock
          ? [{ name: parentScope.currentBlock, row: parentScope.currentRow! }]
          : []),
      ],
    };

    output += renderNodes(node.children, rootVars, newScope, ctx);
  }

  return output;
}

function resolveBlockData(
  blockName: string,
  parentScope: BlockScope,
  blockData: Record<string, Record<string, TemplateValue>[]>
): Record<string, TemplateValue>[] | undefined {
  if (!parentScope.currentBlock) {
    // Top-level block — look in blockData
    return blockData[blockName];
  }

  // Nested block — look in the parent's current row
  const key = `__block_${blockName}`;
  return (parentScope.currentRow as any)?.[key];
}

/**
 * Render a value into the output stream. Plain strings are HTML-
 * escaped; MarkupString values are passed through verbatim. Wrap any
 * pre-rendered HTML at the assignVars site with markup() to opt out
 * of escaping.
 */
function renderValue(value: TemplateValue | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? escapeHtml(value) : value.html;
}

/**
 * Substitute `{VAR}` and `{block.VAR}` placeholders in one pass.
 *
 * SECURITY: this MUST remain a single `replace` over the template text.
 * Two sequential passes (namespaced, then root) would re-scan the output of
 * the first — and since escapeHtml deliberately leaves `{` and `}` alone,
 * user content rendered through a block variable could then name and expand
 * arbitrary root variables, including MarkupString ones that emit raw HTML.
 * A post body of `{S_HIDDEN_FIELDS}` printed the viewer's own CSRF token;
 * `{S_TOPIC_ADMIN}` forged moderator controls. `String.replace` never
 * re-scans what a replacement function returns, so one pass closes it.
 */
function substituteVars(
  text: string,
  rootVars: Record<string, TemplateValue>,
  scope: BlockScope
): string {
  return text.replace(
    /\{(?:(([a-z0-9_-]+\.)+)([a-z0-9_-]+)|([a-z0-9_-]+))\}/gi,
    (
      _match,
      namespace: string | undefined,
      _lastDot: string | undefined,
      namespacedVar: string | undefined,
      rootVar: string | undefined
    ) => {
      if (namespace) {
        return renderValue(resolveNamespacedVar(namespace, namespacedVar!, scope));
      }
      return renderValue(rootVars[rootVar!]);
    }
  );
}

function resolveNamespacedVar(
  namespace: string,
  varname: string,
  scope: BlockScope
): TemplateValue | undefined {
  // namespace is like "catrow." or "catrow.forumrow."
  // Strip trailing dot and split
  const parts = namespace.slice(0, -1).split(".");

  // The variable belongs to the block at the deepest level of the namespace.
  // We need to find the right row in the current scope.

  // Check if the deepest block matches the current scope
  const deepest = parts[parts.length - 1];

  if (scope.currentBlock === deepest) {
    return scope.currentRow?.[varname];
  }

  // Check ancestors
  if (scope.ancestors) {
    for (const ancestor of scope.ancestors) {
      if (ancestor.name === deepest) {
        return ancestor.row[varname];
      }
    }
  }

  return undefined;
}

// ─── Template instance ──────────────────────────────────────────────

export class Template {
  private root?: string;
  private loader?: TemplateLoader;
  // handle -> compiled AST. Compiled at load time so render() is a pure walk
  // over data, identical regardless of where the AST came from (fs, loader,
  // precompiled JSON). compile() is memoized, so compile-at-load costs the
  // same as the old compile-at-render.
  private templates: Map<string, TemplateNode[]> = new Map();
  private rootVars: Record<string, TemplateValue> = {};
  private blockData: Record<string, Record<string, TemplateValue>[]> = {};
  private substitutions: { pattern: RegExp; replacement: string }[] = [];

  /**
   * Construct with either a theme-root path (filesystem source, the default
   * on Node) or an explicit TemplateLoader (Supabase / KV / in-memory).
   */
  constructor(source: string | TemplateLoader = ".") {
    if (typeof source === "string") {
      this.root = resolve(source);
    } else {
      this.loader = source;
    }
  }

  /** Load a template from a string (useful for tests). Compiled immediately. */
  loadString(handle: string, content: string): void {
    this.templates.set(handle, compile(content));
  }

  /** Load a precompiled AST directly (e.g. fetched from storage). */
  loadAst(handle: string, nodes: TemplateNode[]): void {
    this.templates.set(handle, nodes);
  }

  /**
   * Load a template by filename. Resolves through the loader if one was
   * supplied, otherwise reads + compiles from the filesystem theme root.
   */
  loadFile(handle: string, filename: string): void {
    const nodes = this.loader
      ? this.loader.resolve(filename)
      : compile(readTemplateFile(join(this.root!, filename)));
    this.templates.set(handle, nodes);
  }

  /**
   * Register a post-render line substitution.
   * Any output line matching the pattern is replaced entirely.
   */
  registerSubstitution(pattern: RegExp, replacement: string): void {
    this.substitutions.push({ pattern, replacement });
  }

  /** Assign root-level template variables. */
  assignVars(vars: Record<string, TemplateValue>): void {
    Object.assign(this.rootVars, vars);
  }

  /**
   * Assign a block iteration. Each call adds a new row to the block.
   *
   * For top-level blocks: assignBlockVars("blockname", { ... })
   * For nested blocks: assignBlockVars("parent.child", { ... })
   *   — the child row is added to the LAST iteration of the parent.
   */
  assignBlockVars(blockname: string, vars: Record<string, TemplateValue>): void {
    if (blockname.includes(".")) {
      this.assignNestedBlockVars(blockname, vars);
    } else {
      if (!this.blockData[blockname]) {
        this.blockData[blockname] = [];
      }
      this.blockData[blockname].push(vars);
    }
  }

  private assignNestedBlockVars(
    blockname: string,
    vars: Record<string, TemplateValue>
  ): void {
    const parts = blockname.split(".");
    const childName = parts[parts.length - 1];

    // Walk down to the last iteration of each parent block
    let current: Record<string, TemplateValue>[] | undefined = this.blockData[parts[0]];
    if (!current || current.length === 0) return;

    let lastRow: Record<string, TemplateValue> = current[current.length - 1];

    for (let i = 1; i < parts.length - 1; i++) {
      const nested = (lastRow as any)[`__block_${parts[i]}`] as
        | Record<string, TemplateValue>[]
        | undefined;
      if (!nested || nested.length === 0) return;
      lastRow = nested[nested.length - 1];
    }

    // Add the child block row
    const key = `__block_${childName}`;
    if (!(lastRow as any)[key]) {
      (lastRow as any)[key] = [];
    }
    (lastRow as any)[key].push(vars);
  }

  /**
   * Resolve an `<!-- INCLUDE name -->` to its AST, the same way loadFile
   * sources templates (loader if present, else filesystem theme root).
   * Memoized per instance so a repeated include compiles/reads once.
   */
  private includeCache: Map<string, TemplateNode[]> = new Map();
  private resolveInclude(name: string): TemplateNode[] {
    const cached = this.includeCache.get(name);
    if (cached !== undefined) return cached;
    const nodes = this.loader
      ? this.loader.resolve(name)
      : compile(readTemplateFile(join(this.root!, name)));
    this.includeCache.set(name, nodes);
    return nodes;
  }

  /** Render the template identified by handle. */
  render(handle: string): string {
    const nodes = this.templates.get(handle);
    if (nodes === undefined) {
      throw new Error(`Template->render(): No template loaded for handle "${handle}"`);
    }

    const ctx: RenderCtx = {
      blockData: this.blockData,
      resolveInclude: (name) => this.resolveInclude(name),
      includeStack: [],
    };
    let output = renderNodes(nodes, this.rootVars, {}, ctx);

    for (const { pattern, replacement } of this.substitutions) {
      output = output.replace(pattern, replacement);
    }

    return output;
  }
}
