# ateam 开发教训（产品级）

按时间倒序，记录 ateam 自身演进中值得永久保留的教训。板子（`.ateam/`）是生成物不入库，
因此产品级教训必须落到本文件。

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
- 教训：机制性组件要追问「谁在执行」；先对照参考实现（sapper-v2-master）再决定保留什么。

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