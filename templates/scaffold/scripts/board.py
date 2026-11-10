#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ateam board — the Leader's single write API for the fact-intent graph.

Only the Leader writes the board. Workers never touch it; they receive a
rendered mission and return a structured report. This script is the one
physical write path, so board quality has a single owner.

Standard library only. JSON files under .ateam/board/ (git-friendly, diffable).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common

FACT_KINDS = ["codebase", "module", "test", "decision", "lesson", "blocker", "note", "acceptance"]
TASK_TYPES = ["recon", "implement", "fix", "verify", "chore", "distill"]
INTENT_STATUSES = ["open", "dispatched", "running", "done", "blocked", "help", "cancelled", "timed_out"]
ACCEPTANCE_STATUSES = ["recorded", "verified", "submitted", "failed", "waived"]
PHASES = ["recon", "implement", "verify", "endgame", "blocked", "done"]

REPORT_STATUS_TO_INTENT = {
    "DONE": "done",
    "BLOCKED": "blocked",
    "HELP": "help",
    "REPORT": "running",
    "TIMEOUT_SALVAGE": "timed_out",
}
CONCLUDED_REPORT_STATUSES = ("DONE", "BLOCKED", "HELP", "TIMEOUT_SALVAGE")


def _require_project(ateam: Path) -> dict:
    project = common.load_project(ateam)
    if project is None:
        raise SystemExit("no project on the board. Run: board.py project init --title ...")
    return project


def _split_list(value: str | None) -> list:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _split_pipe(value: str | None) -> list:
    if not value:
        return []
    return [part.strip() for part in value.split("|") if part.strip()]


# -- project -----------------------------------------------------------------

def cmd_project_init(args, ateam: Path) -> int:
    existing = common.load_project(ateam)
    if existing is not None and not args.force:
        print("project already exists; use --force to replace", file=sys.stderr)
        return 1

    project = {
        "id": "p1",
        "title": args.title,
        "origin": args.origin or "",
        "goal": args.goal or "",
        "status": "active",
        "phase": "recon",
        "budget": {
            "total_tokens": int(args.tokens or 0),
            "total_seconds": int(args.seconds or 0),
            "deadline_at": args.deadline,
            "restart_budget": int(args.restart_budget or 5),
        },
        "created_at": common.now_iso(),
        "updated_at": common.now_iso(),
    }
    common.write_json(common.project_path(ateam), project)

    state = common.load_leader_state(ateam)
    state["phase"] = "recon"
    state["next_action"] = "dispatch a recon worker to map Spec to the codebase"
    state["open_intents"] = state.get("open_intents") or []
    state["recent_decisions"] = state.get("recent_decisions") or []
    state["handover_doc"] = ".ateam/workspace/handover.md"
    state["updated_at"] = common.now_iso()
    common.write_json(common.leader_state_path(ateam), state)

    print(f"project created: {project['title']} (phase=recon)")
    return 0


def cmd_project_show(args, ateam: Path) -> int:
    project = common.load_project(ateam)
    if project is None:
        print("no project on the board")
        return 1
    print(json.dumps(project, ensure_ascii=False, indent=2))
    return 0


def cmd_project_phase(args, ateam: Path) -> int:
    project = _require_project(ateam)
    if args.phase not in PHASES:
        print(f"invalid phase; choose from: {', '.join(PHASES)}", file=sys.stderr)
        return 1
    project["phase"] = args.phase
    project["updated_at"] = common.now_iso()
    common.write_json(common.project_path(ateam), project)

    state = common.load_leader_state(ateam)
    state["phase"] = args.phase
    if args.next_action is not None:
        state["next_action"] = args.next_action
    state["updated_at"] = common.now_iso()
    common.write_json(common.leader_state_path(ateam), state)
    print(f"phase -> {args.phase}")
    return 0


# -- facts -------------------------------------------------------------------

def cmd_fact_add(args, ateam: Path) -> int:
    _require_project(ateam)
    if args.kind not in FACT_KINDS:
        print(f"invalid fact kind; choose from: {', '.join(FACT_KINDS)}", file=sys.stderr)
        return 1
    if args.source_intent and common.find_entity(ateam, "intents", args.source_intent) is None:
        print(f"source intent {args.source_intent} not found", file=sys.stderr)
        return 1

    data = {}
    if args.data:
        try:
            data = json.loads(args.data)
        except json.JSONDecodeError as exc:
            print(f"--data must be valid JSON: {exc}", file=sys.stderr)
            return 1

    fact = {
        "id": common.next_id(ateam, "fact", "f"),
        "title": args.title,
        "description": args.description,
        "doc": args.doc,
        "kind": args.kind,
        "data": data if isinstance(data, dict) else {},
        "created_at": common.now_iso(),
        "creator": args.creator,
        "source_intent": args.source_intent,
    }
    common.save_entity(ateam, "facts", fact)
    print(fact["id"])
    return 0


def cmd_fact_list(args, ateam: Path) -> int:
    facts = common.list_entities(ateam, "facts")
    if args.kind:
        facts = [f for f in facts if f.get("kind") == args.kind]
    if args.json:
        print(json.dumps(facts, ensure_ascii=False, indent=2))
        return 0
    verbose = getattr(args, "verbose", False)
    rows = []
    for fact in facts:
        content = common_text(fact.get("title", ""))
        if verbose and fact.get("description"):
            content = f"{content} — {common_text(fact.get('description'))}"
        rows.append((str(fact.get("id", "")), str(fact.get("kind", "note")), content))
    for line in _render_status_rows(rows):
        print(line)
    return 0


# -- intents -----------------------------------------------------------------

def cmd_intent_add(args, ateam: Path) -> int:
    _require_project(ateam)
    if args.task_type not in TASK_TYPES:
        print(f"invalid task type; choose from: {', '.join(TASK_TYPES)}", file=sys.stderr)
        return 1
    from_facts = _split_list(args.from_facts)
    for fact_id in from_facts:
        if common.find_entity(ateam, "facts", fact_id) is None:
            print(f"from fact {fact_id} not found", file=sys.stderr)
            return 1

    intent = {
        "id": common.next_id(ateam, "intent", "i"),
        "from": from_facts,
        "to": None,
        "description": args.description,
        "task_type": args.task_type,
        "angle": args.angle or "",
        "acceptance": _split_pipe(args.acceptance),
        "creator": "leader",
        "worker": None,
        "mission_ref": None,
        "status": "open",
        "model": args.model,
        "time_budget": int(args.time) if args.time else None,
        "token_budget": int(args.tokens) if args.tokens else None,
        "created_at": common.now_iso(),
        "dispatched_at": None,
        "concluded_at": None,
        "report": None,
    }
    common.save_entity(ateam, "intents", intent)
    print(intent["id"])
    return 0


def cmd_intent_list(args, ateam: Path) -> int:
    intents = common.list_entities(ateam, "intents")
    if args.status:
        intents = [i for i in intents if i.get("status") == args.status]
    if args.json:
        print(json.dumps(intents, ensure_ascii=False, indent=2))
        return 0
    verbose = getattr(args, "verbose", False)
    rows = []
    for intent in intents:
        content = "{task} worker={worker} from={frm} — {desc}".format(
            task=intent.get("task_type"),
            worker=intent.get("worker") or "-",
            frm=",".join(intent.get("from") or []) or "-",
            desc=common_text(intent.get("description")),
        )
        if verbose:
            extras = []
            if intent.get("angle"):
                extras.append(f"angle={common_text(intent.get('angle'))}")
            if intent.get("acceptance"):
                extras.append("acceptance=" + " | ".join(str(a) for a in intent.get("acceptance")))
            if intent.get("mission_ref"):
                extras.append(f"mission_ref={intent.get('mission_ref')}")
            if extras:
                content += " (" + "; ".join(extras) + ")"
        rows.append((str(intent.get("id", "")), str(intent.get("status") or "-"), content))
    for line in _render_status_rows(rows):
        print(line)
    return 0


def common_text(value) -> str:
    """Collapse whitespace without hard truncating: list text is shown in full."""
    return " ".join(str(value or "").split())


def _render_status_rows(rows) -> list:
    """Render (id, status, content) rows as two aligned, colored columns."""
    if not rows:
        return []
    id_width = max(common.display_width(row[0]) for row in rows)
    status_width = max(common.display_width(row[1]) for row in rows)
    lines = []
    for ident, status, content in rows:
        plain_status = str(status or "")
        lines.append(
            "{ident}{id_pad}  {status}{status_pad}  {content}".format(
                ident=ident,
                id_pad=" " * max(0, id_width - common.display_width(ident)),
                status=common.paint_status(plain_status),
                status_pad=" " * max(0, status_width - common.display_width(plain_status)),
                content=content,
            )
        )
    return lines


def _get_intent(ateam: Path, intent_id: str) -> dict:
    intent = common.find_entity(ateam, "intents", intent_id)
    if intent is None:
        raise SystemExit(f"intent {intent_id} not found")
    return intent


def cmd_intent_dispatch(args, ateam: Path) -> int:
    intent = _get_intent(ateam, args.intent_id)
    intent["worker"] = args.worker
    if args.mission_ref:
        intent["mission_ref"] = args.mission_ref
    elif not intent.get("mission_ref"):
        intent["mission_ref"] = f"m-{intent['id']}"
    intent["status"] = "dispatched"
    intent["dispatched_at"] = common.now_iso()
    common.save_entity(ateam, "intents", intent)
    print(f"{intent['id']} dispatched to {args.worker} (mission_ref={intent['mission_ref']})")
    return 0


def cmd_intent_status(args, ateam: Path) -> int:
    intent = _get_intent(ateam, args.intent_id)
    if args.status not in INTENT_STATUSES:
        print(f"invalid status; choose from: {', '.join(INTENT_STATUSES)}", file=sys.stderr)
        return 1
    intent["status"] = args.status
    if args.to_fact:
        if common.find_entity(ateam, "facts", args.to_fact) is None:
            print(f"fact {args.to_fact} not found", file=sys.stderr)
            return 1
        intent["to"] = args.to_fact
    if args.status in ("done", "cancelled", "timed_out"):
        intent["concluded_at"] = common.now_iso()
    common.save_entity(ateam, "intents", intent)
    print(f"{intent['id']} -> {args.status}")
    return 0


# -- mission / report --------------------------------------------------------

def cmd_mission_render(args, ateam: Path) -> int:
    intent = _get_intent(ateam, args.intent_id)
    project = common.load_project(ateam) or {}
    facts = [common.find_entity(ateam, "facts", fid) for fid in intent.get("from") or []]
    facts = [f for f in facts if f]

    lines = []
    lines.append(f"# Mission {intent.get('mission_ref') or intent['id']}")
    lines.append("")
    lines.append(
        "You are a Worker (stateless executor) dispatched by the Leader. You do NOT know any "
        "shared board; do not look for, read, or modify `.ateam/`. Your only context is this mission."
    )
    lines.append("")
    lines.append(f"Project: {project.get('title', '')}")
    if project.get("goal"):
        lines.append(f"Project goal: {project.get('goal')}")
    lines.append("")
    lines.append("## Task")
    lines.append(str(intent.get("description") or "").strip())
    if intent.get("angle"):
        lines.append("")
        lines.append("## Angle")
        lines.append(str(intent["angle"]).strip())
    if facts:
        lines.append("")
        lines.append("## Relevant facts (from the Leader)")
        for fact in facts:
            doc = f" (doc: {fact['doc']})" if fact.get("doc") else ""
            lines.append(
                f"- [{fact.get('id')}] {fact.get('title', '')} — {fact.get('description', '')}{doc}"
            )
    if intent.get("acceptance"):
        lines.append("")
        lines.append("## Acceptance for this slice")
        for item in intent.get("acceptance") or []:
            lines.append(f"- {item}")
    lines.append("")
    lines.append("## Constraints (non-negotiable)")
    lines.append("- Only change what this mission requires; no unrelated refactors or cleanup.")
    lines.append("- Do not break existing tests; run the relevant tests before reporting.")
    lines.append("- Respect the repo's build/lint/naming conventions (see relevant codebase facts).")
    lines.append("- No over-engineering: no speculative abstractions, fallbacks, or compat shims.")
    lines.append("- If a new dependency or a destructive action is needed, stop and report BLOCKED.")
    lines.append("")
    lines.append("## Budget")
    lines.append(f"- model: {intent.get('model') or 'standard'}")
    lines.append(f"- time_seconds: {intent.get('time_budget') or 'unset'}")
    lines.append(f"- tokens: {intent.get('token_budget') or 'unset'}")
    lines.append("")
    lines.append("## Report (return one JSON object)")
    lines.append("```json")
    lines.append("{")
    lines.append(f'  "mission_ref": "{intent.get("mission_ref") or intent["id"]}",')
    lines.append('  "status": "DONE|BLOCKED|HELP|REPORT|TIMEOUT_SALVAGE",')
    lines.append('  "confirmed_findings": [{"title": "...", "description": "...", "doc_pointer": null, "kind_hint": "module"}],')
    lines.append('  "evidence": {"run_cmd": "...", "result": "...", "diff_pointer": null},')
    lines.append('  "acceptance_claim": [{"criterion": "...", "result": "...", "evidence_pointer": null}],')
    lines.append('  "next_suggestion": "...",')
    lines.append('  "spent": {"tokens_in": 0, "tokens_out": 0, "seconds": 0}')
    lines.append("}")
    lines.append("```")
    lines.append("")
    lines.append("If your context is insufficient: write a handover (done / next / tried-and-failed),")
    lines.append("compact, re-read the handover, and continue. If stuck or over budget: STOP and report")
    lines.append("BLOCKED/HELP with what you tried — do not keep burning tokens.")

    print("\n".join(lines))
    return 0


def cmd_report_ingest(args, ateam: Path) -> int:
    report = common.read_json(Path(args.file), None)
    if not isinstance(report, dict):
        print(f"report file {args.file} is not a JSON object", file=sys.stderr)
        return 1

    mission_ref = report.get("mission_ref") or args.mission_ref
    if not mission_ref:
        print("report needs mission_ref (or pass --mission-ref)", file=sys.stderr)
        return 1

    intent = None
    for candidate in common.list_entities(ateam, "intents"):
        if candidate.get("mission_ref") == mission_ref or candidate.get("id") == mission_ref:
            intent = candidate
            break
    if intent is None:
        print(f"no intent matches mission_ref {mission_ref}", file=sys.stderr)
        return 1

    outcome = str(report.get("status", "REPORT")).upper()
    intent["status"] = REPORT_STATUS_TO_INTENT.get(outcome, "running")
    intent["report"] = report
    if outcome in CONCLUDED_REPORT_STATUSES:
        intent["concluded_at"] = common.now_iso()
    common.save_entity(ateam, "intents", intent)
    common.write_json(common.missions_dir(ateam) / f"{mission_ref}.json", report)
    print(f"report ingested for {intent['id']} -> status {intent['status']}")
    return 0


# -- acceptance ledger -------------------------------------------------------

def cmd_acceptance_add(args, ateam: Path) -> int:
    _require_project(ateam)
    item = {
        "id": common.next_id(ateam, "acceptance", "a"),
        "criterion": args.criterion,
        "source": args.source or "",
        "status": "recorded",
        "evidence_fact": None,
        "verified_by": None,
        "verified_at": None,
        "pr_ref": None,
        "note": None,
    }
    common.save_entity(ateam, "acceptance", item)
    print(item["id"])
    return 0


def cmd_acceptance_list(args, ateam: Path) -> int:
    items = common.list_entities(ateam, "acceptance")
    if args.status:
        items = [a for a in items if a.get("status") == args.status]
    if args.json:
        print(json.dumps(items, ensure_ascii=False, indent=2))
        return 0
    verbose = getattr(args, "verbose", False)
    rows = []
    for item in items:
        content = common_text(item.get("criterion"))
        if verbose:
            extras = []
            if item.get("source"):
                extras.append(f"source={common_text(item.get('source'))}")
            if item.get("evidence_fact"):
                extras.append(f"evidence={item.get('evidence_fact')}")
            if item.get("verified_by"):
                extras.append(f"verified_by={item.get('verified_by')}")
            if item.get("pr_ref"):
                extras.append(f"pr={item.get('pr_ref')}")
            if item.get("note"):
                extras.append(f"note={common_text(item.get('note'))}")
            if extras:
                content += " (" + "; ".join(extras) + ")"
        rows.append((str(item.get("id", "")), str(item.get("status", "recorded")), content))
    for line in _render_status_rows(rows):
        print(line)
    return 0


def cmd_acceptance_verify(args, ateam: Path) -> int:
    item = common.find_entity(ateam, "acceptance", args.acceptance_id)
    if item is None:
        raise SystemExit(f"acceptance {args.acceptance_id} not found")
    if args.evidence_fact and common.find_entity(ateam, "facts", args.evidence_fact) is None:
        print(f"evidence fact {args.evidence_fact} not found", file=sys.stderr)
        return 1
    item["status"] = "verified"
    item["evidence_fact"] = args.evidence_fact
    item["verified_by"] = args.by or "verify-worker"
    item["verified_at"] = common.now_iso()
    common.save_entity(ateam, "acceptance", item)
    print(f"{item['id']} verified by {item['verified_by']}")
    return 0


def cmd_acceptance_status(args, ateam: Path) -> int:
    item = common.find_entity(ateam, "acceptance", args.acceptance_id)
    if item is None:
        raise SystemExit(f"acceptance {args.acceptance_id} not found")
    if args.status not in ACCEPTANCE_STATUSES:
        print(f"invalid status; choose from: {', '.join(ACCEPTANCE_STATUSES)}", file=sys.stderr)
        return 1
    item["status"] = args.status
    if args.pr:
        item["pr_ref"] = args.pr
    if args.note:
        item["note"] = args.note
    common.save_entity(ateam, "acceptance", item)
    print(f"{item['id']} -> {args.status}")
    return 0


# -- hints / handover / consumption ------------------------------------------

def cmd_hint_add(args, ateam: Path) -> int:
    hint = {
        "id": common.next_id(ateam, "hint", "h"),
        "content": args.content,
        "creator": args.creator,
        "created_at": common.now_iso(),
    }
    common.save_entity(ateam, "hints", hint)
    print(hint["id"])
    return 0


def cmd_hint_list(args, ateam: Path) -> int:
    hints = common.list_entities(ateam, "hints")
    if args.json:
        print(json.dumps(hints, ensure_ascii=False, indent=2))
        return 0
    verbose = getattr(args, "verbose", False)
    rows = []
    for hint in hints:
        content = common_text(hint.get("content"))
        if verbose and hint.get("created_at"):
            content += f" ({hint.get('created_at')})"
        rows.append((str(hint.get("id", "")), str(hint.get("creator", "human")), content))
    for line in _render_status_rows(rows):
        print(line)
    return 0


def cmd_handover_write(args, ateam: Path) -> int:
    state = common.load_leader_state(ateam)
    if args.phase:
        state["phase"] = args.phase
    if args.next_action is not None:
        state["next_action"] = args.next_action
    if args.decisions is not None:
        state["recent_decisions"] = _split_pipe(args.decisions)
    state["handover_doc"] = ".ateam/workspace/handover.md"
    state["updated_at"] = common.now_iso()
    common.write_json(common.leader_state_path(ateam), state)

    if args.notes is not None:
        common.write_text(common.handover_path(ateam), args.notes.rstrip() + "\n")

    print("leader state updated" + (" + handover.md written" if args.notes is not None else ""))
    return 0


def cmd_consumption_add(args, ateam: Path) -> int:
    records = common.read_json(common.consumption_path(ateam), [])
    if not isinstance(records, list):
        records = []
    records.append(
        {
            "intent_id": args.intent_id,
            "worker": args.worker,
            "model": args.model,
            "tokens_in": int(args.tokens_in or 0),
            "tokens_out": int(args.tokens_out or 0),
            "seconds": int(args.seconds or 0),
            "recorded_at": common.now_iso(),
        }
    )
    common.write_json(common.consumption_path(ateam), records)
    print("consumption recorded")
    return 0


def cmd_summary(args, ateam: Path) -> int:
    summary = common.board_summary(ateam)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(common.render_summary_text(summary, verbose=getattr(args, "verbose", False)))
    return 0


# -- parser ------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="board.py", description="ateam board CLI (Leader-only writes)")
    sub = parser.add_subparsers(dest="command", required=True)

    project = sub.add_parser("project", help="project lifecycle")
    project_sub = project.add_subparsers(dest="project_command", required=True)

    p_init = project_sub.add_parser("init", help="create the requirement project")
    p_init.add_argument("--title", required=True)
    p_init.add_argument("--origin", default="")
    p_init.add_argument("--goal", default="")
    p_init.add_argument("--tokens", type=int, default=0)
    p_init.add_argument("--seconds", type=int, default=0)
    p_init.add_argument("--deadline", default=None)
    p_init.add_argument("--restart-budget", type=int, default=5)
    p_init.add_argument("--force", action="store_true")
    p_init.set_defaults(func=cmd_project_init)

    p_show = project_sub.add_parser("show", help="print project.json")
    p_show.set_defaults(func=cmd_project_show)

    p_phase = project_sub.add_parser("phase", help="set project phase (also drives the breadcrumb)")
    p_phase.add_argument("--phase", required=True)
    p_phase.add_argument("--next-action", default=None)
    p_phase.set_defaults(func=cmd_project_phase)

    fact = sub.add_parser("fact", help="facts (confirmed findings)")
    fact_sub = fact.add_subparsers(dest="fact_command", required=True)

    f_add = fact_sub.add_parser("add", help="add a fact")
    f_add.add_argument("--title", required=True)
    f_add.add_argument("--description", required=True)
    f_add.add_argument("--doc", default=None)
    f_add.add_argument("--kind", default="note", choices=FACT_KINDS)
    f_add.add_argument("--creator", default="leader")
    f_add.add_argument("--source-intent", default=None)
    f_add.add_argument("--data", default=None, help="kind-specific JSON payload")
    f_add.set_defaults(func=cmd_fact_add)

    f_list = fact_sub.add_parser("list", help="list facts")
    f_list.add_argument("--kind", default=None)
    f_list.add_argument("--json", action="store_true")
    f_list.add_argument("--verbose", action="store_true", help="show descriptions in full")
    f_list.set_defaults(func=cmd_fact_list)

    intent = sub.add_parser("intent", help="intents (work items)")
    intent_sub = intent.add_subparsers(dest="intent_command", required=True)

    i_add = intent_sub.add_parser("add", help="declare a work item")
    i_add.add_argument("--from", dest="from_facts", default=None, help="comma list of fact ids")
    i_add.add_argument("--description", required=True)
    i_add.add_argument("--task-type", required=True, choices=TASK_TYPES)
    i_add.add_argument("--angle", default=None)
    i_add.add_argument("--acceptance", default=None, help="pipe-separated acceptance items")
    i_add.add_argument("--model", default=None)
    i_add.add_argument("--time", type=int, default=None, help="time budget in seconds")
    i_add.add_argument("--tokens", type=int, default=None, help="token budget")
    i_add.set_defaults(func=cmd_intent_add)

    i_list = intent_sub.add_parser("list", help="list intents")
    i_list.add_argument("--status", default=None)
    i_list.add_argument("--json", action="store_true")
    i_list.add_argument("--verbose", action="store_true", help="show angle/acceptance/mission details")
    i_list.set_defaults(func=cmd_intent_list)

    i_dispatch = intent_sub.add_parser("dispatch", help="assign an intent to a worker")
    i_dispatch.add_argument("intent_id")
    i_dispatch.add_argument("--worker", required=True)
    i_dispatch.add_argument("--mission-ref", default=None)
    i_dispatch.set_defaults(func=cmd_intent_dispatch)

    i_status = intent_sub.add_parser("status", help="update intent status / produced fact")
    i_status.add_argument("intent_id")
    i_status.add_argument("--status", required=True, choices=INTENT_STATUSES)
    i_status.add_argument("--to-fact", default=None)
    i_status.set_defaults(func=cmd_intent_status)

    mission = sub.add_parser("mission", help="mission rendering for workers")
    mission_sub = mission.add_subparsers(dest="mission_command", required=True)
    m_render = mission_sub.add_parser("render", help="render the mission text for an intent")
    m_render.add_argument("intent_id")
    m_render.set_defaults(func=cmd_mission_render)

    report = sub.add_parser("report", help="worker reports")
    report_sub = report.add_subparsers(dest="report_command", required=True)
    r_ingest = report_sub.add_parser("ingest", help="ingest a worker report JSON")
    r_ingest.add_argument("--file", required=True)
    r_ingest.add_argument("--mission-ref", default=None)
    r_ingest.set_defaults(func=cmd_report_ingest)

    acceptance = sub.add_parser("acceptance", help="acceptance ledger")
    acceptance_sub = acceptance.add_subparsers(dest="acceptance_command", required=True)

    a_add = acceptance_sub.add_parser("add", help="record an acceptance criterion")
    a_add.add_argument("--criterion", required=True)
    a_add.add_argument("--source", default="")
    a_add.set_defaults(func=cmd_acceptance_add)

    a_list = acceptance_sub.add_parser("list", help="list acceptance criteria")
    a_list.add_argument("--status", default=None)
    a_list.add_argument("--json", action="store_true")
    a_list.add_argument("--verbose", action="store_true", help="show source/evidence/verifier details")
    a_list.set_defaults(func=cmd_acceptance_list)

    a_verify = acceptance_sub.add_parser("verify", help="mark verified from an independent verify mission")
    a_verify.add_argument("acceptance_id")
    a_verify.add_argument("--evidence-fact", default=None)
    a_verify.add_argument("--by", default=None)
    a_verify.set_defaults(func=cmd_acceptance_verify)

    a_status = acceptance_sub.add_parser("status", help="set failed/waived/submitted/recorded")
    a_status.add_argument("acceptance_id")
    a_status.add_argument("--status", required=True, choices=ACCEPTANCE_STATUSES)
    a_status.add_argument("--pr", default=None)
    a_status.add_argument("--note", default=None)
    a_status.set_defaults(func=cmd_acceptance_status)

    hint = sub.add_parser("hint", help="human steering hints")
    hint_sub = hint.add_subparsers(dest="hint_command", required=True)
    h_add = hint_sub.add_parser("add", help="record a human hint")
    h_add.add_argument("--content", required=True)
    h_add.add_argument("--creator", default="human")
    h_add.set_defaults(func=cmd_hint_add)
    h_list = hint_sub.add_parser("list", help="list hints")
    h_list.add_argument("--json", action="store_true")
    h_list.add_argument("--verbose", action="store_true", help="show timestamps")
    h_list.set_defaults(func=cmd_hint_list)

    handover = sub.add_parser("handover", help="Leader self-memory")
    handover_sub = handover.add_subparsers(dest="handover_command", required=True)
    ho_write = handover_sub.add_parser("write", help="update leader-state and/or handover.md")
    ho_write.add_argument("--phase", default=None)
    ho_write.add_argument("--next-action", default=None)
    ho_write.add_argument("--decisions", default=None, help="pipe-separated recent decisions")
    ho_write.add_argument("--notes", default=None, help="overwrite handover.md with these notes")
    ho_write.set_defaults(func=cmd_handover_write)

    consumption = sub.add_parser("consumption", help="token/time consumption ledger")
    consumption_sub = consumption.add_subparsers(dest="consumption_command", required=True)
    c_add = consumption_sub.add_parser("add", help="record consumption from a report")
    c_add.add_argument("--intent", dest="intent_id", default=None)
    c_add.add_argument("--worker", default=None)
    c_add.add_argument("--model", default=None)
    c_add.add_argument("--tokens-in", type=int, default=0)
    c_add.add_argument("--tokens-out", type=int, default=0)
    c_add.add_argument("--seconds", type=int, default=0)
    c_add.set_defaults(func=cmd_consumption_add)

    summary = sub.add_parser("summary", help="print the board summary")
    summary.add_argument("--json", action="store_true")
    summary.add_argument("--verbose", action="store_true", help="do not fold long text")
    summary.set_defaults(func=cmd_summary)

    return parser


def main() -> int:
    common.configure_encoding()
    parser = build_parser()
    args = parser.parse_args()
    ateam = common.ateam_dir_from_script()
    if not ateam.is_dir():
        print(f"not an ateam project: {ateam}", file=sys.stderr)
        return 1
    return args.func(args, ateam)


if __name__ == "__main__":
    raise SystemExit(main())