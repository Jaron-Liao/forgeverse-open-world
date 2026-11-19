# ForgeVerse Epic / Story 实现清单

> 版本：v1.0 ｜ 日期：2026-11-19 ｜ 作者：程基岩（engineering-lead）
> 任务：FV-ENG-01（**仅文档产出；本文件不包含实现代码**）
> 上游依据：`docs/architecture/ARCHITECTURE.md`、`docs/architecture/ADR.md`
> 使用方式：后续 coding 子任务按 Story ID 领取，完成前必须提供「证据」列路径下的测试/冒烟记录。

---

## 0. 优先级与执行顺序

| 优先级 | 含义 | Story |
|---|---|---|
| **P0** | 交付必需，缺一不可运行/不可信 | S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09, S-11, S-13, S-14, S-16, S-17, S-22, S-23, S-24 |
| **P1** | 需求明确但可在 P0 之后并行 | S-10, S-12, S-15, S-18, S-19, S-21, S-25 |
| **P2** | 增强项 | S-20 |

**推荐批次**（同批内可并行，跨批按依赖）：

1. **批次 A（地基）**：S-04 → S-01 → S-02 → S-03
2. **批次 B（入口 + 渲染骨架）**：S-05, S-06, S-07, S-08, S-09, S-11, S-22
3. **批次 C（云与集成）**：S-13, S-14, S-16, S-17, S-18, S-19, S-21, S-23
4. **批次 D（体验与收尾）**：S-10, S-12, S-15, S-20, S-24, S-25

**硬依赖链**：S-01 → S-02 → S-03 → S-05/S-08 → S-13 → S-16 → S-15；S-09 → S-10/S-11/S-12。
S-04（测试骨架）必须先于所有功能 Story 合入。

---

## 1. EPIC-0 · 数据契约与本地地基

> 目标：先把「世界」变成一等公民，且所有行为可单测。对应 ADR-01/05/06。

### S-01 · v4 payload 契约与校验器（P0）
- 依赖：S-04（测试骨架）
- 范围：`js/data/schema.js`、`js/data/validate.js`；契约正本见 ARCHITECTURE §6
- 验收：
  1. `createDefaultWorld(config)` 输出完整 v4 结构，含 `worldId/rev/viewportSettings`；
  2. `validate()` 对超长名称、非法主题枚举、NaN 坐标、>500 对象、>2MB 体积、深度>12 均返回**错误码**而非抛异常；
  3. 合法 payload 往返 `JSON.stringify → parse → validate` 无损；
  4. 纯函数，无 DOM/存储引用。
- 证据：`tests/data/schema.test.js`、`tests/data/validate.test.js`

### S-02 · IndexedDB 世界仓储与本地索引（P0）
- 依赖：S-01
- 范围：`js/data/local-store.js`、`js/data/world-index.js`；`worlds` / `outbox` / `backups` 三个 store
- 验收：
  1. 写入两个不同 `worldId` 后互读不串；删除 A 不影响 B；
  2. `outbox.enqueue` 同 id 合并为最新一条；
  3. IDB 不可用时降级 localStorage 并给出明确错误码（不静默）；
  4. 索引合并：同 id 时 `dirty:true` 的本地条目优先，`source` 正确标注。
- 证据：`tests/data/local-store.test.js`（用 fake-indexeddb 或浏览器冒烟记录）、`tests/data/world-index.test.js`、`tests/evidence/idb-smoke.png`

### S-03 · WorldSession 生命周期与 App 适配（P0）
- 依赖：S-02
- 范围：`js/world/world-session.js`（open/create/close/activate/deactivate、meta 持有 worldId/rev）、
  `js/world/world-config.js`、`js/world/scene-codec.js`（从 `io.js` 抽取）
- 验收：
  1. 连续 open A → open B，B 的 `App.worldName/objects/tasks` 正确，A 的状态不泄漏；
  2. `deactivate()` 后 `undoStack/redoStack` 被清空（需在 main.js 暴露清理钩子）；
  3. v3 场景经 codec 往返，seed/书签/地形编辑/笔记字段不丢；
  4. 坏 payload 不进入 activate（先校验/迁移）。
- 证据：`tests/world/session.test.js`、`tests/world/scene-codec.test.js`

### S-04 · 零依赖测试骨架与 fixtures（P0，最高优先）
- 依赖：无
- 范围：`tests/**` 目录、`package.json` 增加 `test` 脚本（`node --test`）、`tests/fixtures/v3-save.json`
- 验收：
  1. `npm test` 在沙箱无安装依赖情况下退出码 0；
  2. fixture 覆盖最小 v3 存档、含布尔/导入物体的复杂存档、恶意超长文本存档。
- 证据：`tests/smoke.test.js`、命令输出 `tests/evidence/npm-test.txt`

---

## 2. EPIC-1 · 全屏世界管理页与新建配置

> 目标：入口从「小弹窗」升级为全屏页面，存档卡片可点回对应世界。对应 ADR-01/06。

### S-05 · 全屏 `#world-manager` 页面与路由状态机（P0）
- 依赖：S-03
- 范围：替换 `index.html:420-433` 的 `#intro` 为 `#world-manager`；`js/ui/manager-page.js`；
  `js/main.js` 的 `boot()` 末尾改为 `ManagerPage.show()`
- 验收：
  1. 首屏直接进入管理页，**不再出现小弹窗**；
  2. MANAGER 状态下编辑器控件不可交互；EDITOR 状态下管理页节点 `hidden`；
  3. 退出到管理页后渲染循环降频/暂停（依赖 S-09 的 `setPaused`，未完成前用 CSS 遮罩过渡）；
  4. 浏览器前进/后退不改变世界数据（路由只切 UI 状态，不做历史栈滥用）。
- 证据：`tests/ui/manager-page.test.js`（DOM 桩）、`tests/evidence/manager-fullscreen.png`

### S-06 · 世界卡片列表：打开 / 重命名 / 复制 / 删除（P0）
- 依赖：S-05、S-03
- 范围：`js/ui/manager-page.js` 卡片渲染
- 验收：
  1. 卡片显示名称、主题、最后更新、来源（本地/云端/双端）、未同步标记；
  2. 删除与覆盖必须二次确认，取消后数据仍在；
  3. 复制生成**新 worldId** 与新 slot，不覆盖原世界；
  4. 所有用户文本用 `textContent`，注入 `<img onerror>` 不执行（对应风险 R12）。
- 证据：`tests/ui/world-cards.test.js`、`tests/evidence/card-actions.png`

### S-07 · 新建世界细粒度配置表单（P0）
- 依赖：S-01、S-05
- 范围：`js/ui/new-world-form.js`、`js/world/world-config.js`
- 验收：
  1. 可配置：名称、主题、生态/群系、地图种子、地形 seed/高度/分段、天气、初始时刻、画质、初始资产（树/无）；
  2. 字段级校验提示；非法值不创建世界、不写 IndexedDB；
  3. 提交后生成的 payload 通过 `Validate.assert()` 且种子/地形参数正确落入 `config`；
  4. 默认 fx 视窗为关闭状态。
- 证据：`tests/ui/new-world-form.test.js`、`tests/world/world-config.test.js`

### S-08 · 点击存档恢复对应世界（P0）
- 依赖：S-02、S-03、S-06
- 范围：`WorldSession.open(id)` 接入卡片点击；`main.js:99-111` 的隐式 `cloudLoad('main')` 移除
- 验收：
  1. 存在 A/B 两个世界，点 A 卡片恢复 A 的场景/笔记/书签，点 B 恢复 B，互不串档；
  2. 坏档：显示「存档损坏」并提供导出原始 JSON，**不产生半加载场景**；
  3. 云端来源的卡片能拉取对应 slot 的世界；
  4. 切世界后撤销/重做栈为空。
- 证据：`tests/world/open-isolation.test.js`（端到端脚本）、`tests/evidence/two-worlds.png`

---

## 3. EPIC-2 · 渲染层与独立特效视窗

> 目标：单 canvas 多视窗、输入隔离、截图与性能降级。对应 ADR-02。

### S-09 · ViewportRegistry 与 scissor 渲染器（P0）
- 依赖：S-03
- 范围：`js/render/viewport-registry.js`、`js/render/viewport-renderer.js`、`js/render/pipeline-bridge.js`；
  `engine.js` 增加 `setPaused()`
- 验收：
  1. 主视口后处理 Saturation/亮度在关闭 FX 时与改造前一致（截图对比）；
  2. 开启 FX 后主画面无闪烁、无黑块；FX 区域只显示 FX scene；
  3. 渲染结束后 `viewport/scissorTest/autoClear` 状态恢复；
  4. resize 与 DPR 变化时两个视窗矩形均不越界、不重叠。
- 证据：`tests/render/viewport-registry.test.js`、`tests/evidence/fx-overlay.png`、`tests/evidence/no-fx-baseline.png`

### S-10 · FX 视窗停靠 / 缩放 / 关闭（P1）
- 依赖：S-09
- 范围：`js/ui/viewport-dock.js`
- 验收：可拖动改锚点、可调整宽高（10%~40%）、关闭后矩形归还主视口；设置写入 `payload.viewportSettings`，
  重开世界后恢复；移动端默认关闭。
- 证据：`tests/ui/viewport-dock.test.js`、`tests/evidence/fx-dock.png`

### S-11 · 视窗输入路由与拾取隔离（P0）
- 依赖：S-09
- 范围：`js/render/viewport-input.js`；改接 `main.js:118-149` 的射线与 `terrain-edit.js` 的地形命中
- 验收：
  1. 点击 FX 视窗不会选中主世界物体，也不会触发地形编辑；
  2. 主视口内点击的 NDC 换算与改造前一致（物体可被正确选中/变换）；
  3. TransformControls 与 OrbitControls 只绑定主视口；
  4. 高 DPR 下命中偏差 <2px。
- 证据：`tests/render/viewport-input.test.js`、`tests/evidence/pick-isolation.txt`

### S-12 · 分视口截图、性能 HUD 与自动降级（P1）
- 依赖：S-09、S-10
- 范围：`js/render/perf-monitor.js`；改接 `io.js:screenshot()`
- 验收：
  1. 主视口截图不含 FX 区域；FX 截图只含 FX 内容；
  2. HUD 分视窗显示 FPS/帧时；连续 3 秒低帧率按 ADR-02 四级阶梯降级且每级只触发一次；
  3. 手动重开 FX 重置降级计数。
- 证据：`tests/render/perf-monitor.test.js`、`tests/evidence/screenshot-main.png`、`tests/evidence/screenshot-fx.png`

---

## 4. EPIC-3 · 云端多用户、并发与自动保存

> 目标：多世界云端隔离、离线优先同步、冲突可控。对应 ADR-01/03。

### S-13 · `slot=worldId` 的 CloudGateway 改造（P0）
- 依赖：S-02
- 范围：`js/data/cloud-gateway.js`（基于现有 `js/cloud.js`，保留 auth 逻辑不动）
- 验收：
  1. `save(payload)` 使用 `slot=payload.worldId`，`list()` 只取元数据；
  2. 未登录/SDK 未加载时返回 null/false，**不发网络请求**；
  3. **双账号交叉读返回 0 行**（RLS 生效验证）；
  4. 记录 `owner_id` 是否自动落库：若否，升级为需用户审批的云侧改动，不得绕过。
- 证据：`tests/data/cloud-gateway.test.js`（SDK 桩）、`tests/evidence/rls-two-accounts.txt`

### S-14 · 云端世界列表与本地索引合并（P0）
- 依赖：S-13
- 范围：`world-index.merge()` 接入管理页
- 验收：
  1. 仅本地 / 仅云端 / 双端三种来源的卡片展示正确；
  2. 云端有更新而本地无 dirty 时提示「云端有新版本」；
  3. 列表不请求 payload 字段（用请求日志验证）。
- 证据：`tests/data/index-merge.test.js`、`tests/evidence/cloud-list-request.txt`

### S-15 · 乐观并发与冲突对话框（P1）
- 依赖：S-13
- 范围：`js/ui/conflict-dialog.js`、`CloudSync` 的 CAS 分支
- 验收：
  1. 模拟 `baseRev` 落后 → 弹出三选一，未选择前两端数据均未被覆盖；
  2. 选「另存为新世界」生成新 id 且不删除任一原记录；
  3. 成功后 `rev` 递增、卡片时间戳更新。
- 证据：`tests/integration/conflict.test.js`、`tests/evidence/conflict-dialog.png`

### S-16 · 自动保存队列与上线追平（P0）
- 依赖：S-02、S-13
- 范围：`js/world/autosave.js`、`js/integration/cloud-sync.js`
- 验收：
  1. 连续 100 次 dirty 只产生 1~N 次写（防抖 2s / 上限 10s）；
  2. 离线编辑 → 上线后 outbox 自动消费并清空；
  3. `visibilitychange:hidden` 触发 flush（移动端模拟）；
  4. 单世界写云间隔 ≥10s。
- 证据：`tests/world/autosave.test.js`、`tests/integration/outbox-flush.test.js`

### S-17 · 输入校验、错误脱敏与退避（P0）
- 依赖：S-01、S-13
- 范围：`cloud-gateway` 写前校验、错误映射表、`main.js` 既有 `innerHTML` 拼接改 `textContent`
- 验收：
  1. 越界 payload 不触网；
  2. 401/403/429/5xx 分别显示对应中文短句，无 token/endpoint/堆栈；
  3. 退避序列 1/2/4/8/16s 带抖动，5 次后转离线态；
  4. 搜索结果/书签/标签渲染改为 textContent，注入测试不执行。
- 证据：`tests/data/validate.test.js`、`tests/integration/backoff.test.js`、`tests/evidence/xss-check.txt`

---

## 5. EPIC-4 · GitHub Skill 与建模资源入口

> 目标：绕开 MCP 403，页面内可检索/管理 skill，白名单导入 GLB。对应 ADR-04。

### S-18 · Skill 入口页与精选 catalog（P1）
- 依赖：S-05
- 范围：`data/skills-catalog.json`（由 `docs/TECH_SELECTION.md` 精选清单生成）、`js/ui/skill-panel.js`
- 验收：管理页有「GitHub Skill」卡片与外链；断网时精选列表仍可浏览；外链在 Edge 新标签打开。
- 证据：`tests/ui/skill-panel.test.js`、`tests/evidence/skill-offline.png`

### S-19 · GitHub 只读检索、TTL 缓存与降级（P1）
- 依赖：S-18
- 范围：`js/integration/github-skills.js`
- 验收：
  1. 搜索调用仅 `GET api.github.com/search/repositories`，无 token、无写操作；
  2. 10 分钟内重复搜索不重复请求（TTL 命中）；
  3. 429 / 离线 / CORS 失败 → 保持精选列表 + 「离线精选模式」提示；
  4. 缓存写入 IndexedDB，可查看 `lastSyncedAt`。
- 证据：`tests/integration/github-skills.test.js`、`tests/evidence/skill-search.png`

### S-20 · Skill 收藏 / 标签 / 笔记（P2）
- 依赖：S-19
- 范围：`fv.skills.prefs.v1` 本地偏好读写
- 验收：收藏/标签/笔记刷新后保留；**不进入世界 payload**（用导出的存档 JSON 验证字段不存在）。
- 证据：`tests/integration/skill-prefs.test.js`

### S-21 · GitHub GLB 白名单导入（P1）
- 依赖：S-19
- 范围：`js/integration/github-assets.js`，接入 `js/model-import.js` 资产库
- 验收：
  1. 非白名单域名、非 `.glb` 被拒且**零网络请求**；
  2. 超过大小上限在 parse 前被拒；
  3. 合法 GLB 进资产库并可放置到场景；
  4. CORS 失败时提示「在 Edge 下载后走本地导入」。
- 证据：`tests/integration/github-assets.test.js`、`tests/evidence/glb-import.png`

---

## 6. EPIC-5 · PWA、跨端与可运行交付

> 目标：手机随时保存与刷新、离线可用、文档可执行。对应 ADR-05。

### S-22 · Service Worker 策略分流与版本升级（P0）
- 依赖：S-05
- 范围：`sw.js` 升级 `forgeverse-v7`
- 验收：
  1. 静态资源缓存优先 + 后台更新；离线导航回退 index.html；
  2. 带 `code/state/provider` 的认证回调**不进入缓存**（缓存列表断言）；
  3. 云 API / GitHub API 请求不被 SW 缓存；
  4. 旧缓存 `forgeverse-v6` 在 activate 时清理。
- 证据：`tests/pwa/sw-strategy.test.js`、`tests/evidence/sw-offline.png`

### S-23 · 移动端保存 / 刷新 / 离线提示（P0）
- 依赖：S-16、S-22
- 范围：`js/ui/offline-banner.js`、顶栏「刷新云端」按钮、`webglcontextlost` 监听
- 验收：
  1. 顶栏可见「☁ 同步状态 / 刷新云端」；离线时显示离线条且本地保存仍可用；
  2. 切后台再回前台触发 flush + 列表刷新；
  3. context lost 显示重载提示，重载后从本地副本恢复；
  4. 文案不含敏感信息。
- 证据：`tests/ui/offline-banner.test.js`、`tests/evidence/mobile-save.png`

### S-24 · 运行文档与本地冒烟脚本（P0）
- 依赖：无（可与任意批次并行）
- 范围：更新 `README.md`、`docs/OPS_COMMANDS.md`，新增本地冒烟步骤；**不触碰云端 Page 节点**
- 验收：
  1. 从干净目录按文档执行可在浏览器打开、无控制台报错；
  2. 明确记录 `python -m http.server` 启动方式与 `file://` 限制；
  3. 记录 GitHub 403 的现有绕过方式与「需用户审批」的上线步骤。
- 证据：`tests/evidence/run-doc-check.txt`、冒烟截图

### S-25 · 性能预算与全量回归（P1）
- 依赖：S-01…S-24
- 范围：按 ARCHITECTURE §5 逐项测量
- 验收：
  1. 桌面/移动两档帧率与像素预算达标，记录实测值；
  2. 降级阶梯可复现；
  3. `npm test` 全绿；
  4. 风险 R1/R2/R3/R5 的「待验证」项全部有结论或降级记录。
- 证据：`tests/evidence/perf-budget.md`、`tests/evidence/final-regression.txt`

---

## 7. 跨 Story 验收清单（Definition of Done）

每个 Story 合入前逐条打勾：

- [ ] 先有测试（或冒烟脚本），再合入实现（验证驱动）
- [ ] 数据流不绕过 `LocalStore` / `Validate.assert()`
- [ ] 新增 UI 组件不持有世界状态，只发事件/收回调
- [ ] 用户可见文本均为中文短句，无 token/endpoint/堆栈
- [ ] 离线场景已验证（断网后仍可用或明确降级）
- [ ] 相关 ADR 的决策未被实现悄悄改写；若需改写，先更新 ADR
- [ ] 「证据」列路径下文件已提交并可复现

---

## 8. 本轮边界提醒

- 本任务（FV-ENG-01）**只产出三份文档**，不写实现代码、不改业务文件、不提交、不部署。
- 云端 Page 节点 `PswMzviTMbzUhZZS1aNhac` 本轮冻结；任何上线动作需用户确认。
- GitHub MCP 写权限 403、reconnect 被拒：所有 Story 不得依赖 MCP 写；需要推送时交由用户本地执行。
