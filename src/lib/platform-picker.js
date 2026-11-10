import { emitKeypressEvents } from "node:readline";

import { HOST_PLATFORMS } from "./platforms.js";

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K";
const cursorUp = (n) => `\x1b[${n}A`;
const CURSOR_DOWN = "\x1b[1B";

function cancelError(exitCode) {
  const err = new Error(exitCode === 130 ? "cancelled by ctrl+c" : "cancelled");
  err.cancelled = true;
  err.exitCode = exitCode;
  return err;
}

/**
 * Interactive multi-select for host platforms.
 *
 * Reads keys from `input`, renders to `output`, and never touches the
 * filesystem (the caller decides what to write after a successful selection).
 * Streams are injectable so tests can drive it with PassThrough pipes.
 *
 * Resolves with a Set of selected platform names on Enter.
 * Rejects with { cancelled: true, exitCode } on Esc (1) or Ctrl+C (130).
 *
 * @param {object} [options]
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {Iterable<string>} [options.checked] platforms pre-checked as configured
 * @returns {Promise<Set<string>>}
 */
export function selectPlatforms({
  input = process.stdin,
  output = process.stdout,
  checked = [],
} = {}) {
  return new Promise((resolve, reject) => {
    const configured = new Set(checked);
    const items = HOST_PLATFORMS.map((name) => ({ name, checked: configured.has(name) }));
    let cursor = 0;
    let drawnLines = 0;
    let done = false;

    const canSetRaw = typeof input.setRawMode === "function";
    const previousRaw = canSetRaw ? Boolean(input.isRaw) : false;
    if (canSetRaw) {
      try {
        input.setRawMode(true);
      } catch {
        // Injected/non-TTY streams may not support raw mode.
      }
    }
    if (typeof input.resume === "function") input.resume();
    emitKeypressEvents(input);

    const menuLines = () => {
      const lines = [
        "Select host platforms — up/down or j/k move, space toggle, enter confirm, esc cancel:",
      ];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const pointer = i === cursor ? ">" : " ";
        const box = item.checked ? "[x]" : "[ ]";
        const suffix = configured.has(item.name) ? " (configured)" : "";
        lines.push(`${pointer} ${box} ${item.name}${suffix}`);
      }
      lines.push("   [always included] .agents/skills (generic core)");
      lines.push("   note: unchecking a configured platform keeps its files on disk");
      return lines;
    };

    const render = () => {
      const lines = menuLines();
      let buf = "";
      if (drawnLines === 0) {
        buf += HIDE_CURSOR;
        buf += `${lines.join("\n")}\n`;
      } else {
        // Cursor sits one line below the block; go back to its first line.
        buf += cursorUp(drawnLines);
        for (let i = 0; i < lines.length; i++) {
          buf += `${CLEAR_LINE}${lines[i]}\n`;
        }
      }
      drawnLines = lines.length;
      output.write(buf);
    };

    const cleanup = () => {
      if (drawnLines > 0) {
        let buf = cursorUp(drawnLines);
        for (let i = 0; i < drawnLines; i++) {
          buf += CLEAR_LINE;
          if (i < drawnLines - 1) buf += CURSOR_DOWN;
        }
        output.write(buf);
      }
      output.write(SHOW_CURSOR);
      if (canSetRaw) {
        try {
          input.setRawMode(previousRaw);
        } catch {
          // ignore
        }
      }
      input.removeListener("keypress", onKeypress);
      input.removeListener("end", onEnd);
      if (typeof input.pause === "function") input.pause();
    };

    const finish = (settle) => {
      if (done) return;
      done = true;
      cleanup();
      settle();
    };

    const onEnd = () => finish(() => reject(cancelError(1)));

    const onKeypress = (str, key) => {
      if (done || !key) return;
      const name = key.name;
      if (key.ctrl && name === "c") {
        finish(() => reject(cancelError(130)));
        return;
      }
      if (name === "escape") {
        finish(() => reject(cancelError(1)));
        return;
      }
      if (name === "return" || name === "enter") {
        const selected = new Set(items.filter((item) => item.checked).map((item) => item.name));
        finish(() => resolve(selected));
        return;
      }
      if (name === "up" || (!key.ctrl && !key.meta && name === "k")) {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
        return;
      }
      if (name === "down" || (!key.ctrl && !key.meta && name === "j")) {
        cursor = (cursor + 1) % items.length;
        render();
        return;
      }
      if (name === "space") {
        items[cursor].checked = !items[cursor].checked;
        render();
      }
    };

    input.on("keypress", onKeypress);
    input.once("end", onEnd);
    render();
  });
}