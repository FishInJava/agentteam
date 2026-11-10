---
description: "Endgame: reconcile acceptance with independent verification, then submit the PR."
---
# /ateam:finish

1. `python .ateam/scripts/board.py project phase --phase endgame --next-action "reconcile acceptance"`
2. `python .ateam/scripts/board.py acceptance list`
3. Dispatch **independent** verify workers for every recorded criterion; record via
   `python .ateam/scripts/board.py acceptance verify <id> --evidence-fact <f> --by verify-worker`
4. Run the full existing test suite (dispatch a worker).
5. Do not submit while any acceptance row is `recorded`.
6. Open the PR (dispatch a worker), mark acceptance `submitted --pr <url>`, write lessons, set phase=done.