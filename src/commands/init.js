import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensureDir, writeTemplateMap, atomicWrite } from "../lib/fsutil.js";
import { buildScaffoldMap, PROTECTED_PATHS } from "../lib/scaffold.js";
import { HOOK_CONFIG_PATHS, mergeExistingHookConfigs } from "../lib/hooks-merge.js";
import { resolvePythonCommand } from "../lib/python.js";
import { recordHashes } from "../lib/hashes.js";
import {
  collectPlatformFiles,
  HOST_PLATFORMS,
  suggestConfiguredPlatforms,
  SUPPORTED_PLATFORMS,
} from "../lib/platforms.js";
import { selectPlatforms } from "../lib/platform-picker.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAFFOLD_DIR = path.join(PACKAGE_ROOT, "templates", "scaffold");
const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;

const DEFAULT_PLATFORMS = HOST_PLATFORMS.slice();
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

const PATH_LIST_LIMIT = 20;

/** Capped, one-per-line path entries (shared by stdout and stderr listings). */
function cappedPathLines(paths) {
  const lines = paths.slice(0, PATH_LIST_LIMIT).map((rel) => `    - ${rel}`);
  if (paths.length > PATH_LIST_LIMIT) {
    lines.push(`    ... and ${paths.length - PATH_LIST_LIMIT} more`);
  }
  return lines;
}

/** Print a capped, one-per-line list of repo-relative paths. */
function printPathList(label, paths) {
  if (!paths.length) return;
  console.log(`  ${label}: ${paths.length}`);
  for (const line of cappedPathLines(paths)) console.log(line);
}

/**
 * Compare a target against the bytes this run would write.
 * Returns "absent" | "same" | "different" | "non-regular". Anything that
 * exists but is not a regular file (directory, symlink, device) is reported
 * as "non-regular" so callers can refuse to write over it.
 */
function compareTarget(target, content) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return "absent";
  }
  if (!stat.isFile()) return "non-regular";
  try {
    return fs.readFileSync(target).equals(Buffer.from(content, "utf8")) ? "same" : "different";
  } catch {
    return "different";
  }
}

/** A terminal where the interactive picker can actually run. */
function isInteractiveTTY() {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      typeof process.stdin.setRawMode === "function" &&
      process.env.TERM !== "dumb",
  );
}

/**
 * Decide which platforms to install (priority: --platform, --yes, TTY picker,
 * fail fast). Returns { platforms, source } and never writes files.
 */
async function resolvePlatforms(flags, cwd) {
  if (flags.platform) {
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
    return { platforms: list, source: "--platform" };
  }

  if (flags.yes) {
    return { platforms: DEFAULT_PLATFORMS.slice(), source: "--yes" };
  }

  if (isInteractiveTTY()) {
    const selected = await selectPlatforms({
      checked: suggestConfiguredPlatforms(cwd),
    });
    return { platforms: [...selected], source: "interactive" };
  }

  throw new Error(
    "cannot choose platforms in a non-interactive terminal: pass --platform <list> " +
      "(e.g. --platform qoder,claude,codex) or --yes",
  );
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

  // Mutually exclusive escape hatches: refuse before platform resolution and
  // before any disk access, so nothing can be written.
  if (flags.force && flags["keep-existing"]) {
    console.error("  error: --force and --keep-existing are mutually exclusive — no files written.");
    process.exitCode = 1;
    return;
  }

  const python = resolvePythonCommand();
  const vars = { PYTHON_CMD: python };
  const mode = flags.force ? "force" : flags["keep-existing"] ? "keep-existing" : "default";
  let platforms;
  let selectionSource;
  try {
    ({ platforms, source: selectionSource } = await resolvePlatforms(flags, cwd));
  } catch (err) {
    if (err && err.cancelled) {
      console.error(`\n  ${err.message} — no files written.`);
      process.exitCode = err.exitCode || 1;
      return;
    }
    throw err;
  }
  const isFirst = !fs.existsSync(path.join(cwd, ".ateam"));

  const scaffold = scaffoldMap(vars);
  const scaffoldWritable = new Map();
  const scaffoldProtected = new Map();
  for (const [rel, content] of scaffold) {
    if (PROTECTED.has(rel)) scaffoldProtected.set(rel, content);
    else scaffoldWritable.set(rel, content);
  }

  const platformFiles = collectPlatformFiles(platforms, vars);

  const exists = (rel) => fs.existsSync(path.join(cwd, ...rel.split("/")));
  const extraOwned = [".ateam/.developer", ".ateam/.version"];

  // Preflight: compare every file this run would write or merge against disk.
  // Byte-identical files are not conflicts; runtime data (PROTECTED) and
  // .developer/.version are owned by other mechanisms and excluded.
  // Non-regular targets (directories, symlinks) are collected separately:
  // --force cannot atomically replace them, so it must abort before writing.
  const planned = new Map([...scaffoldWritable, ...scaffoldProtected, ...platformFiles]);
  const conflicts = [];
  const nonRegular = [];
  for (const [rel, content] of planned) {
    const status = compareTarget(path.join(cwd, ...rel.split("/")), content);
    if (status === "non-regular") nonRegular.push(rel);
    if (PROTECTED.has(rel)) continue;
    if (status === "different" || status === "non-regular") conflicts.push(rel);
  }

  // Default mode: fail fast with a zero-write exit when anything conflicts.
  if (mode === "default" && conflicts.length) {
    console.error(
      `ateam init stopped — ${conflicts.length} existing file(s) differ from the template:`,
    );
    for (const line of cappedPathLines(conflicts)) console.error(line);
    console.error("");
    console.error("No files were written.");
    console.error(
      "  --force           overwrite conflicting template files (host configs are still merge-only)",
    );
    console.error("  --keep-existing   keep conflicting files and install the rest");
    console.error("  or move the conflicting files out of the way and re-run `ateam init`.");
    process.exitCode = 1;
    return;
  }

  // --force cannot atomically replace a directory/symlink (rename fails with
  // EPERM on Windows). Abort before any write/merge/ensureDir so there is no
  // partial install and no .tmp debris.
  if (mode === "force" && nonRegular.length) {
    console.error(`ateam init stopped — ${nonRegular.length} path(s) are not regular files:`);
    for (const line of cappedPathLines(nonRegular)) console.error(line);
    console.error("");
    console.error("No files were written.");
    console.error(
      "  remove or move these paths out of the way and re-run `ateam init` (--force cannot overwrite them).",
    );
    process.exitCode = 1;
    return;
  }

  // --force: announce every existing file this run is about to overwrite,
  // before any write happens. Host hook configs are excluded: they are
  // merged below, never overwritten.
  if (mode === "force") {
    const overwritten = [
      ...[...scaffoldWritable.keys()].filter(exists),
      ...[...platformFiles.keys()].filter((rel) => !HOOK_CONFIG_PATHS.has(rel) && exists(rel)),
      ...extraOwned.filter(exists),
    ];
    printPathList("overwriting (existing)", [...new Set(overwritten)]);
  }

  let keptExisting = [];
  if (mode !== "force") {
    // Everything already on disk stays untouched in these modes: identical
    // template files are skipped, protected runtime data is never written,
    // and conflicting files were either kept by --keep-existing or would
    // have stopped the run above. Non-regular targets are never written in
    // any mode; --keep-existing keeps them as "existing" (--force aborted
    // above when any were present).
    for (const rel of new Set(nonRegular)) {
      scaffoldWritable.delete(rel);
      scaffoldProtected.delete(rel);
      platformFiles.delete(rel);
    }
    keptExisting = [
      ...new Set([...planned.keys()].filter(exists).concat(extraOwned.filter(exists), nonRegular)),
    ];

    // Existing host hook configs are never merged (or rewritten) outside
    // --force: default mode only gets here when they are byte-identical, and
    // --keep-existing must leave them exactly as the user has them.
    for (const rel of [...platformFiles.keys()]) {
      if (HOOK_CONFIG_PATHS.has(rel) && exists(rel)) platformFiles.delete(rel);
    }

    printPathList("kept (existing)", keptExisting);
  } else {
    // Existing host hook configs are merged and then removed from the write
    // map, including on merge failure, so a template write (even --force)
    // can never clobber user hooks/permissions/env.
    const merged = mergeExistingHookConfigs(cwd, platformFiles);
    for (const warning of merged.warnings) {
      console.warn(`  warn: ${warning}`);
    }
  }

  const writeMode = mode === "force" ? "force" : "skip";
  const scaffoldResult = writeTemplateMap(cwd, scaffoldWritable, writeMode);
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

  const platformResult = writeTemplateMap(cwd, platformFiles, writeMode);

  recordHashes(cwd, new Map([...scaffold, ...platformFiles]));

  // Remember the deliberate selection (host platforms only; `agents` is the
  // always-on generic core). An empty array means "no host platform on purpose".
  const selectedHosts = platforms.filter((p) => HOST_PLATFORMS.includes(p));
  atomicWrite(
    path.join(cwd, ".ateam", ".platforms.json"),
    `${JSON.stringify({ platforms: selectedHosts }, null, 2)}\n`,
  );

  const written = scaffoldResult.written.length + platformResult.written.length;
  const skipped =
    mode === "force"
      ? scaffoldResult.skipped.length + platformResult.skipped.length
      : keptExisting.length;
  const platformLabel = platforms.length ? platforms.join(", ") : "none";

  console.log(`\nateam ${isFirst ? "initialized" : "updated"} in ${cwd}`);
  console.log(`  python  : ${python}`);
  console.log(`  selection: ${selectionSource}`);
  console.log(`  platforms: ${platformLabel} (generic .agents/skills always)`);
  console.log(`  files   : ${written} written, ${skipped} kept (existing)`);
  console.log(`  developer: ${developer}`);

  if (selectedHosts.length === 0) {
    console.log("  note    : no host platform selected — only .agents/skills and .ateam are installed");
  }

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