import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { atomicWrite } from "./fsutil.js";

const HASH_PARTS = [".ateam", ".template-hashes.json"];

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadHashes(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, ...HASH_PARTS), "utf8"));
  } catch {
    return {};
  }
}

export function saveHashes(cwd, hashes) {
  atomicWrite(path.join(cwd, ...HASH_PARTS), `${JSON.stringify(hashes, null, 2)}\n`);
}

/** Record the template hash for every path in a Map<relPath, content>. */
export function recordHashes(cwd, map) {
  const hashes = loadHashes(cwd);
  for (const [rel, content] of map) hashes[rel] = sha256(content);
  saveHashes(cwd, hashes);
}