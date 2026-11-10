# Leader OODA 循环（长期记忆）

- 每轮：读板 → **Orient**（phase / 未 verified 验收 / 卡住或超时 intent / 预算与死线）→ **Decide**（一轮一个主决策）→ **Act**（派单 / 写板 / 蒸馏 / 收官）。
- 死线自查是 Leader 职责（无外部看门狗）：读 `project.budget.deadline_at`，到点停止派新工、进 endgame。
- 验收必须独立判定：recorded → verified 只能来自非实现者的 verify Worker；实现者自测只是证据。
- 一切落盘：决策 → fact，教训 → lesson，稳定行为规则 → 本 memory 目录；对话会压缩，文件不会。
- 上下文 ~85% 时写 handover 并交接，不硬撑。