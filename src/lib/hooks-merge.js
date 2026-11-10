import fs from "node:fs";
import path from "node:path";

import { atomicWrite } from "./fsutil.js";

/** Hook-wiring files that must be merged into existing host config, never clobbered. */
export const HOOK_CONFIG_PATHS = new Set([
  ".claude/settings.json",
  ".qoder/settings.json",
  ".codex/hooks.json",
]);

function commandsOf(entry) {
  const hooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
  return hooks.map((hook) => hook && hook.command).filter(Boolean);
}

function hasEntry(existing, incoming) {
  const incomingCommands = commandsOf(incoming);
  if (incomingCommands.length === 0) return false;
  return existing.some((entry) => {
    const existingCommands = commandsOf(entry);
    return incomingCommands.every((command) => existingCommands.includes(command));
  });
}

/** Merge incoming hook entries into existing settings JSON without duplication. */
export function mergeHookSettings(existingText, incomingText) {
  const existing = JSON.parse(existingText);
  const incoming = JSON.parse(incomingText);
  existing.hooks = existing.hooks && typeof existing.hooks === "object" ? existing.hooks : {};

  for (const [event, entries] of Object.entries(incoming.hooks || {})) {
    if (!Array.isArray(entries)) continue;
    const current = Array.isArray(existing.hooks[event]) ? existing.hooks[event] : [];
    for (const entry of entries) {
      if (!hasEntry(current, entry)) current.push(entry);
    }
    existing.hooks[event] = current;
  }
  if (incoming.env && !existing.env) existing.env = incoming.env;

  return `${JSON.stringify(existing, null, 2)}\n`;
}

/**
 * Merge our hooks into hook-config files that already exist on disk.
 * Mutates `files` in place: every hook-config path that exists on disk is
 * removed from the map, whether the merge succeeded or failed, so no caller
 * (including `--force`) can ever overwrite user-owned host configuration.
 * Returns { handled, preserved, warnings }.
 */
export function mergeExistingHookConfigs(cwd, files) {
  const handled = [];
  const preserved = [];
  const warnings = [];
  for (const rel of [...files.keys()]) {
    if (!HOOK_CONFIG_PATHS.has(rel)) continue;
    const target = path.join(cwd, ...rel.split("/"));
    if (!fs.existsSync(target)) continue;
    preserved.push(rel);
    try {
      const merged = mergeHookSettings(fs.readFileSync(target, "utf8"), files.get(rel));
      atomicWrite(target, merged);
      handled.push(rel);
    } catch (error) {
      // Leave the file byte-for-byte untouched and still drop it from the
      // write map: a merge failure must never downgrade to a clobber.
      warnings.push(`${rel}: ${error && error.message ? error.message : error}`);
    } finally {
      files.delete(rel);
    }
  }
  return { handled, preserved, warnings };
}