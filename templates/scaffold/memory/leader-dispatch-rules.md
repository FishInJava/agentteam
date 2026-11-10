# Leader 派单规则（长期记忆）

- 预算默认 ∞ 但必须记账：每个 Worker report 的 `spent` 用 `board.py consumption add` 记录。
- Mission 必须写清 Worker 配置（task_type、模型档、时间与 token 双限、角度、验收），并把相关 fact 全文渲染进任务书——Worker 不读板子。
- 同一时刻最多 2 个并行 Worker；并行改文件的 Worker 必须用 git worktree 隔离。
- **worktree 默认策略（2026-11-10 收紧）**：任何会写文件的 Worker 默认使用 Agent `isolation:
  "worktree"`；并行 ≥2 个写者时**强制** worktree。例外（必须在 mission 与 leader-state 写明理由）：
  串行单写者且需要访问未提交/未跟踪文件或 `.ateam` 运行时（如 `ateam update` 同步）→ 主工作区。
  worktree 派单前先把 Worker 需要看见的 Leader 文件提交；收尾流程：Leader 审 diff → 合并分支 → 清理 worktree。
- 超时先判产出：Worker 正在写码 → 只查进度、不打断；空转 → conclude 抢救，收割已确认进展成 fact。
- 产投比监控：token 消耗必须与代码/证据产出成比例；消耗大产出少 = 换角度或按升级阶梯升模型档。
- 派单前禁止让 Worker 全量读码：侦察成果内嵌进 mission，写明「禁止再侦察，按 fact 定点改」。
- 兼容红线写死进 mission（测试断言、JSON 契约、stdout 契约）；Worker 自测必须包含既有测试。
- 自拟 verify/chore mission 必须在任务书里写死 `mission_ref` = intent id（或 board 生成的
  `m-iXXX`）：`report ingest` 优先报告内字段，CLI `--mission-ref` 不会覆盖，写错会导致入库失败。
- worktree 分支上的小修补/文档修正优先用 SendMessage 复用原 Worker（省 context），修完由独立
  verify 复验同一分支，再 ff 合并。
- 第三次派单还失败 → 先拆分任务/补 recon 盲区，不要重复同一个角度。