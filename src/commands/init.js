import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensureDir, writeTemplateMap, atomicWrite } from "../lib/fsutil.js";
import { buildScaffoldMap, PROTECTED_PATHS } from "../lib/scaffold.js";
import { mergeExistingHookConfigs } from "../lib/hooks-merge.js";
import { resolvePythonCommand } from "../lib/python.js";
import { recordHashes } from "../lib/hashes.js";
import { collectPlatformFiles, SUPPORTED_PLATFORMS } from "../lib/platforms.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAFFOLD_DIR = path.join(PACKAGE_ROOT, "templates", "scaffold");
const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;

const DEFAULT_PLATFORMS = ["qoder", "claude", "codex"];
const RUNTIME_DIRS = [
  "board/facts",
  "board/intents",
  "board/acceptance",
  "board/hints",
  "workspace",
  "missions",
  "roles",
];
// Runtime-owned files: seeded on first init, never overwritten (even by --force).
const PROTECTED = PROTECTED_PATHS;

function resolvePlatforms(flags) {
  if (!flags.platform) return DEFAULT_PLATFORMS.slice();
  const list = String(flags.platform)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const invalid = list.filter((p) => !SUPPORTED_PLATFORMS.includes(p));
  if (invalid.length) {
    throw new Error(
      `unsupported platform(s): ${invalid.join(", ")}. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
    );
  }
  return list;
}

function resolveDeveloper(cwd, flags) {
  if (flags.user) return String(flags.user);
  try {
    const name = execSync("git config user.name", { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    if (name) return name;
  } catch {
    // not a git repo or no user.name — fall through
  }
  return "unknown";
}

function scaffoldMap(vars) {
  return buildScaffoldMap(SCAFFOLD_DIR, vars);
}

export async function init(flags = {}) {
  const cwd = process.cwd();
  const python = resolvePythonCommand();
  const vars = { PYTHON_CMD: python };
  const mode = flags.force ? "force" : "skip";
  const platforms = resolvePlatforms(flags);
  const isFirst = !fs.existsSync(path.join(cwd, ".ateam"));

  const scaffold = scaffoldMap(vars);
  const scaffoldWritable = new Map();
  const scaffoldProtected = new Map();
  for (const [rel, content] of scaffold) {
    if (PROTECTED.has(rel)) scaffoldProtected.set(rel, content);
    else scaffoldWritable.set(rel, content);
  }
  const scaffoldResult = writeTemplateMap(cwd, scaffoldWritable, mode);
  const protectedResult = writeTemplateMap(cwd, scaffoldProtected, "skip");
  scaffoldResult.written.push(...protectedResult.written);
  scaffoldResult.skipped.push(...protectedResult.skipped);

  for (const dir of RUNTIME_DIRS) {
    ensureDir(path.join(cwd, ".ateam", ...dir.split("/")));
  }

  const developer = resolveDeveloper(cwd, flags);
  const developerFile = path.join(cwd, ".ateam", ".developer");
  if (!fs.existsSync(developerFile) || mode === "force") {
    atomicWrite(developerFile, `${developer}\n`);
  }

  const versionFile = path.join(cwd, ".ateam", ".version");
  if (!fs.existsSync(versionFile) || mode === "force") {
    atomicWrite(versionFile, `${VERSION}\n`);
  }

  const platformFiles = collectPlatformFiles(platforms, vars);
  if (mode !== "force") {
    const merged = mergeExistingHookConfigs(cwd, platformFiles);
    for (const warning of merged.warnings) {
      console.warn(`  warn: could not merge existing hooks (${warning})`);
    }
  }
  const platformResult = writeTemplateMap(cwd, platformFiles, mode);

  recordHashes(cwd, new Map([...scaffold, ...platformFiles]));

  const written = scaffoldResult.written.length + platformResult.written.length;
  const skipped = scaffoldResult.skipped.length + platformResult.skipped.length;

  console.log(`\nateam ${isFirst ? "initialized" : "updated"} in ${cwd}`);
  console.log(`  python  : ${python}`);
  console.log(`  platforms: ${platforms.join(", ")} (generic .agents/skills always)`);
  console.log(`  files   : ${written} written, ${skipped} kept (existing)`);
  console.log(`  developer: ${developer}`);

  if (platforms.includes("codex")) {
    console.log(
      "\n  note: Codex hooks need `features.hooks = true` in ~/.codex/config.toml (Codex >= 0.129).",
    );
  }

  console.log(`
Next:
  1. Create your first requirement project (Leader's board):
     ${python} .ateam/scripts/board.py project init \\
       --title "<requirement>" --origin "<spec summary>" --goal "<done definition>"
  2. Print the board summary (also auto-injected at host SessionStart):
     ${python} .ateam/scripts/get_context.py
  3. Deadline self-check each Leader loop: read project.budget.deadline_at; if reached,
     stop dispatching new work and enter endgame (see .ateam/workflow.md).
`);
}