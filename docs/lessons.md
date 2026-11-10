# ateam 开发教训（产品级）

按时间倒序，记录 ateam 自身演进中值得永久保留的教训。板子（`.ateam/`）是生成物不入库，
因此产品级教训必须落到本文件。

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