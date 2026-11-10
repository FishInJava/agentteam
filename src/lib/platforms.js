import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTemplateDir, render } from "./fsutil.js";
import { loadHashes } from "./hashes.js";

const TEMPLATES_ROOT = fileURLToPath(new URL("../../templates/", import.meta.url));

export const SUPPORTED_PLATFORMS = ["qoder", "claude", "codex", "agents"];

/** Platforms that install host-specific integration (the `agents` pseudo-host has none). */
export const HOST_PLATFORMS = ["qoder", "claude", "codex"];

/** Marker file whose presence means a host is already configured. */
export const PLATFORM_MARKERS = {
  qoder: ".qoder/settings.json",
  claude: ".claude/settings.json",
  codex: ".codex/hooks.json",
};

/**
 * Additional paths written by older versions that did not have
 * PLATFORM_MARKERS. Kept so pre-S1 installs are still detected identically.
 */
const LEGACY_PLATFORM_MARKERS = {
  qoder: [".qoder/commands/ateam-start.md"],
  claude: [".claude/commands/ateam/start.md", ".claude/skills/ateam-start/SKILL.md"],
  codex: [],
};

/** Where `init` records the deliberate host selection (a `{"platforms":[]}` file). */
export const PLATFORM_SELECTION_PATH = ".ateam/.platforms.json";

/**
 * The single source of truth for "which hosts are already installed here".
 * Evidence, in order: recorded template hashes, current marker files, legacy
 * marker files. Returns platform names in the canonical host order.
 */
export function detectConfiguredPlatforms(cwd, hashes = loadHashes(cwd)) {
  const keys = hashes && typeof hashes === "object" ? Object.keys(hashes) : [];
  return HOST_PLATFORMS.filter((name) => {
    if (keys.some((key) => key.startsWith(`${name}/`))) return true;
    const markers = [PLATFORM_MARKERS[name], ...LEGACY_PLATFORM_MARKERS[name]];
    return markers.some((rel) => fs.existsSync(path.join(cwd, ...rel.split("/"))));
  });
}

/**
 * Read the selection persisted by `init`.
 * - { status: "missing", platforms: null }  — pre-S1 install, infer instead
 * - { status: "ok", platforms: [...] }      — authoritative (may be empty!)
 * - { status: "corrupt", platforms: null, reason } — caller decides the fallback
 * Unknown platform names in the array are filtered out (forward compatibility).
 */
export function readPlatformSelection(cwd) {
  const file = path.join(cwd, ...PLATFORM_SELECTION_PATH.split("/"));
  if (!fs.existsSync(file)) return { status: "missing", platforms: null };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { status: "corrupt", platforms: null, reason: err.message };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.platforms)) {
    return {
      status: "corrupt",
      platforms: null,
      reason: 'expected {"platforms":["qoder"|"claude"|"codex", ...]}',
    };
  }

  const platforms = [...new Set(parsed.platforms.filter((p) => HOST_PLATFORMS.includes(p)))];
  return { status: "ok", platforms };
}

/**
 * Picker pre-check: the persisted selection unioned with what is actually on
 * disk. Persisted-but-empty memberships stay unchecked unless a marker exists.
 */
export function suggestConfiguredPlatforms(cwd) {
  const selection = readPlatformSelection(cwd);
  const persisted = selection.status === "ok" ? new Set(selection.platforms) : new Set();
  const detected = new Set(detectConfiguredPlatforms(cwd));
  return HOST_PLATFORMS.filter((name) => persisted.has(name) || detected.has(name));
}

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