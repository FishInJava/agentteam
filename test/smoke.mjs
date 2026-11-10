#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePythonCommand } from "../src/lib/python.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "bin", "ateam.js");
const PY = resolvePythonCommand().split(" ");

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

  console.log("smoke: PASS");
} finally {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
}