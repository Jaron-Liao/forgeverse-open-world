// 种子化无限地图：以视点为中心分块生成地形；记录种子；导航书签一键返回
import * as THREE from 'three';
import { App, toast } from './state.js';

const CHUNK = 60;          // 每块边长（世界单位）
const SEG = 32;            // 每块网格分段
const RADIUS = 2;          // 维护半径（生成 (2R+1)^2 块）
let chunks = new Map();    // key "cx,cz" -> Mesh
let group = null, seed = 7, enabled = false;

function hash(i, j, s) {
  let n = (i * 374761393 + j * 668265263 + s * 982451653) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}
function noise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, s), b = hash(xi + 1, zi, s), c = hash(xi, zi + 1, s), d = hash(xi + 1, zi + 1, s);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function heightAt(wx, wz, s) {
  let h = 0, amp = 3, f = 0.015;
  for (let o = 0; o < 4; o++) { h += noise(wx * f, wz * f, s + o * 13) * amp; amp *= 0.5; f *= 2; }
  return h - 1.2;
}

function colorFor(h) {
  if (h < 0.2) return new THREE.Color(0x3a78c2);
  if (h < 0.8) return new THREE.Color(0xd9c27a);
  if (h < 3) return new THREE.Color(0x4f9d4f);
  if (h < 5) return new THREE.Color(0x6f7a86);
  return new THREE.Color(0xeef3ff);
}

function buildChunk(cx, cz) {
  const g = new THREE.PlaneGeometry(CHUNK, CHUNK, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const wx = cx * CHUNK + pos.getX(i) + CHUNK / 2;
    const wz = cz * CHUNK + pos.getZ(i) + CHUNK / 2;
    const h = heightAt(wx, wz, seed);
    pos.setY(i, h);
    const c = colorFor(h);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
  mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}

export function initInfiniteMap() {
  group = new THREE.Group();
  group.name = 'infinite-map';
  App.engine.add(group);
  App.engine.onUpdate(() => { if (enabled) updateChunks(); });
}

function updateChunks() {
  const p = App.engine.camera.position;
  const cx = Math.round(p.x / CHUNK), cz = Math.round(p.z / CHUNK);
  const want = new Set();
  for (let dz = -RADIUS; dz <= RADIUS; dz++)
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const k = (cx + dx) + ',' + (cz + dz);
      want.add(k);
      if (!chunks.has(k)) {
        const [a, b] = k.split(',').map(Number);
        const mesh = buildChunk(a, b);
        group.add(mesh); chunks.set(k, mesh);
      }
    }
  // 回收远处块
  for (const [k, mesh] of chunks) {
    if (!want.has(k)) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); chunks.delete(k); }
  }
}

export function applySeed(newSeed) {
  seed = Number(newSeed) || 7;
  for (const [, mesh] of chunks) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  chunks.clear();
  App.mapSeed = seed;
  updateChunks();
  toast('无限地图种子已应用：' + seed);
}

export function enableInfinite(on) {
  enabled = on;
  if (group) group.visible = on;
  if (on) updateChunks();
}

export function getSeed() { return seed; }
export function terrainHeight(x, z) { return heightAt(x, z, seed); }

// ---- 导航书签 ----
export function addBookmark(name) {
  if (!App.bookmarks) App.bookmarks = [];
  const p = App.engine.camera.position;
  const target = App.engine.controls.target;
  App.bookmarks.push({ name: name || `位置 ${App.bookmarks.length + 1}`, x: target.x, y: target.y, z: target.z, seed });
  renderBookmarks();
  toast('书签已添加：' + name);
}

export function addObjectBookmark(rec) {
  if (!App.bookmarks) App.bookmarks = [];
  const p = rec.root.position;
  App.bookmarks.push({ name: '📍 ' + rec.name, x: p.x, y: p.y + 1, z: p.z, seed });
  renderBookmarks();
  toast('已记录位置：' + rec.name);
}

export function renderBookmarks() {
  const box = document.getElementById('bookmarkList');
  if (!box) return;
  box.innerHTML = '';
  (App.bookmarks || []).forEach((bm, i) => {
    const n = document.createElement('div');
    n.className = 'node';
    n.innerHTML = `<span>📍</span><span>${bm.name}</span><span class="x">✕</span>`;
    n.onclick = e => {
      if (e.target.classList.contains('x')) { App.bookmarks.splice(i, 1); renderBookmarks(); return; }
      goTo(bm);
    };
    box.appendChild(n);
  });
}

export function goTo(bm) {
  if (bm.seed != null && bm.seed !== seed) applySeed(bm.seed);
  const cam = App.engine.camera, ctl = App.engine.controls;
  cam.position.set(bm.x + 10, bm.y + 8, bm.z + 10);
  ctl.target.set(bm.x, bm.y, bm.z);
  ctl.update();
  toast('已返回：' + bm.name);
}
