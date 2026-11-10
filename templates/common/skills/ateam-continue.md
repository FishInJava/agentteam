---
name: ateam-continue
description: "Resumes the active ateam Leader loop: reloads the board summary and leader-state, then continues from the current phase. Use when resuming a session or after a context compaction."
---

# ateam — Continue

1. Reload the board:

```bash
{{PYTHON_CMD}} .ateam/scripts/get_context.py
```

2. Read the Leader's own memory:
   - `.ateam/workspace/leader-state.json` (phase, next_action, recent decisions)
   - `.ateam/workspace/handover.md` (done / next / tried-and-failed / budget)

3. Continue from `next_action`. **Do not re-pick work that is already done.**

4. Follow the current phase breadcrumb (from `.ateam/workflow.md`):

- recon / implement / verify / endgame / blocked / done — one main decision per loop.

5. Keep looping with a deadline self-check: read `project.budget.deadline_at`; if it has
   passed, stop dispatching new work and enter endgame.

```bash
{{PYTHON_CMD}} .ateam/scripts/board.py summary
```