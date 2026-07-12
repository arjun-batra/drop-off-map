#!/usr/bin/env node
/**
 * REV-018 recurrence prevention: real Node ESM resolution check.
 *
 * `tsc --noEmit` / `vite build` / `vitest` all resolve modules via
 * TypeScript's "Bundler" moduleResolution, which happily accepts
 * extensionless relative specifiers (`from "../src/config/loader"`).
 * Node's real ESM loader -- what Vercel actually runs in production,
 * since package.json has `"type": "module"` -- does not; it requires an
 * explicit file extension. That gap is exactly what caused the REV-018
 * production outage (every api/*.ts handler crashed at cold start with
 * `ERR_MODULE_NOT_FOUND`) invisibly to the entire typecheck/build/test
 * pipeline (see docs/review-log.md's "Post-Closure Incident Audit --
 * REV-018" section for the full root-cause writeup).
 *
 * This script is a reusable, CI-runnable version of the exact manual
 * verification dev/QA did during the REV-018 hotfix (docs/handoff.md's
 * "Critical production hotfix" section, docs/test-report.md's "Hotfix
 * Verification" section):
 *
 *   1. Compile the backend-reachable tree (api/**, non-frontend src/**)
 *      with `tsc` (module: ESNext) to a scratch outDir, preserving the
 *      same relative directory layout Vercel's /var/task/ uses.
 *   2. Import each compiled api/*.js handler with a real, unbundled Node
 *      `import()` -- no Vite, no Vitest, no bundler resolution involved.
 *   3. Exit non-zero with a clear per-handler error if any handler fails
 *      to import, so this can be wired into CI as a real gate.
 *
 * Run: `npm run verify:esm` (see package.json).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(REPO_ROOT, "api");
const TSC_BIN = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
const SCRATCH_TSCONFIG_NAME = "tsconfig.verify-esm.generated.json";

/** Recursively finds every `.ts` file under `dir` (api/ has nested route dirs, e.g. api/config/, api/auth/). */
function findTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...findTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

function compileBackendTree(scratchOutDir, scratchTsconfigPath) {
  // Extends the project's real tsconfig.json so this stays in sync with it
  // (lib/strict/target/etc.), overriding only what's needed to emit real
  // ESM JS for the backend-reachable subset into a scratch directory.
  const scratchTsconfig = {
    extends: "./tsconfig.json",
    compilerOptions: {
      module: "ESNext",
      noEmit: false,
      declaration: false,
      sourceMap: false,
      outDir: scratchOutDir,
      rootDir: REPO_ROOT,
    },
    include: ["api/**/*.ts", "src/**/*.ts"],
    exclude: ["src/frontend/**", "node_modules"],
  };
  writeFileSync(scratchTsconfigPath, JSON.stringify(scratchTsconfig, null, 2));

  try {
    execFileSync(process.execPath, [TSC_BIN, "-p", scratchTsconfigPath], {
      cwd: REPO_ROOT,
      stdio: "pipe",
      encoding: "utf8",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

async function verifyHandlersImportCleanly(handlerSourceFiles, scratchOutDir) {
  const failures = [];

  for (const sourceFile of handlerSourceFiles) {
    const relativePath = path.relative(REPO_ROOT, sourceFile);
    const compiledPath = path.join(scratchOutDir, relativePath).replace(/\.ts$/, ".js");
    const moduleUrl = pathToFileURL(compiledPath).href;

    try {
      await import(moduleUrl);
      console.log(`  OK    ${relativePath}`);
    } catch (err) {
      console.log(`  FAIL  ${relativePath}`);
      failures.push({ relativePath, err });
    }
  }

  return failures;
}

async function main() {
  const handlerSourceFiles = findTsFiles(API_DIR).sort();
  if (handlerSourceFiles.length === 0) {
    console.error(`verify:esm -- no api/*.ts handler files found under ${API_DIR}; nothing to verify.`);
    process.exitCode = 1;
    return;
  }

  const scratchOutDir = mkdtempSync(path.join(tmpdir(), "dropspot-verify-esm-"));
  const scratchTsconfigPath = path.join(REPO_ROOT, SCRATCH_TSCONFIG_NAME);

  try {
    console.log("verify:esm -- compiling api/** + non-frontend src/** with tsc (module: ESNext)...");
    const compileResult = compileBackendTree(scratchOutDir, scratchTsconfigPath);
    if (!compileResult.ok) {
      console.error("");
      console.error("verify:esm -- FAILED: TypeScript compilation of the backend-reachable tree failed.");
      console.error(compileResult.stdout);
      console.error(compileResult.stderr);
      process.exitCode = 1;
      return;
    }

    console.log(
      `verify:esm -- compiled OK. Importing ${handlerSourceFiles.length} handler(s) under real Node ESM resolution...`,
    );
    const failures = await verifyHandlersImportCleanly(handlerSourceFiles, scratchOutDir);

    if (failures.length > 0) {
      console.error("");
      console.error(
        `verify:esm -- FAILED: ${failures.length} of ${handlerSourceFiles.length} handler(s) could not be imported under real Node ESM resolution:`,
      );
      for (const { relativePath, err } of failures) {
        console.error("");
        console.error(`  ${relativePath}:`);
        console.error(`    ${err.stack || err.message || err}`);
      }
      console.error("");
      console.error(
        "This is the exact failure class behind REV-018 (production ERR_MODULE_NOT_FOUND on every " +
          "api/*.ts handler at Vercel cold start): a relative import/export somewhere in this handler's " +
          "module graph is missing an explicit file extension. Node's real ESM loader (what Vercel runs " +
          "in production, per package.json's \"type\": \"module\") requires one; TypeScript's Bundler " +
          "resolution (typecheck/build/test) does not, so this class of bug is invisible to those checks. " +
          "Fix: add the missing \".js\" extension to the relative import/export specifier(s) named above.",
      );
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log(
      `verify:esm -- PASS: all ${handlerSourceFiles.length} api/*.ts handler(s) import cleanly under real Node ESM resolution.`,
    );
  } finally {
    rmSync(scratchTsconfigPath, { force: true });
    rmSync(scratchOutDir, { recursive: true, force: true });
  }
}

await main();
