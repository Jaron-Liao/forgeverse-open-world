# ForgeVerse 架构决策记录（ADR 集合）

> 版本：v1.0 ｜ 日期：2026-11-19 ｜ 作者：程基岩（engineering-lead）
> 任务：FV-ENG-01 ｜ 状态：供评审
> 约定：每条 ADR 必须包含 Context / Decision / Consequences；备选方案与「待验证」不得省略。
> 数据契正如正文引用，正本在 `docs/architecture/ARCHITECTURE.md` 第 6 节。

---

## ADR-01 · 多世界独立存档：复用 `slot` 作为 worldId

- 状态：Accepted（待 S-13 实测验证）
- 影响层：L4 数据层 / L2 世界管理层

### Context

现状只有一份存档：本地 `localStorage['forgeverse_v1']`（`js/io.js:11,52`），云端 `wb_saves` 的 `slot='main'`（`js/cloud.js:88-118`）。
需求是「每个世界独立存档、互相隔离、点存档回到对应世界」。云表结构已固定为
`id, owner_id(text,RLS), owner_name, slot, world_name, payload(jsonb), created_at, updated_at`，
唯一键 `UNIQUE(owner_id, slot)`。本轮**没有云侧 DDL 权限/授权**。

### Decision

1. **不为世界建新表**。把 `slot` 直接复用为 `worldId`（例如 `w_1731...`）；一个世界 = 一行 `wb_saves`。
2. 世界列表 = `select('id, slot, world_name, updated_at')`，不拉 `payload`。
3. payload 内 `worldId` 与 `slot` 必须一致（写入前由 `Validate.assert()` 校验）；不一致以 payload 为准并告警。
4. 本地采用 `fv.worlds.index.v1`（索引）+ IndexedDB `worlds` store（payload 按 id 分键）；
   旧键 `forgeverse_v1` 只读保留，首次运行迁移成一个世界，记录 `legacySlot:'main'`。
5. 云端旧的 `slot='main'` 行**不删除、不改名**，仅作为可迁移的旧世界展示，避免不可逆数据丢失。

### Alternatives

| 方案 | 优点 | 否决理由 |
|---|---|---|
| 新建 `worlds` 表 + `world_id` 主键 | 语义清晰，可加索引/历史表 | 需云侧 DDL 与 RLS 策略配置，本轮无权限，阻塞交付 |
| 一个 `slot='main'` 里存 `{ worlds: [...] }` 数组 | 零 schema 改动 | 每次写重写全部世界；并发冲突放大到全量；违反「互相隔离」 |
| 本地多文件 + 云端仍单 slot | 本地隔离了 | 云端仍互相覆盖，不满足跨端需求 |

### Consequences

- 正面：零云侧变更即可落地；天然继承 `owner_id` RLS 与唯一键；列表查询轻量。
- 负面：`slot` 语义从「存档槽位」变成「世界 ID」，需在文档中固定，避免后续误用 `main`。
- 负面：没有服务端历史版本表，历史备份只能放本地（IndexedDB `backups` + 手动导出 JSON）。
- 约束：`worldId` 一旦写入不可更改；改名只改 `world_name`/`name`，不动 `slot`。
- 验证：S-01、S-02、S-13、S-14；双账号交叉读取应返回 0 行。

---

## ADR-02 · 独立特效视窗：单 renderer + scissor/viewport 多视窗

- 状态：Accepted（渲染顺序待 S-09 像素级验证）
- 影响层：L3 渲染层

### Context

现有 `createEngine()` 创建**一个** `WebGLRenderer`，`render-pipeline.js` 的 `EffectComposer` 绑定该 renderer 与全画布。
需求增加一个「可独立渲染的特效视窗」。引擎固定 Three.js r160，本地 vendor，无构建。

### Decision

1. **单 WebGLRenderer + scissor/viewport**，不创建第二个 canvas / WebGL context。
2. 引入 `ViewportRegistry`：视窗描述为 `{id, rect, camera, scene, mode, enabled}`；主视口 `rect=null` 表示全画布；
   FX 视窗默认关闭、位于右下、宽高各 24%、DPR ≤1。
3. 渲染顺序固定：
   `composer.render()`（主视口后处理，输出到整张 canvas）→ `autoClear=false` → `setScissorTest(true)` →
   对每个附加视窗 `setViewport/setScissor(rect)` → `clear(true,true,true)` → `renderer.render(fxScene, fxCamera)` →
   恢复全画布 viewport / scissorTest / autoClear。
4. FX 视窗使用**轻量渲染**：无 SSAO/Bloom、无阴影、独立 scene/camera，几何与纹理从主场景共享引用。
5. 输入：先按矩形命中视窗，再转换该视窗的 NDC；FX 视窗默认**只读**（不参与主世界拾取）。
6. 截图：主视口与 FX 视窗分别用 canvas 按 DPR 裁剪导出，避免互相包含。

### Alternatives

| 方案 | 优点 | 否决理由 |
|---|---|---|
| 多 canvas / 多 WebGLRenderer | 隔离最干净，每个视窗可跑自己的 composer | 每 context 都有内存与上限（移动端常见 8~16 个），context lost 风险高；几何/纹理无法共享 |
| 单 canvas 但每个视窗各跑一个 composer | 后处理独立 | 多个 EffectComposer 争夺同一 renderer 的 render target 与 viewport 状态，复杂度高、收益小 |
| CSS 叠加两个透明 canvas | 实现简单 | 仍是两个 context，且合成与输入层级更难管 |

### Consequences

- 正面：一个上下文、一套 GPU 资源；移动端更稳；共享几何/纹理，显存增量接近零。
- 负面：后处理只作用于主视口；FX 视窗无 Bloom/SSAO（设计上接受）。
- 负面：所有视窗共享一次 `requestAnimationFrame`，FX 视窗无法独立帧率；通过降级阶梯控制成本。
- 负面：输入路由、截图裁剪、resize 都需要正确处理 DPR 换算（易错点，列为 S-11 验收）。
- **待验证**：r160 的 `OutputPass` 是否完全恢复 renderer viewport/scissor 状态；首日写像素级冒烟。
  若失败，降级预案：主视口也改回 `renderer.render()` + 仅 tone mapping（画质档位退一级）。
- 验证：S-09、S-10、S-11、S-12。

---

## ADR-03 · 腾讯云多用户 / 并发 / 数据保护

- 状态：Accepted（云侧行为待 S-13 验证）
- 影响层：L4 数据层 / L5 集成层

### Context

`wb_saves` 已启用 RLS（`owner_id`），SDK 为浏览器直连的 WorkBuddy CloudBase（publishable key 公开）。
需求包含「多用户信息、实时反馈、大规模并发、云端控制、数据保护」。
现状 `cloudSave()` 不写 `owner_id`、先查再写、无版本号、无限流（`js/cloud.js:97-118`）。

### Decision

1. **安全边界只认 RLS**：`owner_id` 由云端默认/触发器写入（**待验证**），客户端任何 `eq('owner_id')` 都不算鉴权。
2. **乐观并发**：payload 带 `rev`，写入以 `baseRev` 为条件；返回 0 行视为冲突，交用户三选一（云端覆盖 / 本地强制覆盖 / 另存为新世界）。
   `updated_at` 作为展示用最后更新时间；不实现静默 last-write-wins。
3. **客户端限流**：单世界写云 ≤1 次/10s；outbox 同 id 合并；429/5xx 退避 1/2/4/8/16s 带抖动，5 次转离线。
4. **输入校验**：所有写云前 `Validate.assert(payload)`（白名单枚举、范围、数量、体积、深度）。
5. **数据保护**：
   - 传输：SDK/HTTPS；publishable key 公开但**不得在日志/toast 中出现**；
   - 存储：RLS 行隔离；不在浏览器保存用户令牌；
   - 备份：本地 IndexedDB 保留最近 3 份迁移/覆盖前副本 + 手动导出 JSON；
   - 错误脱敏：只回错误码与中文短句，console 不打印 payload/token。
6. **实时反馈**：当前不做 WebSocket 订阅（SDK 能力未确认）；采用「进入/回到页面时刷新列表 + 手动刷新按钮 +
   写成功后即时更新卡片」的准实时方案。若后续确认支持订阅，再作为增强项另开 ADR。

### Alternatives

| 方案 | 优点 | 否决理由 |
|---|---|---|
| 服务端权威 + 事务锁表 | 真正强一致 | 需要云函数/DDL，本轮无权限；且离线优先场景不适合强锁 |
| 静默 last-write-wins | 实现最简单 | 用户会无声丢数据，违背「数据保护」 |
| 客户端自行写 `owner_id` 并过滤 | 看似隔离 | 可被篡改，伪安全；RLS 才是边界 |

### Consequences

- 正面：零云侧改动即可获得用户隔离与基本并发安全；离线时功能不降级。
- 负面：冲突需要用户决策，产品上要提供清晰的三选一 UI。
- 负面：无服务端限流、无服务端备份、无真正推送；列入风险 R3/R4 与待用户确认项。
- **待验证**：`owner_id` 是否自动落库；`update().eq(...).eq(...)` 是否按预期返回受影响行数；
  `jsonb` 实际大小上限；列表查询最大行数。均由 S-13/S-17 冒烟确认。
- 验证：S-13、S-15、S-16、S-17。

---

## ADR-04 · GitHub Skill 检索管理架构（含 MCP 403 降级）

- 状态：Accepted
- 影响层：L5 集成层 / L1 UI 层

### Context

需求：页面提供从 Edge 访问 GitHub 免费开源 skill 的入口，并支持后台同步检索与管理 GitHub skill；
同时 GitHub 已有建模资源要能导入工作台。
已知约束：GitHub MCP 集成**写权限 403（只读）**，reconnect 被用户拒绝；但 Edge 浏览器网页登录态可建仓。

### Decision

1. **架构分三条互不依赖的路径**：
   - **入口**：管理页提供「GitHub Skill」卡片与外链（GitHub Topics / `awesome-gamedev-agent-skills` 等），
     使用户可用 Edge 登录态直接浏览/建仓；不调用 MCP 写接口。
   - **检索**：浏览器直连 `GET https://api.github.com/search/repositories?q=…&sort=stars&per_page=10`。
     仅 GET、无 token、无写操作；结果与 TTL（10 分钟）缓存写入 IndexedDB。
   - **管理**：收藏/标签/笔记存浏览器本地偏好（`fv.skills.prefs.v1`），**不进入世界 payload**，避免污染存档。
2. **内置精选 catalog**：`data/skills-catalog.json`（源自 `docs/TECH_SELECTION.md` 的已筛选项目）。
   离线、限流、CORS 失败时自动降级为「离线精选模式」，功能不空白。
3. **GitHub MCP 403 的降级**：架构不依赖 MCP 写；需要建仓/推送时只给出「在 Edge 手动操作」或
   「用户本地 `git push`」说明，不重试、不请求 reconnect。
4. **资源导入白名单**：只接受 `raw.githubusercontent.com` / `github.com` 域名、**仅 `.glb`**；
   先 `fetch` 校验体积上限，再 `GLTFLoader.parse(arrayBuffer)`；失败提示「在 Edge 下载后走本地导入」。
   `.gltf` 因外链资源路径问题只支持本地文件导入。
5. **安全**：不加载/执行远端 JS，不存 GitHub token，不用自定义请求头（避免不必要的 CORS 预检）。

### Alternatives

| 方案 | 优点 | 否决理由 |
|---|---|---|
| 通过 MCP 写仓库/建索引 | 自动化程度高 | 403 明确不可写；reconnect 已被拒绝，不能作为依赖 |
| 自建后端代理 GitHub API | 可提额、可缓存 | 本轮纯静态无服务端；引入运维成本，违背离线优先 |
| 只用静态链接列表 | 最简 | 不满足「后台同步检索管理」 |

### Consequences

- 正面：完全绕开 403；离线可用；无密钥泄露面；实现只增前端静态文件。
- 负面：匿名搜索有速率限制（约 10 次/分，**待实测**），靠 TTL 与缓存缓解。
- 负面：只能读公开仓库，用户私有 skill 需经 Edge 手动下载后本地导入。
- **待验证**：`api.github.com` / `raw.githubusercontent.com` 在目标浏览器的 CORS 行为；
  若 `If-None-Match` 触发预检失败，则不启用 ETag，仅用 TTL（本决策已按不用 ETag 设计）。
- 验证：S-18、S-19、S-20、S-21。

---

## ADR-05 · PWA 离线保存与刷新策略

- 状态：Accepted
- 影响层：L4 数据层 / L5 集成层 / 交付配置

### Context

现有 `sw.js` 对所有 GET 采用「网络优先 + 全部写入缓存」，会误缓存认证回调（`code/state`）、
云端 API 与 GitHub 响应；缓存版本 `forgeverse-v6`。
现有保存依赖 `localStorage` 同步写入（约 5MB 上限）与用户手动点击，移动端「随时保存与刷新」无保障。

### Decision

1. **存储分层**：
   - IndexedDB `worlds` store = 世界 payload 的**权威本地副本**（按月台 id 分键）；
   - IndexedDB `outbox` store = 待同步队列；`backups` store = 覆盖前快照（≤3/世界）；
   - `localStorage` 只放小索引、偏好、旧版迁移键。
2. **写入顺序**：本地先落盘成功才算「保存成功」；云端是异步增强。
3. **触发时机**：编辑后防抖 2s、最长 10s；`visibilitychange:hidden` / `pagehide` 强制 flush；
   `online` 事件与启动/回到页面时消费 outbox。不依赖 `beforeunload` 等待异步。
4. **Service Worker 分流**（缓存版本升级为 `forgeverse-v7`）：
   - 导航/静态资源（HTML/CSS/JS/vendor/manifest）：缓存优先 + 后台更新；
   - 认证回调与云 SDK API URL（含 `code`/`state`/`provider` 或工作云域名）：**仅网络，绝不缓存**；
   - `api.github.com` / `raw.githubusercontent.com`：仅网络，由应用层 TTL 缓存在 IndexedDB；
   - 导航离线兜底：`caches.match('./index.html')`。
5. **刷新语义**：提供显式「刷新云端」按钮；进入/回到页面自动刷新列表；
   有未同步修改时先 flush 再拉取，冲突按 ADR-03 处理。
6. **降级**：IndexedDB 不可用（隐私模式/配额）时退回 localStorage（仅小存档）+ 强制提示导出文件。

### Alternatives

| 方案 | 优点 | 否决理由 |
|---|---|---|
| 继续只用 localStorage | 零新依赖、同步简单 | 配额小、大场景必爆；且无法做 outbox 与快照 |
| Background Sync API | 系统级补发 | 浏览器支持不一致，沙箱不可验证；作为未来增强而非依赖 |
| 依赖云端为准 | 无本地冲突 | 离线即不可用，违背需求⑧与离线优先准则 |

### Consequences

- 正面：离线完整可用；移动端切后台/杀进程前尽量落盘；认证与 API 不再被污染缓存。
- 负面：引入 IndexedDB 异步 API，所有存储调用需 `await`；`main.js` 的同步保存路径要适配。
- 负面：`beforeunload` 无法保证异步完成，仍有极端丢失窗口（真实局限，写入风险表 R9 之外的已知限制）。
- 验证：S-02、S-16、S-22、S-23。

---

## ADR-06 · v4 存档契约、纯函数迁移与严格校验

- 状态：Accepted
- 影响层：L4 数据层 / L2 世界管理层

### Context

v3 payload（`js/io.js:29-49`）已含主题/种子/任务/笔记/书签/地形编辑，但**没有世界 ID、版本号语义、
视窗设置、乐观并发字段**。`deserialize()` 对坏档只弹 toast 后继续，可能留下半加载状态（`js/io.js:64-101`）。
多世界与跨端同步要求存档可演进、可测试、坏档可抢救。

### Decision

1. 定义 v4 契约（正本见 `ARCHITECTURE.md` 第 6 节）：新增 `worldId/rev/timestamps/viewportSettings/assets/tags/progress`，
   并把 v3 的 `note/tasks` 归入 `notes`、`terrain/theme/...` 归入 `config`、`objects` 归入 `scene`。
2. 迁移器是**纯函数链式迁移**（v3→v4），不碰 DOM/存储；结果可重复。
3. `schemaVersion > 4` **拒绝加载**并先导出原始 JSON；不做猜测性降版本。
4. 迁移/覆盖前把原字节写入 IndexedDB `backups`（≤3 份/世界）。
5. `Validate.assert()` 在**每次写入前**（本地与云端都）执行：枚举白名单、数值范围、数量与体积上限、深度上限；
   违反时拒绝写入并给字段级错误码，不静默裁剪。
6. 用户文本一律 `textContent` 渲染；迁移器不得把用户字符串拼进 HTML。

### Alternatives

| 方案 | 优点 | 否决理由 |
|---|---|---|
| 直接改 v3 字段、不升版本 | 改动最小 | 旧档与新档无法区分，跨端同步必然错乱 |
| 每个版本写一次性 if 迁移 | 短期快 | 不可组合、不可测试，版本多了必然出错 |
| 宽松校验（能读就写） | 容错强 | 坏档静默扩散到云端，且可能放大 XSS/体积问题 |

### Consequences

- 正面：迁移可单测；坏档可抢救；跨端有共同语言。
- 负面：所有写入路径必须记得调用 `Validate.assert()`——由 Story 验收与代码审查双重保证。
- 负面：v3 中布尔运算物体已降级为占位，迁移不伪造还原，只标记 `meta.migratedFromV3`。
- 验证：S-01、S-03、S-08。

---

## ADR 汇总与依赖

| ADR | 主要依赖 | 被哪些 Story 落地 |
|---|---|---|
| ADR-01 | 现有 `wb_saves` 结构 | S-01/02/13/14 |
| ADR-02 | Three.js r160 vendor | S-09/10/11/12 |
| ADR-03 | CloudBase SDK + RLS | S-13/15/16/17 |
| ADR-04 | GitHub 只读 API + Edge | S-18/19/20/21 |
| ADR-05 | PWA + IndexedDB | S-02/16/22/23 |
| ADR-06 | v3 存档现状 | S-01/03/08 |

> 本轮所有 ADR 均与钉定技术栈（Three.js r160、无构建静态站、WorkBuddy CloudBase）兼容；
> 凡涉及未确认 SDK/浏览器行为处均已标注「待验证」，不臆造 API。
