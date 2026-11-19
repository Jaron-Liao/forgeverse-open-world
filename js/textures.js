import * as THREE from 'three';
import { App, toast } from './state.js';

// ---------- 可平铺的程序化 PBR 纹理生成器 ----------
// 生成 颜色图 / 法线图 / 粗糙度图，零依赖、无缝平铺

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function tileNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y, seed, octaves = 5) {
  let h = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    h += tileNoise(x * freq, y * freq, Math.round(freq), seed + o * 31) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return h / norm;
}

// 颜色映射：给高度值返回 RGB(0-255)
const COLOR_FNS = {
  grass(h, n) {
    // 绿色系：低处深绿，高处黄绿，混随机斑点
    const t = h * 0.7 + n * 0.3;
    return [
      40 + t * 90 + (n > 0.7 ? 20 : 0),
      90 + t * 110,
      35 + t * 45,
    ];
  },
  rock(h, n) {
    const t = h * 0.8 + n * 0.2;
    const g = 70 + t * 120;
    return [g + 8, g + 6, g];
  },
  bark(h, n, u, v) {
    // 树皮：垂直纤维条纹
    const stripe = Math.sin(u * Math.PI * 2 * 18 + n * 6) * 0.5 + 0.5;
    const t = h * 0.4 + stripe * 0.4 + n * 0.2;
    return [55 + t * 70, 38 + t * 50, 25 + t * 35];
  },
  sand(h, n) {
    const t = h * 0.6 + n * 0.4;
    return [190 + t * 50, 170 + t * 50, 125 + t * 50];
  },
  snow(h, n) {
    const t = h * 0.5 + n * 0.5;
    return [220 + t * 35, 230 + t * 25, 240 + t * 15];
  },
};

function makeSet(type, size = 512) {
  const height = new Float32Array(size * size);
  const noiseVals = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const h = fbm(u * 4, v * 4, type.length * 13 + 7, 5);
      height[y * size + x] = h;
      noiseVals[y * size + x] = tileNoise(u * 16, v * 16, 16, 91);
    }
  }

  // 颜色图
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = size;
  const cctx = colorCanvas.getContext('2d');
  const cimg = cctx.createImageData(size, size);
  const colorFn = COLOR_FNS[type] || COLOR_FNS.rock;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, p = i * 4;
      const [r, g, b] = colorFn(height[i], noiseVals[i], x / size, y / size);
      cimg.data[p] = Math.max(0, Math.min(255, r));
      cimg.data[p + 1] = Math.max(0, Math.min(255, g));
      cimg.data[p + 2] = Math.max(0, Math.min(255, b));
      cimg.data[p + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);

  // 法线图（Sobel 从高度求梯度）
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  const nctx = normalCanvas.getContext('2d');
  const nimg = nctx.createImageData(size, size);
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = 3.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      nimg.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  // 粗糙度图
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  const rimg = rctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const r = 160 + noiseVals[i] * 80;
    const p = i * 4;
    rimg.data[p] = rimg.data[p + 1] = rimg.data[p + 2] = r;
    rimg.data[p + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);

  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mk(colorCanvas, true), normalMap: mk(normalCanvas, false), roughnessMap: mk(roughCanvas, false) };
}

const cache = {};
function getSet(type) { if (!cache[type]) cache[type] = makeSet(type); return cache[type]; }

// ---------- 应用到场景资产 ----------
export function enhanceAssets() {
  // 地形：草地纹理 + 顶点色叠加
  const terrain = window.__terrain;
  if (terrain && terrain.material) {
    const tex = getSet('grass');
    tex.map.repeat.set(20, 20); tex.normalMap.repeat.set(20, 20); tex.roughnessMap.repeat.set(20, 20);
    terrain.material.map = tex.map;
    terrain.material.normalMap = tex.normalMap;
    terrain.material.roughnessMap = tex.roughnessMap;
    terrain.material.normalScale = new THREE.Vector2(0.6, 0.6);
    terrain.material.roughness = 0.95;
    terrain.material.needsUpdate = true;
  }

  // 场景对象：按 kind/type 贴图
  App.objects.forEach(rec => {
    rec.root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const name = (rec.type || '').toLowerCase();
      let set = null;
      if (name.includes('tree') || name.includes('bush')) set = getSet('bark');
      else if (name.includes('rock') || name.includes('stone')) set = getSet('rock');
      else if (name.includes('chest') || name.includes('wood')) set = getSet('bark');
      if (!set) return;
      // 克隆纹理以独立控制重复
      const m = o.material;
      m.map = set.map.clone(); m.map.needsUpdate = true;
      m.normalMap = set.normalMap.clone(); m.normalMap.needsUpdate = true;
      m.roughnessMap = set.roughnessMap.clone(); m.roughnessMap.needsUpdate = true;
      m.normalScale = new THREE.Vector2(0.8, 0.8);
      m.needsUpdate = true;
    });
  });
  toast('PBR 纹理已应用：颜色 + 法线 + 粗糙度');
}

export function applyTextureToSelected(type) {
  const rec = App.selected;
  if (!rec) { toast('先选中物体'); return; }
  const set = getSet(type);
  rec.root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    o.material.map = set.map.clone(); o.material.map.needsUpdate = true;
    o.material.normalMap = set.normalMap.clone(); o.material.normalMap.needsUpdate = true;
    o.material.roughnessMap = set.roughnessMap.clone(); o.material.roughnessMap.needsUpdate = true;
    o.material.normalScale = new THREE.Vector2(0.8, 0.8);
    o.material.needsUpdate = true;
  });
  toast('已贴 PBR 纹理：' + type);
}
