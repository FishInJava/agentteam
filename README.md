# MyAgentTeam01 — ateam

**一个可安装到任意已有项目中的多 Agent 开发协作底座。** 在项目根目录跑 `ateam init`：
把 **Leader / Workers** 的板子、军规、脚本与平台集成铺进去。

- **Leader**（宿主主会话）：读板、判断、派单；**唯一写板者**；永不亲手写码 / 跑测试。
  每轮 OODA 自查死线（`project.budget.deadline_at`），到点停止派新工、进 endgame。
- **Workers**（宿主子代理）：无状态执行单元，收 mission、返 report，**不知道板子存在**。

零运行时依赖（Node ≥ 18 + Python ≥ 3.9）。板子用 JSON 文件，随 git 走、可 diff / 评审。

## 快速开始

```bash
# 在本仓库安装（零依赖，生成全局 ateam 命令）
npm link            # 或 npm install -g .

# 在任意已有项目根目录
cd your-project
ateam init          # 默认 qoder + claude + codex；通用 .agents/skills 始终铺
ateam init --platform qoder,agents   # 只装部分平台
```

`ateam init` 会铺出：

```
.ateam/                # 板子 + 军规 + Python 状态脚本
  workflow.md          # Leader 军规（含每轮 [workflow-state:*] 面包屑）
  config.json          # 模型分层 / 跳过词
  roles/               # leader.md worker.md
  scripts/             # board.py get_context.py hook_*.py
  board/               # fact-intent 图 + 验收台账（JSON）
  workspace/           # leader-state.json + handover.md
  missions/            # mission / report 存档
.agents/skills/        # 通用技能（始终铺，Codex 等直接消费）
.qoder/                # commands + skills + settings.json(hooks)
.claude/               # commands + skills + settings.json(hooks)
.codex/                # hooks.json
```

## 仓库目录结构

本仓库的目录分三类，注意区分：**跟踪的源码/资产**、**`ateam init` 在目标项目生成的目录**、**本地参考资料**。不要把它们与上方「`ateam init` 会铺出」的树混淆。

### 一、随仓库跟踪的源码与资产

| 路径 | 作用 |
|---|---|
| `bin/` | CLI 入口：`bin/ateam.js`，`package.json` 的 `bin` 指向它 |
| `src/` | CLI 实现：`src/cli/index.js` 负责命令分发；`src/commands/` 为 `init` / `update` / `context` 三个命令；`src/lib/` 为 scaffold、文件与哈希、hooks 合并、平台与 Python 探测等工具 |
| `templates/` | 脚手架模板（事实源）：`templates/scaffold/` 是 `init` 铺到目标项目的文件（workflow.md、config.json、roles/、scripts/、board/、workspace/、missions/、gitignore.txt）；`templates/common/` 是跨平台命令（start / continue / finish / test-handover）与技能（start / continue / finish）；`templates/qoder/`、`templates/claude/`、`templates/codex/` 是各平台 settings / hooks 集成文件 |
| `test/` | 端到端 smoke 测试：`test/smoke.mjs` 在临时项目里跑 init → board → update → force 保护 |
| `docs/` | 设计文档，见下方「设计文档」表 |

其中 `bin/`、`src/`、`templates/`、`README.md` 会随 npm 包发布（`package.json` 的 `files`）；`test/`、`docs/` 仅在仓库内使用。

### 二、`ateam init` 在目标项目生成的目录（不跟踪、不随包分发）

| 路径 | 作用 |
|---|---|
| `.ateam/` | 板子 + 军规 + Python 状态脚本：`board/`、`roles/`、`scripts/`、`workspace/`、`missions/`、`workflow.md`、`config.json`（细节见上方生成树） |
| `.agents/skills/` | 通用技能（ateam-start / continue / finish），始终铺，Codex 等直接消费 |
| `.qoder/` | Qoder 命令、技能与 `settings.json`（hooks） |
| `.claude/` | Claude Code 命令、技能与 `settings.json`（hooks） |
| `.codex/` | Codex 的 `hooks.json` |

这些目录由 `.gitignore` 忽略。本仓库根目录当前就有一份本地生成物；clone 后执行 `npm link && ateam init` 即可重建。

### 三、本地参考资料（不进入仓库）

| 路径 | 作用 |
|---|---|
| `Cairn-main/` | 本地 clone 的参考实现，已被 `.gitignore` 忽略，不在仓库与 npm 包中 |
| `sapper-v2-master/` | 本地 clone 的参考实现，已被 `.gitignore` 忽略，不在仓库与 npm 包中 |

### 根文件

| 文件 | 作用 |
|---|---|
| `README.md` | 本文件：项目介绍、快速开始、目录结构、日常使用 |
| `package.json` | npm 包元数据：`bin` 命令、`files` 发布清单、`npm run smoke`、Node 版本要求 |
| `.gitignore` | 忽略 `node_modules/`、Python 缓存、`ateam init` 生成物与本地参考实现 |

（`.git/` 仅为 Git 元数据目录，不参与上述分类。）

## 日常使用

```bash
# 1. 建需求项目（一个需求 = 一张图）
python .ateam/scripts/board.py project init \
  --title "<需求>" --origin "<Spec 摘要>" --goal "<完成定义>"

# 2. 看板摘要（宿主 SessionStart 也会自动注入）
python .ateam/scripts/get_context.py
ateam context

# 3. 派单：渲染 mission 给 Worker（Worker 只拿任务书，看不到板子）
python .ateam/scripts/board.py mission render i001

# 4. 死线自查（Leader 每轮 OODA 内执行，读 budget.deadline_at，到点进 endgame）
#    见 .ateam/workflow.md「预算与死线」

# 5. 更新模板（不覆盖你改过的文件与运行时数据）
ateam update
```

完整板子命令（fact / intent / acceptance / hint / handover / consumption）见
[.ateam/workflow.md 模板](templates/scaffold/workflow.md) 与 [docs/board-schema.md](docs/board-schema.md)。

## 设计文档

| 文件 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 三角色职责（补全骨架）、mission/report 通信流、关键设计决策 |
| [docs/board-schema.md](docs/board-schema.md) | 板子（fact-intent 图）逻辑 schema、验收台账、Leader 独占写规则、JSON 物理形式 |
| [docs/leader-doctrine.md](docs/leader-doctrine.md) | Leader 军规：循环、升级阶梯、模型分层、预算、经验蒸馏、角色创建、验收收官 |
| [docs/worker-protocol.md](docs/worker-protocol.md) | Worker 协议：mission/report 格式、交接、停止汇报规则、context 管理 |

## 核心设定（来自需求方，不可违背）

- Leader 只读板 / 判断 / 派单；可创建新角色；定 Worker 配置（工时、模型）；优化其他角色的
  工作方式与手册（可委托手下）；**独占板子写权，Worker 不知道板子存在**。
- 死线由 Leader 每轮 OODA 自查（读 `project.budget.deadline_at`），到点停止派新工、进 endgame；
  无外部看门狗脚本。
- Workers context 不足时：交接 + 压缩 + 重读交接文档；遇到问题可停止 + 向 Leader 汇报。

## 验证

```bash
npm run smoke     # 在临时项目跑 init -> board -> update -> force 保护
```

> 使用场景是**代码开发与维护**。