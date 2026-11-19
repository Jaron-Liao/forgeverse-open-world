# Changelog

本项目所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本（SemVer）。

## [Unreleased] — v9 规划中

### Planned
- P0：GitHub 分支策略与 PR 流程（本文件即基线）
- P0：设计系统 v9、游戏主页 SPA 容器
- P0：体素方块系统、重力与 AABB 碰撞、视听反馈
- P1：全站静态页、响应式、关卡与计分胜负
- P2：分享码、社区展示、排行榜、云数据
- P3：IndexedDB、性能优化、跨浏览器

详见 `docs/REQUIREMENTS_V9.md`。

## [8.0.0] — 2026-11-19

### Added
- 全屏世界管理页与新建世界配置页（14 项细分配置），替代旧小弹窗。
- 多世界独立存档：`js/world-manager.js`，分键存储 + 活动指针，世界间互不污染。
- 独立渲染视窗：`js/viewport.js`，单 canvas scissor 多视口，非激活视窗降频。
- 四生态资产补齐：`js/biome-pro.js` 注册 grass/snow/desert/cyber。
- 自动保存（2s 防抖 + visibilitychange flush）、返回世界管理入口。
- 5 角色协作交付：概念文档、美术圣经、GDD、架构 ADR、Epics、QA 报告。

### Changed
- 视觉统一到暗金玄墨体系（ART_BIBLE §9.1 变量迁移表），删除蓝紫粉残留。
- 云存档 slot 从固定 `main` 改为 `worldId`（`js/cloud.js`）。
- 清理冗余技术文案 3 处。

### Fixed
- D1：旧 `#intro` 弹窗残留（已删 boot 中显示调用）。
- D2：配置页选非草原生态恒生成草原（pick 选择器 aria-checked 残留根因）。
- D3：管理页工具条（计数/排布/筛选/排序/搜索/导入导出/卡片菜单）未接线。

## [7.0.0] — 2026-11-17

### Added
- 雪地/沙漠 Pro 建模升级（沙岩民居/哨站/油井、北欧木屋/冰洞/观测站）。
- PWA 支持（manifest + Service Worker，可安装离线用）。
- 技术选型报告、Unity 集成方案、运维命令清单。

## [6.0.0] — 2026-11-17

### Added
- 三环境资产分层（沙漠/雪地/都市 × 建筑/地形/装饰/公路）。
- 地形编辑：水源放置/删除、挖地、编辑结果保存加载。
- 真实感渲染：太阳高度角驱动光色、天气氛围、4 档性能预设。

## [5.0.0] — 2026-10-16

### Added
- 腾讯云持久化（wb_saves + RLS）、操作台、第一/三人称漫游、无限地图、资产库、9 种天气。

## [1.0.0] — 初始版本

### Added
- Three.js r160 本地化；建模/布尔/细分/阵列、顶点与纹理绘画、12 种 PBR 材质、种子地形、XP/等级/任务。
