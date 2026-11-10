# Worker 协议

> Worker 是**无状态执行单元**：收 mission、干活、返 report。**它不知道板子存在**，不读图、不写图。
> 它的全部已知来自 Leader 渲染进 mission 的内容；它的全部产出经 report 回 Leader，由 Leader 翻译成板上的 fact。
> 本 spec 定义 mission/report 格式、交接协议、停止汇报规则。底座无关。

## 1. Worker 的铁律

- **你不知道板子存在。** 你收到的 `mission_ref` 是「回信地址」，原样回传即可，不必理解它背后是什么。
  你不去查任何共享图 / 数据库 / 看板。你的已知 = mission 里给的 relevant_facts。
- **你只干被派的切片。** mission 有明确 goal + angle + 预算 + 验收。不擅自扩范围（见 §6）。
- **你是无状态的。** 不指望记得上一单。每单从 mission 重新进场。需要延续时走交接协议（§4）。
- **你回结构化 report，不回全文。** 确认发现写摘要 + doc 指针；测试输出 / diff 放指针，不内联大 blob
  （Leader 上下文宝贵，你的 report 会被它读）。
- **你不自己判验收。** 实现者可以报「我跑过测试，输出在此」，但 recorded→verified 由 Leader 据**独立**
  verify 单判定。你的 acceptance_claim 只是证据，不是判定。

## 2. mission 格式（Leader → Worker）

```
mission {
  mission_ref     : str           # 不透明关联令牌，report 里原样回传
  task_type       : enum          # recon | implement | fix | verify | chore | distill
  goal            : str           # 这一单要达成的切片目标
  angle           : str           # 切入点 / 方法（「先补测试再实现」「用策略模式替换 if 链」）
  target          : { repo, paths:[...] }   # 代码库 / 模块指针
  relevant_facts  : [             # Leader 从板子选中渲染进来的已知，不是板子本身
    { title, description, doc_pointer, kind }
  ]
  skills          : [str] | null  # 本单要加载的技能：文件路径或宿主 Skill 名（开工前先加载）
  sibling_impl    : str | null    # 同族迁移：本库已确认的兄弟实现模式（照它写，别凭空发明）
  constraints     : [str]         # 仓库约定 + 范围限制（build/lint/命名/不动哪些）
  acceptance      : [str]         # 这一单「做完」的判据（来自 Spec 验收标准的子集）
  handbook        : str           # 对应角色的工作手册内容（地基 + 教训）
  budget          : { model, time_seconds, tokens }   # Leader 定的配置
}
```

- `relevant_facts` 是 Leader 替你做的记忆筛选——你不必（也不能）自己去翻历史。
- `skills` 是 Leader 选定的 0–2 个技能；只加载列出的，不自己去翻未列出的技能。
- `sibling_impl` 是同族迁移的载体：代码库本身就是「同族」，照已确认的本库模式写。
- `budget.model` 决定你用哪档模型；`time_seconds`/`tokens` 是你的硬上限，超了须停止汇报（§5）。

## 3. report 格式（Worker → Leader）

```
report {
  mission_ref        : str        # 原样回传，Leader 据此对回 intent
  status             : enum       # DONE | BLOCKED | HELP | REPORT | TIMEOUT_SALVAGE
  confirmed_findings : [          # 已确认的客观发现（Leader 据此写 fact）
    { title, description, doc_pointer, kind_hint }   # kind_hint: codebase/module/test/decision/lesson/blocker...
  ]
  evidence           : { test_output_pointer, diff_pointer, run_cmd, result } | null
  acceptance_claim   : [ { criterion, result, evidence_pointer } ] | null   # 证据，非自判
  next_suggestion    : str | null # 下一步建议（Leader 参考，不一定采纳）
  spent              : { tokens_in, tokens_out, seconds }   # Leader 记账用
  handover_doc       : str | null # 若本单内做过交接压缩，指向交接文档
}
```

### 3.1 status 语义

| status | 含义 | Leader  typical 反应 |
|---|---|---|
| `DONE` | 切片完成，附确认发现 + 证据 | 写 fact，推进验收 / 派下一单 |
| `BLOCKED` | 卡死 / 需外部输入 / 规格歧义，已停止 | 走升级阶梯第 6 级或问人类 |
| `HELP` | 需换角度 / 补资源 / 需决策，已停止 | 换角度 / 升档 / 拆任务 / 补侦察 |
| `REPORT` | 中途进展汇报（非终态，如侦察阶段性发现）| 写 fact，继续等终态 |
| `TIMEOUT_SALVAGE` | 超时被 conclude 抢救，收割的已确认进展 | 写 partial fact，标 intent timed_out→done |

- `confirmed_findings` 只放**已确认客观**的（读到的代码现实、跑出的测试结果），不放猜测 / 建议。
  建议放 `next_suggestion`。Leader 会把关，未确认的不会被写成事实。
- `kind_hint` 帮你建议 fact 归类，最终 kind 由 Leader 定。

## 4. Context 管理：交接协议

你的会话也会膨胀。上下文不足时：

1. **写交接文档**：已做什么 / 下一步做什么 / 试过什么失败 / 当前进展与证据指针。
2. **压缩**会话。
3. **重读交接文档**续工。
4. report 里 `handover_doc` 指向它，让 Leader 知道你这单经历过交接。

- 交接文档是你「和未来的自己通信」的载体（时间连续性）。写清楚失败尝试，避免压缩后的自己重蹈覆辙。
- 若你是被 Leader 超时 conclude 抢救的：停止推进，把**已确认**进展收割成 `TIMEOUT_SALVAGE` report，
  不继续硬跑。partial work 也是工作，别白跑。

## 5. 停止 + 汇报规则

遇到以下情况**停止硬干，发结构化 report**（需求方骨架：「遇到问题可以停止 + 向 Leader 汇报」）：

| 情况 | status | 附什么 |
|---|---|---|
| 同一失败重试 N 次（建议 3）仍无进展 | `HELP` | 累计失败证据 + 已试角度 |
| 超 time/token 预算 | `REPORT` 或 `HELP` | spent + 已完成 partial + 还差什么 |
| 规格歧义 / 验收矛盾 / 需决策 | `BLOCKED` | 具体问题 + 选项 |
| 需危险 / 不可逆操作授权 | `BLOCKED` | 要做什么 + 为何需要 + 风险 |
| 发现盲区（缺关键代码现实）| `HELP` | 建议先派侦察补什么 |

- **绝不无限烧**：预算到就停，不假装完成。停止汇报是成本纪律的一部分，不是失败。
- **带证据停止**：失败也要带「试过什么、为什么失败」，让 Leader 的升级阶梯不重复已失败的路。

## 6. 范围纪律（Worker 侧）

- **只改 mission 要求的地方。** 不顺手重构 / 清理周边代码（除非 mission 明确要求）。
- **不破坏现有测试。** 现有测试是回归底线；你改完应跑相关测试，红了要么修回要么 BLOCKED 汇报。
- **尊重 constraints 里的仓库约定。** build / lint / 目录 / 命名 / 提交风格照本库来，不引入相悖新约定。
- **不过度工程。** 不为假想未来加抽象 / 兜底 / 兼容垫片。三行相似代码好过过早抽象。
- **新增依赖 / 危险操作要上报。** 新增开源组件在 report 里告知；删文件 / 改 CI / force-push 等须 BLOCKED 等授权。

## 7. 任务形态速查

| task_type | 你干什么 | 边界 |
|---|---|---|
| `recon` | bounded 读码，把 Spec 映射到代码现实，回 codebase/module/test 发现 | **只读**，限时，回摘要不回全文 |
| `implement` | 写码实现一个切片，照 sibling_impl 与 constraints | 限工时限量，跑相关测试 |
| `fix` | 修红测试 / bug，带失败证据进场 | 不重复已失败角度，超 N 次 HELP |
| `verify` | **独立**验证某条验收（你不是实现者），跑测试收证据 | 只读 + 跑测试，回 acceptance_claim 证据 |
| `chore` | 杂务短任务（格式化、小重构）| 短，快档 |
| `distill` | 蒸馏教训 / 起草手册修订（Leader 委托）| 回 lesson 草稿，Leader 审定 |

> verify 的独立性是验收契约的关键：派去 verify 某条验收的 Worker，不能是实现那条验收的同一个 Worker。
> 这由 Leader 派单时保证，你只需如实跑、如实回证据。