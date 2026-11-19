// ============================================================
// terrain-edit.js — 地形编辑：水源 / 挖地 / 地貌改动的保存与加载
// 编辑以"增量操作"记录（edits[]），存档时序列化，加载时重放，
// 不依赖原地形网格的重建，保证跨种子/跨会话可恢复。
// ============================================================
import * as THREE from 'three';
import { App, bus, addXP, toast } from './state.js';

let waterBodies = [];   // {id, x, z, r, mesh}
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let active = false;

// App.terrainEdits = [ {type:'water-add'|'water-del'|'dig', x, z, r, depth?, id?} ]

function terrainHit(ev) {
  const t = window.__terrain;
  if (!t) return null;
  const eng = App.engine;
  const rect = eng.renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ndc, eng.camera);
  const hits = ray.intersectObject(t, false);
  return hits.length ? hits[0] : null;
}

function makeWater(x, z, r, id) {
  const g = new THREE.CircleGeometry(r, 40);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({
    color: 0x3f9fd8, transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.35,
    emissive: 0x0a2c44, emissiveIntensity: 0.25,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, 0.45, z);
  mesh.name = 'waterbody';
  mesh.userData.wid = id;
  mesh.receiveShadow = true;
  App.engine.add(mesh);
  const body = { id, x, z, r, mesh };
  waterBodies.push(body);
  return body;
}

export function addWater(x, z, r = 4, record = true, forcedId = null) {
  const id = forcedId || ('w' + Math.random().toString(36).slice(2, 8));
  makeWater(x, z, r, id);
  // 挖低下方地形，形成水盆
  digTerrain(x, z, r * 1.1, 1.2, false);
  if (record) { App.terrainEdits.push({ type: 'water-add', x, z, r, id }); addXP(6); }
  bus.emit('terrain-edit');
  toast('水源已添加');
  return id;
}

export function removeWaterNear(x, z) {
  let best = null, bd = Infinity;
  waterBodies.forEach(w => { const d = Math.hypot(w.x - x, w.z - z); if (d < bd) { bd = d; best = w; } });
  if (!best || bd > (best.r + 3)) { toast('附近没有水源'); return false; }
  App.engine.remove(best.mesh); best.mesh.geometry.dispose(); best.mesh.material.dispose();
  waterBodies = waterBodies.filter(w => w !== best);
  App.terrainEdits.push({ type: 'water-del', id: best.id });
  bus.emit('terrain-edit'); toast('水源已删除');
  return true;
}

export function clearWater() {
  waterBodies.forEach(w => { App.engine.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose(); });
  waterBodies = [];
}

// 挖地：降低地形顶点，重算法线并重新按高度上色
export function digTerrain(x, z, r, depth = 1.5, record = true) {
  const t = window.__terrain;
  if (!t) return;
  const g = t.geometry, pos = g.attributes.position;
  const local = new THREE.Vector3(x, 0, z);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), pz = pos.getZ(i);
    const d = Math.hypot(px - local.x, pz - local.z);
    if (d < r) {
      const w = Math.pow(1 - d / r, 1.4);
      pos.setY(i, pos.getY(i) - depth * w);
    }
  }
  g.computeVertexNormals();
  pos.needsUpdate = true;
  // 重新按主题上色（简化：低于水位的涂成沙/水底色）
  const col = g.attributes.color;
  const under = new THREE.Color(0x6a8a7a);
  if (col) {
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.1) { col.setXYZ(i, under.r, under.g, under.b); }
    }
    col.needsUpdate = true;
  }
  if (record) { App.terrainEdits.push({ type: 'dig', x, z, r, depth }); addXP(4); }
  bus.emit('terrain-edit');
}

// ---------- 编辑模式指针交互 ----------
export function initTerrainEdit() {
  const dom = App.engine.renderer.domElement;
  dom.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    if (App.mode !== 'water' && App.mode !== 'dig') return;
    const h = terrainHit(ev); if (!h) return;
    const p = h.point;
    if (App.mode === 'water') {
      if (ev.shiftKey) removeWaterNear(p.x, p.z);
      else addWater(p.x, p.z, App.editBrush?.waterR || 4);
    } else if (App.mode === 'dig') {
      active = true;
      digTerrain(p.x, p.z, App.editBrush?.digR || 5, (App.editBrush?.digDepth || 1.2) * 0.25);
    }
  });
  dom.addEventListener('pointermove', ev => {
    if (!active || App.mode !== 'dig') return;
    const h = terrainHit(ev); if (!h) return;
    digTerrain(h.point.x, h.point.z, App.editBrush?.digR || 5, (App.editBrush?.digDepth || 1.2) * 0.12);
  });
  window.addEventListener('pointerup', () => { active = false; });
}

// ---------- 保存 / 加载增量 ----------
export function serializeEdits() { return (App.terrainEdits || []).slice(); }

export function loadEdits(edits = []) {
  clearWater();
  App.terrainEdits = [];
  edits.forEach(e => {
    if (e.type === 'water-add') addWater(e.x, e.z, e.r, false, e.id);
    else if (e.type === 'dig') digTerrain(e.x, e.z, e.r, e.depth, false);
    else if (e.type === 'water-del') { const w = waterBodies.find(b => b.id === e.id); if (w) { App.engine.remove(w.mesh); waterBodies = waterBodies.filter(b => b !== w); } }
  });
  toast('地形编辑已恢复（' + edits.length + ' 项）');
}

export function getWaterBodies() { return waterBodies; }
