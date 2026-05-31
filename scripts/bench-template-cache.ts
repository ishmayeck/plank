/**
 * Benchmark for the Chunk 21 rung-1 template parse cache.
 *
 * Measures the cost of repeatedly compiling the real Solaris .tpl files
 * with the cache cleared each iteration (the OLD behavior — re-parse every
 * render) vs. with the cache warm (the NEW behavior). Run with:
 *
 *   npx tsx scripts/bench-template-cache.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  compile,
  clearTemplateCaches,
} from "../src/template/engine.js";

const THEME_DIR = join(import.meta.dirname, "..", "themes", "Solaris");

const files = readdirSync(THEME_DIR).filter((f) => f.endsWith(".tpl"));
const contents = files.map((f) => readFileSync(join(THEME_DIR, f), "utf-8"));
const totalBytes = contents.reduce((n, c) => n + c.length, 0);

console.log(
  `Loaded ${files.length} Solaris templates (${(totalBytes / 1024).toFixed(1)} KiB)\n`
);

const ITERATIONS = 2000;

// ── Cold: clear the cache before each pass, so every compile re-parses.
// This models the pre-Chunk-21 behavior (parseBlocks on every render).
function benchCold(): number {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    clearTemplateCaches();
    for (const c of contents) compile(c);
  }
  return performance.now() - start;
}

// ── Warm: parse once, then every compile is a cache hit.
function benchWarm(): number {
  clearTemplateCaches();
  for (const c of contents) compile(c); // prime
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const c of contents) compile(c);
  }
  return performance.now() - start;
}

// Warm up the JIT.
benchCold();
benchWarm();

const cold = benchCold();
const warm = benchWarm();

const passes = ITERATIONS;
console.log(`Iterations: ${passes} full passes over all templates\n`);
console.log(`Cold (re-parse every pass): ${cold.toFixed(1)} ms  ` +
  `(${((cold / passes) * 1000).toFixed(1)} µs/pass)`);
console.log(`Warm (cached AST):          ${warm.toFixed(1)} ms  ` +
  `(${((warm / passes) * 1000).toFixed(1)} µs/pass)`);
console.log(`\nSpeedup: ${(cold / warm).toFixed(1)}×`);
