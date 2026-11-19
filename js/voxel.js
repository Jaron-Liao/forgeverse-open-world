/**
 * voxel.js —— ForgeVerse 体素方块建造系统
 *
 * 职责：
 *  - 以 chunk（默认 16×16×16）为单位稀疏存储方块，按材质批量使用 InstancedMesh 渲染，
 *    保证大量方块下的绘制性能（每个 chunk 每种材质仅 1 次 draw call）。
 *  - 提供 placeVoxel / removeVoxel 编程接口，以及体素模式下的鼠标交互
 *    （左键放置、右键破坏，基于 Raycaster + instanceId + 面法线）。
 *  - 提供 serializeVoxels / loadVoxels 纯数据序列化，供存档使用。
 *  - 维护方块总数上限（20000），并通过 bus.emit('voxel:change', { count }) 广播变更。
 *
 * 依赖：three（importmap 已配）、./state.js（App / bus / toast）。
 * 仅操作 engine.scene 中由本模块创建的 InstancedMesh，不触碰其他对象。
 *
 * 约定：方块以整数网格 (x,y,z) 寻址，方块中心世界坐标为 (x+0.5, y+0.5, z+0.5)，
 *       即地面基准 y=0 时，第一层方块中心 y=0.5。
 */

import * as THREE from 'three';
import { bus, toast } from './state.js';

// ---------------------------------------------------------------------------
// 常量与调色板（配色取自 DESIGN_SYSTEM_V9 四生态场景色与语义色）
// ---------------------------------------------------------------------------

export const CHUNK_SIZE = 16;
export const MAX_VOXELS = 20000;

// 方块材质调色板：key -> { label, color, roughness, metalness }
// 颜色与 DESIGN_SYSTEM_V9 生态色协调：草原绿、沙漠金、玄墨石、朱砂砖等。
export const VOXEL_PALETTE = Object.freeze({
  grass: { label: '草', color: 0x6FA85A, roughness: 0.95, metalness: 0.0 },
  dirt:  { label: '土', color: 0x8B6A43, roughness: 1.00, metalness: 0.0 },
  stone: { label: '石', color: 0x7F8794, roughness: 0.92, metalness: 0.04 },
  wood:  { label: '木', color: 0x8B5E34, roughness: 0.88, metalness: 0.0 },
  sand:  { label: '沙', color: 0xD9BA6A, roughness: 0.98, metalness: 0.0 },
  brick: { label: '砖', color: 0xC8453A, roughness: 0.86, metalness: 0.0 },
});

// ---------------------------------------------------------------------------
// 模块内部状态
// ---------------------------------------------------------------------------

let engine = null;                 // engine 实例（initVoxel 注入）
let voxelMode = false;             // 是否处于体素建造模式
let currentMaterial = 'grass';     // 当前放置材质
let count = 0;                     // 方块总数（O(1) 维护）
let enabled = false;               // initVoxel 是否已完成

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const materials = {};              // 材质 key -> THREE.Material（共享）

// chunkKey -> Map<voxelKey, {x,y,z,material}>
const chunks = new Map();
// chunkKey -> InstancedMesh[]（该 chunk 每种材质一个）
const chunkMeshes = new Map();

// 交互复用对象
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
const dummy = new THREE.Object3D();
let downInfo = null;               // { button, x, y }

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const voxelKey = (x, y, z) => `${x},${y},${z}`;
const chunkKey = (x, y, z) =>
  `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;

function ensureMaterials() {
  if (Object.keys(materials).length) return;
  for (const [key, def] of Object.entries(VOXEL_PALETTE)) {
    materials[key] = new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: def.roughness,
      metalness: def.metalness,
    });
  }
}

function emitChange() {
  bus.emit('voxel:change', { count });
}

// ---------------------------------------------------------------------------
// 渲染：按 chunk + 材质重建 InstancedMesh
// ---------------------------------------------------------------------------

function disposeChunkMeshes(key) {
  const list = chunkMeshes.get(key);
  if (!list) return;
  for (const mesh of list) {
    engine.remove(mesh);
    mesh.dispose(); // InstancedMesh.dispose() 释放 instanceMatrix 等 GPU 资源
  }
  chunkMeshes.delete(key);
}

function rebuildChunk(key) {
  disposeChunkMeshes(key);
  const chunk = chunks.get(key);
  if (!chunk || chunk.size === 0) {
    chunks.delete(key);
    return;
  }

  // 按材质分组
  const byMaterial = new Map();
  for (const [vKey, v] of chunk) {
    let list = byMaterial.get(v.material);
    if (!list) { list = []; byMaterial.set(v.material, list); }
    list.push({ vKey, v });
  }

  const meshes = [];
  for (const [materialKey, list] of byMaterial) {
    const mesh = new THREE.InstancedMesh(boxGeometry, materials[materialKey], list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.isVoxelMesh = true;
    mesh.userData.voxelKeys = new Array(list.length);

    for (let i = 0; i < list.length; i++) {
      const { vKey, v } = list[i];
      dummy.position.set(v.x + 0.5, v.y + 0.5, v.z + 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.userData.voxelKeys[i] = vKey;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // 保证 Raycaster 的粗检测正确

    engine.add(mesh);
    meshes.push(mesh);
  }
  chunkMeshes.set(key, meshes);
}

// ---------------------------------------------------------------------------
// 底层增删（内部使用，不触发上限提示）
// ---------------------------------------------------------------------------

function setVoxel(x, y, z, material) {
  const ck = chunkKey(x, y, z);
  let chunk = chunks.get(ck);
  if (!chunk) { chunk = new Map(); chunks.set(ck, chunk); }
  const key = voxelKey(x, y, z);
  if (chunk.has(key)) return false; // 已存在，视为未变更
  chunk.set(key, { x, y, z, material });
  count++;
  rebuildChunk(ck);
  return true;
}

function deleteVoxel(x, y, z) {
  const ck = chunkKey(x, y, z);
  const chunk = chunks.get(ck);
  if (!chunk) return false;
  const key = voxelKey(x, y, z);
  if (!chunk.has(key)) return false;
  chunk.delete(key);
  count--;
  rebuildChunk(ck);
  return true;
}

// ---------------------------------------------------------------------------
// 公共 API：放置 / 破坏 / 查询
// ---------------------------------------------------------------------------

/**
 * 放置一个方块。
 * @returns {boolean} 是否真正放置（越界、已存在、超上限返回 false）
 */
export function placeVoxel(x, y, z, material = currentMaterial) {
  if (!enabled) return false;
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return false;
  if (!materials[material]) material = 'grass';
  if (count >= MAX_VOXELS) {
    toast(`体素已达上限 ${MAX_VOXELS}，无法继续放置`);
    return false;
  }
  const ok = setVoxel(x, y, z, material);
  if (ok) emitChange();
  return ok;
}

/**
 * 破坏（移除）一个方块。
 * @returns {boolean} 是否真正移除
 */
export function removeVoxel(x, y, z) {
  if (!enabled) return false;
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  const ok = deleteVoxel(x, y, z);
  if (ok) emitChange();
  return ok;
}

/** 读取指定格点的方块数据，不存在返回 null */
export function getVoxel(x, y, z) {
  const chunk = chunks.get(chunkKey(x, y, z));
  return chunk ? (chunk.get(voxelKey(x, y, z)) || null) : null;
}

/** 当前方块总数（O(1)） */
export function getVoxelCount() { return count; }

/** 供存档/物理使用的纯数据快照：[{x,y,z,material}, ...] */
export function getVoxelState() {
  const out = [];
  for (const chunk of chunks.values()) {
    for (const v of chunk.values()) out.push({ x: v.x, y: v.y, z: v.z, material: v.material });
  }
  return out;
}

/** 供物理模块做近邻查询：返回与给定 AABB 相交格范围内的方块（粗粒度） */
export function queryVoxelsNear(minX, minY, minZ, maxX, maxY, maxZ) {
  const out = [];
  const x0 = Math.floor(minX / CHUNK_SIZE), x1 = Math.floor(maxX / CHUNK_SIZE);
  const y0 = Math.floor(minY / CHUNK_SIZE), y1 = Math.floor(maxY / CHUNK_SIZE);
  const z0 = Math.floor(minZ / CHUNK_SIZE), z1 = Math.floor(maxZ / CHUNK_SIZE);
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++)
      for (let cz = z0; cz <= z1; cz++) {
        const chunk = chunks.get(`${cx},${cy},${cz}`);
        if (!chunk) continue;
        for (const v of chunk.values()) {
          if (v.x >= minX - 1 && v.x <= maxX + 1 &&
              v.y >= minY - 1 && v.y <= maxY + 1 &&
              v.z >= minZ - 1 && v.z <= maxZ + 1) out.push(v);
        }
      }
  return out;
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

/** 导出为纯数据数组（顺序不保证稳定，内容完整） */
export function serializeVoxels() { return getVoxelState(); }

/** 从纯数据数组恢复（会清空当前方块） */
export function loadVoxels(data) {
  if (!enabled) return;
  // 先清空
  for (const key of Array.from(chunkMeshes.keys())) disposeChunkMeshes(key);
  chunks.clear();
  count = 0;

  const touchedChunks = new Set();
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item) continue;
      const x = Number(item.x), y = Number(item.y), z = Number(item.z);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
      if (count >= MAX_VOXELS) break;
      const material = materials[item.material] ? item.material : 'grass';
      const ck = chunkKey(x, y, z);
      let chunk = chunks.get(ck);
      if (!chunk) { chunk = new Map(); chunks.set(ck, chunk); }
      const key = voxelKey(x, y, z);
      if (chunk.has(key)) continue;
      chunk.set(key, { x, y, z, material });
      count++;
      touchedChunks.add(ck);
    }
  }
  // 每个 chunk 只重建一次，避免 O(n²)
  for (const ck of touchedChunks) rebuildChunk(ck);
  emitChange();
}

/** 清空所有方块 */
export function clearVoxels() { loadVoxels([]); }

// ---------------------------------------------------------------------------
// 模式与材质切换
// ---------------------------------------------------------------------------

export function setVoxelMode(on) {
  voxelMode = !!on;
  bus.emit('voxel:mode', { on: voxelMode });
}
export function isVoxelMode() { return voxelMode; }

/** 设置当前放置材质（key 来自 VOXEL_PALETTE） */
export function setVoxelMaterial(key) {
  if (!materials[key]) { toast('未知方块材质：' + key); return false; }
  currentMaterial = key;
  bus.emit('voxel:material', { material: key });
  return true;
}
export function getVoxelMaterial() { return currentMaterial; }

// ---------------------------------------------------------------------------
// 交互：射线检测 + 左右键
// ---------------------------------------------------------------------------

// 收集当前所有体素 InstancedMesh
function voxelMeshes() {
  const list = [];
  for (const meshes of chunkMeshes.values()) for (const m of meshes) list.push(m);
  return list;
}

// 返回最近命中：{ key, x, y, z, normal }
function raycastVoxel() {
  raycaster.setFromCamera(ndc, engine.camera);
  const hits = raycaster.intersectObjects(voxelMeshes(), false);
  if (!hits.length) return null;
  const hit = hits[0];
  const mesh = hit.object;
  const keys = mesh.userData.voxelKeys;
  if (!keys || hit.instanceId == null || !keys[hit.instanceId]) return null;
  const [x, y, z] = keys[hit.instanceId].split(',').map(Number);
  const n = hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0);
  // 实例仅平移无旋转/缩放，face.normal 即为世界方向；四舍五入到轴向
  const normal = {
    x: Math.round(n.x),
    y: Math.round(n.y),
    z: Math.round(n.z),
  };
  return { x, y, z, normal };
}

function onPointerDown(ev) {
  if (!isVoxelMode()) return;              // 非体素模式完全不干预
  if (ev.button !== 0 && ev.button !== 2) return;
  downInfo = { button: ev.button, x: ev.clientX, y: ev.clientY };
}

function onPointerUp(ev) {
  if (!isVoxelMode()) return;              // 非体素模式完全不干预
  if (!downInfo || downInfo.button !== ev.button) { downInfo = null; return; }
  const moved = Math.hypot(ev.clientX - downInfo.x, ev.clientY - downInfo.y);
  downInfo = null;
  if (moved > 6 || engine.tcontrols?.dragging) return; // 拖拽视为旋转/平移视角

  const rect = engine.renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, engine.camera);

  const hit = raycastVoxel();

  if (ev.button === 2) {
    // 右键破坏
    if (hit) removeVoxel(hit.x, hit.y, hit.z);
    return;
  }

  // 左键放置
  if (hit) {
    const nx = hit.x + hit.normal.x;
    const ny = hit.y + hit.normal.y;
    const nz = hit.z + hit.normal.z;
    placeVoxel(nx, ny, nz, currentMaterial);
  } else {
    // 无方块命中时，回退到地面 y=0 平面，便于从空场景放下第一块
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      placeVoxel(Math.floor(hitPoint.x), 0, Math.floor(hitPoint.z), currentMaterial);
    }
  }
}

function onContextMenu(ev) {
  if (!isVoxelMode()) return;              // 非体素模式保留浏览器默认菜单
  ev.preventDefault();
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

export function initVoxel(eng) {
  if (enabled) return;
  engine = eng;
  ensureMaterials();
  const dom = engine.renderer.domElement;
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('contextmenu', onContextMenu);
  enabled = true;
  emitChange();
}
