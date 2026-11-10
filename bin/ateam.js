#!/usr/bin/env node
import { main } from "../src/cli/index.js";

main(process.argv.slice(2)).catch((err) => {
  console.error(`ateam: ${err && err.message ? err.message : err}`);
  process.exit(1);
});