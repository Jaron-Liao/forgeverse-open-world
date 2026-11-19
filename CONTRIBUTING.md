# 贡献与版本管理规范

## 分支策略
- `main`：稳定发布分支，只接受来自 `dev` / `feature/*` 的 PR 合并。
- `dev`：开发集成分支，各 feature 合并到这里。
- `feature/<简短名>`：每项重大改动独立分支，如 `feature/voxel-physics`。
- `fix/<简短名>`：缺陷修复分支。

## Commit 规范（Conventional Commits）
格式：`<type>(<scope>): <subject>`

| type | 用途 |
|---|---|
| feat | 新功能 |
| fix | 缺陷修复 |
| docs | 文档 |
| perf | 性能优化 |
| refactor | 重构（不改功能） |
| chore | 构建/工具/配置 |
| test | 测试 |

示例：`feat(voxel): 实现体素 chunk 放置与破坏`

## 工作流
1. 从 `dev` 切 `feature/*` 分支。
2. 开发 + 自测（语法/符号/冒烟）。
3. 提交规范 commit。
4. 推远端，开 PR 合并回 `dev`（附验证结果）。
5. `dev` 稳定后 PR 合并到 `main` 并发版（更新 CHANGELOG + 版本号）。

## 变更记录
每次发版必须更新 `CHANGELOG.md`（新增/变更/修复/移除）。
