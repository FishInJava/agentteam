#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePythonCommand, splitCommand } from "../src/lib/python.js";
import { readTemplateDir, walkFiles } from "../src/lib/fsutil.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "bin", "ateam.js");
const PY_CMD = resolvePythonCommand();
const PY = splitCommand(PY_CMD);

const tempDirs = [];
function mkTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ateam-smoke-"));
  tempDirs.push(dir);
  return dir;
}
const tmp = mkTemp();

function run(command, args, opts = {}) {
  return execFileSync(command, args, { cwd: tmp, encoding: "utf8", stdio: "pipe", ...opts });
}
/** Run the CLI in a specific directory; returns stdout (throws on failure). */
function runAteem(cwd, args) {
  return execFileSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}
/** Run the CLI in a specific directory; returns spawnSync result (status/stdout/stderr). */
function runAteemResult(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}
/** Every file under dir as sorted posix-relative paths (zero-write assertions). */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}
function py(args) {
  return run(PY[0], [...PY.slice(1), ...args]);
}
/** Run board.py via Python; returns spawnSync result (status/stdout/stderr). */
function pyResult(args) {
  return spawnSync(PY[0], [...PY.slice(1), ...args], {
    cwd: tmp,
    encoding: "utf8",
    stdio: "pipe",
  });
}
/** Run board.py in a specific directory; returns stdout (throws on failure). */
function pyIn(cwd, args) {
  return execFileSync(PY[0], [...PY.slice(1), ...args], { cwd, encoding: "utf8", stdio: "pipe" });
}
/** Run board.py in a specific directory; returns spawnSync result. */
function pyInResult(cwd, args) {
  return spawnSync(PY[0], [...PY.slice(1), ...args], { cwd, encoding: "utf8", stdio: "pipe" });
}
function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/");
}
/** Compare paths independent of separator style and (on Windows) drive/path case. */
function normalizePathCase(value) {
  const normalized = normalizeSlashes(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function readPlatforms(cwd) {
  const file = path.join(cwd, ".ateam", ".platforms.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).platforms;
}
function assertSamePlatforms(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected platforms ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

try {
  // Pre-existing host config: a plain init must stop before writing anything,
  // list the conflicts, and leave the host files byte-for-byte untouched.
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".codex"), { recursive: true });
  const claudeSettingsPath = path.join(tmp, ".claude/settings.json");
  const codexHooksPath = path.join(tmp, ".codex/hooks.json");
  fs.writeFileSync(
    claudeSettingsPath,
    `${JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "echo pre-existing-claude" }] },
        ],
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    codexHooksPath,
    `${JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo pre-existing-codex" }] }],
      },
    }, null, 2)}\n`,
  );
  const claudeInitialBytes = fs.readFileSync(claudeSettingsPath);
  const codexInitialBytes = fs.readFileSync(codexHooksPath);

  const stopResult = runAteemResult(tmp, ["init", "--user", "smoketest", "--yes"]);
  assert(stopResult.status === 1, `conflicting init exited ${stopResult.status}, expected 1`);
  const stopStderr = String(stopResult.stderr || "");
  assert(
    stopStderr.includes("ateam init stopped — 2 existing file(s) differ from the template:"),
    `init stop message missing or misspelled:\n${stopStderr}`,
  );
  assert(stopStderr.includes(".claude/settings.json"), "init stop list missing .claude/settings.json");
  assert(stopStderr.includes(".codex/hooks.json"), "init stop list missing .codex/hooks.json");
  assert(stopStderr.includes("No files were written."), "init stop message missing the zero-write line");
  assert(
    stopStderr.includes("--force") && stopStderr.includes("--keep-existing"),
    "init stop message does not offer --force / --keep-existing",
  );
  assert(!fs.existsSync(path.join(tmp, ".ateam")), "conflicting init wrote .ateam");
  assert(!fs.existsSync(path.join(tmp, ".qoder")), "conflicting init wrote .qoder");
  assert(!fs.existsSync(path.join(tmp, ".agents")), "conflicting init wrote .agents");
  assert(
    fs.readFileSync(claudeSettingsPath).equals(claudeInitialBytes),
    "conflicting init modified .claude/settings.json",
  );
  assert(
    fs.readFileSync(codexHooksPath).equals(codexInitialBytes),
    "conflicting init modified .codex/hooks.json",
  );

  // --force is the explicit escape hatch: install templates, merge host
  // configs (never replace them).
  runAteem(tmp, ["init", "--user", "smoketest", "--yes", "--force"]);

  const claudeSettings = fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8");
  assert(claudeSettings.includes("echo pre-existing-claude"), "merge dropped existing claude hook");
  assert(claudeSettings.includes("hook_session_start.py"), "merge missing ateam claude hook");
  const codexHooks = fs.readFileSync(path.join(tmp, ".codex/hooks.json"), "utf8");
  assert(codexHooks.includes("echo pre-existing-codex"), "merge dropped existing codex hook");
  assert(codexHooks.includes("hook_breadcrumb.py"), "merge missing ateam codex hook");

  for (const rel of [
    ".ateam/workflow.md",
    ".ateam/config.json",
    ".ateam/scripts/board.py",
    ".ateam/workspace/leader-state.json",
    ".agents/skills/ateam-start/SKILL.md",
    ".qoder/settings.json",
    ".claude/settings.json",
    ".codex/hooks.json",
  ]) {
    assert(fs.existsSync(path.join(tmp, rel)), `missing ${rel}`);
  }

  // --yes installs the three default hosts and records the deliberate selection.
  assertSamePlatforms(readPlatforms(tmp), ["qoder", "claude", "codex"], "init --yes");
  for (const dir of [".qoder", ".claude", ".codex"]) {
    assert(fs.existsSync(path.join(tmp, dir)), `init --yes missing ${dir}`);
  }

  // A1: Python bytecode never reaches templates, the installed scaffold, or
  // the npm package.
  assert(
    !fs.existsSync(path.join(tmp, ".ateam/scripts/__pycache__")),
    "init installed .ateam/scripts/__pycache__",
  );
  assert(
    !listFiles(path.join(tmp, ".ateam")).some((rel) => /\.(pyc|pyo)$/.test(rel)),
    "init installed Python bytecode into .ateam",
  );

  const bytecodeDir = mkTemp();
  fs.mkdirSync(path.join(bytecodeDir, "__pycache__"), { recursive: true });
  fs.writeFileSync(path.join(bytecodeDir, "__pycache__/x.pyc"), "bytecode");
  fs.writeFileSync(path.join(bytecodeDir, "stray.pyo"), "bytecode");
  fs.writeFileSync(path.join(bytecodeDir, "normal.txt"), "ok");
  const walkedRel = walkFiles(bytecodeDir)
    .map((full) => path.relative(bytecodeDir, full).split(path.sep).join("/"))
    .sort();
  assert(
    JSON.stringify(walkedRel) === JSON.stringify(["normal.txt"]),
    `walkFiles leaked Python bytecode: ${walkedRel.join(", ")}`,
  );
  const bytecodeTemplateMap = readTemplateDir(bytecodeDir);
  assert(
    JSON.stringify([...bytecodeTemplateMap.keys()]) === JSON.stringify(["normal.txt"]),
    `readTemplateDir leaked Python bytecode: ${[...bytecodeTemplateMap.keys()].join(", ")}`,
  );

  let packNote = null;
  try {
    const pack = spawnSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    });
    const parsed = pack.status === 0 && pack.stdout ? JSON.parse(pack.stdout) : null;
    const packFiles =
      Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].files) ? parsed[0].files : null;
    if (!packFiles) {
      packNote = String(pack.stderr || "").trim() || `unexpected npm pack output (exit ${pack.status})`;
    } else {
      const bytecode = packFiles
        .map((file) => file.path)
        .filter((rel) => /(^|\/)__pycache__(\/|$)/.test(rel) || /\.(pyc|pyo)$/.test(rel));
      assert(
        bytecode.length === 0,
        `npm pack would ship Python bytecode: ${bytecode.join(", ")}`,
      );
    }
  } catch (error) {
    packNote = error.message;
  }
  if (packNote) console.log(`smoke: note: npm pack bytecode check skipped (${packNote})`);

  // Durable Leader memory ships with the scaffold and is required by workflow.md.
  assert(
    fs.existsSync(path.join(tmp, ".ateam/memory/leader-dispatch-rules.md")),
    "init did not lay out .ateam/memory/leader-dispatch-rules.md",
  );
  const installedWorkflow = fs.readFileSync(path.join(tmp, ".ateam/workflow.md"), "utf8");
  assert(
    installedWorkflow.includes(".ateam/memory") || installedWorkflow.includes("长期记忆"),
    "installed workflow.md does not require reading .ateam/memory",
  );

  py([".ateam/scripts/board.py", "project", "init", "--title", "Smoke", "--origin", "spec", "--goal", "done"]);
  assert(py([".ateam/scripts/board.py", "summary"]).includes("Phase: recon"), "summary missing phase");

  const factId = py([
    ".ateam/scripts/board.py", "fact", "add",
    "--title", "t", "--description", "d", "--kind", "note",
  ]).trim();
  assert(/^f\d{3}$/.test(factId), "fact id not returned");

  // Skill routing (mission i001): intents carry skills; mission render emits them.
  fs.mkdirSync(path.join(tmp, "skills", "tdd"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "skills/tdd/SKILL.md"), "# TDD\n");
  const skillIntent = py([
    ".ateam/scripts/board.py", "intent", "add",
    "--from", factId,
    "--task-type", "chore",
    "--description", "x",
    "--skills", "skills/tdd/SKILL.md,host:code-review",
  ]).trim();
  const skillMission = py([".ateam/scripts/board.py", "mission", "render", skillIntent]);
  assert(skillMission.includes("## Skills (load before working)"), "mission missing skills section");
  const skillAbs = normalizePathCase(fs.realpathSync(path.join(tmp, "skills/tdd/SKILL.md")));
  assert(
    normalizePathCase(skillMission).includes(skillAbs),
    `mission missing resolved skill path ${skillAbs}`,
  );
  assert(skillMission.includes("host:code-review"), "mission missing host skill name");
  assert(
    skillMission.includes("Rules: load only the skills listed here"),
    "mission missing skills rules line",
  );

  // A missing skill file warns on stderr but never fails rendering.
  const missingSkillIntent = py([
    ".ateam/scripts/board.py", "intent", "add",
    "--task-type", "chore",
    "--description", "x",
    "--skills", "missing/SKILL.md",
  ]).trim();
  const missingRender = pyResult([
    ".ateam/scripts/board.py", "mission", "render", missingSkillIntent,
  ]);
  assert(missingRender.status === 0, `mission render with missing skill exited ${missingRender.status}`);
  assert(
    String(missingRender.stderr).includes("warn: skill not found"),
    "mission render did not warn about a missing skill",
  );
  assert(
    normalizeSlashes(missingRender.stdout).includes("missing/SKILL.md"),
    "mission render dropped the missing skill entry from stdout",
  );

  // Watchdog removal (mission i004): no watchdog script/command/role/config keys;
  // deadline self-check moved into the Leader OODA loop.
  assert(!fs.existsSync(path.join(tmp, ".ateam/scripts/watchdog.py")), "watchdog.py still laid out");
  assert(!fs.existsSync(path.join(PACKAGE_ROOT, "src/commands/watchdog.js")), "src/commands/watchdog.js still exists");
  assert(!fs.existsSync(path.join(PACKAGE_ROOT, "templates/scaffold/roles/watchdog.md")), "roles/watchdog.md still exists");
  assert(!fs.existsSync(path.join(PACKAGE_ROOT, "docs/watchdog-spec.md")), "docs/watchdog-spec.md still exists");
  const scaffoldConfig = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "templates/scaffold/config.json"), "utf8"));
  assert(!("liveness_threshold_seconds" in scaffoldConfig), "config still has liveness_threshold_seconds");
  assert(!("check_interval_seconds" in scaffoldConfig), "config still has check_interval_seconds");
  assert(!("restart_budget" in scaffoldConfig), "config still has restart_budget");
  const scaffoldGitignore = fs.readFileSync(path.join(PACKAGE_ROOT, "templates/scaffold/gitignore.txt"), "utf8");
  assert(!scaffoldGitignore.includes("heartbeat"), "gitignore.txt still ignores heartbeat");
  assert(!scaffoldGitignore.includes("watchdog-state"), "gitignore.txt still ignores watchdog-state.json");
  const summary = py([".ateam/scripts/board.py", "summary"]);
  assert(summary.includes("Phase: recon") && !/Heartbeat/i.test(summary), "summary still renders heartbeat line");
  const summaryJson = JSON.parse(py([".ateam/scripts/board.py", "summary", "--json"]));
  assert(!("heartbeat_age_seconds" in summaryJson), "summary --json still has heartbeat_age_seconds");
  const scaffoldWorkflow = fs.readFileSync(path.join(PACKAGE_ROOT, "templates/scaffold/workflow.md"), "utf8");
  assert(scaffoldWorkflow.includes("deadline_at"), "workflow.md missing deadline_at self-check");
  assert(scaffoldWorkflow.includes("死线自查"), "workflow.md missing deadline self-check step");

  run(process.execPath, [BIN, "update"]);

  const before = fs.readFileSync(path.join(tmp, ".ateam/workspace/leader-state.json"), "utf8");
  const forceOut = runAteem(tmp, ["init", "--force", "--yes"]);
  const after = fs.readFileSync(path.join(tmp, ".ateam/workspace/leader-state.json"), "utf8");
  assert(before === after, "init --force overwrote runtime leader-state");
  assert(
    forceOut.includes("overwriting (existing)"),
    "init --force did not announce the overwriting (existing) list",
  );

  // Host hook configs stay merge-only even under --force.
  const claudeAfterForce = fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8");
  assert(claudeAfterForce.includes("echo pre-existing-claude"), "init --force clobbered existing claude hook");
  const codexAfterForce = fs.readFileSync(path.join(tmp, ".codex/hooks.json"), "utf8");
  assert(codexAfterForce.includes("echo pre-existing-codex"), "init --force clobbered existing codex hook");

  // A plain re-init now stops: the merged host configs carry user hooks the
  // template does not have. --keep-existing keeps them exactly as-is.
  const claudeBeforeReinit = fs.readFileSync(path.join(tmp, ".claude/settings.json"));
  const codexBeforeReinit = fs.readFileSync(path.join(tmp, ".codex/hooks.json"));
  const reinitStop = runAteemResult(tmp, ["init", "--user", "smoketest", "--yes"]);
  assert(
    reinitStop.status === 1,
    `plain re-init with differing host configs exited ${reinitStop.status}, expected 1`,
  );
  const reinitStopStderr = String(reinitStop.stderr || "");
  assert(reinitStopStderr.includes("ateam init stopped"), "plain re-init did not report the conflict stop");
  assert(
    reinitStopStderr.includes(".claude/settings.json"),
    "plain re-init stop list missing .claude/settings.json",
  );

  const reinitOut = runAteem(tmp, ["init", "--user", "smoketest", "--yes", "--keep-existing"]);
  assert(
    reinitOut.includes("kept (existing)"),
    "repeated init did not report the kept (existing) list",
  );
  assert(
    fs.readFileSync(path.join(tmp, ".claude/settings.json")).equals(claudeBeforeReinit),
    "--keep-existing merged or rewrote .claude/settings.json",
  );
  assert(
    fs.readFileSync(path.join(tmp, ".codex/hooks.json")).equals(codexBeforeReinit),
    "--keep-existing merged or rewrote .codex/hooks.json",
  );

  // 1. Non-TTY with neither --platform nor --yes: fail fast, write nothing.
  const nonTtyDir = mkTemp();
  let refusal;
  try {
    runAteem(nonTtyDir, ["init", "--user", "smoketest"]);
  } catch (error) {
    refusal = error;
  }
  assert(refusal, "non-TTY init without --platform/--yes should fail");
  assert(refusal.status !== 0, `non-TTY init exited ${refusal.status}, expected non-zero`);
  const refusalStderr = String(refusal.stderr || "");
  assert(refusalStderr.includes("--platform"), "non-TTY init error does not mention --platform");
  assert(refusalStderr.includes("--yes"), "non-TTY init error does not mention --yes");
  assert(fs.readdirSync(nonTtyDir).length === 0, "non-TTY init wrote files despite failing");

  // 2. --platform agents: generic core only; persisted selection is deliberately empty.
  const agentsOnlyDir = mkTemp();
  runAteem(agentsOnlyDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  assert(fs.existsSync(path.join(agentsOnlyDir, ".ateam/workflow.md")), "agents-only init missing .ateam");
  assert(
    fs.existsSync(path.join(agentsOnlyDir, ".agents/skills/ateam-start/SKILL.md")),
    "agents-only init missing generic .agents/skills",
  );
  for (const dir of [".qoder", ".claude", ".codex"]) {
    assert(!fs.existsSync(path.join(agentsOnlyDir, dir)), `--platform agents created ${dir}`);
  }
  assertSamePlatforms(readPlatforms(agentsOnlyDir), [], "--platform agents");
  const agentsTopLevel = fs.readdirSync(agentsOnlyDir).sort();
  assert(
    JSON.stringify(agentsTopLevel) === JSON.stringify([".agents", ".ateam"]),
    `--platform agents created unexpected top-level entries: ${agentsTopLevel.join(", ")}`,
  );

  // 3. update honors the persisted selection; qoder stays qoder-only.
  const qoderOnlyDir = mkTemp();
  runAteem(qoderOnlyDir, ["init", "--platform", "qoder", "--user", "smoketest"]);
  assert(fs.existsSync(path.join(qoderOnlyDir, ".qoder/settings.json")), "qoder-only init missing .qoder");
  runAteem(qoderOnlyDir, ["update"]);
  for (const dir of [".claude", ".codex"]) {
    assert(
      !fs.existsSync(path.join(qoderOnlyDir, dir)),
      `update resurrected ${dir} for a qoder-only install`,
    );
  }
  assertSamePlatforms(readPlatforms(qoderOnlyDir), ["qoder"], "update after --platform qoder");

  // 4. Byte-identical existing files are not conflicts: re-running init on an
  // untouched install succeeds, reports kept (existing), and does not
  // rewrite/reformat the host config.
  const sameDir = mkTemp();
  runAteem(sameDir, ["init", "--platform", "claude", "--user", "smoketest"]);
  const sameClaudePath = path.join(sameDir, ".claude/settings.json");
  const sameClaudeBytes = fs.readFileSync(sameClaudePath);
  const sameWorkflowPath = path.join(sameDir, ".ateam/workflow.md");
  const sameWorkflowBytes = fs.readFileSync(sameWorkflowPath);
  const sameReinit = runAteemResult(sameDir, ["init", "--platform", "claude", "--user", "smoketest"]);
  assert(sameReinit.status === 0, `identical re-init exited ${sameReinit.status}, expected 0`);
  assert(
    String(sameReinit.stdout).includes("kept (existing)"),
    "identical re-init did not report the kept (existing) list",
  );
  assert(
    fs.readFileSync(sameClaudePath).equals(sameClaudeBytes),
    "identical host config was rewritten/reformatted",
  );
  assert(
    fs.readFileSync(sameWorkflowPath).equals(sameWorkflowBytes),
    "identical template file was rewritten",
  );

  // 5. --keep-existing keeps conflicting files (host configs included, without
  // merging) and installs only the missing ones.
  const keepDir = mkTemp();
  runAteem(keepDir, ["init", "--platform", "claude", "--user", "smoketest"]);
  const keepWorkflow = path.join(keepDir, ".ateam/workflow.md");
  const keepClaudePath = path.join(keepDir, ".claude/settings.json");
  const missingCommand = path.join(keepDir, ".claude/commands/ateam/start.md");
  fs.appendFileSync(keepWorkflow, "\n<!-- user edit -->\n");
  // 4-space JSON: a merge (or any rewrite) would reformat it to 2 spaces.
  fs.writeFileSync(keepClaudePath, `${JSON.stringify({ userMarker: true }, null, 4)}\n`);
  const keepWorkflowBytes = fs.readFileSync(keepWorkflow);
  const keepClaudeBytes = fs.readFileSync(keepClaudePath);
  fs.rmSync(missingCommand);

  const keepStop = runAteemResult(keepDir, ["init", "--platform", "claude", "--user", "smoketest"]);
  assert(keepStop.status === 1, `default init with user edits exited ${keepStop.status}, expected 1`);
  const keepStopStderr = String(keepStop.stderr || "");
  assert(keepStopStderr.includes(".ateam/workflow.md"), "stop list missing edited workflow.md");
  assert(keepStopStderr.includes(".claude/settings.json"), "stop list missing edited host config");
  assert(!fs.existsSync(missingCommand), "stopped init installed a missing file");
  assert(
    fs.readFileSync(keepWorkflow).equals(keepWorkflowBytes),
    "stopped init modified edited workflow.md",
  );
  assert(
    fs.readFileSync(keepClaudePath).equals(keepClaudeBytes),
    "stopped init modified edited host settings.json",
  );

  const keepOut = runAteem(keepDir, ["init", "--platform", "claude", "--user", "smoketest", "--keep-existing"]);
  assert(keepOut.includes("kept (existing)"), "--keep-existing did not report the kept (existing) list");
  assert(keepOut.includes(".ateam/workflow.md"), "--keep-existing kept list missing edited workflow.md");
  assert(
    fs.readFileSync(keepWorkflow).equals(keepWorkflowBytes),
    "--keep-existing overwrote workflow.md",
  );
  assert(
    fs.readFileSync(keepClaudePath).equals(keepClaudeBytes),
    "--keep-existing merged or rewrote host settings.json",
  );
  assert(fs.existsSync(missingCommand), "--keep-existing did not install the missing template file");

  // --force overwrites template conflicts, merges (never replaces) host
  // configs, and never touches runtime data.
  const keepState = path.join(keepDir, ".ateam/workspace/leader-state.json");
  fs.writeFileSync(keepState, "runtime-state\n");
  const claudeBeforeForce = fs.readFileSync(keepClaudePath);
  const forceKeep = runAteemResult(keepDir, ["init", "--platform", "claude", "--user", "smoketest", "--force"]);
  assert(forceKeep.status === 0, `init --force exited ${forceKeep.status}`);
  const forceKeepStdout = String(forceKeep.stdout);
  assert(forceKeepStdout.includes("overwriting (existing)"), "init --force did not announce overwrites");
  assert(forceKeepStdout.includes(".ateam/workflow.md"), "init --force overwrite list missing workflow.md");
  assert(
    fs.readFileSync(keepWorkflow).equals(fs.readFileSync(sameWorkflowPath)),
    "init --force did not restore workflow.md to the template",
  );
  assert(
    !fs.readFileSync(keepClaudePath).equals(claudeBeforeForce),
    "init --force did not merge the conflicting host config",
  );
  const mergedClaude = JSON.parse(fs.readFileSync(keepClaudePath, "utf8"));
  assert(mergedClaude.userMarker === true, "init --force clobbered user host settings");
  assert(
    fs.readFileSync(keepClaudePath, "utf8").includes("hook_session_start.py"),
    "init --force merge missing the ateam claude hook",
  );
  assert(fs.readFileSync(keepState, "utf8") === "runtime-state\n", "init --force overwrote runtime leader-state");

  // 6. --force and --keep-existing are mutually exclusive: error, exit 1, no writes.
  const mutexDir = mkTemp();
  const mutex = runAteemResult(mutexDir, ["init", "--platform", "agents", "--force", "--keep-existing"]);
  assert(mutex.status === 1, `mutually exclusive flags exited ${mutex.status}, expected 1`);
  const mutexStderr = String(mutex.stderr || "");
  assert(
    mutexStderr.includes("--force") && mutexStderr.includes("--keep-existing"),
    "mutex error does not name both flags",
  );
  assert(mutexStderr.includes("mutually exclusive"), "mutex error message missing");
  assert(fs.readdirSync(mutexDir).length === 0, "mutually exclusive flags wrote files");

  // The mutex check wins over platform resolution (no --platform/--yes here).
  const mutexNoPlatform = runAteemResult(mutexDir, ["init", "--force", "--keep-existing"]);
  assert(mutexNoPlatform.status === 1, `mutex without platform exited ${mutexNoPlatform.status}`);
  assert(
    String(mutexNoPlatform.stderr).includes("mutually exclusive"),
    "mutex check did not run before platform resolution",
  );

  // 8. Non-regular targets (here: a directory) are never written. --force
  // aborts before writing anything: no partial install, no .tmp debris.
  const nonRegularDir = mkTemp();
  const blockedTarget = path.join(nonRegularDir, ".ateam/workflow.md");
  fs.mkdirSync(blockedTarget, { recursive: true });
  fs.writeFileSync(path.join(blockedTarget, "inner.txt"), "user data\n");
  const blockedFileList = listFiles(nonRegularDir);

  const forceBlocked = runAteemResult(nonRegularDir, [
    "init", "--platform", "agents", "--force", "--user", "smoketest",
  ]);
  assert(forceBlocked.status !== 0, `init --force with a directory target exited ${forceBlocked.status}`);
  const forceBlockedStderr = String(forceBlocked.stderr || "");
  assert(
    forceBlockedStderr.includes("ateam init stopped — 1 path(s) are not regular files:"),
    `init --force non-regular stop message missing or misspelled:\n${forceBlockedStderr}`,
  );
  assert(
    forceBlockedStderr.includes(".ateam/workflow.md"),
    "init --force non-regular stop list missing the directory path",
  );
  assert(
    forceBlockedStderr.includes("No files were written."),
    "init --force non-regular stop missing the zero-write line",
  );
  assert(/move|remove/i.test(forceBlockedStderr), "init --force non-regular stop does not say to move/remove");
  assert(
    JSON.stringify(listFiles(nonRegularDir)) === JSON.stringify(blockedFileList),
    "init --force wrote files despite a non-regular target",
  );
  assert(
    !listFiles(nonRegularDir).some((rel) => rel.includes(".tmp")),
    "init --force left .tmp debris",
  );

  // Default mode keeps its existing conflict-stop behavior for the same target.
  const defaultBlocked = runAteemResult(nonRegularDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  assert(defaultBlocked.status !== 0, `default init with a directory target exited ${defaultBlocked.status}`);
  assert(
    String(defaultBlocked.stderr).includes("existing file(s) differ from the template:"),
    "default non-regular stop message changed",
  );
  assert(
    JSON.stringify(listFiles(nonRegularDir)) === JSON.stringify(blockedFileList),
    "default init wrote files despite a non-regular target",
  );

  // --keep-existing treats the directory as existing, writes the rest, and
  // never touches the directory contents.
  const keepNonRegular = runAteemResult(nonRegularDir, [
    "init", "--platform", "agents", "--user", "smoketest", "--keep-existing",
  ]);
  assert(keepNonRegular.status === 0, `--keep-existing with a directory target exited ${keepNonRegular.status}`);
  assert(
    fs.readdirSync(blockedTarget).join(",") === "inner.txt",
    "--keep-existing touched the directory target",
  );
  assert(
    fs.existsSync(path.join(nonRegularDir, ".ateam/config.json")),
    "--keep-existing did not install the remaining files",
  );
  assert(
    !listFiles(nonRegularDir).some((rel) => rel.includes(".tmp")),
    "--keep-existing left .tmp debris",
  );

  // 7. Invalid host JSON is warned about and left byte-for-byte untouched.
  const invalidJsonDir = mkTemp();
  const invalidJsonTarget = path.join(invalidJsonDir, ".claude/settings.json");
  fs.mkdirSync(path.dirname(invalidJsonTarget), { recursive: true });
  fs.writeFileSync(invalidJsonTarget, '{ "hooks": this is not json\n');
  const invalidBytes = fs.readFileSync(invalidJsonTarget);

  const badInit = runAteemResult(invalidJsonDir, ["init", "--yes", "--force", "--user", "smoketest"]);
  assert(badInit.status === 0, `init --yes --force against invalid host JSON exited ${badInit.status}`);
  assert(String(badInit.stderr).includes("warn"), "init did not warn about invalid host JSON");
  assert(
    fs.readFileSync(invalidJsonTarget).equals(invalidBytes),
    "init --force modified an invalid host settings.json",
  );

  const badUpdate = runAteemResult(invalidJsonDir, ["update", "--force"]);
  assert(badUpdate.status === 0, `update --force against invalid host JSON exited ${badUpdate.status}`);
  assert(String(badUpdate.stderr).includes("warn"), "update did not warn about invalid host JSON");
  assert(
    fs.readFileSync(invalidJsonTarget).equals(invalidBytes),
    "update --force modified an invalid host settings.json",
  );

  // A2: update fails closed when the hash ledger is missing (fresh clone /
  // another machine). An edit must survive a plain update and be listed as a
  // conflict; --force is the explicit way to restore the template.
  const hashlessDir = mkTemp();
  runAteem(hashlessDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  const hashlessWorkflowPath = path.join(hashlessDir, ".ateam/workflow.md");
  const templateWorkflowBytes = fs.readFileSync(hashlessWorkflowPath);
  fs.appendFileSync(hashlessWorkflowPath, "\n<!-- user edit -->\n");
  const editedWorkflowBytes = fs.readFileSync(hashlessWorkflowPath);
  const versionPath = path.join(hashlessDir, ".ateam/.version");
  fs.writeFileSync(versionPath, "0.0.0-stale\n");
  fs.rmSync(path.join(hashlessDir, ".ateam/.template-hashes.json"));

  const hashlessUpdate = runAteemResult(hashlessDir, ["update"]);
  assert(hashlessUpdate.status === 0, `update without hashes exited ${hashlessUpdate.status}`);
  const hashlessStdout = String(hashlessUpdate.stdout);
  assert(
    hashlessStdout.includes("conflicts (use --force to overwrite):"),
    "update without hashes did not print the conflict header",
  );
  assert(
    hashlessStdout.includes(".ateam/workflow.md"),
    "update without hashes did not list the unknown-provenance conflict",
  );
  assert(
    fs.readFileSync(hashlessWorkflowPath).equals(editedWorkflowBytes),
    "update overwrote a user edit when the hash ledger was missing",
  );
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  ).version;
  assert(
    fs.readFileSync(versionPath, "utf8").trim() === packageVersion,
    `update did not refresh .ateam/.version (got ${fs.readFileSync(versionPath, "utf8").trim()})`,
  );

  const forcedUpdate = runAteem(hashlessDir, ["update", "--force"]);
  assert(forcedUpdate.includes("updated"), "update --force did not report updates");
  assert(
    fs.readFileSync(hashlessWorkflowPath).equals(templateWorkflowBytes),
    "update --force did not restore the template",
  );
  assert(
    fs.existsSync(path.join(hashlessDir, ".ateam/.template-hashes.json")),
    "update did not rewrite .template-hashes.json",
  );

  // A5: project init --force archives the previous board graph and resets
  // counters so a new requirement starts at f001/i001/a001.
  const archiveDir = mkTemp();
  runAteem(archiveDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  const boardPy = ".ateam/scripts/board.py";
  pyIn(archiveDir, [boardPy, "project", "init", "--title", "Old requirement", "--origin", "old", "--goal", "old"]);
  const oldFact = pyIn(archiveDir, [
    boardPy, "fact", "add", "--title", "old fact", "--description", "d", "--kind", "note",
  ]).trim();
  const oldIntent = pyIn(archiveDir, [
    boardPy, "intent", "add", "--from", oldFact, "--task-type", "chore", "--description", "old intent",
  ]).trim();
  const oldAcceptance = pyIn(archiveDir, [
    boardPy, "acceptance", "add", "--criterion", "old criterion",
  ]).trim();
  pyIn(archiveDir, [
    boardPy, "consumption", "add", "--intent", oldIntent, "--worker", "w0", "--tokens-in", "10",
  ]);

  const noForceReinit = pyInResult(archiveDir, [boardPy, "project", "init", "--title", "Nope"]);
  assert(
    noForceReinit.status === 1 && String(noForceReinit.stderr).includes("use --force"),
    "project init without --force did not keep the existing-project error",
  );

  const archiveInitOut = pyIn(archiveDir, [
    boardPy, "project", "init", "--title", "New requirement",
    "--origin", "new", "--goal", "new", "--force",
  ]);
  assert(
    archiveInitOut.includes("archived previous board ->"),
    "project init --force did not report the archive",
  );

  const archiveRoot = path.join(archiveDir, ".ateam/workspace/archive");
  const archiveStamps = fs.readdirSync(archiveRoot);
  assert(archiveStamps.length === 1, `expected one archive dir, got ${archiveStamps.join(", ")}`);
  const archiveRun = path.join(archiveRoot, archiveStamps[0]);
  for (const [kind, id] of [
    ["facts", oldFact],
    ["intents", oldIntent],
    ["acceptance", oldAcceptance],
  ]) {
    assert(
      fs.existsSync(path.join(archiveRun, kind, `${id}.json`)),
      `archive missing ${kind}/${id}.json`,
    );
  }
  assert(fs.existsSync(path.join(archiveRun, "consumption.json")), "archive missing consumption.json");

  const countersAfter = JSON.parse(
    fs.readFileSync(path.join(archiveDir, ".ateam/board/counters.json"), "utf8"),
  );
  assert(
    JSON.stringify(countersAfter) === JSON.stringify({ fact: 0, intent: 0, acceptance: 0, hint: 0 }),
    `counters not reset after project init --force: ${JSON.stringify(countersAfter)}`,
  );
  const recreatedFacts = fs.readdirSync(path.join(archiveDir, ".ateam/board/facts"));
  assert(
    JSON.stringify(recreatedFacts) === JSON.stringify([".gitkeep"]),
    `facts dir was not recreated empty with .gitkeep: ${recreatedFacts.join(", ")}`,
  );
  const archiveSummary = pyIn(archiveDir, [boardPy, "summary"]);
  assert(
    archiveSummary.includes("Board: facts 0 | intents 0"),
    `summary not reset after project init --force:\n${archiveSummary}`,
  );
  const nextFactAfterArchive = pyIn(archiveDir, [
    boardPy, "fact", "add", "--title", "new fact", "--description", "d", "--kind", "note",
  ]).trim();
  assert(
    nextFactAfterArchive === "f001",
    `next fact id after archive was ${nextFactAfterArchive}, expected f001`,
  );

  // ==========================================================================
  // Batch 2 (mission i004): eliminate silent failures.
  // ==========================================================================

  // A7: splitCommand handles multi-word Python commands ("py -3").
  assert(
    JSON.stringify(splitCommand("py -3")) === JSON.stringify(["py", "-3"]),
    `splitCommand('py -3') -> ${JSON.stringify(splitCommand("py -3"))}`,
  );
  assert(
    JSON.stringify(splitCommand("  python   -X  ")) === JSON.stringify(["python", "-X"]),
    "splitCommand did not collapse surrounding/repeated whitespace",
  );

  // A7: context runs the resolved command and prints the board summary / JSON.
  const contextOut = runAteem(tmp, ["context"]);
  assert(contextOut.includes("Smoke"), "context output missing the project title");
  assert(contextOut.includes("Phase: recon"), "context output missing the board summary");
  const parsedContext = JSON.parse(runAteem(tmp, ["context", "--json"]));
  assert(
    parsedContext.project && parsedContext.project.title === "Smoke",
    "context --json did not return the project",
  );

  // A16: raw templates carry the placeholder; installed files carry the command.
  const rawMarkdown = walkFiles(path.join(PACKAGE_ROOT, "templates"))
    .filter((full) => full.endsWith(".md"))
    .map((full) => ({ full, text: fs.readFileSync(full, "utf8") }));
  const rawPythonLeaks = rawMarkdown.filter(({ text }) => text.includes("python .ateam/scripts"));
  assert(
    rawPythonLeaks.length === 0,
    `raw templates still contain "python .ateam/scripts": ${rawPythonLeaks
      .map(({ full }) => path.relative(PACKAGE_ROOT, full).split(path.sep).join("/"))
      .join(", ")}`,
  );
  const installedWorkflowText = fs.readFileSync(path.join(tmp, ".ateam/workflow.md"), "utf8");
  assert(!installedWorkflowText.includes("{{PYTHON_CMD}}"), "installed workflow.md kept {{PYTHON_CMD}}");
  assert(
    installedWorkflowText.includes(`${PY_CMD} .ateam/scripts/board.py`),
    "installed workflow.md missing the resolved Python command",
  );
  const installedStartSkill = fs.readFileSync(path.join(tmp, ".agents/skills/ateam-start/SKILL.md"), "utf8");
  assert(!installedStartSkill.includes("{{PYTHON_CMD}}"), "installed skill kept {{PYTHON_CMD}}");
  assert(
    installedStartSkill.includes(`${PY_CMD} .ateam/scripts/get_context.py`),
    "installed skill missing the resolved Python command",
  );

  // A3: update refuses directories/symlinks before any write, --force included.
  const updateBlockedDir = mkTemp();
  runAteem(updateBlockedDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  const updateBlockedTarget = path.join(updateBlockedDir, ".ateam/workflow.md");
  fs.rmSync(updateBlockedTarget);
  fs.mkdirSync(updateBlockedTarget);
  fs.writeFileSync(path.join(updateBlockedTarget, "inner.txt"), "user data\n");
  const updateBlockedFiles = listFiles(updateBlockedDir);
  const updateVersionBefore = fs.readFileSync(path.join(updateBlockedDir, ".ateam/.version"), "utf8");

  for (const args of [["update"], ["update", "--force"]]) {
    const blocked = runAteemResult(updateBlockedDir, args);
    assert(blocked.status !== 0, `${args.join(" ")} with a directory target exited ${blocked.status}`);
    const blockedErr = String(blocked.stderr || "");
    assert(
      blockedErr.includes("ateam update stopped — 1 path(s) are not regular files:"),
      `${args.join(" ")} stop message missing or misspelled:\n${blockedErr}`,
    );
    assert(blockedErr.includes(".ateam/workflow.md"), `${args.join(" ")} stop list missing the path`);
    assert(blockedErr.includes("No files were written."), `${args.join(" ")} missing the zero-write line`);
    assert(/move|remove/i.test(blockedErr), `${args.join(" ")} does not say to move/remove`);
    assert(
      JSON.stringify(listFiles(updateBlockedDir)) === JSON.stringify(updateBlockedFiles),
      `${args.join(" ")} wrote files despite a non-regular target`,
    );
    assert(
      fs.readFileSync(path.join(updateBlockedDir, ".ateam/.version"), "utf8") === updateVersionBefore,
      `${args.join(" ")} rewrote .version despite aborting`,
    );
    assert(
      !listFiles(updateBlockedDir).some((rel) => rel.includes(".tmp")),
      `${args.join(" ")} left .tmp debris`,
    );
  }

  // Symlink target (the preflight must abort without following the link).
  try {
    const symlinkDir = mkTemp();
    runAteem(symlinkDir, ["init", "--platform", "agents", "--user", "smoketest"]);
    const symlinkConfig = path.join(symlinkDir, ".ateam/config.json");
    const outsideConfig = path.join(symlinkDir, "outside-config.json");
    fs.writeFileSync(outsideConfig, '{ "user": true }\n');
    fs.rmSync(symlinkConfig);
    fs.symlinkSync(outsideConfig, symlinkConfig, "file");
    const outsideBytes = fs.readFileSync(outsideConfig);
    const symlinkUpdate = runAteemResult(symlinkDir, ["update", "--force"]);
    assert(symlinkUpdate.status !== 0, `update --force over a symlink exited ${symlinkUpdate.status}`);
    assert(
      String(symlinkUpdate.stderr).includes("not regular files"),
      "update --force over a symlink did not report the non-regular stop",
    );
    assert(
      fs.readFileSync(outsideConfig).equals(outsideBytes),
      "update followed and wrote through a symlink",
    );
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN", "ENOSYS"].includes(error.code)) {
      console.log(`smoke: note: symlink preflight check skipped (${error.code})`);
    } else {
      throw error;
    }
  }

  // A8: handover placeholder detection ignores bare "TODO" in real handovers.
  const handoverDir = mkTemp();
  runAteem(handoverDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  const hookRun = (dir) =>
    spawnSync(PY[0], [...PY.slice(1), ".ateam/scripts/hook_session_start.py"], {
      cwd: dir,
      input: "{}",
      encoding: "utf8",
      stdio: "pipe",
    });
  const placeholderHook = hookRun(handoverDir);
  assert(placeholderHook.status === 0, `session-start hook exited ${placeholderHook.status}`);
  const placeholderContext = JSON.parse(placeholderHook.stdout).hookSpecificOutput.additionalContext;
  assert(
    !placeholderContext.includes("## Handover (previous Leader)"),
    "placeholder handover template was injected",
  );
  fs.writeFileSync(
    path.join(handoverDir, ".ateam/workspace/handover.md"),
    "# Handover\n\nDone: shipped the batch.\n\nTODO: fix X in the next session.\n\nNext: continue.\n",
  );
  const realHook = hookRun(handoverDir);
  assert(realHook.status === 0, `session-start hook with real handover exited ${realHook.status}`);
  const realContext = JSON.parse(realHook.stdout).hookSpecificOutput.additionalContext;
  assert(realContext.includes("## Handover (previous Leader)"), "real handover was not injected");
  assert(realContext.includes("TODO: fix X"), "real handover containing TODO was dropped");

  // A9: unsupported array-shaped hooks are warned about and left untouched.
  const hooksArrayDir = mkTemp();
  runAteem(hooksArrayDir, ["init", "--platform", "claude", "--user", "smoketest"]);
  const arrayClaudePath = path.join(hooksArrayDir, ".claude/settings.json");
  fs.writeFileSync(
    arrayClaudePath,
    `${JSON.stringify({
      hooks: [{ matcher: "x", hooks: [{ type: "command", command: "echo user-array" }] }],
      userMarker: true,
    }, null, 2)}\n`,
  );
  const arrayBytes = fs.readFileSync(arrayClaudePath);
  const arrayUpdate = runAteemResult(hooksArrayDir, ["update"]);
  assert(arrayUpdate.status === 0, `update with array hooks exited ${arrayUpdate.status}`);
  assert(
    String(arrayUpdate.stderr).includes(
      "warn: unsupported hooks shape (array) in .claude/settings.json; left untouched",
    ),
    `array-shape warning missing:\n${arrayUpdate.stderr}`,
  );
  assert(fs.readFileSync(arrayClaudePath).equals(arrayBytes), "array-shaped hooks file was modified");

  // A9: same command with a different matcher is a distinct entry; env merges.
  const mergeDir = mkTemp();
  runAteem(mergeDir, ["init", "--platform", "claude", "--user", "smoketest"]);
  const mergeClaudePath = path.join(mergeDir, ".claude/settings.json");
  const sessionCommand = `${PY_CMD} .ateam/scripts/hook_session_start.py`;
  fs.writeFileSync(
    mergeClaudePath,
    `${JSON.stringify({
      env: { USER_KEY: "keep-me" },
      hooks: {
        SessionStart: [
          { matcher: "custom", hooks: [{ type: "command", command: sessionCommand }] },
        ],
      },
    }, null, 2)}\n`,
  );
  const mergeUpdate = runAteemResult(mergeDir, ["update"]);
  assert(mergeUpdate.status === 0, `matcher/env update exited ${mergeUpdate.status}`);
  const mergedSettings = JSON.parse(fs.readFileSync(mergeClaudePath, "utf8"));
  const matchers = mergedSettings.hooks.SessionStart.map((entry) => entry.matcher).sort();
  assert(
    JSON.stringify(matchers) === JSON.stringify(["clear", "compact", "custom", "startup"]),
    `same command with a different matcher was dropped or duplicated: ${JSON.stringify(matchers)}`,
  );
  assert(
    mergedSettings.hooks.SessionStart.filter((entry) =>
      (entry.hooks || []).some((hook) => hook.command === sessionCommand),
    ).length === 4,
    "session-start entries with the same command were not all kept",
  );
  assert(mergedSettings.env.USER_KEY === "keep-me", "merge dropped an existing env key");
  assert(
    mergedSettings.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR === "1",
    "merge did not add a missing incoming env key",
  );

  // Existing env values win over incoming ones.
  const existingEnvSettings = JSON.parse(fs.readFileSync(mergeClaudePath, "utf8"));
  existingEnvSettings.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = "mine";
  fs.writeFileSync(mergeClaudePath, `${JSON.stringify(existingEnvSettings, null, 2)}\n`);
  runAteem(mergeDir, ["update"]);
  assert(
    JSON.parse(fs.readFileSync(mergeClaudePath, "utf8")).env
      .CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR === "mine",
    "merge overwrote an existing env value",
  );

  // A9: a no-op merge leaves a 4-space file byte-for-byte untouched.
  const noopDir = mkTemp();
  runAteem(noopDir, ["init", "--platform", "claude", "--user", "smoketest"]);
  const noopClaudePath = path.join(noopDir, ".claude/settings.json");
  const noopParsed = JSON.parse(fs.readFileSync(noopClaudePath, "utf8"));
  fs.writeFileSync(noopClaudePath, `${JSON.stringify(noopParsed, null, 4)}\n`);
  const noopBytes = fs.readFileSync(noopClaudePath);
  const noopUpdate = runAteemResult(noopDir, ["update"]);
  assert(noopUpdate.status === 0, `no-op update exited ${noopUpdate.status}`);
  assert(
    fs.readFileSync(noopClaudePath).equals(noopBytes),
    "no-op merge reformatted/re-wrote .claude/settings.json",
  );

  // A12: unknown/misspelled flags abort before the command runs.
  const flagDir = mkTemp();
  const typoInit = runAteemResult(flagDir, [
    "init", "--platform", "agents", "--user", "smoketest", "--keep-existng",
  ]);
  assert(typoInit.status === 1, `misspelled init flag exited ${typoInit.status}, expected 1`);
  assert(
    String(typoInit.stderr).includes("unknown option --keep-existng"),
    `misspelled init flag error missing:\n${typoInit.stderr}`,
  );
  assert(fs.readdirSync(flagDir).length === 0, "misspelled init flag wrote files");
  for (const args of [["update", "--forc"], ["context", "--jsn"]]) {
    const unknown = runAteemResult(flagDir, args);
    assert(unknown.status === 1, `${args.join(" ")} exited ${unknown.status}, expected 1`);
    assert(
      String(unknown.stderr).includes(`unknown option --${args[1].slice(2)}`),
      `${args.join(" ")} did not report the unknown option`,
    );
  }
  const spelledInit = runAteemResult(flagDir, [
    "init", "--platform", "agents", "--user", "smoketest", "--keep-existing",
  ]);
  assert(spelledInit.status === 0, `correctly spelled --keep-existing exited ${spelledInit.status}`);
  assert(fs.existsSync(path.join(flagDir, ".ateam/workflow.md")), "correctly spelled init wrote nothing");

  // A6: corrupt JSON warns on stderr but still returns the default.
  const corruptDir = mkTemp();
  runAteem(corruptDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  const corruptProject = path.join(corruptDir, ".ateam/board/project.json");
  fs.writeFileSync(corruptProject, "{ this is not json\n");
  const corruptSummary = pyInResult(corruptDir, [boardPy, "summary"]);
  assert(corruptSummary.status === 0, `summary with corrupt project.json exited ${corruptSummary.status}`);
  assert(
    String(corruptSummary.stderr).includes("warn: cannot parse"),
    `corrupt project.json did not warn:\n${corruptSummary.stderr}`,
  );
  assert(
    String(corruptSummary.stdout).includes("no project yet"),
    "corrupt project.json did not fall back to the default",
  );
  fs.writeFileSync(corruptProject, `${JSON.stringify({ id: "p1", title: "Healthy", phase: "recon" })}\n`);
  const healthySummary = pyInResult(corruptDir, [boardPy, "summary"]);
  assert(healthySummary.status === 0, `healthy summary exited ${healthySummary.status}`);
  assert(
    !String(healthySummary.stderr).includes("warn"),
    `healthy summary emitted a warning: ${healthySummary.stderr}`,
  );

  // A5: entity listing sorts by numeric id suffix, grouped per prefix.
  const sortDir = mkTemp();
  runAteem(sortDir, ["init", "--platform", "agents", "--user", "smoketest"]);
  pyIn(sortDir, [boardPy, "project", "init", "--title", "Sorting", "--origin", "x", "--goal", "y"]);
  for (const id of ["f1000", "f2", "f999", "f10"]) {
    fs.writeFileSync(
      path.join(sortDir, `.ateam/board/facts/${id}.json`),
      `${JSON.stringify({ id, title: id, description: "d", kind: "note" })}\n`,
    );
  }
  const sortedFacts = JSON.parse(pyIn(sortDir, [boardPy, "fact", "list", "--json"]));
  const sortedIds = sortedFacts.map((fact) => fact.id);
  assert(
    JSON.stringify(sortedIds) === JSON.stringify(["f2", "f10", "f999", "f1000"]),
    `facts not sorted numerically: ${JSON.stringify(sortedIds)}`,
  );

  // A5: a same-second archive collision gets -1, never nested directories.
  const archiveCollisionScript = [
    "import datetime as dt",
    "import sys",
    'sys.path.insert(0, ".ateam/scripts")',
    "import board",
    "class FixedDT(dt.datetime):",
    "    @classmethod",
    "    def now(cls, tz=None):",
    "        return dt.datetime(2024, 1, 1, 0, 0, 0)",
    "board.datetime = FixedDT",
    "ateam = board.common.ateam_dir_from_script()",
    "board._archive_previous_board(ateam)",
    "board._archive_previous_board(ateam)",
  ].join("\n");
  const collisionRun = pyInResult(sortDir, ["-c", archiveCollisionScript]);
  assert(collisionRun.status === 0, `archive collision script failed:\n${collisionRun.stderr}`);
  const collisionRoot = path.join(sortDir, ".ateam/workspace/archive");
  const firstCollision = path.join(collisionRoot, "20240101-000000");
  const secondCollision = path.join(collisionRoot, "20240101-000000-1");
  assert(fs.existsSync(firstCollision), "first archive stamp missing");
  assert(fs.existsSync(secondCollision), "same-second archive was not suffixed with -1");
  assert(fs.existsSync(path.join(firstCollision, "facts")), "first archive missing facts");
  assert(fs.existsSync(path.join(secondCollision, "facts")), "second archive missing facts");
  assert(
    !fs.existsSync(path.join(firstCollision, "facts", "facts")),
    "same-second archive nested the entity directory",
  );
  for (const name of ["facts", "intents", "acceptance", "hints"]) {
    const recreated = fs.readdirSync(path.join(sortDir, `.ateam/board/${name}`));
    assert(
      JSON.stringify(recreated) === JSON.stringify([".gitkeep"]),
      `board/${name} was not recreated with .gitkeep after archiving: ${recreated.join(", ")}`,
    );
  }

  console.log("smoke: PASS");
} finally {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
}