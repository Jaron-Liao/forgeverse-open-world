import * as THREE from 'three';
import { App, addXP, toast } from './state.js';
import { selectFromMesh } from './objects.js';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let painting = false;

// 笔刷形状权重：根据局部偏移返回 0..1 覆盖
function shapeWeight(dx, dy, dz, radius, shape, soft) {
  if (shape === 'square') {
    const inside = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < radius;
    if (!inside) return 0;
    return soft ? 1 - Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / radius * 0.5 : 1;
  }
  if (shape === 'star') {
    const a = Math.atan2(dy, dx);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const edge = radius * (0.6 + 0.4 * Math.abs(Math.cos(2.5 * a)));
    if (d > edge) return 0;
    return soft ? 1 - d / edge * 0.6 : 1;
  }
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > radius) return 0;
  // round：柔边用平滑衰减，硬边用阶跃
  return soft ? Math.pow(1 - d / radius, 0.6) : 1;
}

export function paintVertex(mesh, localPoint, radius, color, strength) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const col = g.attributes.color;
  if (!col) return;
  const c = new THREE.Color(color);
  const tmp = new THREE.Color();
  const v = new THREE.Vector3();
  const shape = App.brush.shape || 'round';
  const soft = App.brush.soft !== false;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dx = v.x - localPoint.x, dy = v.y - localPoint.y, dz = v.z - localPoint.z;
    const w = shapeWeight(dx, dy, dz, radius, shape, soft);
    if (w > 0) {
      tmp.fromBufferAttribute(col, i);
      tmp.lerp(c, w * strength);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
  }
  col.needsUpdate = true;
}

export function prepMesh(mesh) {
  if (!mesh || !mesh.geometry) return;
  if (!mesh.userData.paintReady) {
    const base = mesh.material.color ? mesh.material.color.clone() : new THREE.Color(0xffffff);
    mesh.userData.base = base.getHex();
    mesh.material.vertexColors = true;
    mesh.material.color.set(0xffffff);
    const col = mesh.geometry.attributes.color;
    if (col) {
      for (let i = 0; i < col.count; i++) col.setXYZ(i, base.r, base.g, base.b);
      col.needsUpdate = true;
    }
    mesh.userData.paintReady = true;
  }
}

function hitObject(mesh) {
  if (!mesh || !mesh.isMesh) return;
  const rec = App.objects.find(r => r.root === mesh || isDescendant(r.root, mesh));
  return mesh;
}
function isDescendant(root, node) {
  let o = node;
  while (o) { if (o === root) return true; o = o.parent; }
  return false;
}

function paintAt(ev) {
  const eng = App.engine;
  const rect = eng.renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ndc, eng.camera);
  // 仅命中当前选中对象
  if (!App.selected) return;
  const hits = ray.intersectObject(App.selected.root, true);
  if (!hits.length) return;
  const h = hits[0];
  const mesh = h.object;
  prepMesh(mesh);
  const local = mesh.worldToLocal(h.point.clone());
  const color = App.brush.erase ? mesh.userData.base : new THREE.Color(App.brush.color).getHex();
  paintVertex(mesh, local, App.brush.size, color, App.brush.strength);
  mesh.geometry.computeVertexNormals();
}

export function initPaint() {
  const eng = App.engine;
  const dom = eng.renderer.domElement;
  dom.addEventListener('pointerdown', ev => {
    if (App.mode !== 'paint' || ev.button !== 0) return;
    if (!App.selected) { toast('请先选择一个物体'); return; }
    painting = true;
    paintAt(ev);
  });
  dom.addEventListener('pointermove', ev => {
    if (painting && App.mode === 'paint') paintAt(ev);
  });
  window.addEventListener('pointerup', () => {
    if (painting) { painting = false; addXP(3); }
  });
}
