/**
 * physics.js —— ForgeVerse 轻量物理系统（重力 + AABB 碰撞）
 *
 * 职责：
 *  - 为注册的 Mesh 提供重力积分、落地检测与「回弹一次」行为。
 *  - 使用 THREE.Box3 做动态 body 之间、以及 body 与体素静态方块之间的 AABB 碰撞与
 *    简单轴向分离，避免穿透。
 *  - 性能目标 60fps：只处理注册过的动态 body（上限 200）；体素静态碰撞体通过
 *    空间哈希分桶，查询时只检查 body 附近格；body 间用包围盒早退。
 *
 * 依赖：three（importmap 已配）、./state.js（bus / toast）、./voxel.js（getVoxelState 作为默认静态碰撞源）。
 * 说明：initPhysics(engine, { getSolids }) 可注入自定义静态碰撞源以避免任何模块耦合；
 *       未提供时使用 voxel.js 的 getVoxelState()。voxel:change 事件会自动标记碰撞源重建。
 *
 * 约定：体素方块格子 (x,y,z) 的 AABB 为 [x, x+1] × [y, y+1] × [z, z+1]。
 *       注册 body 默认以几何体包围盒（含 scale）推导半尺寸，也可用 opts.halfExtents / opts.radius 覆盖。
 */

import * as THREE from 'three';
import { bus, toast } from './state.js';
import { getVoxelState } from './voxel.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const MAX_BODIES = 200;

const CELL = 4;          // 静态体素空间哈希格边长（单位：方块）
const MAX_DT = 1 / 30;   // 单帧步长上限，避免切后台后 dt 过大导致穿透
const DEFAULT_G = 20;    // 默认重力加速度

// ---------------------------------------------------------------------------
// 模块内部状态
// ---------------------------------------------------------------------------

let engine = null;
let enabled = true;
let gravity = DEFAULT_G;
let groundY = 0;                       // 全局默认地面高度
let getSolids = null;                  // 注入的静态碰撞源（可选）
let solidsDirty = true;                // 静态碰撞源是否需要重建
let busBound = false;

const bodies = new Map();              // mesh -> body
const solidGrid = new Map();           // cellKey -> THREE.Box3[]

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function toBox(v) {
  if (!v) return null;
  if (v.isBox3) return v;
  if (v.min && v.max) return v;
  if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
    return new THREE.Box3(
      new THREE.Vector3(v.x, v.y, v.z),
      new THREE.Vector3(v.x + 1, v.y + 1, v.z + 1)
    );
  }
  return null;
}

function rebuildSolidGrid() {
  solidGrid.clear();
  const source = getSolids ? getSolids() : getVoxelState();
  if (Array.isArray(source)) {
    for (const item of source) {
      const box = toBox(item);
      if (!box) continue;
      const cx0 = Math.floor(box.min.x / CELL), cx1 = Math.floor(box.max.x / CELL);
      const cy0 = Math.floor(box.min.y / CELL), cy1 = Math.floor(box.max.y / CELL);
      const cz0 = Math.floor(box.min.z / CELL), cz1 = Math.floor(box.max.z / CELL);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++)
          for (let cz = cz0; cz <= cz1; cz++) {
            const key = `${cx},${cy},${cz}`;
            let bucket = solidGrid.get(key);
            if (!bucket) { bucket = []; solidGrid.set(key, bucket); }
            bucket.push(box);
          }
    }
  }
  solidsDirty = false;
}

// 查询与给定 Box3 可能相交的静态方块（粗粒度，仅附近格）
function querySolids(box, out) {
  out.length = 0;
  const seen = new Set();
  const cx0 = Math.floor(box.min.x / CELL), cx1 = Math.floor(box.max.x / CELL);
  const cy0 = Math.floor(box.min.y / CELL), cy1 = Math.floor(box.max.y / CELL);
  const cz0 = Math.floor(box.min.z / CELL), cz1 = Math.floor(box.max.z / CELL);
  for (let cx = cx0; cx <= cx1; cx++)
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const bucket = solidGrid.get(`${cx},${cy},${cz}`);
        if (!bucket) continue;
        for (const b of bucket) {
          if (!seen.has(b)) { seen.add(b); out.push(b); }
        }
      }
  return out;
}

function syncBox(body) {
  body.box.min.copy(body.center).sub(body.halfV);
  body.box.max.copy(body.center).add(body.halfV);
}

// ---------------------------------------------------------------------------
// 碰撞分离：把 body 沿最小穿透轴推出 solid
// ---------------------------------------------------------------------------

function separate(body, solid) {
  const box = body.box;
  const ox = Math.min(box.max.x, solid.max.x) - Math.max(box.min.x, solid.min.x);
  if (ox <= 0) return false;
  const oy = Math.min(box.max.y, solid.max.y) - Math.max(box.min.y, solid.min.y);
  if (oy <= 0) return false;
  const oz = Math.min(box.max.z, solid.max.z) - Math.max(box.min.z, solid.min.z);
  if (oz <= 0) return false;

  if (oy <= ox && oy <= oz) {
    const centerY = (solid.min.y + solid.max.y) * 0.5;
    const sign = body.center.y < centerY ? -1 : 1;
    body.center.y += sign * oy;
    body.velocity.y = 0;                 // 静态碰撞不反弹，保持稳定堆叠
  } else if (ox <= oz) {
    const centerX = (solid.min.x + solid.max.x) * 0.5;
    const sign = body.center.x < centerX ? -1 : 1;
    body.center.x += sign * ox;
    body.velocity.x = 0;
  } else {
    const centerZ = (solid.min.z + solid.max.z) * 0.5;
    const sign = body.center.z < centerZ ? -1 : 1;
    body.center.z += sign * oz;
    body.velocity.z = 0;
  }
  return true;
}

function separatePair(a, b) {
  const boxA = a.box, boxB = b.box;
  const ox = Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x);
  if (ox <= 0) return;
  const oy = Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y);
  if (oy <= 0) return;
  const oz = Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z);
  if (oz <= 0) return;

  const push = 0.5;
  if (oy <= ox && oy <= oz) {
    const sign = a.center.y <= b.center.y ? -1 : 1;
    a.center.y += sign * oy * push;
    b.center.y -= sign * oy * push;
    a.velocity.y = 0; b.velocity.y = 0;
  } else if (ox <= oz) {
    const sign = a.center.x <= b.center.x ? -1 : 1;
    a.center.x += sign * ox * push;
    b.center.x -= sign * ox * push;
    a.velocity.x = 0; b.velocity.x = 0;
  } else {
    const sign = a.center.z <= b.center.z ? -1 : 1;
    a.center.z += sign * oz * push;
    b.center.z -= sign * oz * push;
    a.velocity.z = 0; b.velocity.z = 0;
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 注册一个动态刚体。
 * @param {THREE.Mesh} mesh
 * @param {Object} [opts]
 *   - halfExtents {x,y,z} 半尺寸；radius 数值统一半尺寸；不传则从几何包围盒+scale 推导
 *   - velocity {x,y,z} 初速度
 *   - restitution number 回弹系数（默认 0.35）
 *   - groundY number 该 body 的地面高度（默认取 initPhysics 的 groundY）
 *   - mass number 质量（保留字段，默认 1）
 * @returns {Object|null} body 对象；超出上限返回 null
 */
export function registerBody(mesh, opts = {}) {
  if (!mesh || bodies.has(mesh)) return null;
  if (bodies.size >= MAX_BODIES) {
    toast(`物理刚体已达上限 ${MAX_BODIES}`);
    return null;
  }

  let hx, hy, hz;
  if (opts.halfExtents) {
    ({ x: hx, y: hy, z: hz } = opts.halfExtents);
  } else if (Number.isFinite(opts.radius)) {
    hx = hy = hz = opts.radius;
  } else {
    const geo = mesh.geometry;
    if (geo) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      hx = (bb.max.x - bb.min.x) * 0.5;
      hy = (bb.max.y - bb.min.y) * 0.5;
      hz = (bb.max.z - bb.min.z) * 0.5;
    } else {
      hx = hy = hz = 0.5;
    }
    hx *= Math.abs(mesh.scale.x) || 1;
    hy *= Math.abs(mesh.scale.y) || 1;
    hz *= Math.abs(mesh.scale.z) || 1;
  }

  const v = opts.velocity || {};
  const body = {
    mesh,
    center: mesh.position.clone(),
    halfV: new THREE.Vector3(hx, hy, hz),
    velocity: new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0),
    box: new THREE.Box3(),
    restitution: Number.isFinite(opts.restitution) ? opts.restitution : 0.35,
    groundY: Number.isFinite(opts.groundY) ? opts.groundY : groundY,
    mass: opts.mass || 1,
    grounded: false,
    bounces: 0,
    disabled: !!opts.disabled,
  };
  syncBox(body);
  bodies.set(mesh, body);
  return body;
}

/** 注销刚体 */
export function unregisterBody(mesh) {
  if (!mesh) return false;
  return bodies.delete(mesh);
}

/** 获取已注册刚体数量 */
export function getBodyCount() { return bodies.size; }

/** 清空所有刚体 */
export function clearBodies() { bodies.clear(); }

/** 物理开关 */
export function setPhysicsEnabled(on) { enabled = !!on; }
export function isPhysicsEnabled() { return enabled; }

// ---------------------------------------------------------------------------
// 单步推进
// ---------------------------------------------------------------------------

const _nearby = [];   // 复用数组，避免每帧分配

export function stepPhysics(dt) {
  if (!enabled || !engine) return;
  const step = Math.min(Math.max(Number(dt) || 0, 0), MAX_DT);
  if (step <= 0) return;
  if (solidsDirty) rebuildSolidGrid();

  const list = Array.from(bodies.values());

  // 1) 积分 + 地面 + 体素碰撞
  for (const b of list) {
    if (b.disabled) continue;
    b.center.copy(b.mesh.position);     // 允许外部直接改 mesh.position
    syncBox(b);

    // 重力积分
    b.velocity.y -= gravity * step;
    b.center.addScaledVector(b.velocity, step);
    syncBox(b);

    // 地面碰撞（回弹一次后停下）
    const bottom = b.center.y - b.halfV.y;
    if (bottom < b.groundY) {
      b.center.y = b.groundY + b.halfV.y;
      if (!b.grounded) {
        if (Math.abs(b.velocity.y) > 1 && b.bounces < 1) {
          b.velocity.y = -b.velocity.y * b.restitution;  // 第一次：回弹
          b.bounces++;
        } else {
          b.velocity.y = 0;                              // 之后：停止
          b.grounded = true;
        }
      } else {
        b.velocity.y = 0;
      }
      syncBox(b);
    } else if (b.grounded) {
      b.grounded = false;
      b.bounces = 0;
    }

    // 体素静态碰撞（仅查询附近格）
    querySolids(b.box, _nearby);
    for (const solid of _nearby) {
      if (separate(b, solid)) syncBox(b);
    }
  }

  // 2) 动态 body 之间碰撞（包围盒早退）
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.disabled) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.disabled) continue;
      if (!a.box.intersectsBox(b.box)) continue;
      separatePair(a, b);
    }
  }

  // 3) 写回 Mesh
  for (const b of list) {
    if (b.disabled) continue;
    b.mesh.position.copy(b.center);
    syncBox(b);
  }
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

/**
 * @param {Object} eng engine 实例（createEngine 返回值）
 * @param {Object} [options]
 *   - getSolids {Function} 可选：返回静态碰撞体数组（体素格或 THREE.Box3），
 *                           注入后不再依赖 voxel.js 的 getVoxelState
 *   - gravity {number} 重力加速度（默认 20）
 *   - groundY {number} 默认地面高度（默认 0）
 */
export function initPhysics(eng, options = {}) {
  if (engine) return;
  engine = eng;
  if (Number.isFinite(options.gravity)) gravity = options.gravity;
  if (Number.isFinite(options.groundY)) groundY = options.groundY;
  if (typeof options.getSolids === 'function') getSolids = options.getSolids;

  if (!busBound) {
    bus.on('voxel:change', () => { solidsDirty = true; });
    busBound = true;
  }

  // 每帧推进，dt 由引擎给出
  engine.onUpdate(dt => stepPhysics(dt));
}
