#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared helpers for ateam state scripts. Standard library only."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

OPEN_INTENT_STATUSES = ("open", "dispatched", "running")
ATTENTION_INTENT_STATUSES = ("blocked", "help")


def configure_encoding() -> None:
    if sys.platform.startswith("win"):
        for name in ("stdin", "stdout", "stderr"):
            stream = getattr(sys, name, None)
            if stream is not None and hasattr(stream, "reconfigure"):
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except Exception:
                    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def ateam_dir_from_script() -> Path:
    return Path(__file__).resolve().parent.parent


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError, UnicodeDecodeError):
        return default


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def write_json(path: Path, data: Any) -> None:
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def write_text(path: Path, text: str) -> None:
    _atomic_write_text(path, text)


# -- paths -------------------------------------------------------------------

def board_dir(ateam: Path) -> Path:
    return ateam / "board"


def workspace_dir(ateam: Path) -> Path:
    return ateam / "workspace"


def missions_dir(ateam: Path) -> Path:
    return ateam / "missions"


def config_path(ateam: Path) -> Path:
    return ateam / "config.json"


def project_path(ateam: Path) -> Path:
    return board_dir(ateam) / "project.json"


def counters_path(ateam: Path) -> Path:
    return board_dir(ateam) / "counters.json"


def consumption_path(ateam: Path) -> Path:
    return board_dir(ateam) / "consumption.json"


def leader_state_path(ateam: Path) -> Path:
    return workspace_dir(ateam) / "leader-state.json"


def handover_path(ateam: Path) -> Path:
    return workspace_dir(ateam) / "handover.md"


# -- entity IO ---------------------------------------------------------------

def load_config(ateam: Path) -> dict:
    data = read_json(config_path(ateam), {})
    return data if isinstance(data, dict) else {}


def load_project(ateam: Path) -> Optional[dict]:
    data = read_json(project_path(ateam), None)
    return data if isinstance(data, dict) else None


def load_leader_state(ateam: Path) -> dict:
    data = read_json(leader_state_path(ateam), {})
    return data if isinstance(data, dict) else {}


def list_entities(ateam: Path, kind: str) -> list:
    directory = board_dir(ateam) / kind
    items = []
    if directory.is_dir():
        for path in sorted(directory.glob("*.json")):
            data = read_json(path, None)
            if isinstance(data, dict):
                items.append(data)
    return items


def next_id(ateam: Path, kind: str, prefix: str) -> str:
    counters = read_json(counters_path(ateam), {})
    if not isinstance(counters, dict):
        counters = {}
    value = int(counters.get(kind, 0)) + 1
    counters[kind] = value
    write_json(counters_path(ateam), counters)
    return f"{prefix}{value:03d}"


def entity_path(ateam: Path, kind: str, entity_id: str) -> Path:
    return board_dir(ateam) / kind / f"{entity_id}.json"


def save_entity(ateam: Path, kind: str, entity: dict) -> Path:
    path = entity_path(ateam, kind, entity["id"])
    write_json(path, entity)
    return path


def find_entity(ateam: Path, kind: str, entity_id: str) -> Optional[dict]:
    data = read_json(entity_path(ateam, kind, entity_id), None)
    return data if isinstance(data, dict) else None


# -- summary -----------------------------------------------------------------

def board_summary(ateam: Path) -> dict:
    project = load_project(ateam)
    intents = list_entities(ateam, "intents")
    acceptance = list_entities(ateam, "acceptance")
    consumption = read_json(consumption_path(ateam), [])
    if not isinstance(consumption, list):
        consumption = []
    state = load_leader_state(ateam)

    acceptance_counts = {}
    for item in acceptance:
        status = item.get("status", "recorded")
        acceptance_counts[status] = acceptance_counts.get(status, 0) + 1

    tokens = 0
    seconds = 0
    for item in consumption:
        if not isinstance(item, dict):
            continue
        tokens += int(item.get("tokens_in", 0) or 0) + int(item.get("tokens_out", 0) or 0)
        seconds += int(item.get("seconds", 0) or 0)

    if project is None:
        phase = "no_project"
    else:
        phase = project.get("phase") or state.get("phase") or "recon"

    return {
        "project": project,
        "phase": phase,
        "facts": list_entities(ateam, "facts"),
        "intents": intents,
        "open_intents": [i for i in intents if i.get("status") in OPEN_INTENT_STATUSES],
        "attention_intents": [i for i in intents if i.get("status") in ATTENTION_INTENT_STATUSES],
        "acceptance": acceptance,
        "acceptance_counts": acceptance_counts,
        "hints": list_entities(ateam, "hints"),
        "leader_state": state,
        "consumption": {"tokens": tokens, "seconds": seconds},
    }


def _short(text: Any, limit: int = 120) -> str:
    value = " ".join(str(text or "").split())
    if len(value) <= limit:
        return value
    return value[: limit - 1] + "…"


def render_summary_text(summary: dict) -> str:
    lines: list = []
    project = summary.get("project")
    phase = summary.get("phase", "no_project")

    if project is None:
        lines.append("# ateam board — no project yet")
        lines.append("")
        lines.append("Next: create one with `board.py project init --title ... --origin ... --goal ...`")
        lines.append("Then dispatch a recon worker (see .ateam/workflow.md).")
        return "\n".join(lines)

    budget = project.get("budget") or {}
    consumed = summary.get("consumption") or {}
    lines.append(f"# ateam board — {project.get('title', '(untitled)')}")
    lines.append("")
    lines.append(f"Phase: {phase}")
    if project.get("origin"):
        lines.append(f"Origin: {_short(project.get('origin'), 160)}")
    if project.get("goal"):
        lines.append(f"Goal: {_short(project.get('goal'), 160)}")
    lines.append(
        "Budget: tokens {used}/{total}; seconds {sused}/{stotal}; deadline {deadline}".format(
            used=consumed.get("tokens", 0),
            total=budget.get("total_tokens", 0) or "∞",
            sused=consumed.get("seconds", 0),
            stotal=budget.get("total_seconds", 0) or "∞",
            deadline=budget.get("deadline_at") or "none",
        )
    )
    counts = summary.get("acceptance_counts") or {}
    lines.append(
        "Acceptance: " + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "none")
    )

    facts = summary.get("facts") or []
    lines.append("")
    lines.append(f"## Facts ({len(facts)})")
    if not facts:
        lines.append("- none")
    else:
        for fact in facts:
            lines.append(f"- [{fact.get('id')}] {fact.get('kind', 'note')} — {_short(fact.get('title'), 100)}")

    open_intents = summary.get("open_intents") or []
    lines.append("")
    lines.append(f"## Open intents ({len(open_intents)})")
    if not open_intents:
        lines.append("- none")
    else:
        for intent in open_intents:
            lines.append(
                "- [{id}] {task} worker={worker} status={status} since={since}".format(
                    id=intent.get("id"),
                    task=intent.get("task_type", "?"),
                    worker=intent.get("worker") or "-",
                    status=intent.get("status"),
                    since=intent.get("dispatched_at") or intent.get("created_at") or "-",
                )
            )

    attention = summary.get("attention_intents") or []
    if attention:
        lines.append("")
        lines.append(f"## Needs Leader attention ({len(attention)})")
        for intent in attention:
            lines.append(
                f"- [{intent.get('id')}] status={intent.get('status')} worker={intent.get('worker') or '-'}"
            )

    acceptance = summary.get("acceptance") or []
    lines.append("")
    lines.append(f"## Acceptance ledger ({len(acceptance)})")
    if not acceptance:
        lines.append("- none")
    else:
        for item in acceptance:
            lines.append(f"- [{item.get('id')}] {item.get('status', 'recorded')} — {_short(item.get('criterion'), 100)}")

    hints = summary.get("hints") or []
    if hints:
        lines.append("")
        lines.append(f"## Hints ({len(hints)})")
        recent = hints[-5:]
        for hint in recent:
            lines.append(f"- [{hint.get('id')}] {_short(hint.get('content'), 140)}")

    state = summary.get("leader_state") or {}
    lines.append("")
    lines.append("## Leader state")
    lines.append(f"phase: {state.get('phase') or phase}")
    if state.get("next_action"):
        lines.append(f"next: {_short(state.get('next_action'), 160)}")
    if state.get("recent_decisions"):
        decisions = state.get("recent_decisions") or []
        lines.append("recent decisions: " + "; ".join(_short(d, 60) for d in decisions[-3:]))
    lines.append(f"handover: {state.get('handover_doc') or '.ateam/workspace/handover.md'}")

    return "\n".join(lines)