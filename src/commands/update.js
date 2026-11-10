import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "../lib/fsutil.js";
import { buildScaffoldMap, PROTECTED_PATHS } from "../lib/scaffold.js";
import { HOOK_CONFIG_PATHS, mergeExistingHookConfigs } from "../lib/hooks-merge.js";
import { resolvePythonCommand } from "../lib/python.js";
import { loadHashes, saveHashes, sha256 } from "../lib/hashes.js";
import {
  collectPlatformFiles,
  detectConfiguredPlatforms,
  HOST_PLATFORMS,
  readPlatformSelection,
} from "../lib/platforms.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
const PATH_LIST_LIMIT = 20;

/**
 * Platforms `update` should refresh.
 * - Persisted selection wins (an empty array is deliberate: generic core only).
 * - Corrupt selection falls back to detection instead of failing the upgrade;
 *   stderr says how to repair it.
 * - Missing selection = pre-S1 install: same detection (and all-hosts fallback)
 *   as older versions.
 */
function detectPlatforms(cwd) {
  const selection = readPlatformSelection(cwd);
  if (selection.status === "ok") return selection.platforms;

  if (selection.status === "corrupt") {
    console.error(
      "  warn: .ateam/.platforms.json is invalid " +
        `(${selection.reason}); falling back to platform detection. ` +
        "Re-run `ateam init` to rewrite the selection.",
    );
  }

  const detected = detectConfiguredPlatforms(cwd);
  return detected.length ? detected : HOST_PLATFORMS.slice();
}

export async function update(flags = {}) {
  const cwd = process.cwd();
  if (!fs.existsSync(path.join(cwd, ".ateam"))) {
    throw new Error("not initialized: run `ateam init` first");
  }

  const python = resolvePythonCommand();
  const vars = { PYTHON_CMD: python };
  const platforms = detectPlatforms(cwd);

  const scaffold = buildScaffoldMap(path.join(PACKAGE_ROOT, "templates", "scaffold"), vars);

  const desired = new Map([...scaffold, ...collectPlatformFiles(platforms, vars)]);
  const hashes = loadHashes(cwd);

  const merged = mergeExistingHookConfigs(cwd, desired);
  for (const warning of merged.warnings) {
    console.warn(`  warn: could not merge existing hooks (${warning}); file left untouched`);
  }
  // Host hook configs are merge-only, even under --force: after the merge
  // attempt, drop every on-disk host config from the desired set so a failed
  // merge can never fall through to atomicWrite below.
  for (const rel of HOOK_CONFIG_PATHS) {
    if (fs.existsSync(path.join(cwd, ...rel.split("/")))) desired.delete(rel);
  }

  let updated = 0;
  let skipped = 0;
  let runtimeKept = 0;
  const conflicts = [];

  for (const [rel, content] of desired) {
    const target = path.join(cwd, ...rel.split("/"));
    const newHash = sha256(content);

    if (PROTECTED_PATHS.has(rel) && fs.existsSync(target)) {
      runtimeKept += 1;
      continue;
    }

    if (!fs.existsSync(target)) {
      atomicWrite(target, content);
      hashes[rel] = newHash;
      updated += 1;
      continue;
    }

    const current = fs.readFileSync(target, "utf8");
    const currentHash = sha256(current);
    const knownHash = hashes[rel];

    if (currentHash === newHash) {
      hashes[rel] = newHash;
      continue;
    }

    // Fail closed: only overwrite a differing file when we can prove it is
    // untouched since install (a recorded hash exists and still matches).
    // Missing provenance (`.template-hashes.json` is gitignored, so a fresh
    // clone has none) is a conflict, not a silent overwrite.
    const untouchedSinceInstall = knownHash !== undefined && currentHash === knownHash;
    if (!untouchedSinceInstall && !flags.force) {
      conflicts.push(rel);
      skipped += 1;
      continue;
    }

    atomicWrite(target, content);
    hashes[rel] = newHash;
    updated += 1;
  }

  saveHashes(cwd, hashes);
  atomicWrite(path.join(cwd, ".ateam", ".version"), `${VERSION}\n`);

  const platformLabel = platforms.length ? platforms.join(", ") : "none (generic .agents/skills only)";
  console.log(`\nateam update — ${platformLabel}`);
  console.log(`  updated : ${updated}`);
  console.log(`  kept    : ${skipped} (modified or unknown provenance)`);
  console.log(`  runtime : ${runtimeKept} (board/leader state, never overwritten)`);
  if (conflicts.length) {
    console.log("  conflicts (use --force to overwrite):");
    for (const file of conflicts.slice(0, PATH_LIST_LIMIT)) console.log(`    - ${file}`);
    if (conflicts.length > PATH_LIST_LIMIT) {
      console.log(`    ... and ${conflicts.length - PATH_LIST_LIMIT} more`);
    }
  }
}