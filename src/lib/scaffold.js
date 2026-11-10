import { readTemplateDir, renderMap } from "./fsutil.js";

/** Runtime-owned paths: seeded once, never overwritten by init --force or update. */
export const PROTECTED_PATHS = new Set([
  ".ateam/board/counters.json",
  ".ateam/workspace/leader-state.json",
  ".ateam/workspace/handover.md",
]);

/**
 * Read templates/scaffold into Map<.ateam-relative path, content>.
 * `gitignore.txt` is renamed to `.gitignore` so both init and update agree.
 */
export function buildScaffoldMap(scaffoldDir, vars) {
  const map = renderMap(readTemplateDir(scaffoldDir), vars);
  const prefixed = new Map();
  for (const [rel, content] of map) {
    const target = rel === "gitignore.txt" ? ".gitignore" : rel;
    prefixed.set(`.ateam/${target}`, content);
  }
  return prefixed;
}