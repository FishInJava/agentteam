#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print the ateam board summary that the Leader reads each loop."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common


def main() -> int:
    common.configure_encoding()
    ateam = common.ateam_dir_from_script()
    if not ateam.is_dir():
        print(f"not an ateam project: {ateam}", file=sys.stderr)
        return 1

    summary = common.board_summary(ateam)
    if "--json" in sys.argv[1:]:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(common.render_summary_text(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())