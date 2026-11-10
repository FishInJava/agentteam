import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "../lib/fsutil.js";
import { buildScaffoldMap, PROTECTED_PATHS } from "../lib/scaffold.js";
import { mergeExistingHookConfigs } from "../lib/hooks-merge.js";
import { resolvePythonCommand } from "../lib/python.js";
import { loadHashes, saveHashes, sha256 } from "../lib/hashes.js";
import { collectPlatformFiles } from "../lib/platforms.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function detectPlatforms(cwd) {
  const hashes = loadHashes(cwd);
  const keys = Object.keys(hashes);
  const platforms = [];

  const hasQoder =
    keys.some((k) => k.startsWith(".qoder/")) ||
    fs.existsSync(path.join(cwd, ".qoder/commands/ateam-start.md"));
  const hasClaude =
    keys.some((k) => k.startsWith(".claude/")) ||
    fs.existsSync(path.join(cwd, ".claude/commands/ateam/start.md")) ||
    fs.existsSync(path.join(cwd, ".claude/skills/ateam-start/SKILL.md"));
  const hasCodex =
    keys.some((k) => k.startsWith(".codex/")) ||
    fs.existsSync(path.join(cwd, ".codex/hooks.json"));

  if (hasQoder) platforms.push("qoder");
  if (hasClaude) platforms.push("claude");
  if (hasCodex) platforms.push("codex");
  return platforms.length ? platforms : ["qoder", "claude", "codex"];
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
    console.warn(`  warn: could not merge existing hooks (${warning})`);
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

    const userModified = knownHash !== undefined && currentHash !== knownHash;
    if (userModified && !flags.force) {
      conflicts.push(rel);
      skipped += 1;
      continue;
    }

    atomicWrite(target, content);
    hashes[rel] = newHash;
    updated += 1;
  }

  saveHashes(cwd, hashes);

  console.log(`\nateam update — ${platforms.join(", ")}`);
  console.log(`  updated : ${updated}`);
  console.log(`  kept    : ${skipped} (locally modified)`);
  console.log(`  runtime : ${runtimeKept} (board/leader state, never overwritten)`);
  if (conflicts.length) {
    console.log("  conflicts (use --force to overwrite):");
    for (const file of conflicts) console.log(`    - ${file}`);
  }
}