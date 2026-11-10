import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export function toPosix(p) {
  return p.split(path.sep).join("/");
}

/** Python bytecode must never enter templates or be installed by init/update. */
function isPythonBytecode(entry) {
  if (entry.isDirectory()) return entry.name === "__pycache__";
  return entry.name.endsWith(".pyc") || entry.name.endsWith(".pyo");
}

export function walkFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isPythonBytecode(entry)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir);
  return out;
}

/** Read a template directory into Map<posix relative path, content>. */
export function readTemplateDir(rootDir) {
  const map = new Map();
  for (const full of walkFiles(rootDir)) {
    const rel = toPosix(path.relative(rootDir, full));
    map.set(rel, fs.readFileSync(full, "utf8"));
  }
  return map;
}

export function render(text, vars) {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export function renderMap(map, vars) {
  const out = new Map();
  for (const [key, value] of map) out.set(key, render(value, vars));
  return out;
}

/**
 * Write a Map<relative path, content> under cwd.
 * - skip: never overwrite an existing file (default, preserves user edits)
 * - force: overwrite everything
 * Returns { written, skipped }.
 */
export function writeTemplateMap(cwd, map, mode = "skip") {
  const written = [];
  const skipped = [];
  for (const [rel, content] of map) {
    const target = path.join(cwd, ...rel.split("/"));
    if (fs.existsSync(target) && mode !== "force") {
      skipped.push(rel);
      continue;
    }
    atomicWrite(target, content);
    written.push(rel);
  }
  return { written, skipped };
}