#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SubagentStart hook (Codex): remind a dispatched worker it is a stateless executor."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common

CONTEXT = (
    "<ateam-worker>\n"
    "You are a Worker dispatched by the Leader. You do NOT know any shared board; do not read or modify .ateam/.\n"
    "Obey the mission in your dispatch prompt. Return a structured report "
    "(mission_ref, status, confirmed_findings, evidence, acceptance_claim, spent).\n"
    "If stuck or over budget: STOP and report BLOCKED/HELP with what you tried. Never guess your way forward.\n"
    "Do not dispatch other workers; the Leader owns dispatch.\n"
    "</ateam-worker>"
)


def main() -> int:
    common.configure_encoding()
    try:
        sys.stdin.read()
    except Exception:
        pass
    result = {"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": CONTEXT}}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())