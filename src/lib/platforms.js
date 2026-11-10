import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTemplateDir, render } from "./fsutil.js";

const TEMPLATES_ROOT = fileURLToPath(new URL("../../templates/", import.meta.url));

export const SUPPORTED_PLATFORMS = ["qoder", "claude", "codex", "agents"];

function readTemplateFile(...parts) {
  return fs.readFileSync(path.join(TEMPLATES_ROOT, ...parts), "utf8");
}

/** Read templates/common/<kind>/*.md into [{ name, content }]. */
function readCommon(kind) {
  const dir = path.join(TEMPLATES_ROOT, "common", kind);
  const out = [];
  for (const [rel, content] of readTemplateDir(dir)) {
    if (!rel.endsWith(".md")) continue;
    out.push({ name: rel.slice(0, -3), content });
  }
  return out;
}

function withCommandName(content, name) {
  if (!content.startsWith("---\n")) {
    return `---\nname: ${name}\n---\n\n${content}`;
  }
  return content.replace(/^---\n/, `---\nname: ${name}\n`);
}

function skillFiles(prefix, vars) {
  const map = new Map();
  for (const { name, content } of readCommon("skills")) {
    map.set(`${prefix}/${name}/SKILL.md`, render(content, vars));
  }
  return map;
}

function commandFiles(prefix, vars, options = {}) {
  const map = new Map();
  for (const { name, content } of readCommon("commands")) {
    const targetName = options.rename ? options.rename(name) : name;
    let body = render(content, vars);
    if (options.injectName) body = withCommandName(body, targetName);
    map.set(`${prefix}/${targetName}.md`, body);
  }
  return map;
}

/**
 * Build the full Map<relative path, content> for the selected platforms.
 * The generic `.agents/skills/` core is always written (Codex and any
 * `.agents/skills`-reading host consume it without extra configuration).
 */
export function collectPlatformFiles(platforms, vars) {
  const out = new Map();

  for (const [k, v] of skillFiles(".agents/skills", vars)) out.set(k, v);

  if (platforms.includes("qoder")) {
    out.set(".qoder/settings.json", render(readTemplateFile("qoder", "settings.json"), vars));
    for (const [k, v] of commandFiles(".qoder/commands", vars, {
      rename: (name) => `ateam-${name}`,
      injectName: true,
    })) {
      out.set(k, v);
    }
    for (const [k, v] of skillFiles(".qoder/skills", vars)) out.set(k, v);
  }

  if (platforms.includes("claude")) {
    out.set(".claude/settings.json", render(readTemplateFile("claude", "settings.json"), vars));
    for (const [k, v] of commandFiles(".claude/commands/ateam", vars)) out.set(k, v);
    for (const [k, v] of skillFiles(".claude/skills", vars)) out.set(k, v);
  }

  if (platforms.includes("codex")) {
    out.set(".codex/hooks.json", render(readTemplateFile("codex", "hooks.json"), vars));
  }

  return out;
}