#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SessionStart hook: inject the ateam board summary into the host session.

Output contract: {"hookSpecificOutput": {"hookEventName": "SessionStart",
"additionalContext": "<text>"}}. Used by Qoder and Claude Code; Codex uses the
same JSON envelope where SessionStart is supported.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common

PROJECT_ENV_VARS = ("QODER_PROJECT_DIR", "CLAUDE_PROJECT_DIR", "CODEX_PROJECT_DIR", "ATEAM_PROJECT_DIR")

# Placeholder handovers (fresh scaffold stubs) carry no real handoff content.
# "TODO" is the generic placeholder marker; "（待写）" is what the scaffold's
# workspace/handover.md template seeds every section with.
HANDOVER_PLACEHOLDER_MARKERS = ("TODO", "（待写）")


def _read_handover(ateam: Path) -> str:
    """Read the previous Leader's handover; return "" when absent or placeholder."""
    try:
        content = common.handover_path(ateam).read_text(encoding="utf-8")
    except (FileNotFoundError, OSError, UnicodeDecodeError, ValueError):
        return ""
    if len(content.strip()) <= 20 or any(marker in content for marker in HANDOVER_PLACEHOLDER_MARKERS):
        return ""
    return content.rstrip()


def _project_root(payload: dict) -> Path:
    for var in PROJECT_ENV_VARS:
        value = os.environ.get(var)
        if value:
            return Path(value).resolve()
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    return Path(cwd or ".").resolve()


def main() -> int:
    common.configure_encoding()
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            payload = {}
    except (json.JSONDecodeError, ValueError):
        payload = {}

    ateam = _project_root(payload) / ".ateam"
    if not ateam.is_dir():
        return 0

    summary = common.board_summary(ateam)
    text = common.render_summary_text(summary)
    context = (
        "<ateam-session-context>\n"
        "Canonical guide: .ateam/workflow.md. Board CLI: .ateam/scripts/board.py (Leader-only).\n"
        "You are the Leader: read the board, decide, dispatch workers. Never write code or run tests yourself.\n\n"
        + text
    )
    handover = _read_handover(ateam)
    if handover:
        context += f"\n\n## Handover (previous Leader)\n\n{handover}"
    context += "\n</ateam-session-context>"
    result = {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": context}}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())