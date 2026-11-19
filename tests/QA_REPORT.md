# ForgeVerse v8 · 最终质量门 QA 报告（FV-QA-01 / 复验 FV-QA-01R ×2）

| 项目 | 内容 |
|---|---|
| 任务 | FV-QA-01 · 最终质量门（P0）→ **FV-QA-01R 三处修复复验（最终轮：D2 单项快验）** |
| 验证人 | 严守真（quality-lead）· 独立验证，未参与任何撰写与修复 |
| 项目根 | `D:/WorkBuddy/2026-10-16-00-30-25/workbench3d/` |
| Node | `C:/Users/28767/.workbuddy/binaries/node/versions/22.22.2-6/node.exe` (v22.22.2) |
| 判定（最终） | **CONCERNS**（由 FAIL 降级；静态/真实 DOM 全通过，仅余浏览器实测项） |
| 复验日期 | D2 根因修复后最终复验 |

> **最终结论**：D1（残留 #intro）、D3（工具条未接线）已确认修复；D2（配置页生态选择无效）经采用推荐方案 (a)——`pick()` 选择器删除 `[aria-checked="true"]` 分支后，**真实 DOM 验证四值全部正确**（grass/snow/desert/cyber 各自命中），场景/配置选择器仍隔离，26 模块语法全通过。所有静态与逻辑层检查通过，无遗留确定性缺陷 → 判定由 FAIL 降为 **CONCERNS**（保留浏览器实测项）。

> 降级依据：判定规则「全通过但存在需浏览器确认项 → CONCERNS」。本轮 D2 的 11 项 jsdom 断言全 PASS，阻断项清零。

---

## 判定总览（最终）

| # | 验证目标 | 首轮 | 复验1 | 最终 | 计数（最终） |
|---|---|---|---|---|---|
| 1 | 静态检查（node --check / 跨模块符号 / DOM ID） | PASS | PASS | **PASS** | 26/26 语法；225 具名 import 0 缺失；224 DOM 引用 0 缺失 |
| 2 | 场景键映射（grass/snow/desert/cyber） | PASS | PASS | **PASS** | 4/4 键存在且四层齐全 |
| 3 | 世界隔离 smoke | PASS | PASS | **PASS** | 11/11 断言通过 |
| 4 | 接线正确性审查 | FAIL | FAIL | **PASS** | D1 ✅ / D2 ✅ / D3 ✅ 全部修复并验证 |
| 5 | UX_SPEC §7 验收点对照（抽 10 条） | — | — | **5 静态 PASS / 5 需浏览器** | 见第 5 节 |

### 三处修复逐项结论（最终）

| 缺陷 | 修复方案 | 最终结论 | 证据 |
|---|---|---|---|
| D1 残留 intro | 删除 boot 末尾 `intro.classList.remove('hidden')` | ✅ **已修复** | `main.js` 全文检索该表达式 **0 处**；`showManager()` 仍在 boot（:106） |
| D2 生态选择无效 | 方案 (a)：`pick()` 选择器删除 `[aria-checked="true"]` 分支 | ✅ **已修复** | `main.js:425` 选择器现为 `sel+' .active, '+sel+' [data-active="true"]'`；jsdom 真实 DOM 四值点击全对，11/11 PASS |
| D3 工具条未接线 | 新增 `wireManagerToolbar()` 并在 wireUI 调用 | ✅ **已修复** | `main.js:481-574` 定义 + `:381` 调用；11 控件全部在 HTML+JS；CSS `[data-layout]` 三态齐全 |

---

## 目标 1 · 静态检查（PASS · 最终重跑）

### 1.1 `node --check js/*.js` — 26/26 PASS
对 `js/` 下全部 26 个 `.js` 逐个执行，全部退出码 0，无报错（含最终修改的 `main.js`）。

### 1.2 跨模块 import/export 符号校验 — 225 项 0 错误
```
named imports checked: 225 | errors: 0
```
`main.js` 从 `world-manager.js`（22 符号）、`viewport.js`（6 符号）、`io.js`（含 `deserializeWorld`）导入全部存在。

### 1.3 DOM ID 引用校验 — 224 处 0 缺失
```
DOM refs checked: 224 | html ids: 202 | errors: 0
```

---

## 目标 2 · 场景键映射（PASS）

`registerProBiomes()` 四键覆盖注册，`boot()` 在 `main.js:86` 调用；grass/snow/desert/cyber 四层（terrain/buildings/decor/road）齐全。架构门 CONCERNS 项保持关闭。

---

## 目标 3 · 世界隔离 smoke（PASS · 11/11）

Node + stub 直接加载生产 `world-manager.js`：`createWorld` 两次不同 id、切换 A/B snapshot 隔离、删除 B 不误伤 A、四生态键四层齐全 —— 11/11 PASS。真实 WebGL 几何体释放仍需浏览器确认。

---

## 目标 4 · 接线正确性审查（PASS · 最终）

### 4.1 五项子检查（最终）

| 子项 | 要求 | 结果 | 证据 |
|---|---|---|---|
| ① | 导入 world-manager/viewport API 且符号存在 | **PASS** | `main.js:33-39`；225 符号校验 0 缺失 |
| ② | boot 调 showManager 且无残留 #intro 弹出 | **PASS** | `main.js:106` showManager；全文无 `intro.classList.remove('hidden')` |
| ③ | wcSubmit 走 createWorld→openWorld→enterWorkspace，无二次 startWorld | **PASS** | `main.js:468-477` 链路正确 |
| ④ | data-biome-switch 隔离 + 配置生态值生效 | **PASS** | 选择器隔离（场景 3 / 配置 4 零交集）；四值点击全对（见 D2 验证） |
| ⑤ | 返回管理页按钮先 saveWorld | **PASS** | `main.js:370-373` |

### 4.2 三处缺陷最终状态

#### ✅ D1 · [已修复] boot 残留 `#intro` 弹窗
- `main.js:174` 的 `$('intro').classList.remove('hidden')` 已删除；全文正则检索 **0 处**。`boot()` 收尾仅剩 loading 隐藏 + 注释。入口统一由 `showManager()` 展示。AC-1.4 静态达标。

#### ✅ D2 · [已修复] 配置页生态选择无效 —— 最终轮快验
- **最终修复**：`main.js:424-425` 的 `pick()` 选择器由
  `sel+' .active, '+sel+' [aria-checked="true"], '+sel+' [data-active="true"]'`
  改为 `sel+' .active, '+sel+' [data-active="true"]'`，删除了 `[aria-checked="true"]` 分支（:424 附说明注释）。点击处理器（`main.js:459-464`）维持互斥切换 `.active` / `data-active`，两者自洽。
- **验证方法**：jsdom 加载**生产 `index.html`**，从**生产 `main.js` 源码中原样提取 `pick` 函数体**（`new Function` 重建，非手抄），等价复现 `readConfigFromDom().biome`；复刻 `wireWorldConfig` 点击处理器与场景 `buildBiome` 处理器，触发真实 `button.click()`。
- **真实 DOM（jsdom）验证输出（最终）**：
```
=== D2 QUICK RE-VERIFY (jsdom, production index.html + verbatim pick) ===
PASS  pick() 源含 data-biomeSwitch 读取
PASS  pick() 源已移除 aria-checked 分支  [selector=sel + ' .active, ' + sel + ' [data-active="true"]']
PASS  配置页 4 张生态卡  [count=4]
PASS  初始 biome = grass  [got=grass]
PASS  点击 snow  → readConfigFromDom().biome = snow   [got=snow | active=snow | data-active=true=snow | aria-checked(true)=grass]
PASS  点击 desert → readConfigFromDom().biome = desert [got=desert | active=desert | data-active=true=desert | aria-checked(true)=grass]
PASS  点击 cyber → readConfigFromDom().biome = cyber   [got=cyber | active=cyber | data-active=true=cyber | aria-checked(true)=grass]
PASS  点击 grass → readConfigFromDom().biome = grass   [got=grass | active=grass | data-active=true=grass | aria-checked(true)=grass]
PASS  点击配置卡不触发场景 buildBiome  [sceneBuildCalls=[]]
PASS  场景按钮仍独立可点（buildBiome 命中）  [sceneBuildCalls=["desert"]]
PASS  场景选择器命中 3 项且与配置零交集  [scene=3]
TOTAL pass=11 fail=0
```
  关键观察：即便 `aria-checked(true)` 仍残留在 grass 上（点击处理器按设计不更新它），因选择器已移除该分支，`pick()` 正确地跟随 `.active` / `data-active` 返回所选值。阻断项根除。
- **影响消除**：用户选雪原/沙漠/赛博后创建世界，`config.biome` / `biomeName` / `theme` 均正确为所选生态。AC-4.2、AC-1.2 数据层达标。

#### ✅ D3 · [已修复] 管理页工具条与卡片 ⋯ 菜单未接线
- `wireManagerToolbar()` 定义（`main.js:481-574`）+ `wireUI()` 调用（`:381`）。11 控件全部 HTML+JS 在位：
```
wmWorldCount / wmFilterBiome / wmFilterSync / wmSortBy / wmSearch / wmExportAll / wmImportSave / wmSettings : js=true
wmLayoutGrid / wmLayoutList / wmLayoutTimeline : 经 .wm-layout class 选择器覆盖（:486-490）✅ 计入有效
.wm-layout selector wired: true | [data-more] wired: true（:552-570 事件委托）
```
- 三排布通过 `.wm-layout` class 统一绑定并设置 `box.dataset.layout`（`:489`）；CSS `.wm-worlds[data-layout="grid|list|timeline"]` 三态齐全（`css/3d.css:323-325,334-343`）。

---

## 目标 5 · UX_SPEC §7 验收点对照（抽 10 条 · 最终）

图例：**静态可确认** = 源码/真实 DOM/stub 可直接判定；**需浏览器** = 视觉/层级/真实 WebGL/交互。

| AC | 验收点 | 分类 | 最终判定 / 依据 |
|---|---|---|---|
| AC-1.2 | 四生态选项卡片单选、选中态描边角标 | 数据层真实 DOM + 视觉需浏览器 | **数据层 PASS**（四值点击全对，D2）；选中态视觉反馈需浏览器 |
| AC-1.4 | 进入流程不再出现 `#intro`/`#themePick` 小弹窗 | 静态可确认 | **PASS** — `main.js` 无 `intro.classList.remove('hidden')`（D1） |
| AC-2.1 | 点入口先进入全屏管理页（非弹窗） | 需浏览器 | `#worldManager` 为 `.fullscreen-page`（`index.html:421`）+ `showManager()`；实际层级需浏览器 |
| AC-2.2 | 三排布，切换一致且持久化 | 静态 + 需浏览器 | **静态 PASS**（D3 接线 + CSS 三态）；「持久化」需浏览器 |
| AC-2.4 | 筛选（生态/同步）与排序可用且正确 | 静态 + 需浏览器 | **静态 PASS**（4 控件绑定，D3）；结果语义正确性需浏览器 |
| AC-3.1 | 可创建 ≥3 世界并显示 | 逻辑静态 / UI 需浏览器 | `createWorld` 无上限；smoke 验证 2 个；3 卡渲染需浏览器 |
| AC-3.2 | 世界 A 物体/天气切到 B 不存在，切回 A 仍在 | 静态+runtime | **PASS** — 世界隔离 smoke 通过 |
| AC-3.3 | 单击卡片进入；返回后卡片更新时间刷新 | 部分静态 / 需浏览器 | `renderManager` 用 `relTime` + `emit('world:list')`；`bindManagerActions`→`openWorld`；`wmWorldCount` 已接线；真实点击/刷新需浏览器 |
| AC-4.1 | 配置页组 A/B/C 共 13 项，组 C 默认折叠 | 静态可确认 | **PASS** — 三组齐全，`wcGroupC` 用 `<details>` 默认折叠 |
| AC-4.2 | 配置项默认值符合 §3，修改后生效于新世界 | 真实 DOM/静态 | **PASS** — 生态项四值真实 DOM 全对（D2）；默认 seed/weather/quality 对齐 |

**统计**：10 条中 **5 条静态/真实 DOM PASS**（AC-1.2 数据层、AC-1.4、AC-2.2 静态部分、AC-2.4 静态部分、AC-3.2、AC-4.1、AC-4.2 中可判部分）；**全部无静态 FAIL**；涉及视觉/交互/持久化的 **5 条需浏览器**。

### 需浏览器确认项（CONCERNS 保留）
1. **AC-1.1** 世界名输入框「大字号美观」视觉。
2. **AC-1.3** 新建入口按钮尺寸/圆角、点击无卡顿。
3. **AC-2.1 / AC-2.3** 全屏管理页层级、L0–L4 五区视觉。
4. **AC-5.1 / AC-5.2** 冗余文案静态全文检索无匹配（PASS）；替换文案视觉需浏览器。
5. **AC-6.1 / AC-6.2** 视觉层级、留白、3D 视窗不被遮挡，需截图。
6. **D1 收尾**：启动后无 `#intro` 视觉残留/焦点拦截（静态已达标）。
7. **D2 用户可见后果**：真实浏览器选「赛博」→创建→加载，场景确为赛博（jsdom 已证配置层正确，确认端到端呈现）。
8. **D3 行为**：三排布切换视觉、筛选/排序结果语义、搜索过滤、⋯ 菜单（`window.prompt/confirm`）实际可用、刷新后排布持久化。
9. **世界隔离真实副作用**：`disposeGroup` 几何体/材质释放、`App.engine.remove`（stub 盲区）。

---

## 质量门结论与建议（最终）

- **判定：CONCERNS**（由 FAIL 降级）。D1/D2/D3 三处缺陷全部修复并经静态 + 真实 DOM 验证；所有确定性检查通过。
- **降级理由**：静态与逻辑层无遗留缺陷；剩余均为需真机/浏览器确认的视觉、交互持久化与 WebGL 副作用项，符合 CONCERNS 定义。
- **放行建议**：可进入浏览器实测阶段；建议按「需浏览器确认项」清单逐条验收后再做发布签字。高影响动作（发布签字）须人工审批。
- **已达标无需返工**：静态语法/符号/DOM、四生态键映射、世界隔离逻辑、D1、D2、D3。
- 本质量门为建议性门控（advisory），最终放行由用户决定。

### 附：验证命令与脚本记录（最终轮）
- 语法：`node --check <每个 js>` ×26 → 全 PASS（最终 `main.js`）。
- **D2 真实 DOM 快验**：`C:/Users/28767/AppData/Local/Temp/fvqa_dom/verify_d2.js`（jsdom；加载生产 `index.html`，从生产 `main.js` 原样提取 `pick` 函数体重建，复刻点击与场景处理器）→ **11 PASS / 0 FAIL**。
- 静态校验（前轮，仍有效）：`static.js` → 225 符号 0 缺失、224 DOM 0 缺失、intro 表达式 0 处、11 控件全部在 HTML+JS。
- 世界隔离+场景键 smoke（前轮，仍有效）：`fvqa2_smoke_run.mjs` → 11 PASS / 0 FAIL。
- 临时脚本与 `jsdom` 均位于系统临时目录，**未入项目**；未修改任何业务代码；唯一项目内产物为本报告。

## 浏览器实测补记（2026-11-19 · 主理人执行）
- 环境：本地 `python3 -m http.server 8090`，WorkBuddy 内置浏览器（桌面 IAB），视窗 799×702。
- **D1 实测 PASS**：启动直接进入全屏世界管理页「我的世界」——暗金 CTA、网格/列表/时间轴工具条、空状态「还没有世界」、状态条全部呈现；**旧 `#intro` 弹窗未出现**，与静态结论一致（见截图证据）。
- **D2/D3**：内置浏览器在运行 WebGL 的重页面上 CDP 点击/截图多次超时（provider invocation timed out），交互点击未能完成；D2 以 QA 真实 DOM 11/11（jsdom 直接加载生产 index.html + 原样提取 pick 函数体）为权威结论，D3 以静态接线验证为准。此为本环境工具限制，非产品缺陷。
- **未能在浏览器验证**：选赛博→创建→场景视觉确为赛博、三排布切换视觉、⋯菜单（prompt/confirm）、WebGL 几何体释放、刷新持久化。这些仍列为 CONCERNS 待人工在有 GUI 的浏览器复核。
