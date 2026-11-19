# ForgeVerse · Unity 工程骨架

本目录是「3D 造物工作台」的 **Unity C# 版本骨架**，与同级的 `../index.html`（基于 Three.js / WebGL 的网页版）功能对应。  
沙箱里没有 Unity 编辑器，无法编译出可运行播放器；如果你要在 Unity 里落地，把这些脚本放进 `Assets/Scripts/` 即可。

## 功能映射（网页版 → Unity）

| 网页版（Three.js）          | Unity 对应                                          |
| ---------------------- | ------------------------------------------------- |
| `engine.js` 实时渲染/轨道相机  | `CameraRig.cs`（Cinemachine 风格轨道相机 + 昼夜方向光）        |
| `world.js` 高度图地形 + 雕刻  | `TerrainGenerator.cs`（Terrain 脚本化 + 笔刷隆起/下沉/平滑）   |
| `paint.js` 顶点绘画        | `VertexPainter.cs`（射线命中网格，按笔刷半径写顶点色）              |
| `objects.js` 基础体/物件/变换 | Unity 原生 `GameObject` + `Transform` + 检视面板        |
| `tasks.js` 任务/XP/成就/伙伴 | `TaskBoard.cs`（ScriptableObject 任务 + 经验等级 + 成就事件） |

## 用法

1. Unity 新建 3D 工程，将 `Assets/Scripts/` 拷入。
2. 场景里放一个 `DirectionalLight`（太阳）+ `Camera`，挂 `CameraRig.cs`。
3. 建一个 Terrain，挂 `TerrainGenerator.cs`，用 Inspector 调种子/起伏。
4. 运行时切到 Paint 模式，左键在模型/Terrain 上拖动即可上色（对应 `VertexPainter`）。
5. `TaskBoard` 提供 XP/等级/成就，完成任务 +20 XP，升级触发事件。

> 注：网页版用顶点色（vertex color）实现 Blender 式绘画；Unity 版用同样的思路，最终可烘焙成贴图导入 Blender 进一步细化。
