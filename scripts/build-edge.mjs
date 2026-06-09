/**
 * Bundle the Supabase Edge Function entry (Chunk 22).
 *
 * esbuild resolves our NodeNext-style `.js` relative imports to the actual
 * `.ts` sources and inlines npm deps (hono, supabase-js, image-size, fflate)
 * into one file, so the Deno runtime gets a self-contained module with no
 * node_modules resolution. `platform: "node"` keeps `node:*` builtins as
 * bare imports — Deno supports those natively; the only one in the bundle is
 * the template engine's `node:fs`/`node:path`, which is dead code on Edge
 * (the precompiled loader is installed at boot, so readFileSync is never
 * called). The createRequire banner covers any CJS-interop `require` calls
 * esbuild emits for bundled CJS deps.
 *
 * Output is a build artifact (gitignored); `npm run deploy:edge` rebuilds
 * before every deploy.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/edge.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  outfile: "supabase/functions/plank/index.ts",
  banner: {
    js: `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`,
  },
  logLevel: "info",
});
