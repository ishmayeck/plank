/**
 * Theme → AST compiler (Chunk 22: "compiled templates at deploy").
 *
 * Walks a theme directory, compiles every `.tpl` (top level + `admin/`) to an
 * AST, and writes a single JSON manifest: { name -> serializedAst }. A runtime
 * without filesystem access (Supabase Edge / Cloudflare Workers) loads this
 * manifest into a PrecompiledTemplateLoader and renders with no parser and no
 * fs — see src/template/loader.ts and DEPLOYMENT.md.
 *
 * Usage:
 *   npx tsx scripts/compile-theme.ts [themeDir] [outFile]
 * Defaults:
 *   themeDir = themes/Solaris
 *   outFile  = dist/templates/Solaris.json
 *
 * The manifest keys are template names relative to the theme root (e.g.
 * "overall_header.tpl", "admin/index_body.tpl"), exactly the names route code
 * passes to loadFile()/INCLUDE.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { compile, serializeAst } from "../src/template/engine.js";

function findTpls(root: string, dir: string = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findTpls(root, full));
    } else if (entry.endsWith(".tpl")) {
      out.push(relative(root, full));
    }
  }
  return out;
}

export function compileTheme(themeDir: string): Record<string, string> {
  const names = findTpls(themeDir).sort();
  const manifest: Record<string, string> = {};
  for (const name of names) {
    const text = readFileSync(join(themeDir, name), "utf-8");
    manifest[name] = serializeAst(compile(text));
  }
  return manifest;
}

// Run as a script (skip when imported by tests).
const isMain =
  process.argv[1] && process.argv[1].endsWith("compile-theme.ts");
if (isMain) {
  const themeDir = process.argv[2] ?? join("themes", "Solaris");
  const outFile = process.argv[3] ?? join("dist", "templates", "Solaris.json");

  const manifest = compileTheme(themeDir);
  const count = Object.keys(manifest).length;
  const bytes = JSON.stringify(manifest).length;

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(manifest));

  console.log(
    `Compiled ${count} templates from ${themeDir} -> ${outFile} ` +
      `(${(bytes / 1024).toFixed(1)} KiB AST JSON)`
  );
}
