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
ateam init          # 交互勾选平台：空格切换，回车确认，Esc 取消
```

不想交互就显式指定平台：

```bash
ateam init --platform qoder,agents   # 跳过选择，只装 Qoder + 通用技能
ateam init --yes                     # CI / 脚本：不问，装默认 qoder + claude + codex
```

- 交互选择里，`.agents/skills` 是通用核心，始终装、不可取消；空选（直接回车）也合法，
  表示只装 `.ateam` 与通用技能。Esc 取消退出码 1，Ctrl+C 为 130，都不会写文件。
- `--platform` 优先级最高，不进入交互；`--yes/-y` 用于非交互环境。
- 非 TTY（CI、管道、脚本）里如果既没给 `--platform` 也没给 `--yes`，init 会报错退出并提示
  这两个参数，不写任何文件。
- 你的选择会记到 `.ateam/.platforms.json`。日后 `ateam update` 按这份记录更新，
  没选的平台不会被重新装回来。

`ateam init` 会铺出（平台目录按你的选择生成）：

```
.ateam/                # 板子 + 军规 + Python 状态脚本
  workflow.md          # Leader 军规（含每轮 [workflow-state:*] 面包屑）
  config.json          # 模型分层 / 跳过词
  memory/              # 长期记忆：派单规则、自主权、报告落盘、git 边界等
  roles/               # leader.md worker.md
  scripts/             # board.py get_context.py hook_*.py
  board/               # fact-intent 图 + 验收台账（JSON）
  workspace/           # leader-state.json + handover.md
  missions/            # mission / report 存档
  .platforms.json      # 已选平台（update 的依据；空数组=有意不装宿主平台）
.agents/skills/        # 通用技能（始终铺，Codex 等直接消费）
.qoder/                # 仅选 qoder 时：commands + skills + settings.json(hooks)
.claude/               # 仅选 claude 时：commands + skills + settings.json(hooks)
.codex/                # 仅选 codex 时：hooks.json
```

## 仓库目录结构

本仓库的目录分两类，注意区分：**跟踪的源码/资产**、**`ateam init` 在目标项目生成的目录**。不要把它们与上方「`ateam init` 会铺出」的树混淆。

### 一、随仓库跟踪的源码与资产

| 路径 | 作用 |
|---|---|
| `bin/` | CLI 入口：`bin/ateam.js`，`package.json` 的 `bin` 指向它 |
| `src/` | CLI 实现：`src/cli/index.js` 负责命令分发；`src/commands/` 为 `init` / `update` / `context` 三个命令；`src/lib/` 为 scaffold、文件与哈希、hooks 合并、平台与 Python 探测等工具 |
| `templates/` | 脚手架模板（事实源）：`templates/scaffold/` 是 `init` 铺到目标项目的文件（workflow.md、config.json、memory/、roles/、scripts/、board/、workspace/、missions/、gitignore.txt）；`templates/common/` 是跨平台命令（start / continue / finish / test-handover）与技能（start / continue / finish）；`templates/qoder/`、`templates/claude/`、`templates/codex/` 是各平台 settings / hooks 集成文件 |
| `test/` | 端到端 smoke 测试：`test/smoke.mjs` 在临时项目里跑 init（平台选择、冲突预检、`--force` / `--keep-existing`）→ board → update → force 保护 → 长期记忆 |
| `docs/` | 设计文档与产品级教训 `lessons.md`（仅本仓库维护，不随 init 铺出），见下方「设计文档」表 |

其中 `bin/`、`src/`、`templates/`、`README.md` 会随 npm 包发布（`package.json` 的 `files`）；`test/`、`docs/` 仅在仓库内使用。

特别说明：`templates/scaffold/memory/` 是长期记忆的事实源，`ateam init` 会把它铺到目标项目的 `.ateam/memory/`；`templates/scaffold/workflow.md` 的核心原则要求 Leader 会话启动先读这些文件。

### 二、`ateam init` 在目标项目生成的目录（不跟踪、不随包分发）

| 路径 | 作用 |
|---|---|
| `.ateam/` | 板子 + 军规 + Python 状态脚本：`board/`、`memory/`、`roles/`、`scripts/`、`workspace/`、`missions/`、`workflow.md`、`config.json`、`.platforms.json`（细节见上方生成树） |
| `.agents/skills/` | 通用技能（ateam-start / continue / finish），始终铺，Codex 等直接消费 |
| `.qoder/` | 选择 qoder 时生成：Qoder 命令、技能与 `settings.json`（hooks） |
| `.claude/` | 选择 claude 时生成：Claude Code 命令、技能与 `settings.json`（hooks） |
| `.codex/` | 选择 codex 时生成：Codex 的 `hooks.json` |

这些目录由 `.gitignore` 忽略。本仓库根目录当前就有一份本地生成物；clone 后执行 `npm link && ateam init` 即可重建。

### 三、根文件

| 文件 | 作用 |
|---|---|
| `README.md` | 本文件：项目介绍、快速开始、目录结构、日常使用 |
| `package.json` | npm 包元数据：`bin` 命令、`files` 发布清单、`npm run smoke`、Node 版本要求 |
| `.gitignore` | 忽略 `node_modules/`、Python 缓存、`ateam init` 生成物与本地目录 |

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

# 5. 更新模板（按 .ateam/.platforms.json 的平台选择；不覆盖你改过的文件与运行时数据）
ateam update
```

`update` 尊重 `ateam init` 时记下的平台选择：当初只选了 qoder，就不会凭空冒出 `.claude/` 或
`.codex/`；想改选择，重跑一次 `ateam init` 即可（已有文件冲突时按下文「同名文件与已有项目」处理）。
普通 `update` 只刷新没被你改过的模板文件，
本地改过的会保留并列出冲突，`update --force` 才会覆盖它们（宿主配置与运行数据仍不在此列）。
`update` 写盘前也会预检非普通目标：目标路径是目录/符号链接等会直接中止（`--force` 同样中止），
列出路径并零写入。所有命令都会先校验旗标，拼错（如 `ateam init --keep-existng`）会报
`unknown option --keep-existng` 并退出，不执行任何操作。

完整板子命令（fact / intent / acceptance / hint / handover / consumption）见
[.ateam/workflow.md 模板](templates/scaffold/workflow.md) 与 [docs/board-schema.md](docs/board-schema.md)。

## 同名文件与已有项目

在已有项目里跑 `ateam init` 是常态，不需要先清空目录。默认策略是 **先预检、冲突即停**：
写盘前逐个比对本次会写或合并的目标文件，已有文件内容与模板不同就算冲突；只要有一条冲突，
**一个文件都不写**，stderr 打印 `ateam init stopped — N existing file(s) differ from the template:`
和路径清单，退出码 1，并提示出路。逐字节相同（byte-equal）的文件不算冲突。

| 目标文件 | `init`（默认） | `init --force` | `init --keep-existing` |
|---|---|---|---|
| 与模板同名的普通文件（已存在、内容不同） | **停止**，列冲突清单并给出路，零写入 | 覆盖，写盘前先打印 `overwriting (existing): N` 和路径清单 | 保留，打印 `kept (existing): N` 和路径清单，其余文件照常安装 |
| 已存在且与模板逐字节相同 | 不算冲突，原样保留 | 照常覆盖（内容不变） | 原样保留 |
| 宿主配置：`.claude/settings.json`、`.qoder/settings.json`、`.codex/hooks.json` | 内容不同即冲突（默认停止）；相同则原样保留、不重写 | 只把 ateam 的 hooks 合并进去，你原有的配置和权限保留，永不整体覆盖 | 保留，不 merge |
| 运行数据：`.ateam/board/counters.json`、`.ateam/workspace/leader-state.json`、`.ateam/workspace/handover.md` | 永不覆盖 | 永不覆盖 | 永不覆盖 |
| 宿主配置不是合法 JSON | 内容不同即冲突（默认停止） | 警告并原样跳过，文件一个字节都不动 | 原样保留 |

清单最多列 20 条，超出部分显示 `... and N more`。`--force` 与 `--keep-existing` 互斥，
同时给出会直接报错退出、不写盘。目标路径已存在但不是普通文件（目录、符号链接等）时，
任何模式都不会写它：默认模式视为冲突停止，例外是运行数据
`.ateam/board/counters.json`、`.ateam/workspace/leader-state.json`、
`.ateam/workspace/handover.md`——它们永远原样保留，既不写入也不触发默认停止；
`--force` 对任何非普通目标都会在写盘前中止并列出这些路径（先移走/删除再跑，
`--force` 无法覆盖）；`--keep-existing` 则保留它们并安装其余文件。
`update` 也永不覆盖宿主配置与运行数据；合并失败只会产生警告，不会把文件冲掉，修好 JSON 后
重跑即可。宿主配置的 `hooks` 若是不支持的形状（例如数组），同样告警并原样保留。

**重跑 init 改平台**：`.ateam/.platforms.json` 会按新的 `--platform` 选择重写，之后的 `update`
也只刷新新选择。若之前装过、且宿主配置里已有你自己的 hooks/权限，重跑默认会因宿主配置与模板
不同而停止；这时用 `--force`（覆盖模板文件，宿主配置仍只合并）或 `--keep-existing`
（保留所有已有文件，只补缺失的）即可。

## 设计文档

| 文件 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 三角色职责（补全骨架）、mission/report 通信流、关键设计决策 |
| [docs/board-schema.md](docs/board-schema.md) | 板子（fact-intent 图）逻辑 schema、验收台账、Leader 独占写规则、JSON 物理形式 |
| [docs/leader-doctrine.md](docs/leader-doctrine.md) | Leader 军规：循环、升级阶梯、模型分层、预算、经验蒸馏、角色创建、验收收官 |
| [docs/worker-protocol.md](docs/worker-protocol.md) | Worker 协议：mission/report 格式、交接、停止汇报规则、context 管理 |
| [docs/lessons.md](docs/lessons.md) | 产品级教训：本仓库开发与维护中踩过的坑（仅仓库内参考，不随 init 铺出） |

## 核心设定（来自需求方，不可违背）

- Leader 只读板 / 判断 / 派单；可创建新角色；定 Worker 配置（工时、模型）；优化其他角色的
  工作方式与手册（可委托手下）；**独占板子写权，Worker 不知道板子存在**。
- 死线由 Leader 每轮 OODA 自查（读 `project.budget.deadline_at`），到点停止派新工、进 endgame；
  无外部看门狗脚本。
- Workers context 不足时：交接 + 压缩 + 重读交接文档；遇到问题可停止 + 向 Leader 汇报。

## 验证

```bash
npm run smoke     # 临时项目跑 init（平台选择 / 冲突预检 / keep-existing）-> board -> update -> force 保护 -> 长期记忆
```

> 使用场景是**代码开发与维护**。