# ForgeVerse 主架构文档

> 版本：v1.0 ｜ 日期：2026-11-19 ｜ 作者：程基岩（engineering-lead）
> 任务：FV-ENG-01 ｜ 状态：供评审，非实现代码
> 适用范围：`D:/WorkBuddy/2026-10-16-00-30-25/workbench3d/`

---

## 0. 文档约束与事实基线

### 0.1 本轮硬约束

| 约束 | 说明 |
|---|---|
| 引擎 | Three.js r160，**本地 vendor**，无构建步骤，importmap 映射（`index.html:13-19`） |
| 云端 | 沿用腾讯云 WorkBuddy CloudBase；`wb_saves` 表已激活；**本轮不做云侧 DDL** |
| 交付 | 本地全量产出；云端 Page 节点 `PswMzviTMbzUhZZS1aNhac` 本轮冻结，改动需用户确认 |
| 权限 | GitHub MCP 写权限 403（只读）；reconnect 已被用户拒绝；**架构不得依赖 MCP 写操作** |
| 准则 | 可落地、离线优先、沙箱可验证；不臆造引擎/SDK API，不确定处标注「待验证」 |

### 0.2 从现有代码读到的事实（非假设）

| 事实 | 证据 | 架构影响 |
|---|---|---|
| 单存档：`KEY = 'forgeverse_v1'`，`saveLocal()` 直接覆盖 | `js/io.js:11,52-55` | 必须引入世界 ID 与多键存储，保留旧键做迁移 |
| 云存档默认 `slot='main'`，唯一键 `owner_id + slot` | `js/cloud.js:88-118`、任务说明 | **slot 复用为 worldId**，零 DDL 即可多世界 |
| 入口是小弹窗 `#intro`，`startWorld()` 直接生成世界 | `index.html:420-433`、`js/main.js:442-471` | 改为全屏 `#world-manager` 页面 + 显式状态机 |
| 单一 `WebGLRenderer`；后处理 `EffectComposer` 绑定全画布 | `js/engine.js:14-21`、`js/render-pipeline.js:22-57` | 多视窗必须处理 composer 全屏输出与视窗叠加顺序 |
| `App` 是全局单例状态，24 个模块直接读写 | `js/state.js:2-24` | 用「会话适配层」隔离改造面，避免一次性重写 24 模块 |
| Service Worker 网络优先且缓存所有 GET | `sw.js:24-34` | 会误缓存认证回调/API；必须分流缓存策略 |
| 存档 v3 已含 seed/书签/地形编辑/笔记 | `js/io.js:29-49`、`js/main.js:379-388` | v3→v4 迁移可做纯字段映射，无需重解析场景 |
| `tests/` 为空目录 | 文件清单 | 所有 Story 的测试证据路径均为「需新建」 |
| 自动恢复云端存档在 `restoreAuth` 回调里直接 `cloudLoad('main')` | `js/main.js:99-111` | 需改为「列出云端世界 → 由用户点选打开」，不再隐式覆盖 |

### 0.3 本文件与其他交付物关系

- ADR 集合：`docs/architecture/ADR.md`（ADR-01…06）
- Story 拆分：`production/epics/EPICS.md`
- 本文件第 6 节是**唯一的数据契约正本**，ADR 与 Story 均引用它。

---

## 1. 目标运行态与状态机

### 1.1 页面状态

```
        ┌─────────────────────────────────────────────┐
        │                 BOOT                        │
        │  createEngine → initCloud → restoreAuth     │
        └──────────────────────┬──────────────────────┘
                               ▼
        ┌─────────────────────────────────────────────┐
        │  MANAGER（全屏世界管理页，非 modal）         │
        │  · 合并本地/云端世界列表                     │
        │  · 打开 / 新建 / 重命名 / 复制 / 删除        │
        │  · GitHub Skill 入口 / 资源导入入口          │
        └───────┬───────────────────────────┬─────────┘
                │ open(id)                 │ create(config)
                ▼                           ▼
        ┌─────────────────────────────────────────────┐
        │  EDITOR（现有工作台 UI，基本不改）           │
        │  WorldSession.activate(payload)             │
        │  scene-codec 恢复场景 → 渲染循环恢复         │
        │  编辑 → dirty → autosave → outbox → cloud   │
        └──────────────────────┬──────────────────────┘
                               │ exitToManager()
                               ▼  flush() + deactivate()
                            MANAGER
```

### 1.2 状态不变量（必须有测试）

1. 任意时刻最多一个 world 处于 `active`；切换前必须 `flush()` 并 `deactivate()`。
2. `worldId` 在 payload、`slot`、本地索引三处**必须一致**；不一致时以 payload 为准并告警。
3. MANAGER 状态下不写任何世界 payload；只读写索引与配置。
4. EDITOR 状态下 UI 组件不得直接 `localStorage.setItem`；一律经 `LocalStore`。
5. 云端不可用不得阻断本地编辑；离线是**一等公民**而非错误态。

---

## 2. 分层架构

### 2.1 五层与依赖方向

依赖只能**自上而下**，禁止反向 import；跨层通信走 `bus` 事件或显式回调。

```
┌──────────────────────────────────────────────────────────────┐
│ L1 UI 层          js/ui/                                     │
│ manager-page / new-world-form / viewport-dock /              │
│ conflict-dialog / skill-panel / offline-banner               │
│ 职责：只渲染和收集输入，绝不持有游戏状态                       │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ L2 世界管理层      js/world/                                  │
│ world-manager / world-session / world-config /               │
│ scene-codec / autosave                                       │
│ 职责：世界生命周期、配置→payload、App 适配、脏标记              │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ L3 渲染层          js/render/                                 │
│ viewport-registry / viewport-renderer / viewport-input /     │
│ pipeline-bridge / perf-monitor                               │
│ 职责：视窗矩形、渲染顺序、输入路由、截图、性能降级              │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ L4 数据层          js/data/                                   │
│ schema / migration / validate / local-store / world-index /  │
│ outbox / cloud-gateway                                       │
│ 职责：契约、校验、迁移、IndexedDB、CloudBase 访问；**零 DOM**   │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ L5 集成层          js/integration/                            │
│ github-skills / github-assets / cloud-sync / telemetry        │
│ 职责：外部系统适配、白名单与限流、后台队列编排                  │
└──────────────────────────────────────────────────────────────┘
```

> 例外与理由：`cloud-gateway.js`（纯 SDK 封装）放在 L4，`cloud-sync.js`（队列/冲突编排）放在 L5；
> L2 被 L3 依赖是因为视窗需要读取当前世界的视窗配置，此处通过只读 `getViewportSettings()` 暴露，
> 不形成双向依赖。

### 2.2 新产品模块清册

| 层 | 文件路径 | 职责（一句话） | 可独立验证点 |
|---|---|---|---|
| L4 | `js/data/schema.js` | v4 payload 常量、默认值工厂、字段枚举 | `createDefaultWorld()` 输出通过 `validate()` |
| L4 | `js/data/validate.js` | 白名单校验、范围/数量/大小上限、错误码 | 越界/超长/非法枚举被拒且不抛异常 |
| L4 | `js/data/migration.js` | v3→v4 纯迁移、未来版本拒绝、备份 | 同一输入两次迁移结果一致（纯函数） |
| L4 | `js/data/local-store.js` | IndexedDB `worlds` / `outbox` 两个 object store | 写入后立即读取一致；配额失败降级 |
| L4 | `js/data/world-index.js` | 本地索引读写 + 云端元数据列表合并 | 冲突时 `dirty` 本地优先 |
| L4 | `js/data/cloud-gateway.js` | `cloudLoad/cloudSave/listWorlds`；slot=worldId；CAS | 无 session 时返回 null，不触网 |
| L3 | `js/render/viewport-registry.js` | 视窗注册、矩形计算、DPR 换算、启用/禁用 | 矩形不重叠、边界不越界 |
| L3 | `js/render/viewport-renderer.js` | composer 优先 + scissor 叠加渲染、状态恢复 | 关闭 FX 后主视口输出与旧版逐像素一致 |
| L3 | `js/render/viewport-input.js` | 指针命中视窗 → 转换 NDC → 路由射线/控制器 | 点击 FX 视窗不会选中主世界物体 |
| L3 | `js/render/perf-monitor.js` | 分视窗 FPS/帧时采样与降级阶梯 | 连续低帧率触发且仅触发一次 |
| L3 | `js/render/pipeline-bridge.js` | 把现有 `render-pipeline.js` 接入新渲染顺序 | 画质切换仍生效 |
| L2 | `js/world/world-session.js` | `open/create/close/activate/deactivate`；兼容 `App` | 切换世界后旧世界状态不泄漏 |
| L2 | `js/world/world-config.js` | 新建表单配置 → v4 payload | 种子/主题/地形参数落入正确字段 |
| L2 | `js/world/scene-codec.js` | 从 `io.js` 抽取 `serializeScene/deserializeScene` | v3 存档经过 codec 往返字段不丢 |
| L2 | `js/world/autosave.js` | 防抖 2s / 上限 10s / 页面隐藏强制 flush | 连续 100 次 dirty 只产生 1~N 次写 |
| L5 | `js/integration/cloud-sync.js` | outbox 消费、指数退避、冲突派发 | 离线期间编辑，上线后自动追平 |
| L5 | `js/integration/github-skills.js` | GitHub 搜索 + 精选 catalog + TTL 缓存 + 降级 | 断网时仍展示精选列表 |
| L5 | `js/integration/github-assets.js` | 域名白名单 GLB 导入（仅 .glb） | 非白名单 URL 被拒且无网络请求 |
| L1 | `js/ui/manager-page.js` | 全屏管理页渲染与卡片交互 | 无 active 世界时不显示编辑器控件 |
| L1 | `js/ui/new-world-form.js` | 细粒度新建配置收集 | 非法输入不创建世界且给出字段级提示 |
| L1 | `js/ui/viewport-dock.js` | FX 视窗停靠/缩放/关闭 | 关闭后视窗矩形归还主视口 |
| L1 | `js/ui/conflict-dialog.js` | 云端/本地/另存三选一 | 未选择前不覆盖任一副本 |
| L1 | `js/ui/offline-banner.js` | 离线/未登录/同步失败状态条 | 文案不含 token/endpoint/堆栈 |

> 既有 24 个模块**保持原位**。`js/main.js` 仅做三处改接：入口改为 `ManagerPage`、
> 存档按钮改走 `WorldSession`、引擎渲染钩子改走 `viewport-renderer`。

### 2.3 与既有模块的兼容策略（关键）

`App`（`js/state.js`）暂时保留为全局兼容门面：

- `WorldSession.activate(payload)` 把 payload 中的 fields 写入 `App`（worldName/theme/tasks/note/…），
  现有 24 模块无需立即改造；
- `serializeScene()` 以 `App` + 场景对象为输入生成 payload 的 `config/scene/notes` 部分，
  复用 `js/io.js:29-49` 的既有逻辑（迁移期直接调用，之后逐步搬入 `scene-codec.js`）；
- 新增字段（worldId/rev/viewports/…）**不塞进 App**，由 `WorldSession` 单独持有；
- `undoStack/redoStack` 是 `main.js` 模块级变量，切世界时必须清空（列入 Story S-08 验收）。

这条适配层是**过渡设计**，不是终局：它把改造面从 24 个模块压缩到 3 个接线点。

---

## 3. 数据流（文字时序）

### 3.1 启动 → 管理页

1. `main.js:boot()` → `createEngine(#stage)`（renderer/camera/controls 与现在一致）。
2. `initCloud()` → `restoreAuth()`（沿用现有回调分发，**不得提前加 auth gate**）。
3. `LocalStore.open()` 打开 IndexedDB；读取 `fv.worlds.index.v1`。
4. 若已登录且在线：`CloudGateway.listWorlds()` → `SELECT id, slot, world_name, updated_at FROM wb_saves`；
   用 `WorldIndex.merge(local, cloud)` 按 id 合并，得到卡片列表。
5. `ManagerPage.show()` 显示全屏管理页；渲染循环可降频（暂停能力在 S-09 加入）。

### 3.2 新建世界

1. `NewWorldForm.collect()`：名称、主题、生态、地图种子、地形 seed/height/seg、天气、初始时刻、画质、初始资产。
2. `WorldConfig.toPayload(config)` → `Schema.createDefaultWorld()` 填充 → `Validate.assert(payload)`。
3. `LocalStore.putWorld(payload)` 写入 IndexedDB → `WorldIndex.upsert({id, dirty:true})`。
4. `WorldSession.open(id)` → `activate()` → `scene-codec.deserializeScene()` → 生成地形/天空/初始资产。
5. `ManagerPage.hide()`，进入 EDITOR。

### 3.3 打开已有存档 → 回到对应世界

1. 点击卡片拿到 `entry.id` 与 `entry.source`（local/cloud/both）。
2. 优先读本地 payload；若无本地副本或 `entry.dirty` 为假且云端 `updated_at` 更新 → 读云端 payload。
3. `migration.toLatest(payload)`：`v3 → v4` 或 `v4` 直通；未来版本拒绝并保留原始副本。
4. `Validate.assert()` 通过后 `WorldSession.activate()`；失败 → 显示「存档损坏」并导出原始 JSON 供用户抢救。
5. 恢复场景后把 `worldId/rev/viewports` 写入会话，编辑器与卡片一一对应。

### 3.4 编辑 → 自动保存 → 云端同步

1. 任意会改变场景的操作经 `bus.emit('world:dirty')`（在 `main.js` 的 `wireUI` 与 `objects.js` 等入口埋点）。
2. `Autosave.schedule()`：防抖 2s，最长 10s 强制落盘；`visibilitychange:hidden` / `pagehide` 立即 `flush()`。
3. `flush()`：`serializeScene()` → 合并 `WorldSession.meta` → `Validate.assert()` → `LocalStore.putWorld()` + `Outbox.enqueue(id)`。
4. 在线且已登录 → `CloudSync.flush()` 逐条消费 outbox：
   `CloudGateway.save(payload, name, slot=id, baseRev=payload.rev)`。
5. 成功 → 更新会话 `rev`、`cloudUpdatedAt`，`WorldIndex.upsert({dirty:false})`。
6. 冲突/权限/限流 → 见 3.5。

### 3.5 冲突与失败

```
CAS 返回 0 行（云端被别的端更新）
  → ConflictDialog 三选一：
      A 用云端覆盖本地（拉云端 → 重新 activate）
      B 保留本地并强制覆盖云端（rev = cloudRev + 1）
      C 另存为新世界（新 worldId 插入，不覆盖任何一端）
未登录 / 403 / RLS 拒绝
  → 只保留本地，显示「已本地保存，未云端同步」；停止该世界重试直到下次用户操作
429 / 5xx
  → 退避 1/2/4/8/16s（±抖动），5 次后转离线态，outbox 保留
```

### 3.6 GitHub Skill 检索与资源导入

1. 管理页「GitHub Skill」卡片 → `SkillPanel`：先展示内置 `data/skills-catalog.json`（源自 `docs/TECH_SELECTION.md` 的精选清单）。
2. 用户搜索 → `GitHubSkills.search(q)`：`GET https://api.github.com/search/repositories?q=…&sort=stars&per_page=10`；
   **仅 GET、无 token、无写操作**。成功写 IndexedDB 缓存并记录 `lastSyncedAt`，TTL 10 分钟内不重复请求。
3. 失败（离线/429/CORS）→ 保持精选 catalog，显示「离线精选模式」，不阻塞页面。
4. 收藏/标签/笔记写入本地偏好；不进入世界 payload，避免污染存档。
5. 资源导入：只接受 `raw.githubusercontent.com` 或 `github.com` 域名、仅 `.glb`、先 `fetch` 检查大小上限，
   再交 `GLTFLoader.parse(arrayBuffer)`；失败降级为「在 Edge 下载后走本地导入」。

---

## 4. 关键设计决策摘要（详见 ADR.md）

| ADR | 决策 | 一句话理由 |
|---|---|---|
| ADR-01 | 多世界用 `slot = worldId` 复用 `wb_saves`，不建新表 | 零云侧 DDL，直接吃现有 `UNIQUE(owner_id,slot)` 与 RLS |
| ADR-02 | 单 renderer + scissor/viewport 多视窗 | 省 WebGL 上下文与显存，移动端更稳 |
| ADR-03 | RLS 为安全边界 + 客户端乐观并发/限流/校验/本地备份 | 不信任客户端，且当前无服务端扩展点 |
| ADR-04 | Skill 走浏览器只读 GitHub API + 精选 catalog 降级 | 绕开 MCP 403，不存 token，不执行远端代码 |
| ADR-05 | IndexedDB 权威本地存储 + outbox + SW 分流缓存 | 离线优先，避免 localStorage 配额与 API 误缓存 |
| ADR-06 | v4 payload + 纯函数版本迁移 + 严格校验 | 存档可演进、迁移可测试、坏档不静默 |

---

## 5. 性能方案

### 5.1 预算（目标值，需在真机验证）

| 指标 | 桌面 | 移动端 | 测量方式 |
|---|---|---|---|
| 目标帧率 | 60 FPS | 30 FPS | `perf-monitor.js` 分视窗采样 |
| 帧时分配 | 更新 ≤3ms / 主视口 ≤10ms / FX ≤2ms / UI ≤1ms | 更新 ≤4ms / 主 ≤22ms / FX ≤2ms | `performance.now()` 分段 |
| 着色像素/帧（含后处理） | ≤4.0M px | ≤1.2M px | 视窗面积 × DPR² 累加 |
| FX 视窗占比 | ≤20% 且 DPR ≤1 | 默认关闭 | ViewportRegistry 约束 |
| Draw call | 主 ≤600 / FX ≤80 | 主 ≤200 / FX ≤40 | `renderer.info.render.calls` |
| 阴影贴图 | 主 2048 / FX 关闭 | 主 1024 / FX 关闭 | 配置约束 |
| 单世界对象数 | ≤500 | ≤200 | `Validate.assert()` |
| 存档体积 | 云 ≤2MB（**待验证 jsonb 实际上限**） | 本地建议 ≤20MB | 序列化后 `Blob.size` |
| 自动保存主线程占用 | 单次 ≤4ms | 单次 ≤4ms | 索引/序列化放入 `requestIdleCallback` |

### 5.2 渲染顺序（多视窗核心）

```
1. composer.render()                  // 主视口后处理，输出到整张 canvas
2. renderer.autoClear = false
3. renderer.setScissorTest(true)
4. for each 附加视窗（当前仅 fx）:
     setViewport(rect) / setScissor(rect)
     renderer.clear(true, true, true) // 仅清该矩形
     renderer.render(fxScene, fxCamera) // 轻量：无 SSAO/Bloom、无阴影
5. 恢复 setScissorTest(false) / 全画布 viewport / autoClear
```

> **待验证**：Three.js r160 中 `EffectComposer` 最后一个 pass（`OutputPass`）会重置 renderer 状态；
> 上述顺序按 r160 源码语义推导，实施首日需写像素级冒烟测试确认（S-09 验收）。
> 若 composer 状态残留导致叠加异常，降级预案：主视口也改为 `renderer.render()` + 仅保留 tone mapping（画质档位退一档）。

### 5.3 自动降级阶梯

连续 3 秒低于目标帧率时逐级触发，每级只触发一次并 toast 告知：

1. FX 视窗 DPR 降到 1，关闭 FX 端 FXAA；
2. 自动收起 FX 视窗（用户可手动重新打开，重置计数）；
3. 画质档位下调一级（复用 `setQuality()`）；
4. 关闭阴影 / 缩小阴影贴图。

### 5.4 大并发与存储边界

- **没有服务端锁**：靠 `rev + updated_at` 乐观并发，冲突交用户决策，不做静默 LWW。
- **客户端限流**：单世界写云 ≤1 次/10s；outbox 合并同 id 为最新一条；退避上限 16s。
- **列表查询只取元数据**：`select('id,slot,world_name,updated_at')`，绝不拉 payload 列表。
- **分页**：世界数 >50 时本地索引先渲染前 50，滚动加载；云端一次最多拉 200 行（**上限待验证**）。
- **无服务端限流/备份能力**：当前 SDK 为客户端直连，无法在云侧配置限流或定时备份；用本地导出 JSON 作为人工备份，
  并在风险表列为待补能力。

---

## 6. 世界存档数据契约（v4，正本）

### 6.1 顶层结构

```jsonc
{
  "schemaVersion": 4,          // int，固定 4；未来版本拒绝加载
  "worldId": "w_1731...",      // string，32~64 字符，= CloudBase slot
  "name": "雪境前哨",           // string 1..40
  "description": "",           // string <=500
  "tags": ["雪地", "哨站"],     // string[] <=16 项，每项 <=24 字符
  "createdAt": "2026-11-19T...Z",
  "updatedAt": "2026-11-19T...Z",
  "rev": 3,                    // int >=1，客户端递增，用于乐观并发
  "legacySlot": "main",        // 可选：从 v3 迁移而来时记录原 slot
  "config": {
    "theme": "snow",           // grass|snow|desert|cyber
    "biome": "snow",           // 以 biomes.js / biome-pro.js 注册名为准
    "weather": "clear",        // clear|rain|snow|storm|fog|aurora|sandstorm|sunny|mist
    "timeOfDay": 0.55,         // number 0..1
    "autoDay": false,
    "quality": "high",         // low|medium|high|cinema
    "mapSeed": 7,              // int
    "terrain": { "seed": 7, "height": 28, "seg": 96 },
    "infiniteEnabled": false
  },
  "progress": { "level": 1, "xp": 0 },
  "scene": {
    "objects": [
      {
        "id": "o_ab12cd",       // string；v3 无 id，迁移时生成
        "name": "树",
        "type": "tree",
        "kind": "model",        // primitive|model|advanced|boolean|imported
        "p": [0, 0, 0],         // number[3]，|v| <= 10000，有限数
        "r": [0, 0, 0],         // number[3]，弧度
        "s": [1, 1, 1],         // number[3]，0.05..100
        "visible": true,
        "mats": [               // <=8 / mesh
          { "color": "#ffffff", "rough": 0.6, "metal": 0.1,
            "emissive": "#000000", "opacity": 1, "wire": false, "vc": true }
        ],
        "meta": null            // 用户标签/★标记等，纯 JSON，深度 <=12
      }
    ]
  },
  "terrainEdits": [            // <=2000 项，增量操作，加载时重放
    { "type": "water-add", "x": 1.2, "z": -3, "r": 4, "id": "w_ab12" },
    { "type": "water-del", "id": "w_ab12" },
    { "type": "dig", "x": 0, "z": 0, "r": 5, "depth": 1.2 }
  ],
  "bookmarks": [               // <=100 项
    { "name": "位置 1", "x": 0, "y": 1, "z": 0, "seed": 7 }
  ],
  "notes": {
    "text": "",                // <=20000 字符，UI 必须 textContent 渲染
    "tasks": [ { "id": "t_1", "text": "造一座塔", "done": false } ]
  },
  "assets": [                  // 仅引用，不内嵌二进制
    { "id": "a_1", "name": "rock.glb", "source": "local|github",
      "url": "", "bytes": 0, "hash": "" }
  ],
  "viewportSettings": [
    { "id": "main", "enabled": true, "rect": null },       // null = 全画布
    { "id": "fx", "enabled": false, "anchor": "bottom-right",
      "widthRatio": 0.24, "heightRatio": 0.24, "mode": "object-preview" }
  ],
  "meta": { "appVersion": "v5", "client": "web" }
}
```

### 6.2 v3 → v4 字段映射

| v3（现行 `serialize()`） | v4 目标 | 说明 |
|---|---|---|
| `v: 3` | `schemaVersion: 4` | 版本号升级 |
| `worldName` | `name` | 原样 |
| `theme` | `config.theme` | 原样 |
| `biomeName` | `config.biome` | 缺省 `urban` |
| `weather` | `config.weather` | 缺省 `clear` |
| `time` | `config.timeOfDay` | 原样（已是 0..1） |
| `terrain.{seed,height,seg}` | `config.terrain` | 原样 |
| `mapSeed` | `config.mapSeed` | 缺省 7 |
| `level`,`xp` | `progress.*` | 原样 |
| `note` | `notes.text` | 原样 |
| `tasks` | `notes.tasks` | 原样 |
| `terrainEdits` | `terrainEdits` | 原样，重放语义不变 |
| `bookmarks` | `bookmarks` | 原样 |
| `objects[]` | `scene.objects[]` | 每项补 `id`、`visible:true` |
| — | `worldId` | 新生成；来源 slot=`main` 时写 `legacySlot:"main"` |
| — | `createdAt/updatedAt/rev=1` | 新生成 |
| — | `viewportSettings` | 默认值（fx 关闭） |
| — | `tags/description/assets/meta` | 空值 |

> v3 存档中 `kind:'boolean'` 的对象在 `deserialize()` 里降级为 box 占位（`js/io.js:80`）——
> 这是**既有信息丢失**，迁移不做伪造还原，仅在 `meta.migratedFromV3: true` 标记。

### 6.3 迁移规则

1. 迁移器为**纯函数**：`migrate(payload) -> payload`，不读写 DOM/存储，可单测。
2. 按版本链式执行 `v3 → v4`；`schemaVersion > 4` 直接拒绝，先把原始 JSON 导出给用户。
3. 迁移前保留原始字节副本到 IndexedDB `backups` store（最多 3 份/世界）。
4. 迁移后写回前必须通过 `Validate.assert()`；失败则回滚到原副本并提示。

### 6.4 世界列表索引方案

**不建云端索引表**；索引是派生视图。

```jsonc
// localStorage key: fv.worlds.index.v1（小数据，仅元数据）
[
  {
    "id": "w_1731...",
    "name": "雪境前哨",
    "updatedAt": "2026-11-19T...Z",
    "rev": 3,
    "dirty": false,                  // 本地有未同步修改
    "source": "both",                // local | cloud | both
    "localUpdatedAt": "...",
    "cloudUpdatedAt": "...",
    "preview": { "theme": "snow", "biome": "snow", "objectCount": 42 }
  }
]
```

- 本地 payload 存 IndexedDB：`worlds` store，keyPath `id`；`outbox` store，keyPath `worldId`。
- 云端列表：`wb_saves` 元数据 `select`，按 `slot` 映射为 `id`。
- 合并规则：同 id 时 `updatedAt` 取较新；`dirty=true` 的本地副本**始终优先展示**，
  直到用户解决冲突或同步成功。

### 6.5 校验上限（节选，完整规则见 `js/data/validate.js` 的 Story 验收）

`name ≤40`、`description ≤500`、`tags ≤16`、对象数 ≤500、`mats ≤8/物体`、
`note ≤20000`、`terrainEdits ≤2000`、`bookmarks ≤100`、JSON 深度 ≤12、
所有坐标为有限数且 |v|≤10000、枚举字段必须命中白名单、序列化后 ≤2MB（云写前检查）。

---

## 7. 安全方案

| 面 | 措施 | 责任模块 | 验证 |
|---|---|---|---|
| 租户隔离 | RLS `owner_id` 是**唯一安全边界**；客户端 `eq('slot', id)` 只是查询条件，不作为鉴权 | `cloud-gateway.js` | 用两个测试账号交叉读，预期 0 行 |
| owner_id 写入 | 现有 `cloudSave()` 不显式写 `owner_id`，依赖库默认/触发器；**待验证**，若不生效需云侧补默认 | S-13 | 新世界 insert 后能读回且他人读不到 |
| 输入校验 | 所有 payload 写入前 `Validate.assert()`；JSON.parse 后无原型污染（不 `Object.assign` 到原型） | `validate.js` | 恶意长串/深嵌套/非法枚举被拒 |
| XSS | 用户文本（笔记/标签/搜索结果）一律 `textContent`；现有 `main.js` 的 `innerHTML` 拼接列为待修项 | `ui/*` | 注入 `<img onerror>` 不执行 |
| 错误脱敏 | toast 只显示错误码与中文短句；不输出 endpoint/publishableKey/token/堆栈；console 仅代码 | 全层 | 断网/403 场景截图检查 |
| GitHub | 只 GET 白名单域名；无 token；不加载远端 JS；`.glb` 先验大小再 parse | `github-*.js` | 非白名单 URL 零请求 |
| 认证回调 | 沿用 `restoreAuth()` 先于 gate，成功后清理 `code/state/provider`；SW 禁止缓存带这些参数的 GET | `cloud.js`、`sw.js` | 回调 URL 不留痕 |
| 删除确认 | 删除/覆盖世界必须二次确认；迁移不清空旧键 | `manager-page.js` | 取消后数据仍在 |

---

## 8. 风险清单

| # | 风险 | 等级 | 影响 | 缓解 | 触发/验证 |
|---|---|---|---|---|---|
| R1 | `EffectComposer` 与 scissor 叠加状态冲突 | 高 | FX 视窗闪烁或主画面被污染 | 先 composer 后叠加；像素级冒烟；失败降级为单视口+降画质 | S-09 |
| R2 | `wb_saves` 不自动写 `owner_id` / RLS 策略未知 | 高 | 多用户隔离失效或写入失败 | S-13 双账号验证；不行则要求云侧补默认（需用户审批） | S-13 |
| R3 | CloudBase jsonb 体积/查询上限未知 | 中 | 大世界同步失败 | 客户端 2MB 上限 + 列表只取元数据 + 错误提示 | S-17 |
| R4 | 无服务端限流/备份 | 中 | 恶意刷写或误删无恢复 | 客户端限流/退避 + 本地备份 + 导出 JSON；列为后续云函数需求 | S-16 |
| R5 | GitHub API 匿名限流（搜索约 10 次/分）或 CORS 变化 | 中 | 搜索不可用 | TTL 10min 缓存 + 精选 catalog 降级 + 明确提示 | S-19 |
| R6 | IndexedDB 在隐私模式/低配额不可用 | 中 | 保存失败 | 降级 localStorage（仅小存档）+ 强制导出文件提示 | S-02 |
| R7 | v3 存档被旧版页面回写覆盖 | 中 | 迁移成果丢失 | 迁移后旧键只读保留；加载顺序固定；旧版页面提示升级 | S-01 |
| R8 | 多视窗输入路由误选物体 | 中 | 误编辑 | 命中测试先判视窗再转 NDC；FX 视窗默认只读 | S-11 |
| R9 | 移动端 WebGL context lost | 中 | 黑屏 | 监听 `webglcontextlost` → 显示重载提示 + 从 outbox 恢复 | S-23 |
| R10 | `tests/` 为空，验证驱动无基线 | 高 | 回归不可控 | S-04 先建 `node:test` 骨架与 fixtures，再写功能 Story | S-04 |
| R11 | Page 节点冻结与 GitHub 写权限 403 | 中 | 无法线上验证 | 本轮只做本地静态服务器验证；上线/推送均需用户审批 | S-24 |
| R12 | `main.js` 既有 `innerHTML` 拼接 | 中 | 存储型 XSS | 列入 S-17 一并改为 textContent | S-17 |

---

## 9. 测试策略与证据路径

- 框架：**Node 内置 `node:test`**（`package.json` 已是 ESM，`type:module`），零新增依赖，沙箱可跑。
- 纯逻辑（schema/migration/validate/index merge/退避/视窗矩形）做单元测试；
  浏览器侧（composer 叠加、输入路由、IDB、SW）做静态服务器 + Edge 手工冒烟，记录截图到 `tests/evidence/`。
- 每个 Story 的具体证据路径见 `production/epics/EPICS.md` 的「证据」列。
- 全局验收命令（实现阶段）：`node --test tests/**/*.test.js` + `python -m http.server 8080` 后浏览器冒烟。

---

## 10. 待用户/主理人确认（本轮不擅自执行）

1. 云端 Page 节点 `PswMzviTMbzUhZZS1aNhac` 何时允许更新（本轮冻结）。
2. 是否允许云侧补 DDL/云函数（用于服务端限流、历史版本、触发器写 `owner_id`）；当前方案不依赖它。
3. GitHub 推送仍受 MCP 403 限制；如需上线，由用户在本地执行 `git push` 或重新授权（reconnect 已被拒绝，不再尝试）。
4. 2MB 云 payload 上限、匿名 GitHub 搜索限额需在实现首日实测确认，若与假设不符则按 ADR-03 的降级路径处理。
