import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { init } from "../commands/init.js";
import { update } from "../commands/update.js";
import { context } from "../commands/context.js";

const pkg = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
);

const HELP = `ateam ${pkg.version} — installable multi-agent development scaffold

Usage:
  ateam init [--platform <list>] [--user <name>] [--force | --keep-existing] [--yes]
  ateam update [--force]
  ateam context [--json]
  ateam version
  ateam help

Init options:
  --platform <list>  Comma list of host platforms to configure.
                     Supported: qoder, claude, codex, agents
                     Default: qoder,claude,codex (agents core is always written)
  --user <name>      Developer identity (default: git config user.name)
  --force            Overwrite existing template files that differ from the template.
                     Host hook configs are still merged, never replaced; runtime board
                     data is kept.
  --keep-existing    Keep existing files that differ from the template and install only
                     the missing ones. Existing host configs are not merged.
  --yes, -y          Non-interactive: install the default platforms (qoder,claude,codex).
                     Without --platform or --yes, init prompts on an interactive terminal;
                     a non-interactive terminal fails with an actionable error and
                     writes no files.

Safety:
  By default, init stops before writing anything when an existing target file differs
  from the template, lists the conflicts, and exits non-zero. --force and
  --keep-existing are mutually exclusive.

What it writes:
  .ateam/            board (fact-intent graph) + doctrine + Python state scripts
  .agents/skills/    generic skills (always)
  .qoder/, .claude/, .codex/   per-platform integration for selected hosts
`;

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(HELP);
    return;
  }
  if (cmd === "version" || cmd === "-v" || cmd === "--version") {
    console.log(pkg.version);
    return;
  }
  if (cmd === "init") return init(parseFlags(rest));
  if (cmd === "update") return update(parseFlags(rest));
  if (cmd === "context") return context(parseFlags(rest));
  throw new Error(`unknown command "${cmd}". Run: ateam help`);
}

export function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      if (body.includes("=")) {
        const idx = body.indexOf("=");
        flags[body.slice(0, idx)] = body.slice(idx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[body] = args[++i];
      } else {
        flags[body] = true;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const short = { p: "platform", u: "user", y: "yes", f: "force", n: "json" };
      const key = short[arg.slice(1)] || arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}