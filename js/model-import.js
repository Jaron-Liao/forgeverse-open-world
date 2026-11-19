// GLTF/GLB 模型导入：复用 Tripo / Blender 导出的资产，归入资产库并可重复放置
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { App, toast, uid } from './state.js';
import { register } from './objects.js';

const loader = new GLTFLoader();
const library = []; // {id, name, scene}

export function initModelImport() {
  const fi = document.getElementById('modelFileInput');
  if (!fi) return;
  fi.onchange = e => {
    const files = [...e.target.files];
    files.forEach(f => importModelFile(f));
    e.target.value = '';
  };
}

export function importModelFile(file) {
  const url = URL.createObjectURL(file);
  const name = file.name.replace(/\.(glb|gltf)$/i, '');
  loader.load(url, gltf => {
    const root = gltf.scene;
    root.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    library.push({ id: uid(), name, root });
    renderLibrary();
    toast('已导入模型到资产库：' + name);
    URL.revokeObjectURL(url);
  }, undefined, err => {
    console.error(err); toast('导入失败：' + file.name); URL.revokeObjectURL(url);
  });
}

export function renderLibrary() {
  const box = document.getElementById('customAssets');
  if (!box) return;
  box.innerHTML = '';
  library.forEach(item => {
    const b = document.createElement('button');
    b.textContent = '🧊 ' + item.name;
    b.title = '点击放置到场景';
    b.onclick = () => placeFromLibrary(item.id);
    box.appendChild(b);
  });
}

export function placeFromLibrary(id) {
  const item = library.find(x => x.id === id);
  if (!item) return;
  const clone = item.root.clone(true);
  clone.position.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
  clone.userData.recId = undefined;
  register(clone, { name: item.name, type: 'imported', kind: 'imported' });
  toast('已放置：' + item.name);
}

export function getLibrary() { return library; }
