#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePythonCommand } from "../src/lib/python.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "bin", "ateam.js");
const PY = resolvePythonCommand().split(" ");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ateam-smoke-"));

function run(command, args, opts = {}) {
  return execFileSync(command, args, { cwd: tmp, encoding: "utf8", stdio: "pipe", ...opts });
}
function py(args) {
  return run(PY[0], [...PY.slice(1), ...args]);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
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

  run(process.execPath, [BIN, "init", "--user", "smoketest", "--yes"]);

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
  run(process.execPath, [BIN, "init", "--force", "--yes"]);
  const after = fs.readFileSync(path.join(tmp, ".ateam/workspace/leader-state.json"), "utf8");
  assert(before === after, "init --force overwrote runtime leader-state");

  const claudeBeforeReinit = fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8");
  run(process.execPath, [BIN, "init", "--user", "smoketest", "--yes"]);
  const claudeAfterReinit = fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8");
  assert(
    JSON.stringify(JSON.parse(claudeBeforeReinit)) === JSON.stringify(JSON.parse(claudeAfterReinit)),
    "re-init duplicated merged hooks",
  );

  console.log("smoke: PASS");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}