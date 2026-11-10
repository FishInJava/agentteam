import fs from "node:fs";
import path from "node:path";

import { atomicWrite } from "./fsutil.js";

/** Hook-wiring files that must be merged into existing host config, never clobbered. */
export const HOOK_CONFIG_PATHS = new Set([
  ".claude/settings.json",
  ".qoder/settings.json",
  ".codex/hooks.json",
]);

class UnsupportedHooksShapeError extends Error {
  constructor(shape) {
    super(`unsupported hooks shape (${shape})`);
    this.name = "UnsupportedHooksShapeError";
    this.code = "UNSUPPORTED_HOOKS_SHAPE";
    this.shape = shape;
  }
}

function commandSet(entry) {
  const hooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
  return [...new Set(hooks.map((hook) => hook && hook.command).filter(Boolean))].sort();
}

/** Entries are equal only when the matcher AND the distinct command sets match. */
function sameEntry(a, b) {
  const aMatcher = a && typeof a.matcher === "string" ? a.matcher : "";
  const bMatcher = b && typeof b.matcher === "string" ? b.matcher : "";
  return aMatcher === bMatcher && JSON.stringify(commandSet(a)) === JSON.stringify(commandSet(b));
}

/**
 * Merge our env into the existing one: existing values win, and incoming keys
 * the user does not have yet are added. Returns true when anything was added.
 */
function mergeEnv(existing, incoming) {
  const incomingEnv =
    incoming && typeof incoming.env === "object" && !Array.isArray(incoming.env)
      ? incoming.env
      : null;
  if (!incomingEnv) return false;

  const existingEnv = existing.env;
  if (existingEnv === undefined || existingEnv === null) {
    if (Object.keys(incomingEnv).length === 0) return false;
    existing.env = { ...incomingEnv };
    return true;
  }
  if (typeof existingEnv !== "object" || Array.isArray(existingEnv)) return false;

  let changed = false;
  for (const [key, value] of Object.entries(incomingEnv)) {
    if (!Object.prototype.hasOwnProperty.call(existingEnv, key)) {
      existingEnv[key] = value;
      changed = true;
    }
  }
  return changed;
}

/**
 * Merge incoming hook settings into existing settings JSON without duplication.
 * Returns { text, changed } where `changed` is false when nothing would be
 * added, so callers can leave a no-op file byte-for-byte untouched.
 * Throws UnsupportedHooksShapeError when `hooks` is not an object.
 */
export function mergeHookSettings(existingText, incomingText) {
  const existing = JSON.parse(existingText);
  const incoming = JSON.parse(incomingText);

  if (existing.hooks !== undefined && existing.hooks !== null) {
    if (Array.isArray(existing.hooks)) throw new UnsupportedHooksShapeError("array");
    if (typeof existing.hooks !== "object") {
      throw new UnsupportedHooksShapeError(typeof existing.hooks);
    }
  }

  let changed = false;
  if (!existing.hooks || typeof existing.hooks !== "object") existing.hooks = {};

  const incomingHooks =
    incoming.hooks && typeof incoming.hooks === "object" && !Array.isArray(incoming.hooks)
      ? incoming.hooks
      : {};
  for (const [event, entries] of Object.entries(incomingHooks)) {
    if (!Array.isArray(entries)) continue;
    const current = Array.isArray(existing.hooks[event]) ? existing.hooks[event] : [];
    const before = current.length;
    for (const entry of entries) {
      if (!current.some((existingEntry) => sameEntry(existingEntry, entry))) current.push(entry);
    }
    existing.hooks[event] = current;
    if (current.length !== before) changed = true;
  }

  if (mergeEnv(existing, incoming)) changed = true;

  return { text: `${JSON.stringify(existing, null, 2)}\n`, changed };
}

/**
 * Merge our hooks into hook-config files that already exist on disk.
 * Mutates `files` in place: every hook-config path that exists on disk is
 * removed from the map, whether the merge succeeded or failed, so no caller
 * (including `--force`) can ever overwrite user-owned host configuration.
 * A merge that adds nothing leaves the file untouched (no reformat-on-update).
 * Returns { handled, preserved, warnings, changed }.
 */
export function mergeExistingHookConfigs(cwd, files) {
  const handled = [];
  const preserved = [];
  const warnings = [];
  let changedAny = false;
  for (const rel of [...files.keys()]) {
    if (!HOOK_CONFIG_PATHS.has(rel)) continue;
    const target = path.join(cwd, ...rel.split("/"));
    if (!fs.existsSync(target)) continue;
    preserved.push(rel);
    try {
      const merged = mergeHookSettings(fs.readFileSync(target, "utf8"), files.get(rel));
      if (merged.changed) {
        atomicWrite(target, merged.text);
        handled.push(rel);
        changedAny = true;
      }
    } catch (error) {
      // Leave the file byte-for-byte untouched and still drop it from the
      // write map: a merge failure must never downgrade to a clobber.
      if (error && error.code === "UNSUPPORTED_HOOKS_SHAPE") {
        warnings.push(`unsupported hooks shape (${error.shape}) in ${rel}; left untouched`);
      } else {
        const message = error && error.message ? error.message : String(error);
        warnings.push(`could not merge existing hooks (${rel}: ${message}); file left untouched`);
      }
    } finally {
      files.delete(rel);
    }
  }
  return { handled, preserved, warnings, changed: changedAny };
}
