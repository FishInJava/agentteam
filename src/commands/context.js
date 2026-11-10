import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolvePythonCommand } from "../lib/python.js";

export function context(flags = {}) {
  const cwd = process.cwd();
  const script = path.join(cwd, ".ateam", "scripts", "get_context.py");
  if (!fs.existsSync(script)) {
    throw new Error("not initialized: run `ateam init` first");
  }
  const args = [script];
  if (flags.json) args.push("--json");
  const result = spawnSync(resolvePythonCommand(), args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}