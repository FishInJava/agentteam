#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UserPromptSubmit hook: emit the current phase breadcrumb.

The breadcrumb text lives in `.ateam/workflow.md` [workflow-state:<phase>]
blocks — workflow.md is the single source of truth (no fallback dicts here).
An unknown phase degrades to a visible "refer to workflow.md" line.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common

PROJECT_ENV_VARS = ("QODER_PROJECT_DIR", "CLAUDE_PROJECT_DIR", "CODEX_PROJECT_DIR", "ATEAM_PROJECT_DIR")


def _project_root(payload: dict) -> Path:
    for var in PROJECT_ENV_VARS:
        value = os.environ.get(var)
        if value:
            return Path(value).resolve()
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    return Path(cwd or ".").resolve()


def _phase(ateam: Path) -> str:
    project = common.load_project(ateam)
    state = common.load_leader_state(ateam)
    if project is None:
        return "no_project"
    return project.get("phase") or state.get("phase") or "recon"


def _breadcrumbs(workflow_path: Path) -> dict:
    try:
        text = workflow_path.read_text(encoding="utf-8")
    except OSError:
        return {}
    blocks = {}
    pattern = r"\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n(.*?)\n\s*\[/workflow-state:\1\]"
    for match in re.finditer(pattern, text, re.DOTALL):
        blocks[match.group(1)] = match.group(2).strip()
    return blocks


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

    prompt = str(payload.get("prompt") or "")
    config = common.load_config(ateam)
    skip_keyword = (config.get("prompt_injection") or {}).get("skip_keyword", "no-ateam")
    if skip_keyword:
        boundary = r"(?<![A-Za-z0-9_-])" + re.escape(str(skip_keyword)) + r"(?![A-Za-z0-9_-])"
        if re.search(boundary, prompt, re.IGNORECASE):
            return 0

    phase = _phase(ateam)
    body = _breadcrumbs(ateam / "workflow.md").get(phase) or (
        f"Refer to .ateam/workflow.md for the current step (phase: {phase})."
    )
    context = f"<ateam-breadcrumb>\nPhase: {phase}\n{body}\n</ateam-breadcrumb>"
    result = {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": context}}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())