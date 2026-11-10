#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared helpers for ateam state scripts. Standard library only."""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unicodedata
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
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        print(f"warn: cannot parse {path}: {exc}", file=sys.stderr)
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


_ENTITY_ID_RE = re.compile(r"^([A-Za-z]+)(\d+)$")


def _entity_sort_key(path: Path) -> tuple:
    """Sort by alpha prefix, then by the numeric ID suffix (f1000 after f999)."""
    stem = path.stem
    match = _ENTITY_ID_RE.match(stem)
    if match:
        return (match.group(1), int(match.group(2)), stem)
    return (stem, -1, stem)


def list_entities(ateam: Path, kind: str) -> list:
    directory = board_dir(ateam) / kind
    items = []
    if directory.is_dir():
        for path in sorted(directory.glob("*.json"), key=_entity_sort_key):
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


# -- color / width -----------------------------------------------------------

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_ANSI_CODES = {"red": "31", "green": "32", "yellow": "33", "dim": "2", "bold": "1"}

STATUS_COLORS = {
    "verified": "green",
    "done": "green",
    "blocked": "red",
    "help": "red",
    "failed": "red",
    "running": "yellow",
    "dispatched": "yellow",
}


def _enable_windows_vt() -> None:
    """Best-effort ANSI support for legacy Windows consoles; silent fallback."""
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)
    except Exception:
        pass


def color_enabled(stream=None) -> bool:
    """ANSI is used only on a TTY with NO_COLOR unset (and TERM != dumb)."""
    if "NO_COLOR" in os.environ:
        return False
    if os.environ.get("TERM") == "dumb":
        return False
    stream = stream if stream is not None else sys.stdout
    try:
        if not stream.isatty():
            return False
    except Exception:
        return False
    _enable_windows_vt()
    return True


def paint(text: Any, color: Optional[str] = None) -> str:
    value = "" if text is None else str(text)
    code = _ANSI_CODES.get(color or "")
    if code is None or not color_enabled():
        return value
    return f"\x1b[{code}m{value}\x1b[0m"


def status_color(status: Any) -> Optional[str]:
    return STATUS_COLORS.get(str(status or "").strip().lower())


def paint_status(status: Any) -> str:
    return paint(status, status_color(status))


def strip_ansi(text: Any) -> str:
    return _ANSI_RE.sub("", str(text or ""))


def display_width(text: Any) -> int:
    """Terminal cell width: East Asian wide/full chars count as 2, ANSI ignored."""
    width = 0
    for ch in strip_ansi(text):
        if unicodedata.combining(ch):
            continue
        width += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return width


def pad_display(text: Any, width: int) -> str:
    value = str(text or "")
    return value + " " * max(0, width - display_width(value))


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


def _short(text: Any, limit: Optional[int] = None, verbose: bool = False) -> str:
    """Collapse whitespace; fold long text with an explicit marker (never a silent cut)."""
    value = " ".join(str(text or "").split())
    if verbose or limit is None or display_width(value) <= limit:
        return value
    kept: list = []
    used = 0
    for ch in value:
        step = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if used + step > limit:
            break
        kept.append(ch)
        used += step
    remaining = len(value) - len(kept)
    if remaining <= 0:
        return value
    return "".join(kept) + f" …(+{remaining} chars; --verbose)"


def progress_bar(done: int, total: int, width: int = 20) -> str:
    if total <= 0:
        filled = 0
    else:
        filled = int(round(width * max(0, min(done, total)) / total))
    return "[" + "#" * filled + "-" * (width - filled) + "]"


def render_summary_text(summary: dict, verbose: bool = False) -> str:
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
    facts = summary.get("facts") or []
    intents = summary.get("intents") or []
    open_intents = summary.get("open_intents") or []
    acceptance = summary.get("acceptance") or []
    verified = sum(1 for item in acceptance if item.get("status") == "verified")
    counts = summary.get("acceptance_counts") or {}
    breakdown = ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "none"

    lines.append(f"# ateam board — {project.get('title', '(untitled)')}")
    lines.append("")
    lines.append(f"Phase: {phase}")
    lines.append(
        "Acceptance: {bar} {verified}/{total} verified ({breakdown})".format(
            bar=progress_bar(verified, len(acceptance)),
            verified=verified,
            total=len(acceptance),
            breakdown=breakdown,
        )
    )
    lines.append(
        "Board: facts {facts} | intents {intents} | open intents {open_}".format(
            facts=len(facts),
            intents=len(intents),
            open_=len(open_intents),
        )
    )
    if project.get("origin"):
        lines.append(f"Origin: {_short(project.get('origin'), 160, verbose)}")
    if project.get("goal"):
        lines.append(f"Goal: {_short(project.get('goal'), 160, verbose)}")
    lines.append(
        "Budget: tokens {used}/{total}; seconds {sused}/{stotal}; deadline {deadline}".format(
            used=consumed.get("tokens", 0),
            total=budget.get("total_tokens", 0) or "∞",
            sused=consumed.get("seconds", 0),
            stotal=budget.get("total_seconds", 0) or "∞",
            deadline=budget.get("deadline_at") or "none",
        )
    )

    lines.append("")
    lines.append(f"## Facts ({len(facts)})")
    if not facts:
        lines.append("- none")
    else:
        for fact in facts:
            lines.append(
                "- [{id}] {kind} — {title}".format(
                    id=fact.get("id"),
                    kind=fact.get("kind", "note"),
                    title=_short(fact.get("title"), 100, verbose),
                )
            )

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
                    status=paint_status(intent.get("status")),
                    since=intent.get("dispatched_at") or intent.get("created_at") or "-",
                )
            )

    attention = summary.get("attention_intents") or []
    if attention:
        lines.append("")
        lines.append(f"## Needs Leader attention ({len(attention)})")
        for intent in attention:
            lines.append(
                "- [{id}] status={status} worker={worker}".format(
                    id=intent.get("id"),
                    status=paint_status(intent.get("status")),
                    worker=intent.get("worker") or "-",
                )
            )

    lines.append("")
    lines.append(f"## Acceptance ledger ({len(acceptance)})")
    if not acceptance:
        lines.append("- none")
    else:
        for item in acceptance:
            lines.append(
                "- [{id}] {status} — {criterion}".format(
                    id=item.get("id"),
                    status=paint_status(item.get("status", "recorded")),
                    criterion=_short(item.get("criterion"), 100, verbose),
                )
            )

    hints = summary.get("hints") or []
    if hints:
        lines.append("")
        lines.append(f"## Hints ({len(hints)})")
        recent = hints[-5:]
        for hint in recent:
            lines.append(f"- [{hint.get('id')}] {_short(hint.get('content'), 140, verbose)}")

    state = summary.get("leader_state") or {}
    lines.append("")
    lines.append("## Leader state")
    lines.append(f"phase: {state.get('phase') or phase}")
    if state.get("next_action"):
        lines.append(f"next: {_short(state.get('next_action'), 160, verbose)}")
    if state.get("recent_decisions"):
        decisions = state.get("recent_decisions") or []
        lines.append("recent decisions: " + "; ".join(_short(d, 60, verbose) for d in decisions[-3:]))
    lines.append(f"handover: {state.get('handover_doc') or '.ateam/workspace/handover.md'}")

    return "\n".join(lines)