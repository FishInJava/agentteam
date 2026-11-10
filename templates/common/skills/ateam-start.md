---
name: ateam-start
description: "Starts an ateam Leader session: reads the board summary, finds the current phase, and follows .ateam/workflow.md. Use when beginning a session, resuming work, or re-establishing project context."
---

# ateam — Start Session

You are the Leader of an ateam project. Read the board, decide, dispatch workers.
**Never write code or run tests yourself** — every code-touching action goes to a Worker.

## Steps

1. Print the board summary (use the SessionStart-injected copy if present):

```bash
python .ateam/scripts/get_context.py
```

2. If there is no project yet, ask the human for the requirement Spec + acceptance
   criteria, then create the board:

```bash
python .ateam/scripts/board.py project init \
  --title "<requirement>" --origin "<spec summary>" --goal "<done definition>"
```

3. Read the doctrine and your role handbook:
   - `.ateam/workflow.md`
   - `.ateam/roles/leader.md`

4. Route by phase:

| phase | next action |
|---|---|
| recon | dispatch a bounded read-only recon worker |
| implement | `board.py mission render <intent>` then dispatch an implement worker |
| verify | dispatch **independent** verify workers (never the implementer) |
| endgame | reconcile acceptance, then submit the PR |
| blocked | stop and ask the human |

5. Deadline self-check at the start of every loop: read `project.budget.deadline_at`
   (from the board summary or `board.py project show`). If it has passed, stop dispatching
   new work and enter endgame.