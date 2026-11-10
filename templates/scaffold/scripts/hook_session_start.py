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
# The sentinel comment is seeded by the scaffold's workspace/handover.md;
# "（待写）" is what its template puts in every section. A real handover may
# legitimately mention "TODO" (e.g. "TODO: fix X"), so that is NOT a marker.
HANDOVER_PLACEHOLDER_SENTINEL = "<!-- ATEAM_HANDOVER_PLACEHOLDER -->"
HANDOVER_PLACEHOLDER_MARKERS = ("（待写）",)


def _read_handover(ateam: Path) -> str:
    """Read the previous Leader's handover; return "" when absent or placeholder."""
    try:
        content = common.handover_path(ateam).read_text(encoding="utf-8")
    except (FileNotFoundError, OSError, UnicodeDecodeError, ValueError):
        return ""
    if (
        HANDOVER_PLACEHOLDER_SENTINEL in content
        or len(content.strip()) <= 20
        or any(marker in content for marker in HANDOVER_PLACEHOLDER_MARKERS)
    ):
        return ""
    return content.rstrip()


def _project_root(payload: dict) -> tuple[Path, str]:
    """Return (project root, source) where source is the env var name or "cwd"."""
    for var in PROJECT_ENV_VARS:
        value = os.environ.get(var)
        if value:
            return Path(value).resolve(), var
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    return Path(cwd or ".").resolve(), "cwd"


def main() -> int:
    common.configure_encoding()
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            payload = {}
    except (json.JSONDecodeError, ValueError):
        payload = {}

    root, source = _project_root(payload)
    ateam = root / ".ateam"
    if not ateam.is_dir():
        print(
            f"ateam session-start hook: no .ateam directory at {ateam} "
            f"(project root {root} from {source}); no session context injected",
            file=sys.stderr,
        )
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