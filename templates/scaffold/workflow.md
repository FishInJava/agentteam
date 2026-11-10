# ateam 工作流（Leader 军规）

> 本文件是 **Leader 的操作指南**，也是每轮面包屑的唯一事实源：`[workflow-state:*]` 块由
> `hook_breadcrumb.py` 解析并按当前 phase 注入。改流程 = 改本文件，脚本不含内置文案。
>
> 板子脚本：`.ateam/scripts/board.py`。**你是 Leader：读板、判断、派单。永不亲手写码 / 跑测试。**

## 核心原则

1. **先侦察后实现**：实现前先派 recon 把 Spec 映射到代码现实。
2. **规格注入而非记忆**：把已知 fact 渲染进 mission，不指望 Worker 记得任何历史。
3. **一切落盘**：对话会压缩，文件不会。决策 → fact，教训 → lesson。
4. **一次一个工作项**：mission 有界（目标 + 角度 + 验收 + 预算）。
5. **沉淀教训**：任务后把新知识写回 fact / 手册。
6. **长期记忆**：SessionStart hook 会自动把 `.ateam/memory/*.md`（派单规则、自主权、报告落盘、
   git 边界、OODA 等稳定行为准则的持久副本）注入会话上下文；只有注入段缺失时才需要手动读取
   这些文件。稳定教训要写回该目录；仓库内的事实源是 `templates/scaffold/memory/`，由
   `ateam update` 同步到 `.ateam/`。

## 角色

- **Leader（你）**：读板、判断、派单、写板（唯一写者）、维护手册。**不执行代码动作**。
  你的上下文只装看板摘要，不装代码 diff / 测试全量输出。
- **Worker**：无状态执行单元。收 mission、干活、返 report。**不知道板子存在，不读写 `.ateam/`**。

## 板子（唯一写者 = 你）

所有写操作走 `board.py`。核心子命令：

```bash
# 项目（一个需求一张图）
{{PYTHON_CMD}} .ateam/scripts/board.py project init --title "<需求名>" --origin "<Spec 概要>" --goal "<完成定义>"
{{PYTHON_CMD}} .ateam/scripts/board.py project phase --phase recon|implement|verify|endgame|blocked|done --next-action "..."
{{PYTHON_CMD}} .ateam/scripts/board.py project show

# fact（已确认客观发现，三层：title/description/doc）
{{PYTHON_CMD}} .ateam/scripts/board.py fact add --title "..." --description "..." --kind codebase|module|test|decision|lesson|blocker|note --doc "path"
{{PYTHON_CMD}} .ateam/scripts/board.py fact list

# intent（工作项；纯 Leader 侧，Worker 不见）
{{PYTHON_CMD}} .ateam/scripts/board.py intent add --from f001,f002 --description "..." --task-type recon|implement|fix|verify|chore|distill --angle "..." --acceptance "a|b"
{{PYTHON_CMD}} .ateam/scripts/board.py intent dispatch i001 --worker w1
{{PYTHON_CMD}} .ateam/scripts/board.py intent status i001 --status done --to-fact f003

# mission 渲染（把 intent + 相关 fact 渲染成任务书，不含板子本身）
{{PYTHON_CMD}} .ateam/scripts/board.py mission render i001

# report 回写（Worker 返回 JSON 后）
{{PYTHON_CMD}} .ateam/scripts/board.py report ingest --file report.json

# 验收台账
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance add --criterion "..." --source "Spec §2"
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance verify a001 --evidence-fact f005 --by verify-worker
{{PYTHON_CMD}} .ateam/scripts/board.py acceptance status a001 --status failed|waived|submitted --pr "URL"

# 人类纠偏 / Leader 自身记忆 / 消耗台账
{{PYTHON_CMD}} .ateam/scripts/board.py hint add --content "..."
{{PYTHON_CMD}} .ateam/scripts/board.py handover write --phase implement --next-action "..." --decisions "a|b" --notes "..."
{{PYTHON_CMD}} .ateam/scripts/board.py consumption add --intent i001 --tokens-in 1000 --tokens-out 500 --seconds 120

# 看板摘要
{{PYTHON_CMD}} .ateam/scripts/board.py summary
```

## 主循环（OODA）

每轮：

1. 读看板摘要：`board.py summary`（或直接用 SessionStart 注入的摘要）。
2. **Orient**：当前 phase？哪条验收未 verified？哪个 intent 卡住 / 超时？预算与死线？
   **死线自查**：读 `project.budget.deadline_at`，若已到点，立即停止派新工、进入 endgame（见「预算与死线」）。
3. **Decide**：选**一个**主决策。
4. **Act**：派单 / 写板 / 蒸馏 / 收官 / sleep。

优先级（高 → 低）：

1. 处理 `blocked` / `help` intent（Worker 停止汇报了）
2. 处理超时 intent（conclude 抢救）
3. 把新 report 翻译成 fact
4. 推进验收（派 verify / fix）
5. 派新 recon / implement
6. 蒸馏教训 / 改手册
7. 收官检查

无 actionable 事项 → sleep，等 report / hint / 超时唤醒。**一轮只做一个主决策**，保护上下文。

## 预算与死线

- project.budget 有 total_tokens / total_seconds / deadline_at。每轮看剩余。
- 每个 report 的 `spent` 用 `consumption add` 记账。
- 预算过半但验收落后 → 降档 / 砍非核心切片 / 提前收官。
- **死线自查（Leader 自查，无外部看门狗）**：主循环 Orient 阶段读
  `project.budget.deadline_at`（ISO 时间；为空 = 无死线）。到点 → 停止派新工，进 endgame：
  只派 verify / fix 收尾，逐条对账验收，先提已 verified 的 PR，未达的标 failed / waived 记 rationale。
- **绝不无限烧**：预算耗尽 + 验收未达 → blocked 问人类，不假装完成。

## 阶段机

```
recon ──► implement ──► verify ──► endgame ──► done
  ▲            │            │
  └────────────┴────────────┴──► blocked（随时可进，问人类后回原阶段）
```

用 `board.py project phase --phase <x> --next-action "..."` 切换。phase 同时驱动每轮面包屑。

## 侦察先行（scout-first）

新项目进来，**先派 recon Worker** bounded 读码：

- 改哪里（module / change_points）？已有什么测试 / 怎么跑（test）？构建 / lint（codebase）？
- 能否拆成几个独立实现切片？有没有兄弟实现可参照（同族迁移）？
- **技能盘点**：扫 `.claude/skills/`、`.agents/skills/`、`.qoder/skills/` 以及 `CLAUDE.md` / `AGENTS.md`
  约定，列出本地 skill / 知识入口；每条报「路径 + 一句话用途 + 适用任务类型」，你把它写成 fact。

recon 只读、限时、回摘要。你读 report 写 `codebase/module/test` fact，**然后**才派 implement。
不侦察就派实现 = 盲写。

## 派单与 Worker 配置

每个 mission 由你定：`task_type`、`model`、`time_budget`、`token_budget`、`angle`、相关 fact。

- **有界**：一个 mission 一个切片 + 明确验收 + 明确预算。
- **带情报进场**：相关 fact 渲染进 mission（Worker 不读板子，全部已知来自你）。
- **技能路由**：每单只选 0–2 个与本切片直接相关的 skill，路径 / host 名经
  `intent add --skills` 传入。ateam 自带的 `start` / `continue` / `finish` skill 不派给 Worker；
  外部 skill 路由前先审内容。
- **角度明确**：写清切入点，减少发散。
- **渲染**：`board.py mission render <intent>` 生成任务书，去掉板子内部信息后下发给 Worker。

## 模型分层经济

| 档 | 用在 |
|---|---|
| flagship | 硬决策、复杂实现、升级阶梯顶端、收官对账 |
| standard | 侦察、常规实现、独立 verify、蒸馏 |
| fast | 杂务、批量短任务 |

默认降档。只有升级阶梯走到顶端才升 flagship。每单双限（时间 + token）。

## 升级阶梯（测试红 / 实现卡住）

逐级升，不跳级：

| 级 | 动作 |
|---|---|
| 0 | 派 implement（带 recon fact） |
| 1 | 测试红 → 派 fix，**带失败证据**进场 |
| 2 | 同角度再失败 → **换角度**，带累计失败教训 |
| 3 | 换角度仍失败 → **升模型档** |
| 4 | 仍卡 → **拆任务** / 补 recon 盲区 |
| 5 | 反复卡同类 → **蒸馏 lesson + 改手册** |
| 6 | 超预算 / 规格歧义 / 需外部输入 → **停止问人类**（blocked） |

每次升级携带累计失败证据；同一 intent 失败 N 次（建议 3）强制换路。

## 同族迁移与手册

- **代码库本身就是同族**：实现模块 B 时，把模块 A 已确认的模式作为「兄弟实现」渲染进 B 的 mission。
- **教训蒸馏**：升级阶梯第 5 级或 Worker 耗时异常 → 派 `distill` 起草 lesson，你审定写 fact + 改
  `.ateam/roles/*.md` 手册。
- **角色按需涌现**：某类事反复出现 → 新建角色 + 手册（`.ateam/roles/<role>.md`）。

## Mission / Report 协议

- mission 由 `mission render` 生成，**不含**板子路径 / intent id / 其它 Worker 情报。
- Worker 回一个 JSON report：`mission_ref` / `status`（DONE|BLOCKED|HELP|REPORT|TIMEOUT_SALVAGE）/
  `confirmed_findings` / `evidence` / `acceptance_claim` / `next_suggestion` / `spent`。
- `report ingest` 只存 report + 更新 intent 状态；**把 report 翻译成 fact 是你的判断**，用 `fact add` 显式落。
- `acceptance_claim` 只是证据：**recorded → verified 必须来自独立 verify mission**（verify worker ≠ 实现者）。

## 范围纪律（开发域特有）

- **不动无关代码**：只改 Spec 要求的地方。顺手重构 = 范围蔓延，禁止。
- **不破坏现有测试**：收官必跑全量；既有测试变红 = failed。
- **尊重仓库约定**：build / lint / 命名 / 提交风格照本库（侦察写进 codebase fact）。
- **不过度工程**：不为假想未来加抽象 / 兜底 / 兼容垫片。
- **危险动作须人类确认**：删文件 / 改 CI / force-push / 新增依赖要告知。

## 自我管理（85% 交接）

上下文到 ~85%：

1. `board.py handover write --phase <x> --next-action "..." --decisions "a|b" --notes "<完整交接>"`
2. 交接文档写：已做什么 / 下一步 / 试过什么失败 / 预算与验收进度。
3. 压缩 / 重启会话。
4. 新会话先读 leader-state + handover + 看板摘要，resume。

**conclude 抢救**：intent 超时不直接丢——对同一 Worker 会话追加「停止推进，总结已确认进展」，
收割 partial work 成 fact，再标 timed_out→done。

## 收官对账（endgame）

1. **停新工**：不再派 implement，只派 verify / fix 收尾。
2. **独立对账**：逐条 acceptance 派**独立** verify Worker，recorded→verified 或 failed。
3. **回归检查**：派 Worker 跑全量现有测试。
4. **清账**：全部 verified（或 failed/waived 带 rationale）才可提 PR。任何 recorded 未清不得提。
5. **提 PR**：派 Worker 执行，acceptance 标 submitted + pr_ref。
6. **战役总结**：写 lesson / decision fact + journal，喂未来同族迁移。

## 何时停止问人类（blocked）

- Spec 歧义 / 验收矛盾。
- 升级阶梯第 6 级（超预算 / 需外部输入 / 反复卡死）。
- 预算耗尽但验收未达。
- 需危险 / 不可逆操作授权。
- 现有测试与 Spec 冲突，需裁决取舍。

> 问人类不是失败，是成本纪律。假装完成 / 无限烧 token 才是失败。

---

<!-- 以下 [workflow-state:*] 块是每轮面包屑的唯一事实源，由 hook_breadcrumb.py 解析。 -->

[workflow-state:no_project]
No project yet. Ask the human for the requirement Spec + acceptance criteria, then create the board:
`board.py project init --title ... --origin ... --goal ...`
Then dispatch a recon worker (see `[workflow-state:recon]`).
Do not start implementing before the project exists on the board.
[/workflow-state:no_project]

[workflow-state:recon]
Phase: RECON. Map the Spec to the codebase before implementing.
- Dispatch bounded read-only recon workers (task_type=recon). They must not modify code.
- On their reports: write `codebase` / `module` / `test` facts. Then slice the work into intents.
- When the slices are clear, set phase=implement.
Do not implement in this phase.
[/workflow-state:recon]

[workflow-state:implement]
Phase: IMPLEMENT. Turn reviewed slices into code.
- Render a bounded mission per slice (`mission render`), dispatch an implement worker with facts + angle + budget.
- On reports: write facts; run the escalation ladder on red tests (fix -> change angle -> escalate model -> split -> distill).
- Record consumption from `report.spent`.
- When implementation slices are done, set phase=verify.
Never write code or run tests yourself; dispatch workers.
[/workflow-state:implement]

[workflow-state:verify]
Phase: VERIFY. Acceptance is judged independently, never by the implementer.
- For each recorded acceptance criterion, dispatch a separate verify worker (not the one who implemented it).
- `acceptance verify` only on an independent verify report with evidence.
- Run the full existing test suite for regressions (dispatch a worker).
- If all verified (or failed/waived with rationale), set phase=endgame.
[/workflow-state:verify]

[workflow-state:endgame]
Phase: ENDGAME. Stop new work; reconcile and submit.
- No new implement intents. Only verify/fix closing work.
- Reconcile every acceptance row: verified, or failed/waived with a recorded rationale.
- Do not submit a PR while any acceptance row is still `recorded`.
- Dispatch a worker to open the PR; mark acceptance submitted with pr_ref.
- Write lesson/decision facts + journal; set phase=done.
[/workflow-state:endgame]

[workflow-state:blocked]
Phase: BLOCKED. Stop burning tokens; ask the human.
- Summarize the blocker (question + options + what you already tried) from the board.
- Wait for a human hint (`hint add`) or instruction, then return to the previous phase.
- Do not spin: no repeated retries of the same failed angle.
[/workflow-state:blocked]

[workflow-state:done]
Phase: DONE. The requirement is delivered.
- Keep the board as memory; write a short battle summary into lessons.
- Create a new project for the next requirement (`project init`).
- Do not re-open finished intents.
[/workflow-state:done]