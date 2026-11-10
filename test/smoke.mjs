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
  // Pre-existing host config: init must merge our hooks, not clobber or skip.
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".claude/settings.json"),
    `${JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "echo pre-existing-claude" }] },
        ],
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(tmp, ".codex/hooks.json"),
    `${JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo pre-existing-codex" }] }],
      },
    }, null, 2)}\n`,
  );

  const firstInitOut = runAteem(tmp, ["init", "--user", "smoketest", "--yes"]);
  assert(
    firstInitOut.includes("kept (existing)"),
    "init did not report the kept (existing) list for pre-existing files",
  );

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

  const claudeBeforeReinit = fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8");
  const reinitOut = runAteem(tmp, ["init", "--user", "smoketest", "--yes"]);
  assert(
    reinitOut.includes("kept (existing)"),
    "repeated init did not report the kept (existing) list",
  );
  const claudeAfterReinit = fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8");
  assert(
    JSON.stringify(JSON.parse(claudeBeforeReinit)) === JSON.stringify(JSON.parse(claudeAfterReinit)),
    "re-init duplicated merged hooks",
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

  // 6. Invalid host JSON is warned about and left byte-for-byte untouched.
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