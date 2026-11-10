import { execSync } from "node:child_process";

/**
 * Resolve a Python >= 3.9 command. Windows tries `python`, `python3`, `py -3`
 * (Microsoft Store ships python3; the py launcher needs -3); other hosts try
 * `python3` then `python`.
 */
export function resolvePythonCommand() {
  const candidates =
    process.platform === "win32" ? ["python", "python3", "py -3"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "pipe" });
      return cmd;
    } catch {
      // try next candidate
    }
  }
  return "python3";
}

/** Split a command string into argv parts: "py -3" -> ["py", "-3"]. */
export function splitCommand(cmd) {
  return String(cmd || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}