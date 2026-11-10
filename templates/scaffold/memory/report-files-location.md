# Worker 报告落盘位置（长期记忆）

- Worker 的最终 JSON 报告写 `.ateam/missions/<intent>-report.json`（板子设计的归档地），不要自造系统 TEMP 路径。
- Leader 用 `board.py report ingest` 收割；report 只是证据，把它翻译成 fact 是 Leader 的判断。
- 会话中断/被终止时，先检查 `.ateam/missions/` 是否有半成品报告，再决定 conclude 还是重派。