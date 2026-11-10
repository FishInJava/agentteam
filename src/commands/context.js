import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolvePythonCommand, splitCommand } from "../lib/python.js";

export function context(flags = {}) {
  const cwd = process.cwd();
  const script = path.join(cwd, ".ateam", "scripts", "get_context.py");
  if (!fs.existsSync(script)) {
    throw new Error("not initialized: run `ateam init` first");
  }
  const args = [script];
  if (flags.json) args.push("--json");

  const parts = splitCommand(resolvePythonCommand());
  if (!parts.length) {
    console.error("ateam context: could not resolve a Python command to run");
    process.exit(1);
  }

  const result = spawnSync(parts[0], [...parts.slice(1), ...args], { cwd, stdio: "inherit" });
  if (result.error) {
    console.error(`ateam context: failed to run ${parts[0]}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status === null) {
    const signal = result.signal ? ` (signal ${result.signal})` : "";
    console.error(`ateam context: ${parts[0]} did not exit normally${signal}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status);
}
