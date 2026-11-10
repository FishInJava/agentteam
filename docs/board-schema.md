# 板子 Schema（fact-intent 图 + 验收台账）

> 板子是 **Leader 的私有记忆与控制面**。Worker 不知道它存在，只通过 mission/report 与
> Leader 交互。本 spec 定义**逻辑模型**（实体、字段、关系、状态机、写规则），底座无关；
> 末尾给出**物理形式**（已落定为 JSON 文件，见 §9）。

## 0. 为什么是图，不是一条长会话

单 Agent 的循环（写码→跑测试→改 bug→loop）把全部历史塞进一条会话，越跑越降智、重启即失忆。
板子把「已确认的客观发现」沉淀成 **fact 节点**，把「待探索的工作方向」沉淀成 **intent 边**，
图从 `origin`（Spec + 代码库现状）生长到 `goal`（验收达成）。每次开工只读相关子图，不读全量历史。
这就是「记忆 = 跨间隙的通信」在空间（多 Worker）与时间（重启 / 压缩后的 Leader）两个维度的落地。

## 1. 实体总览

| 实体 | 角色 | 谁写 | 谁读 |
|---|---|---|---|
| Project | 一个需求 = 一张图，含 origin/goal/预算 | Leader | Leader |
| Fact | 已确认客观发现（节点），三层结构 | **仅 Leader** | Leader（摘要）；Worker 只读 mission 里被选中的 fact |
| Intent | 声明的工作方向 / 工作项（边） | **仅 Leader** | Leader；Worker 只见渲染后的 mission |
| Acceptance | 验收台账，逐条 tracked | **仅 Leader** | Leader；独立 verify Worker 提供证据 |
| Hint | 人类中途注入的方向 / 纠偏 | 人类（经接口）| Leader |
| Role / Handbook | 角色定义 + 工作手册库 | Leader（可委托蒸馏，Leader 审定）| Leader；手册内容随 mission 下发 |
| Consumption | token / 时间消耗流水 | Leader（据 report 记账）| Leader（死线自查） |
| LeaderState | Leader 自身交接快照（时间连续性）| Leader | Leader（重启 / 压缩后，经 SessionStart 注入摘要恢复）|

## 2. Fact —— 三层结构（上下文经济）

 一个 fact 分三层，按需展开，避免 Leader 上下文被全文淹没。

| 层 | 字段 | 用途 | 进 Leader 看板摘要？ |
|---|---|---|---|
| 标题层 | `title` | 一句话，看板列表只显示它 | ✅ 是 |
| 描述层 | `description` | 确认的发现本身，中等长度 | 按需（判断时展开）|
| 详情层 | `doc` | 全文 / 文件路径 / diff / 日志摘录的**指针** | ❌ 否（Worker 才需要时去读）|

字段：

```
fact {
  id            : f###（项目内自增）
  project_id
  title         : str            # 一句话，看板用
  description   : str            # 确认的发现
  doc           : str | null     # 详情指针（路径/摘录），不内联大 blob
  kind          : enum           # 见下表（开发域）
  data          : object         # kind 专属结构化载荷
  created_at    : iso8601
  creator       : str            # 来源 worker / leader（审计用）
  source_intent : i### | null    # 由哪个 intent 产出（origin/goal 为 null）
}
```

### 2.1 开发域 fact kinds

| kind | 含义 | data 典型字段 |
|---|---|---|
| `codebase` | 仓库结构 / 构建系统 / 约定 | `{repo, build, test_cmd, lint_cmd, conventions}` |
| `module` | 某模块 / 文件的职责、接口、改哪里 | `{path, responsibility, interfaces, change_points}` |
| `test` | 现有测试覆盖 / 如何跑 / 某测试行为 | `{path, run_cmd, covers, status}` |
| `decision` | 已定的设计取舍 | `{choice, alternatives, rationale}` |
| `lesson` | 蒸馏的教训（什么失败 / 什么有效）| `{situation, failed, worked, rule}` → 喂手册 / 同族迁移 |
| `blocker` | 需 Leader 决策或外部输入的障碍 | `{question, options, needs}` |
| `acceptance` | 某条验收的证据快照（链接台账）| `{acceptance_id, evidence, result}` |
| `note` | 杂项确认发现 | `{}` |

> 没有 `flag` kind。开发域的「flag」是 **Acceptance 台账条目**，单独建模、单独判定（见 §4），
> 不混进普通 fact，从根上避开「实现者自证验收」的双标漏洞。

### 2.2 特殊节点 origin / goal

- `origin`：项目起点 fact，`description` = Spec 全文摘要 + 代码库指针，`doc` = Spec 文件路径。
- `goal`：项目终点定义，`description` = 高层完成定义，逐条验收标准落在 Acceptance 台账。
- 二者 `source_intent = null`，建项目时由 Leader 一次性写入。

## 3. Intent —— 工作项 / 边（纯 Leader 侧）

Intent 是 Leader 内部的派单与追踪记录。**Worker 看不到 intent，也看不到板子**；Leader 把
intent + 选中的 fact 渲染成 mission 下发，Worker 回 report，Leader 写回 intent 并产出 fact。

```
intent {
  id              : i###（项目内自增）
  project_id
  from            : [f###]        # 建立在哪些 fact 上（图的边）
  to              : f### | null   # 产出的 fact；null = 未完成
  description     : str           # 要做什么
  task_type       : enum          # recon | implement | fix | verify | chore | distill
  angle           : str           # 具体角度 / 切入点（同族迁移时带兄弟实现）
  creator         : leader
  worker          : str | null    # 指派的 worker；null = 未派
  mission_ref     : str           # 不透明关联令牌，Worker 原样回传以便 Leader 对账
                                  #（Worker 视其为「回信地址」，不知它是板子节点）
  status          : enum          # open | dispatched | running | done | cancelled | timed_out
  model           : str           # Leader 定的模型分层
  time_budget     : seconds       # Leader 定的工时
  token_budget    : int           # Leader 定的量预算
  created_at, dispatched_at, concluded_at : iso8601 | null
  report          : object | null # Worker 返回的结构化汇报（存档审计）
}
```

### 3.1 状态机

```
open ──派单──► dispatched ──Worker开工──► running ──回report──► done（to=fact）
                  │                          │
                  │                          ├──超时──► timed_out ──conclude抢救──► done（收割已确认fact）
                  └──取消──► cancelled        └──Worker停止汇报──► done（to=blocker/lesson fact）
```

- **conclude 抢救**（超时抢救）：intent 超时不直接丢，Leader 对**同一会话**追加
  override 指令「停止推进，总结已确认进展」，把 partial work 收割成 fact，避免白跑。
- `mission_ref` 让 Worker 无需知道板子就能把 report 对回到正确 intent。

### 3.2 task_type 与默认形态

| task_type | 干什么 | 典型模型档 | 有界性 |
|---|---|---|---|
| `recon` | bounded 读码，把 Spec 映射到代码现实 | 中/快 | 只读，限时 |
| `implement` | 写码实现一个切片 | 旗舰/强 | 限工时限量 |
| `fix` | 修红测试 / bug，带失败证据进场 | 按升级阶梯升档 | 限量 |
| `verify` | **独立**验证某条验收（非实现者自检）| 中/强 | 只读+跑测试 |
| `chore` | 杂务短任务（格式化、小重构）| 快 | 短 |
| `distill` | 蒸馏教训 / 改写手册（Leader 委托）| 中 | 短 |

## 4. Acceptance —— 验收台账（开发域的 flag ledger）

逐条追踪 Spec 里的验收标准。**判定独立性**是核心纪律：实现者不能自证验收。

```
acceptance {
  id              : a###（项目内自增）
  project_id
  criterion       : str           # 验收标准原文（来自 Spec）
  source          : str           # Spec 哪一节 / 谁定的
  status          : enum          # recorded | verified | submitted | failed | waived
  evidence_fact   : f### | null   # 证明它的 fact（如测试通过输出快照）
  verified_by     : str | null    # 哪个独立 verify worker / 何种手段
  verified_at     : iso8601 | null
  pr_ref          : str | null    # 提交后填 PR 链接 / 号
}
```

### 4.1 状态机与判定纪律

```
recorded ──独立verify通过──► verified ──提PR──► submitted
    │                          │
    ├──verify失败──► failed     └──对账发现回归──► failed（打回）
    └──Leader决定豁免──► waived（须记 rationale）
```

- **recorded → verified 只能由独立 verify mission 的 report 触发**，不能由 implement worker
  自报「我测过了就算过」。Leader 是唯一写者，且必须看到 `task_type=verify` 且 `worker != 实现者`
  的证据才改状态。→ 从契约层杜绝「实现者自标通过」的双标。
- **收官对账**：结束前 Leader 停新工，逐条核对所有 acceptance 是否 verified；任何 failed/recorded
  未清不得提 PR（见 leader-doctrine 收官节）。

## 5. Hint —— 人类中途纠偏

```
hint { id, project_id, content, creator:human, created_at }
```

人类可随时注入方向（「先别动 X 模块」「这个验收改用集成测试证」）。Leader 每轮循环读新 hint，
据此调整派单 / 改台账。写入者是**人类**，不是 Worker。

## 6. Role / Handbook —— 角色与手册库

```
role     { id, name, mandate, default_model, default_task_types:[...], handbook_id }
handbook { id, role_id, version, content, updated_at, updated_by }
```

- Leader 发现某类事反复出现 → 建 role + 初版 handbook（按需涌现，不预先堆满）。
- Leader 发现某 Worker 耗时异常 → 派 `distill` mission 让一个 Worker 起草手册修订，**Leader 审定**
  后写库（version++）。手册内容随 mission 下发给对应角色 Worker。
- 手册是「给地基不给满规则」的载体：写协作机制与教训，不写事无巨细的脚本。

## 7. Consumption / LeaderState —— 预算与时间连续性

```
consumption { id, project_id, intent_id, worker, model, tokens_in, tokens_out,
              seconds, recorded_at }                 # 据 report 记账，Leader 汇总
project.budget { total_tokens, total_seconds, deadline_at }

leader_state { project_id, phase, open_intents:[i###], next_action,
               recent_decisions:[...], handover_doc, updated_at }
```

- `consumption` 让 Leader 每轮判断「还剩多少预算」与死线（OODA 自查），决定降档 / 收官。
- `leader_state` 是 Leader 的**交接快照**：85% 上下文压缩时写它，重开 Session 时 SessionStart hook
  注入看板摘要，新 Leader 读 leader_state + 交接文档续工，实现「和未来的自己通信」。
  `handover_doc` 指向完整交接文档（已做/下一步/试过什么失败）。

## 8. 写规则（不可违背）

1. **只有 Leader 写板子。** Fact / Intent / Acceptance / Role / Handbook / Consumption / LeaderState
   全部由 Leader 落笔。Worker 无任何板子写路径，也不知道板子存在。
2. **report → fact 是唯一翻译入口。** Worker 的确认发现经 Leader 判断后才成 fact；Leader 可拒绝
   把未确认 / 自报验收的内容写成 verified。
3. **验收判定独立性。** recorded→verified 必须有独立 verify 证据（§4.1）。
4. **单一写者 = 无并发竞态。** 因为只有一个写者，物理层不需要文件锁；temp+rename 原子写即可。
5. **看板摘要只读标题层。** Leader 每轮只加载 fact.title + open intent + acceptance 状态 + 新 hint，
   不加载 description/doc 全文，保护上下文（§2）。

## 9. 物理形式（已落定）：JSON 文件 per 实体

实现采用 **JSON 文件 per 实体**（文件式，随 git 走），一个需求一棵目录：

```
.ateam/board/
  project.json          # 项目元信息 + phase + budget
  counters.json         # 各实体自增计数
  facts/f###.json
  intents/i###.json
  acceptance/a###.json
  hints/h###.json
  consumption.json      # 消耗流水（列表）
```

理由：

- **随 git 走、可 diff / 评审**：板子是团队记忆，PR 里能看懂它变了什么。二进制 SQLite 做不到。
- **单一写者无并发**：只有 Leader 写；`board.py` 用 temp + `os.replace` 原子写，无需 flock。
- **脚本即查询**：摘要 / 过滤由 `board.py` / `get_context.py` 读目录聚合，量级足够。
- **跨平台**：不依赖 POSIX-only 的文件锁，Windows 可用。

> 运行时文件 `workspace/leader-state.json` / `handover.md` / `board/counters.json` 受 init 保护，
> `--force` 与 `ateam update` 都不会覆盖。逻辑模型不变；若换 SQLite 只是物理映射替换。

## 10. 看板摘要（Leader 每轮读的东西）

一次循环 Leader 加载的**不是全图**，而是一份摘要视图：

```
project: {title, phase, budget_remaining, deadline_remaining}
facts:   [ {id, kind, title} ]            # 仅标题层
open_intents: [ {id, task_type, worker, status, elapsed} ]
acceptance: [ {id, criterion_short, status} ]
new_hints: [ {content, created_at} ]
recent_reports: [ {mission_ref, status, summary} ]   # 待翻译写板的 report
```

这份摘要 + 当前判断 = Leader 的全部上下文负担。代码 diff、测试全量输出、fact 全文**永不进**
Leader 上下文——需要时派 Worker 去读，Worker 回摘要。这是「Leader Context 宝贵」的物理保障。