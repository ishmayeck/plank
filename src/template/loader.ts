import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  compile,
  deserializeAst,
  type TemplateLoader,
  type TemplateNode,
} from "./engine.js";

/**
 * Template loaders (Chunk 21 rung-2).
 *
 * A loader resolves a template name (filename, e.g. "overall_header.tpl") to
 * its compiled AST. `Template` renders from whatever a loader produces, so the
 * engine is identical across runtimes — only the byte source differs:
 *
 *   - FsTemplateLoader          → reads + compiles `.tpl` files (Node/dev/Docker)
 *   - PrecompiledTemplateLoader → serves precompiled AST JSON held in memory
 *                                 (the shape a Supabase/KV loader serves after
 *                                 priming: fetch JSON once, deserialize, render)
 *   - MemoryTemplateLoader      → raw template strings in memory (tests, seeds)
 *
 * `resolve()` is synchronous to keep rendering synchronous. A remote loader
 * (Supabase Storage / Cloudflare KV) implements `prime()` to fetch its data
 * up front, then serves it synchronously from memory — see ROADMAP Chunk 22.
 */

/**
 * Filesystem loader: reads `.tpl` files under a theme root and compiles them.
 * `compile()` memoizes by content, so repeated resolves of the same file are
 * cheap. This is the default behaviour on Node (a bare `new Template(path)`
 * uses the same code path internally).
 */
export class FsTemplateLoader implements TemplateLoader {
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  resolve(name: string): TemplateNode[] {
    return compile(readFileSync(join(this.root, name), "utf-8"));
  }
}

/**
 * In-memory loader over raw template strings. Useful for tests and for
 * bundling a known set of templates without filesystem access.
 */
export class MemoryTemplateLoader implements TemplateLoader {
  private sources: Map<string, string>;

  constructor(sources: Record<string, string> | Map<string, string> = {}) {
    this.sources =
      sources instanceof Map ? new Map(sources) : new Map(Object.entries(sources));
  }

  set(name: string, content: string): void {
    this.sources.set(name, content);
  }

  resolve(name: string): TemplateNode[] {
    const content = this.sources.get(name);
    if (content === undefined) {
      throw new Error(`MemoryTemplateLoader: no template "${name}"`);
    }
    return compile(content);
  }
}

/**
 * Loader over *precompiled* AST JSON (the output of `serializeAst`). This is
 * the runtime-agnostic path: a build/deploy step compiles every `.tpl` to AST
 * JSON and stores it (Postgres / Storage / KV); the server fetches that JSON
 * and renders it with no parser and no filesystem.
 *
 * Construct it from a map of name → serialized-AST, or subclass and fill
 * `compiled` in a `prime()` implementation that fetches from a remote source.
 */
export class PrecompiledTemplateLoader implements TemplateLoader {
  protected compiled: Map<string, TemplateNode[]> = new Map();

  constructor(serialized?: Record<string, string> | Map<string, string>) {
    if (serialized) {
      const entries =
        serialized instanceof Map ? serialized.entries() : Object.entries(serialized);
      for (const [name, json] of entries) {
        this.compiled.set(name, deserializeAst(json));
      }
    }
  }

  /** Add a precompiled AST from its serialized JSON form. */
  add(name: string, serializedAst: string): void {
    this.compiled.set(name, deserializeAst(serializedAst));
  }

  /** Add an already-deserialized AST (e.g. from a fetch + deserialize). */
  addAst(name: string, nodes: TemplateNode[]): void {
    this.compiled.set(name, nodes);
  }

  resolve(name: string): TemplateNode[] {
    const nodes = this.compiled.get(name);
    if (nodes === undefined) {
      throw new Error(
        `PrecompiledTemplateLoader: "${name}" not loaded (did you prime() it?)`
      );
    }
    return nodes;
  }
}
