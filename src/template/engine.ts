import { readFileSync } from "node:fs";
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
 */
export class Template {
  private root: string;
  private templates: Map<string, string> = new Map();
  private rootVars: Record<string, TemplateValue> = {};
  private blockData: Record<string, Record<string, TemplateValue>[]> = {};
  private substitutions: { pattern: RegExp; replacement: string }[] = [];

  constructor(root: string = ".") {
    this.root = resolve(root);
  }

  /** Load a template from a string (useful for tests). */
  loadString(handle: string, content: string): void {
    this.templates.set(handle, content);
  }

  /** Load a template from a .tpl file relative to the theme root. */
  loadFile(handle: string, filename: string): void {
    const filepath = join(this.root, filename);
    const content = readFileSync(filepath, "utf-8");
    this.templates.set(handle, content);
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

  /** Render the template identified by handle. */
  render(handle: string): string {
    const code = this.templates.get(handle);
    if (code === undefined) {
      throw new Error(`Template->render(): No template loaded for handle "${handle}"`);
    }

    const parsed = this.parseBlocks(code);
    let output = this.renderNodes(parsed, this.rootVars, {});

    for (const { pattern, replacement } of this.substitutions) {
      output = output.replace(pattern, replacement);
    }

    return output;
  }

  // ─── Parser ─────────────────────────────────────────────────────

  private parseBlocks(code: string): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    const beginRegex = /<!--\s*BEGIN\s+(\S+?)\s*-->/g;
    const endRegex = /<!--\s*END\s+(\S+?)\s*-->/g;

    let pos = 0;

    while (pos < code.length) {
      beginRegex.lastIndex = pos;
      const beginMatch = beginRegex.exec(code);

      if (!beginMatch) {
        // No more blocks — rest is plain text
        nodes.push({ type: "text", content: code.slice(pos) });
        break;
      }

      // Text before this block
      if (beginMatch.index > pos) {
        nodes.push({ type: "text", content: code.slice(pos, beginMatch.index) });
      }

      const blockName = beginMatch[1];
      const innerStart = beginMatch.index + beginMatch[0].length;

      // Find the matching END tag (handle nesting of same-name blocks)
      const endPos = this.findMatchingEnd(code, blockName, innerStart);
      if (endPos === -1) {
        // No matching end — treat as text
        nodes.push({ type: "text", content: code.slice(beginMatch.index) });
        break;
      }

      const innerContent = code.slice(innerStart, endPos.innerEnd);
      const innerNodes = this.parseBlocks(innerContent);

      nodes.push({
        type: "block",
        name: blockName,
        children: innerNodes,
      });

      pos = endPos.outerEnd;
    }

    return nodes;
  }

  private findMatchingEnd(
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

  // ─── Renderer ───────────────────────────────────────────────────

  private renderNodes(
    nodes: TemplateNode[],
    rootVars: Record<string, TemplateValue>,
    blockScope: BlockScope
  ): string {
    let output = "";

    for (const node of nodes) {
      if (node.type === "text") {
        output += this.substituteVars(node.content, rootVars, blockScope);
      } else {
        output += this.renderBlock(node, rootVars, blockScope);
      }
    }

    return output;
  }

  private renderBlock(
    node: BlockNode,
    rootVars: Record<string, TemplateValue>,
    parentScope: BlockScope
  ): string {
    const blockName = node.name;

    // Determine the data rows for this block
    const rows = this.resolveBlockData(blockName, parentScope);

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

      output += this.renderNodes(node.children, rootVars, newScope);
    }

    return output;
  }

  private resolveBlockData(
    blockName: string,
    parentScope: BlockScope
  ): Record<string, TemplateValue>[] | undefined {
    if (!parentScope.currentBlock) {
      // Top-level block — look in blockData
      return this.blockData[blockName];
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
  private renderValue(value: TemplateValue | undefined): string {
    if (value === undefined) return "";
    return typeof value === "string" ? escapeHtml(value) : value.html;
  }

  private substituteVars(
    text: string,
    rootVars: Record<string, TemplateValue>,
    scope: BlockScope
  ): string {
    // Replace namespaced variables first: {block.child.VAR} or {block.VAR}
    text = text.replace(
      /\{(([a-z0-9_-]+\.)+)([a-z0-9_-]+)\}/gi,
      (_match, namespace: string, _lastDot: string, varname: string) => {
        return this.renderValue(this.resolveNamespacedVar(namespace, varname, scope));
      }
    );

    // Replace root-level variables: {VAR}
    text = text.replace(/\{([a-z0-9_-]+)\}/gi, (_match, varname: string) => {
      return this.renderValue(rootVars[varname]);
    });

    return text;
  }

  private resolveNamespacedVar(
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
}

// ─── Types ──────────────────────────────────────────────────────────

type TemplateNode = TextNode | BlockNode;

interface TextNode {
  type: "text";
  content: string;
}

interface BlockNode {
  type: "block";
  name: string;
  children: TemplateNode[];
}

interface BlockScope {
  currentBlock?: string;
  currentRow?: Record<string, TemplateValue>;
  ancestors?: { name: string; row: Record<string, TemplateValue> }[];
}
