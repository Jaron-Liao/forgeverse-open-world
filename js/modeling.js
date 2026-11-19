import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { App, bus, addXP, toast } from './state.js';
import { register, updateHUD } from './objects.js';

const evaluator = new Evaluator();
evaluator.useGroups = false;

// ---------- 高级几何体 ----------
export const ADVANCED = {
  torusKnot: () => new THREE.Mesh(new THREE.TorusKnotGeometry(1.4, 0.45, 128, 16), new THREE.MeshStandardMaterial({ color: 0x5cc8ff, roughness: 0.3, metalness: 0.6 })),
  icosa: () => new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), new THREE.MeshStandardMaterial({ color: 0x9be8a0, roughness: 0.5, flatShading: true })),
  dodeca: () => new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), new THREE.MeshStandardMaterial({ color: 0xb59bff, roughness: 0.5, flatShading: true })),
  octa: () => new THREE.Mesh(new THREE.OctahedronGeometry(1.7, 0), new THREE.MeshStandardMaterial({ color: 0xffc46b, roughness: 0.4, flatShading: true })),
  tetra: () => new THREE.Mesh(new THREE.TetrahedronGeometry(1.8, 0), new THREE.MeshStandardMaterial({ color: 0xff7fb0, roughness: 0.4, flatShading: true })),
  lathe: () => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const y = i * 0.35; pts.push(new THREE.Vector2(0.6 + Math.sin(i * 0.55) * 0.5 + y * 0.05, y)); }
    return new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({ color: 0x7cc6ff, roughness: 0.35, metalness: 0.3 }));
  },
  spring: () => {
    const pts = [];
    for (let i = 0; i <= 200; i++) { const t = i / 200, a = t * Math.PI * 10; pts.push(new THREE.Vector3(Math.cos(a) * 1.2, t * 3 - 1.5, Math.sin(a) * 1.2)); }
    return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.16, 8, false), new THREE.MeshStandardMaterial({ color: 0xffcf5c, roughness: 0.3, metalness: 0.7 }));
  },
  arch: () => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const a = Math.PI * i / 24; pts.push(new THREE.Vector3(-Math.cos(a) * 2.4, Math.sin(a) * 2.6, 0)); }
    return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.4, 10, false), new THREE.MeshStandardMaterial({ color: 0xd9c27a, roughness: 0.7 }));
  },
};

export function spawnAdvanced(type) {
  const make = ADVANCED[type];
  if (!make) return;
  const m = make();
  m.position.set((Math.random() - 0.5) * 6, 1.8, (Math.random() - 0.5) * 6);
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  register(m, { name: type, type, kind: 'advanced' });
  addXP(14); toast('已放置高级几何体：' + type);
  return App.selected;
}

// ---------- 布尔运算 ----------
function toBrush(rec) {
  rec.root.updateMatrixWorld(true);
  let geo = null, mat = null;
  rec.root.traverse(o => { if (!geo && o.isMesh) { geo = o.geometry.clone(); mat = o.material.clone(); } });
  if (!geo) return null;
  const b = new Brush(geo, mat);
  b.position.copy(rec.root.position);
  b.rotation.copy(rec.root.rotation);
  b.scale.copy(rec.root.scale);
  b.updateMatrixWorld(true);
  return b;
}

export function booleanOp(op) {
  const a = App.selected, b = App.boolTarget;
  if (!a || !b || a === b) { toast('请先选主体，再拾取另一个物体作为目标'); return; }
  try {
    const ba = toBrush(a), bb = toBrush(b);
    if (!ba || !bb) { toast('物体缺少可用网格'); return; }
    const OP = { union: ADDITION, intersect: INTERSECTION, subtract: SUBTRACTION }[op] || ADDITION;
    const result = evaluator.evaluate(ba, bb, OP);
    result.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // 结果放在主体 A 的世界位置
    const pa = a.root.position.clone();
    App.engine.remove(a.root); App.engine.remove(b.root);
    App.objects = App.objects.filter(r => r !== a && r !== b);
    result.position.copy(pa);
    result.updateMatrixWorld(true);
    register(result, { name: '布尔·' + op, type: 'boolean', kind: 'boolean' });
    App.boolTarget = null;
    addXP(28); toast('布尔运算完成：' + op);
  } catch (e) {
    console.error(e); toast('布尔运算失败：几何体可能不兼容');
  }
}

// ---------- 细分曲面 ----------
export function subdivideSelected() {
  const rec = App.selected;
  if (!rec) return;
  let mesh = null;
  rec.root.traverse(o => { if (!mesh && o.isMesh && o.geometry?.attributes.position) mesh = o; });
  if (!mesh) { toast('没有可细分的网格'); return; }
  try {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const pos = g.attributes.position;
    const col = g.attributes.color;
    const outP = [], outC = [];
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
    for (let i = 0; i < pos.count; i += 3) {
      va.fromBufferAttribute(pos, i); vb.fromBufferAttribute(pos, i + 1); vc.fromBufferAttribute(pos, i + 2);
      const ab = mid(va, vb), bc = mid(vb, vc), ca = mid(vc, va);
      const tris = [[va, ab, ca], [ab, vb, bc], [ca, bc, vc], [ab, bc, ca]];
      tris.forEach(t => t.forEach(v => {
        outP.push(v.x, v.y, v.z);
        // 细分后位置向球面归一化，得到平滑效果
        const n = v.clone().normalize().multiplyScalar(v.length() * 0.5 + Math.max(va.length(), vb.length(), vc.length()) * 0.5);
        outP[outP.length - 3] = n.x; outP[outP.length - 2] = n.y; outP[outP.length - 1] = n.z;
        if (col) { const c = new THREE.Color().fromBufferAttribute(col, i); outC.push(c.r, c.g, c.b); }
      }));
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
    if (col) ng.setAttribute('color', new THREE.Float32BufferAttribute(outC, 3));
    else {
      const base = mesh.material.color ? mesh.material.color : new THREE.Color(0x7cc6ff);
      const white = new Float32Array((outP.length / 3) * 3);
      for (let i = 0; i < white.length; i += 3) { white[i] = base.r; white[i + 1] = base.g; white[i + 2] = base.b; }
      ng.setAttribute('color', new THREE.BufferAttribute(white, 3));
      mesh.material.vertexColors = true; mesh.material.color.set(0xffffff);
    }
    ng.computeVertexNormals();
    mesh.geometry.dispose(); mesh.geometry = ng;
    addXP(16); toast('细分完成，面数 ×4');
  } catch (e) { console.error(e); toast('细分失败'); }
}

// ---------- 镜像 ----------
export function mirrorSelected(axis) {
  const rec = App.selected;
  if (!rec) return;
  const clone = rec.root.clone(true);
  clone.userData.recId = undefined;
  if (axis === 'x') clone.scale.x *= -1;
  else if (axis === 'y') clone.scale.y *= -1;
  else if (axis === 'z') clone.scale.z *= -1;
  clone.position.copy(rec.root.position);
  clone.traverse(o => { if (o.isMesh && o.geometry && !o.geometry.attributes.color) {
    const n = o.geometry.attributes.position.count;
    o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }});
  register(clone, { name: rec.name + '·镜像' + axis.toUpperCase(), type: rec.type, kind: rec.kind });
  addXP(10); toast('已沿 ' + axis.toUpperCase() + ' 轴镜像');
}

// ---------- 阵列 ----------
export function arraySelected(mode, count, param) {
  const rec = App.selected;
  if (!rec) { toast('先选中一个物体'); return; }
  count = Math.max(2, Math.min(60, count || 5));
  const base = rec.root;
  const clones = [];
  for (let i = 1; i < count; i++) {
    const c = base.clone(true);
    c.userData.recId = undefined;
    if (mode === 'linear') c.position.set(base.position.x + i * (param || 2), base.position.y, base.position.z);
    else if (mode === 'grid') { const cols = Math.ceil(Math.sqrt(count)); c.position.set(base.position.x + (i % cols) * (param || 2), base.position.y, base.position.z + Math.floor(i / cols) * (param || 2)); }
    else { const a = i / count * Math.PI * 2; const r = param || 5; c.position.set(base.position.x + Math.cos(a) * r, base.position.y, base.position.z + Math.sin(a) * r); c.rotation.y = -a; }
    c.traverse(o => { if (o.isMesh && o.geometry && !o.geometry.attributes.color) {
      const n = o.geometry.attributes.position.count;
      o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }});
    register(c, { name: rec.name + '#' + i, type: rec.type, kind: rec.kind });
    clones.push(c);
  }
  addXP(clones.length * 3); toast('阵列完成：' + clones.length + ' 个副本');
}

// ---------- 挤出建模 ----------
export function extrudeShape(preset, depth) {
  let shape = new THREE.Shape();
  if (preset === 'star') {
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, r = i % 2 ? 0.8 : 1.8; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? shape.lineTo(x, y) : shape.moveTo(x, y); }
    shape.closePath();
  } else if (preset === 'gear') {
    const teeth = 12;
    for (let i = 0; i < teeth * 2; i++) { const a = i * Math.PI / teeth, r = i % 2 ? 1.3 : 1.8; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? shape.lineTo(x, y) : shape.moveTo(x, y); }
    shape.closePath();
    const hole = new THREE.Path(); hole.absarc(0, 0, 0.5, 0, Math.PI * 2, true); shape.holes.push(hole);
  } else if (preset === 'heart') {
    shape.moveTo(0, -1.2);
    shape.bezierCurveTo(-2, 0.4, -1, 2, 0, 1);
    shape.bezierCurveTo(1, 2, 2, 0.4, 0, -1.2);
  } else {
    shape = new THREE.Shape(); shape.absarc(0, 0, 1.6, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, 0.7, 0, Math.PI * 2, true); shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth || 0.8, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3, curveSegments: 24 });
  g.center();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc9a2ff, roughness: 0.35, metalness: 0.5 }));
  m.position.set((Math.random() - 0.5) * 6, 1.8, (Math.random() - 0.5) * 6);
  m.castShadow = true; m.receiveShadow = true;
  register(m, { name: '挤出·' + preset, type: 'extrude-' + preset, kind: 'advanced' });
  addXP(14); toast('已挤出形状：' + preset);
}
