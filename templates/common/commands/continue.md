---
description: "Resume the ateam Leader loop from the current phase."
---
# /ateam:continue

1. `python .ateam/scripts/get_context.py`
2. Read `.ateam/workspace/leader-state.json` and `.ateam/workspace/handover.md`.
3. Continue from `next_action`; do not re-pick completed work.
4. Follow the phase breadcrumb in `.ateam/workflow.md`.
5. Deadline self-check: read `project.budget.deadline_at`; if reached, enter endgame.