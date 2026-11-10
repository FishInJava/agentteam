---
name: ateam-finish
description: "Endgame for an ateam requirement: stops new work, reconciles every acceptance criterion with independent verification, then submits the PR and records lessons. Use when implementation is done or the deadline is reached."
---

# ateam — Finish (endgame)

1. Enter endgame:

```bash
{{PYTHON_CMD}} .ateam/scripts/board.py project phase --phase endgame --next-action "reconcile acceptance"
```

2. List the acceptance ledger:

```bash
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance list
```

3. For **every** `recorded` criterion, dispatch a separate verify worker — never the
   worker that implemented it. On its report:

```bash
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance verify <a-id> --evidence-fact <f-id> --by verify-worker
# or, if it failed / is waived:
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance status <a-id> --status failed --note "..."
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance status <a-id> --status waived --note "rationale"
```

4. Dispatch a worker to run the **full existing test suite** (regression check).

5. **Do not submit a PR while any acceptance row is still `recorded`.**

6. Dispatch a worker to open the PR, then mark each criterion submitted:

```bash
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance status <a-id> --status submitted --pr "<url>"
```

7. Write `lesson` / `decision` facts, update the handover, then:

```bash
{{PYTHON_CMD}} .ateam/scripts/board.py project phase --phase done --next-action "create next project"
```