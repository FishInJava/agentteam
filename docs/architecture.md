# 架构与角色职责

> 需求方起头的 Leader / Workers 骨架（Watchdog 已删除，死线自查并入 Leader OODA）。
> 职责细节见各角色专 spec。

## 运行时形态（底座无关）

```
                ┌───────────┐
                │  人（需求方）│  Spec + 验收标准 + hint 纠偏
                └─────┬─────┘
                      │ 需求 / 纠偏
                ┌─────▼─────────────────┐
                │   Leader（指挥 Agent）  │
                │   读板 → 判断 → 派单     │◄──── report（结构化汇报）
                │   独占板子写权          │
                │   永不亲手执行          │────► mission（任务书）
                │   每轮 OODA 自查死线     │
                └─────┬─────────────────┘
                      │ 读 / 写
                ┌─────▼─────────────────┐
                │   板子（fact-intent 图） │   Leader 私有记忆，Worker 无感知
                │   + 验收台账 + 手册库    │
                └───────────────────────┘
                      │ mission 下行 / report 上行
        ┌─────────────┼─────────────────┐
   ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
   │ Worker A │       │ Worker B │       │ Worker C │   无状态执行单元
   │ 实现/修复 │       │ 侦察/验证 │       │ 杂务/手册 │   只收 mission 返 report
   └─────────┘       └─────────┘       └─────────┘   不知道板子存在
```

## 通信流（只有两条，都经 Leader 中介）

1. **mission 下行**（Leader → Worker）：Leader 从板子提取相关 fact，渲染成任务书下发。
   Worker 拿到的是「目标 + 相关已知 + 约束 + 验收 + 预算 + 角度」，**不是板子本身**。
2. **report 上行**（Worker → Leader）：Worker 返回结构化汇报（状态 + 确认发现 + 证据 +
   下一步建议 + 耗时耗量）。Leader 据此写板（fact / intent / 验收状态）。

Worker 之间**不直接通信**；跨 Worker 的情报传递由 Leader 通过 mission 携带（把 A 的确认
发现写进给 B 的任务书）。这是层级中介的 stigmergy——共享状态在板子上，但读写都过 Leader。

## 角色职责

### Leader（指挥）

- **只读板、判断、派单。永不亲手写码 / 跑测试 / 改 bug。** 凡触碰代码库的动作都派给 Worker。
  它的直接动作仅限：读板、读 report、下发 mission / 调整配置、写板、维护手册库、sleep。
- **Context 宝贵**：上下文只装看板摘要与 report 摘要，不装代码 diff / 测试全量输出。
- **定 Worker 配置**：每个 Worker 的工时（时间预算）、模型、角度、任务类型由 Leader 决定。
- **优化其他角色**：发现某 Worker 干一件事耗时异常 → 蒸馏教训、改写工作手册（可委托一个
  Worker 去做这件事，Leader 审定）。
- **创建新角色**：发现某类事反复出现 → 定义一个新角色 + 手册（按需涌现，不预先堆满）。
- **独占板子写权**：只有 Leader 能改板子；Worker 不知道板子存在。Leader 是 report → fact 的
  唯一翻译者与写入者。
- 详见 [leader-doctrine.md](leader-doctrine.md)。

### Workers（AI 军团）

- **无状态执行单元**：收 mission、干活、返 report。不知道板子存在，不直接读写图。
- **任务形态**：侦察（bounded 读码）、实现 / 修复、验证、杂务（有界短任务）、手册蒸馏。
- **Context 管理**：不足时写交接文档（已做 / 下一步 / 试过什么失败）→ 压缩 → 重读交接文档续工；
  超时则由 Leader 触发 conclude 抢救已确认进展。
- **停止 + 汇报**：遇到卡住 / 超预算 / 需决策时，停止并向 Leader 发结构化 report（HELP / BLOCKED）。
- 详见 [worker-protocol.md](worker-protocol.md)。

## 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 协调范式 | 层级 Leader 中介（非纯 stigmergy） | Leader 中介可控制记忆质量；单一写者无并发竞态 |
| Worker 是否见板子 | **否** | Worker 保持简单无状态、context 不被图污染；板子质量由 Leader 把关；Worker 无法腐化板子 |
| 板子写者 | **仅 Leader** | 单一写者 = 单一验收判定契约，避开「实现者自证验收」的双标漏洞 |
| 死线检查归谁 | **Leader 每轮 OODA 自查** | 看门狗已删除：被动脚本无终端控制权，拉不真 Leader；自查零成本且语义真实 |
| Leader 是否执行 | **否** | 上下文不被代码 / 测试输出淹没，长时间不退化 |
| 记忆物理形式 | **JSON 文件 per 实体（已落定）** | 随 git 走、可 diff / 评审；单写者下 temp+rename 原子写即可；二进制 SQLite 不便评审 |
| 预算约束 | **必须有** | 全局 token / 时间预算 + 模型分层，补齐成本纪律 |

## 一次需求的端到端流

1. 人提交需求 + Spec + 验收标准 → Leader 建项目（Origin=Spec+代码库现状，Goal=验收标准）。
2. Leader 派**侦察 Worker** bounded 读码：把 Spec 映射到代码现实（改哪里、有什么测试、难度）。
3. Leader 读侦察 report，按难度派**实现 Worker**（带相关 fact + 兄弟实现进场）。
4. 实现 Worker 返 report → Leader 写 fact；测试红 → 按升级阶梯派修复 / 换角度 / 升级模型。
5. 验收标准逐条追踪（recorded → verified）；最后阶段停新工、独立**验证 Worker** 对账每条验收。
6. 全部验收 verified → Leader 触发提 PR；写战役总结入库。