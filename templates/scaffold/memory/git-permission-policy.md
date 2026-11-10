# Git 权限边界（长期记忆）

- 本地 git 全权：提交、分支、worktree 合并可自主执行；提交信息遵循仓库约定并带 attribution。
- 远端操作（push / remote / PR / 发布）必须先获得用户批准——即使本地已提交。
- 危险操作（删文件、改 CI、force-push、新增依赖）先告知用户或报 BLOCKED。