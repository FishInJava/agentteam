# ateam 开发教训（产品级）

按时间倒序，记录 ateam 自身演进中值得永久保留的教训。板子（`.ateam/`）是生成物不入库，
因此产品级教训必须落到本文件。

## 2026-11-11 — 长期记忆注入（文件存在 ≠ 自动加载）

### 根因

- `ateam init` 一直会铺 `.ateam/memory/*.md`，但没有任何组件把它们送进 Leader 上下文：
  SessionStart hook 只注入看板摘要与 handover，`workflow.md` 仅要求 Leader「会话启动先读」，
  依赖模型自觉，实际经常不读——文件存在不等于会生效。
- 原生 Claude memory 按**项目目录**作用域（`~/.claude/projects/<project-dir>/memory/`），团队
  仓库里的 `.ateam/memory/` 不在其自动加载路径上，因此必须显式注入。

### 修复

- `hook_session_start.py`：`.ateam` 存在时读取 `.ateam/memory/*.md`（按文件名排序、跳过空文件），
  以 `## Long-term memory (.ateam/memory)` 段追加到 `additionalContext`，位置在看板摘要之后、
  handover 之前；每个文件渲染为 `### <filename>` + 内容原文。JSON 输出契约与无 `.ateam` 行为不变。
- 新增 `templates/scaffold/memory/leader-boundary-leniency.md`（Leader 读取边界放宽）；
  `workflow.md` 原则 6 改为「hook 自动注入，注入段缺失才手动读」。
- smoke：初始化项目断言注入段与记忆原文（`Leader 派单规则`、`Leader 读取边界`）；删除
  `.ateam/memory/*.md` 后重跑 hook，断言该段消失且 handover 仍注入；无 `.ateam` 用例保持原样。

### 教训

- 记忆/上下文类资产必须验证「真的进了上下文」，只断言文件存在是假验证；端到端断言要落在宿主
  可见的 `additionalContext` 上。
- Worker 无长期记忆是**设计**：只有 Leader 会话注入 memory；Worker 仍靠 mission 内嵌的 fact
  获取情报（规格注入而非记忆），不要顺手给 Worker 加记忆。

### 记忆分层（2026-11-11 定）

- 全局规则 → 本仓库 `templates/scaffold/memory/`，push GitHub，`init/update` 下发；
  项目业务规则 → 目标项目 `.ateam/memory/project-*.md`，随项目仓库走，不上游。
- 理由：不同项目的业务规则会冲突；脚手架仓库只应存放跨项目稳定的行为准则。
- 验证：w4 实测 `project-demo.md` 在 `ateam update` 后字节不变，且上游模板不含该文件。

## 2026-11-10 晚 — smoke 封闭性（宿主 PROJECT_DIR 环境泄漏）

### 根因

- `hook_session_start.py` 的 `_project_root` 优先读 `QODER/CLAUDE/CODEX/ATEAM_PROJECT_DIR`，其次
  `payload.cwd`；`.ateam` 不存在时静默 `return 0`。Agent 宿主注入的 `CLAUDE_PROJECT_DIR` 被
  smoke 的 `hookRun` 继承 → hook 解析到没有 `.ateam` 的目录 → 空 stdout → `JSON.parse` 抛
  无指向的 `SyntaxError`（旧 `test/smoke.mjs:857`）。
- 教训：测试进程必须与宿主环境隔离；任何「从环境变量推断项目根」的组件都会把宿主状态带进测试。

### 修复

- smoke：四变量常量化；模块顶部从 `process.env` 删除；`hookRun` 显式传剥净的 env，并设
  `PYTHONDONTWRITEBYTECODE=1` 防测试写模板 `__pycache__`。回归用例逐一污染四个变量后仍注入
  真实 handover；无 `.ateam` 用例断言 exit 0 / stdout 空 / stderr 含诊断。
- hook：缺 `.ateam` 时 stderr 打印解析路径与来源（环境变量名或 `cwd`），仍 exit 0、stdout 空；
  正常路径的 JSON 输出与旧版逐字节一致（实测 631 bytes）。
- 验证法：在旧 commit 的临时 `git worktree` 里用污染 env 复现崩溃（exit 1），再在新分支同条件
  PASS——证明回归用例有真实失败模式，而不是空断言。
- 手动直接运行模板 hook 且不设 `PYTHONDONTWRITEBYTECODE=1` 会生成
  `templates/scaffold/scripts/__pycache__`（标准 Python 行为）；suite 内已规避，不要提交该目录。

### 开源卫生

- 全历史扫描（21 个提交）未发现盘符、绝对路径、用户名、home 目录或 IP：`G:\`、`C:/Users`、
  `000WorkWork`、`admin` 均零命中。原有本地痕迹只有 README 的本地参考目录表与 lessons 一处
  提及，已移除/泛化；`.gitignore` 保留两个本地目录条目（防止本地 clone 变 untracked），
  提交作者邮箱仍存在于 git 元数据（是否改写由用户决定）。

## 2026-11-10 晚 — 审计 Batch 2（清理静默失败）

### 修复内容

- `update` 非普通目标：任何 merge / 写盘之前 lstat 全部已存在目标；目录、符号链接、不可读
  目标即中止，stderr 精确头 `ateam update stopped — N path(s) are not regular files:` + 路径 +
  `No files were written.`，exit 1；`--force` 同样中止。`--force` 的语义因此收紧为「覆盖普通文件
  冲突，不覆盖非普通目标」——force 不是万能钥匙。
- `context`：`splitCommand` 按空白切分命令（`py -3` → `["py","-3"]`）；spawn 失败 / null status
  明确报错并 exit 1。模板 8 个 md 的 37 处 `python .ateam/scripts` 改为 `{{PYTHON_CMD}}`，
  安装后渲染为实际命令，模板源文件不再硬编码解释器名。
- handover 占位符：去掉裸 `TODO` 判定；优先识别 sentinel `<!-- ATEAM_HANDOVER_PLACEHOLDER -->`
  （写进模板 handover.md），其次 `（待写）`。真实交接正文含 `TODO: fix X` 不再被误判为占位。
- hooks 合并：matcher 感知去重（同 command 不同 matcher 都保留）；env 键合并（existing 优先、
  补 incoming 缺失键）；顶层 `hooks` 为数组等不支持形状时告警且文件一个字节不动；无新增 entry/env
  时返回 `changed=false`，`init --force` 与 `update` 都不重写（4 空格 JSON 字节不变）。
- CLI 旗标白名单：每命令先校验旗标再执行，未知/拼错旗标 → stderr `unknown option --x`、
  exit 1、零副作用。`read_json` 解析失败打印 `warn: cannot parse <path>: <err>` 后返回默认值
  （缺文件保持静默）。
- 归档收尾：同秒归档目录追加 `-1`/`-2` 后缀，不嵌套；归档后重建四个实体目录并补 `.gitkeep`；
  `list_entities` 按 ID 数值后缀排序（f1000 在 f999 之后）。

### 验证与教训

- 独立 verify 逐条真实复现，a006–a012 全 PASS。唯一 diff 清单偏离：`src/commands/init.js` 为
  a009 的精确警告字符串做了一行前缀改动，属必要改动而非缺陷；预期清单应包含它。
- Windows 创建符号链接返回 EPERM，符号链接目标只能靠 lstat 代码审查覆盖；smoke 会打印
  「symlink preflight check skipped (EPERM)」，不要把跳过当成 PASS 证据。
- 同秒归档碰撞用 monkeypatch 固定时钟验证后缀递增，比反复抢同秒可靠。
- Worker report 的 `spent` 是自估，与平台实测用量可能差一倍（本次 64.5k vs 115k tokens）。
  板子记账暂以报告为准，可用补充 `consumption add` 条目校正；后续报告协议可要求区分实测/自估。

## 2026-11-10 晚 — Worker skill 路由（存量 skill 进 mission）

### 机制

- `board.py intent add --skills`（逗号分隔的文件路径 / 宿主 skill 名）→ `mission render` 在
  Angle 之后输出 `## Skills (load before working)`：相对路径按项目根解析成**绝对路径**（与 cwd /
  worktree 无关），文件不存在 stderr 警告；宿主 skill 名原样透传、注明优先 Skill 工具；段末固定规则：
  只加载列出的、mission constraints 优先、只取相关部分并计入预算。
- 军规：侦察盘点 `.claude/skills`、`.agents/skills`、`.qoder/skills` 与 `CLAUDE.md`/`AGENTS.md` 约定；
  派单按切片域选 0–2 个经 `--skills` 传入；ateam 自身 start/continue/finish 不派给 Worker；外部 skill
  先审再路由。
- 端到端验证法：仓库外放一个 nonce skill（含唯一令牌），把验证 Worker 的 mission 经 `--skills` 路由它；
  报告必须回传 nonce 并说明读取路径——证明 Worker「真读了」而不仅是「mission 渲染了路径」。
- 边界：0–2 上限仅是军规不作 CLI 强制；`path.exists()` 会让目录静默通过（建议 `is_file()` + warn）；
  逗号分隔无法表达含逗号的路径。

### worktree 基线

- 实测 Agent `isolation: "worktree"` 基于**会话启动时的 HEAD**（本次为 origin/main `4e3167d`），
  不是派单时 main 的最新提交。Leader 有新提交时分支会落后：收尾必须普通 merge（非 ff），合并后重跑
  smoke 再验收；若 Worker 必须看到新提交，改用主工作区或先手动建新 worktree。

## 2026-11-10 晚 — init 同名文件 fail-fast（默认停止）

### 行为矩阵

- 默认 `init`：任何写盘之前预检；目标文件已存在且内容与模板不同 → 停止（exit 1）、列冲突
  （20 条封顶 + 余数）、给出三条出路（`--force` / `--keep-existing` / 先移走），**零写入**。
- `--keep-existing`：保留全部冲突文件（宿主配置也不 merge），补装缺失文件——旧默认 skip 语义显式化。
- `--force`：覆盖模板冲突并先打印 `overwriting (existing)`；宿主 hook 配置仍只合并不整体覆盖；
  PROTECTED 运行数据不动。
- 逐字节相同不算冲突；`--force` 与 `--keep-existing` 互斥，校验先于平台解析。
- 非普通文件目标（目录/符号链接）：默认视为冲突停止；`--force` 也在写盘前中止（防半装）；
  PROTECTED 运行数据路径例外——本来就不写、不触发默认停止。

### 设计教训

- 预检必须零副作用：先构建写盘 map、逐文件比对，判定后再 merge/ensureDir/atomicWrite。
- 「同名」不能只有 skip/force 两档：安全默认 = fail-fast + 显式出路；隐式保留会让用户误以为已安装。
- 独立 verify 再次抓到实现者自测盲区：`--force` 遇目录目标先写 31 个文件再 EPERM，留下半装与
  `.tmp`。修复单复用原 Worker 上下文（SendMessage），成本低；verify 复验同一分支后 ff 合并。
- 清单 20 条封顶可能隐藏关键路径（如宿主配置）；需要时把冲突/宿主配置优先排序或加摘要。

### 框架教训

- `board.py report ingest` 优先读报告内的 `mission_ref`，CLI `--mission-ref` 不能覆盖；自拟 verify
  mission 必须在 prompt 里写死 `mission_ref` = intent id（或 board 生成的 `m-iXXX`）。
- `board.py project init --force` 只替换 project.json，不清空 facts/intents/acceptance/counters；
  新项目开局要先归档旧图（本次归档至 `.ateam/workspace/archive/2026-11-10-prev/` 并归零 counters）。
- worktree 分支上的小修补/文档修正用 SendMessage 复用原 Worker，省 context 也省重新侦察。

## 2026-11-10 下午 — 交互式 init、同名文件安全、记忆入仓

### 交互式 init（S1/S2）

- 选择矩阵：显式 `--platform` 最高优先；`--yes/-y` 保持旧默认三平台（自动化兼容）；TTY 无参交互多选；
  非 TTY 无参 fail-fast——绝不静默全装。
- 零依赖实现：`node:readline` 的 `emitKeypressEvents` + `setRawMode`，ANSI 重绘；picker 的
  input/output 可注入，按键语义可自动化验证。
- 选择持久化 `.ateam/.platforms.json`（空数组 = 有意不装 host 平台）；`update` 必须读取，否则会
  复活未选平台（初版 `detectPlatforms` 回退三平台，已修）。
- 旧安装兼容：无持久化文件才回退 hash/marker 检测。hash 键带前导点（`.claude/...`），前缀匹配
  要先规范化——独立 verify 抓到的真实缺陷（i018 修复）。

### 同名文件安全（i015）

- 默认 skip 不覆盖，但安全必须可见：列出 `kept (existing)` 路径清单。
- 宿主配置（`.claude/settings.json`、`.qoder/settings.json`、`.codex/hooks.json`）任何模式
  （含 `--force`）都只合并、不整体覆盖；合并失败（非法 JSON）保留原文件字节并警告。
- `--force` 覆盖其他模板前先打印 `overwriting (existing)` 清单（20 条上限 + 余数）。
- 独立 verify 的价值：w14 抓到 hash 前缀缺陷，w15 指出 smoke 未直接预置普通 scaffold 同名文件，
  均为真实改进点。

### 流程与记忆

- worktree 默认策略：写文件的 Worker 默认 worktree；并行写者强制；例外须在 mission 与
  leader-state 记录理由。
- 长期记忆入仓：行为准则进 `templates/scaffold/memory/`（随 init 分发），产品教训进本文件
  （随 GitHub）。
- 教训：独立验证不是走流程——本轮两个 verify Worker 都发现了实现者自测未覆盖的问题。

## 2026-11-10 — v0.1.0 首日

### watchdog 删除（方案 C）

- 被动脚本无法复活 Leader，`restart_count` 语义虚假 → 全删；死线检查并入 Leader 每轮 OODA 自查。
- 教训：机制性组件要追问「谁在执行」；先对照本地参考实现再决定保留什么。

### board 渲染改造（i005，三次派单）

- 前两次失败：Worker 全量读码，47.5k / 34k tokens，0 代码改动。
- 第三次成功：mission 内嵌侦察 fact（f012+f015）、明令禁止再侦察、兼容红线写死；65k tokens / 6.8 分钟、约 245 行、smoke PASS。
- 教训：侦察成果必须进任务书；禁止 Worker 重新发现已知信息；测试断言（smoke 行号/字面量）作为红线写死。

### handover 注入（i007）

- SessionStart hook 直读 `.ateam/workspace/handover.md` 全文（占位/缺失时退回原行为），新会话无需手动读文件。

### update 机制遗留（f014 / f028）

- update 不清理模板已删除的文件（dogfood 残留 `watchdog.py` / `watchdog.md` / `.template-hashes.json` 旧条目）。
- templates 下未跟踪的 `__pycache__` 被当 scaffold 内容，产生 kept/conflict 噪声。
- smoke 未覆盖渲染交互行为（折叠标记 / --verbose / NO_COLOR / TTY / 对齐），目前依赖人工验证。
- 平台选择持久化前，`update.detectPlatforms` 回退三平台会复活用户未选的平台。

### 长期记忆归档

- 通用行为记忆进 `templates/scaffold/memory/*.md`（随 init 分发）；产品教训进本文件（随 GitHub）。
- Claude 本地 memory 降级为会话缓存，权威源在仓库。