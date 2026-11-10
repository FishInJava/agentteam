---
description: "Write a Leader handover document now: summarize session state, write .ateam/workspace/handover.md, report context usage. Also the standard response at ~85% context."
---
# /test-handover

Write the Leader handover **immediately** — no subagents, do it yourself. The user may
invoke this manually at any time; the Leader must also run the same steps unprompted
when its own context reaches ~85%.

1. `{{PYTHON_CMD}} .ateam/scripts/get_context.py` — read the live board summary.
2. Read `.ateam/workspace/leader-state.json` (phase, next_action, decisions).
3. Compose the handover, concretely (no vague one-liners):
   - **done**: intents closed this session + acceptance rows verified, citing ids (i00x / a00x / f00x)
   - **next**: the single next action (usually leader-state.next_action) with enough
     detail that a fresh Leader can execute it without re-reading history
   - **tried-and-failed**: dead ends and burned angles, so the next Leader does not repeat them
   - **worker state**: dispatched workers still running; if dead, what to salvage and how
   - **budget**: consumption so far (tokens/seconds) vs budget; acceptance progress X/Y
4. Write it via:
   `{{PYTHON_CMD}} .ateam/scripts/board.py handover write --phase <current> --next-action "<...>" --decisions "<a|b|c>" --notes "<full handover text>"`
5. Report back to the user:
   - handover written (path: `.ateam/workspace/handover.md`)
   - estimated current context usage (%)
   - the standing rule: **~85% context → compact/restart now; the next session resumes
     automatically** (SessionStart hook injects the board summary + this handover).
