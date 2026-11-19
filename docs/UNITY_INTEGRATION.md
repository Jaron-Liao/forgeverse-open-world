# Unity 集成与高质量渲染方案

## 0. 现实边界（先读）

当前交付的 ForgeVerse 是**浏览器实时 3D 工作台**（Three.js / WebGL），已经能跑、能建模、能进资产库。本沙箱**没有图形界面，无法安装或启动 Unity 编辑器与 Blender**——所以这里给的是一套**可直接落地的 Unity 工程方案 + 安装配置步骤 + 对照脚本**，而不是在这台机器上真的装好 Unity。

两条路，按目标选：

| 目标 | 走哪条 |
|---|---|
| 现在就要一个能打开就用的开放世界工作台 | 用本仓库的网页版（`index.html`），无需 Unity |
| 要 Unity 原生工程、可出 Windows/Android 包、要 HDRP 影视级画质 | 按本文在**你自己的机器**上装 Unity 并搭工程，复用 `unity/Assets/Scripts/` 骨架 |

---

## 1. Unity 安装（在你本机执行）

### 1.1 用 Unity Hub（推荐）
1. 下载 Unity Hub：https://unity.com/download
2. 安装时勾选组件：
   - **Unity Editor 2022.3 LTS 或 6000.x LTS**（长期支持版，稳定）
   - 模块：`Windows Build Support (IL2CPP)`、`Android Build Support`（如需移动端）
   - **HDRP 模板**（High Definition Render Pipeline，做真实感必选）
3. Hub → Installs → Install Editor → 选 LTS 版本 → 勾选上述模块 → 安装
4. 新建项目时选模板 **「HDRP - High Definition 3D (URP 也行但真实感弱一档)」**

### 1.2 命令行静默安装（CI / 批量机）
```bash
# Windows（PowerShell，以管理员运行）
# 下载 Hub CLI 后用 unity-hub 安装指定版本；实际版本以 Hub 可装列表为准
Unity Hub.exe -- --headless install --version 2022.3.20f1 --changeset <从官网查> \
  --module windows-mono android-sdk android-ndk

# 验证安装
"${UNITY_HOME}/Editor/Unity.exe" -version
```
> `--changeset` 必须和版本号匹配，从 https://unity.com/releases/editor/whats-new 查，别手写。

### 1.3 环境变量（CI用）
```bash
export UNITY_HOME="/c/Program Files/Unity/Hub/Editor/2022.3.20f1"
export UNITY_LICENSE_FILE="$HOME/.config/unity3d/Unity_v2022.x.ulf"
```

---

## 2. 项目集成配置

### 2.1 目录结构（与网页版资产对齐）
```
ForgeVerse-Unity/
├── Assets/
│   ├── Scripts/                 # 复用仓库 unity/Assets/Scripts/
│   │   ├── WorkbenchManager.cs  # 总控：模式、物件生成
│   │   ├── CameraRig.cs         # 第一/第三人称 + 昼夜太阳
│   │   ├── TerrainGenerator.cs  # 种子化地形 + 雕刻
│   │   ├── VertexPainter.cs     # 顶点绘画（对应网页 paint.js）
│   │   ├── TaskBoard.cs         # 任务/XP/成就
│   │   └── BiomeLayer.cs        # 新增：三环境分层加载
│   ├── Art/
│   │   ├── Biomes/Desert/{Buildings,Terrain,Decor}/
│   │   ├── Biomes/Snow/{...}/
│   │   └── Biomes/Urban/{...}/   # 与网页 biomes.js 三层一一对应
│   ├── Imported/Tripo/           # Tripo 导出 GLB 放这里
│   ├── Imported/Blender/         # Blender 导出 FBX/GLB 放这里
│   ├── Settings/                 # HDRP 质量档位 Volume Profile
│   └── Scenes/Main.unity
├── Packages/manifest.json
└── ProjectSettings/
```

### 2.2 导入 Tripo / Blender 模型
- **Tripo**：https://studio.tripo3d.com 导出 **GLB**（带贴图）→ 拖进 `Assets/Imported/Tripo/`
- **Blender**：File → Export → glTF 2.0（`.glb`，勾选 Apply Modifiers）→ 拖进 `Assets/Imported/Blender/`
- 网页版同理：左侧「导入 GLB/GLTF」按钮 → 进资产库，两边模型格式通用

### 2.3 渲染管线设置（HDRP）
1. Edit → Project Settings → Graphics → Scriptable Render Pipeline = HDRP Asset
2. 创建 Quality 档位（低/中/高/电影级），对应网页版 4 档：
   - Shadow Quality、MSAA、SSAO、Bloom、DOF 逐级提升
3. 场景加 `Volume` 组件，挂 Profile：

```yaml
# HDRP Volume Profile 关键参数（在 Inspector 里设）
Sky/ProceduralSky:            # 程序化天空，对应网页 Sky addon
  Sun Disc: true
Lighting/PhysicalSky: on
Sun (Directional Light):
  Intensity: 3.0 lux 或 1.0（按曝光）
  Color Temperature: 5500K 正午 / 3200K 日出
  Shadows: High, Cascade 4, Bias 0.05
Post-processing:
  Bloom: threshold 1.0, intensity 0.35   # 网页版已调到此值避免天空过曝
  Tonemapping: ACES                       # 与网页 ACESFilmicToneMapping 一致
  SSAO: radius 8, intensity 0.6           # 对应 SSAOPass
  SMAA / FXAA: on
  Color Adjustments: exposure -0.3 ~ 0
  Fog: Exponential Height Fog, density 0.02
```

---

## 3. 高质量渲染方案（网页 ↔ Unity 对照）

| 效果 | 网页版实现 | Unity HDRP 对应 |
|---|---|---|
| 真实光照 | `realism.js` 太阳高度角驱动色温 | Light + Physical Sky + Sun 自动角度 |
| 环境反射 | PMREM + RoomEnvironment | HDRI Sky + Reflection Probe |
| PBR 材质 | MeshStandardMaterial + 程序化法线/粗糙贴图 | HDRP Lit + Normal Map / ORM Map |
| 阴影 | PCFSoft + normalBias | Cascade Shadow Maps + Contact Shadows |
| 地表细节 | `textures.js` 顶点色 + 法线扰动 | Terrain Layer + Detail Normal + Micro Detail |
| 天气氛围 | `environment.js` 9 种粒子 + 雾色 | Visual Effect Graph (雨/雪) + Volume Fog |
| 后处理 | Bloom/SSAO/SMAA/ACES | HDRP Volume 同项 |
| 性能档位 | `realism.js` 4 档预设 | Quality Settings + ScalableBufferManager |

### 关键落地建议
- **不要一上来全场 HDRP 最高档**：先用 Medium 跑通，再局部加 Contact Shadow / SSR。
- **地表真实感**靠三层叠加：宏观高度（terrain mesh）+ 中观顶点色/贴图（`textures.js`）+ 微观法线扰动（`enableSurfaceDetail`）。Unity 里对应 Terrain + Layer + Detail Normal。
- **天气**用 VFX Graph 而非 Particle System，粒子量大且支持 GPU 模拟（网页版用 Points + shader 近似）。
- **性能**：网页版有 `applyPerfProfile()` 动态调 DPR/阴影图；Unity 用 `ScalableBufferManager.ResizeBuffers()` 做动态分辨率。

---

## 4. 命名空间与脚本说明

`unity/Assets/Scripts/` 已有骨架：
- `CameraRig.cs` — 轨道相机 + 昼夜太阳（对应 `engine.js`）
- `TerrainGenerator.cs` — 种子化高度图 + 雕刻（对应 `world.js`）
- `VertexPainter.cs` — 顶点绘画（对应 `paint.js`）
- `TaskBoard.cs` — ScriptableObject 任务/XP/成就
- `WorkbenchManager.cs` — 模式与物件生成总控

新增建议脚本 `BiomeLayer.cs`（按 `biomes.js` 三层结构加载/卸载环境资产），保持"每层一个 GameObject、可整层替换"的设计，与网页版一致。

---

## 5. 验证清单
- [ ] Unity Hub 安装成功，`Unity.exe -version` 有输出
- [ ] HDRP 模板工程可打开、空场景可 Play
- [ ] Tripo GLB 拖入后材质/贴图正常显示
- [ ] 三段环境资产分层加载，切环境时不残留旧层
- [ ] HDRP Volume 参数与网页版观感接近（天空不过曝、雪不过密）
- [ ] Build 出 Windows exe 可运行

> 沙箱内已完成的是：网页版全部功能 + 上述 Unity 骨架与配置方案。Unity 编辑器本身需在你本机按第 1 节安装。
