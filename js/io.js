import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { App, toast } from './state.js';
import { spawnPrimitive, spawnModel, applyMaterial, selectObject } from './objects.js';
import { spawnAdvanced, extrudeShape } from './modeling.js';
import { generateTerrain, applyTheme } from './world.js';
import { renderTasks } from './tasks.js';
import { loadEdits } from './terrain-edit.js';
import { buildBiome } from './biomes.js';

const KEY = 'forgeverse_v1';

function matSnapshot(root) {
  const arr = [];
  root.traverse(o => {
    if (o.isMesh && o.material) {
      const m = o.material;
      arr.push({
        color: '#' + (m.color ? m.color.getHexString() : 'ffffff'),
        rough: m.roughness ?? 0.6, metal: m.metalness ?? 0.1,
        emissive: '#' + (m.emissive ? m.emissive.getHexString() : '000000'),
        opacity: m.opacity ?? 1, wire: !!m.wireframe, vc: !!m.vertexColors,
      });
    }
  });
  return arr;
}

export function serialize() {
  return {
    v: 3, worldName: App.worldName, theme: App.theme, level: App.level, xp: App.xp,
    time: Number(document.getElementById('timeSlider')?.value || 55) / 100,
    terrain: { seed: App.terrainSeed, height: App.terrainHeight, seg: App.terrainSeg },
    tasks: App.tasks,
    note: App.note || '',
    weather: App.weather || 'clear',
    mapSeed: App.mapSeed ?? 7,
    bookmarks: App.bookmarks || [],
    terrainEdits: App.terrainEdits || [],
    biomeName: App.biomeName || 'urban',
    objects: App.objects.map(r => ({
      name: r.name, type: r.type, kind: r.kind,
      p: r.root.position.toArray().map(n => +n.toFixed(3)),
      r: [r.root.rotation.x, r.root.rotation.y, r.root.rotation.z].map(n => +n.toFixed(4)),
      s: r.root.scale.toArray().map(n => +n.toFixed(3)),
      mats: matSnapshot(r.root),
      meta: r.meta || null,
    })),
  };
}

export function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(serialize())); toast('已保存到本地'); }
  catch (e) { toast('本地存储不可用，已改为下载文件'); download('forgeverse.json', serialize()); }
}

export function download(name, data) {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function deserialize(d) {
  if (!d || !d.objects) { toast('存档格式不正确'); return; }
  App.worldName = d.worldName || '未命名世界';
  App.theme = d.theme || 'grass';
  App.level = d.level || 1; App.xp = d.xp || 0;
  App.tasks = d.tasks || [];
  applyTheme(App.theme);
  if (d.terrain) generateTerrain(d.terrain);
  // 清空现有对象
  [...App.objects].forEach(() => {});
  App.objects.slice().forEach(r => { App.engine.remove(r.root); });
  App.objects = [];
  d.objects.forEach(o => {
    if (o.kind === 'model') spawnModel(o.type);
    else if (o.kind === 'advanced' && o.type.startsWith('extrude-')) extrudeShape(o.type.slice(8), 0.8);
    else if (o.kind === 'advanced' && ['torusKnot','icosa','dodeca','octa','lathe','spring','arch'].includes(o.type)) spawnAdvanced(o.type);
    else if (o.kind === 'boolean') spawnPrimitive('box'); // 布尔结果降级为占位，保留变换与外观
    else spawnPrimitive(o.type);
    const rec = App.selected;
    if (!rec) return;
    rec.name = o.name;
    rec.root.position.fromArray(o.p);
    rec.root.rotation.set(o.r[0], o.r[1], o.r[2]);
    rec.root.scale.fromArray(o.s);
    (o.mats || []).forEach(mm => applyMat(rec, mm));
    if (o.meta) rec.meta = o.meta;
    renderTasks();
  });
  // 恢复信息台/标签/书签/天气/种子
  App.note = d.note || '';
  App.bookmarks = d.bookmarks || [];
  if (d.mapSeed != null) { App.mapSeed = d.mapSeed; }
  if (d.weather) { App.weather = d.weather; }
  if (d.biomeName) { App.biomeName = d.biomeName; buildBiome(d.biomeName); }
  if (d.terrainEdits) loadEdits(d.terrainEdits);
  if (d.time != null) { App.engine.setTimeOfDay(d.time); const ts = document.getElementById('timeSlider'); if (ts) ts.value = Math.round(d.time * 100); }
  toast('世界已载入');
}

function applyMat(rec, mm) {
  if (!mm) return;
  rec.root.traverse(c => {
    if (c.isMesh && c.material) {
      c.material.color.set(mm.color);
      c.material.roughness = mm.rough; c.material.metalness = mm.metal;
      if (c.material.emissive) c.material.emissive.set(mm.emissive);
      c.material.opacity = mm.opacity; c.material.wireframe = mm.wire;
      c.material.vertexColors = mm.vc; c.material.needsUpdate = true;
    }
  });
}

export function loadFile(file) {
  const r = new FileReader();
  r.onload = () => { try { deserialize(JSON.parse(r.result)); } catch (e) { toast('读取失败'); } };
  r.readAsText(file);
}

export function exportGLTF() {
  const exporter = new GLTFExporter();
  const grp = new THREE.Group();
  App.objects.forEach(o => grp.add(o.root.clone(true)));
  if (window.__terrain) grp.add(window.__terrain.clone(true));
  exporter.parse(grp, res => {
    download((App.worldName || 'forgeverse') + '.gltf', res);
    toast('GLTF 已导出（可在 Blender/Unity 导入）');
  }, err => toast('导出失败'), { binary: false });
}

export function screenshot() {
  App.engine.renderer.render(App.engine.scene, App.engine.camera);
  const url = App.engine.renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = (App.worldName || 'forgeverse') + '.png'; a.click();
  toast('截图已保存');
}

// ============================================================
// 世界级适配层（FV-ENG-02）
// 目标：既不改变现有 serialize()/deserialize() 的单世界签名，
// 又能让 world-manager.js 以「一个世界一份 payload」的方式读写。
// ============================================================

const clampInt = (v, d, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
};
const clampNum = (v, d, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const clamp01 = v => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.55;
};

// 初始物体包：基础=一棵树；演示=树/巨石/路灯。
// 只使用 objects.js MODEL_INFO 中已存在的 key，避免加载出不存在的模型。
function starterObjects(kit) {
  const make = (type, name, x, z) => ({
    name, type, kind: 'model', p: [x, 0, z], r: [0, 0, 0], s: [1, 1, 1],
    mats: [], meta: null,
  });
  if (kit === 'empty') return [];
  if (kit === 'demo') {
    return [
      make('tree', '🌳 树', 0, 0),
      make('rock', '🪨 巨石', 5, 2),
      make('lamp', '💡 路灯', -4, 3),
      make('bush', '🌿 灌木', 3, -4),
    ];
  }
  return [make('tree', '🌳 树', 0, 0)]; // basic（默认）
}

// 新建世界时构造一份「干净」的 v3 兼容快照。
// 关键：不读 App，避免把上一个世界的物体/任务/笔记带进新世界。
export function emptySnapshot(config = {}) {
  const seed = clampInt(config.seed ?? config.mapSeed, 1, 1, 999999);
  return {
    worldName: config.name || '未命名世界',
    theme: config.biome || config.theme || 'grass',
    level: 1, xp: 0,
    time: clamp01(config.timeOfDay),
    terrain: {
      seed,
      // 与 #wcTerrainHeight(0..8) / generateTerrain 默认值(3) 对齐
      height: clampNum(config.terrainHeight, 3, 0, 8),
      seg: clampInt(config.terrainSeg, 96, 32, 160),
    },
    tasks: [],
    note: '',
    weather: config.weather || 'clear',
    mapSeed: seed,
    bookmarks: [],
    terrainEdits: [],
    biomeName: config.biome || 'grass',
    objects: starterObjects(config.starterKit),
  };
}

// 把当前的 App/场景序列化成完整 World 实体（不修改入参）。
export function serializeWorld(world) {
  if (!world || typeof world !== 'object') return null;
  const snapshot = serialize();
  return {
    ...world,
    schemaVersion: 4,
    id: world.id || world.worldId || null,
    name: world.name || world.worldName || snapshot.worldName,
    updatedAt: new Date().toISOString(),
    snapshot,
  };
}

// 从 payload 中取出 v3 兼容快照；兼容 v4 World（有 snapshot）与裸 v3（有 objects）。
export function extractSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.objects)) return payload;
  if (payload.snapshot && Array.isArray(payload.snapshot.objects)) return payload.snapshot;
  return null;
}

// 灌回 App：复用既有 deserialize，保持单世界恢复逻辑只有一份。
export function deserializeWorld(payload) {
  const snapshot = extractSnapshot(payload);
  if (!snapshot) { toast('存档格式不正确'); return false; }
  deserialize(snapshot);
  return true;
}

// 应用 v4 config 中 deserialize 覆盖不到的项（时段）。
// 侧栏/面板/视角等纯 UI 项由 world-manager 发事件给批次 B 处理。
export function applyWorldConfig(config = {}) {
  if (config.timeOfDay != null && App.engine?.setTimeOfDay) {
    App.engine.setTimeOfDay(clamp01(config.timeOfDay));
    const slider = document.getElementById('timeSlider');
    if (slider) slider.value = String(Math.round(clamp01(config.timeOfDay) * 100));
  }
  if (config.biome) App.biomeName = config.biome;
}
