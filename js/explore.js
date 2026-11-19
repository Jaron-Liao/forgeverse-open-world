import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { App, toast } from './state.js';

let plControls = null;
const keys = { w: false, a: false, s: false, d: false };
let minimapCtx = null, minimapCamera = null;

// 第三人称状态
let player = null, yaw = 0, pitch = 0.25, tpDragging = false, lastMouse = null;
const FP_POS = new THREE.Vector3(0, 2.5, 6);
const EDIT_POS = new THREE.Vector3(14, 12, 18);

export function initExplore(minimapCanvas) {
  const eng = App.engine;
  plControls = new PointerLockControls(eng.camera, eng.renderer.domElement);

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k in keys) keys[k] = true;
  });
  window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k in keys) keys[k] = false; });

  // 第三人称：鼠标拖动控制 yaw/pitch（上下视角）
  const dom = eng.renderer.domElement;
  dom.addEventListener('pointerdown', e => {
    if (!App.thirdPerson || e.button !== 0) return;
    tpDragging = true; lastMouse = [e.clientX, e.clientY];
  });
  window.addEventListener('pointermove', e => {
    if (!App.thirdPerson || !tpDragging || !lastMouse) return;
    yaw -= (e.clientX - lastMouse[0]) * 0.004;
    pitch = THREE.MathUtils.clamp(pitch + (e.clientY - lastMouse[1]) * 0.003, -0.5, 1.2);
    lastMouse = [e.clientX, e.clientY];
  });
  window.addEventListener('pointerup', () => { tpDragging = false; lastMouse = null; });

  eng.onUpdate(dt => {
    if (App.thirdPerson) {
      updateThirdPerson(dt);
    } else if (App.firstPerson) {
      const fwd = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
      const str = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      if (fwd) plControls.moveForward(fwd * 8 * dt);
      if (str) plControls.moveRight(str * 8 * dt);
      if (eng.camera.position.y < 1.6) eng.camera.position.y = 1.6;
    }
  });

  if (minimapCanvas) { minimapCtx = minimapCanvas.getContext('2d'); minimapCamera = eng.camera; }
}

function ensurePlayer() {
  if (player) return player;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 8, 16), new THREE.MeshStandardMaterial({ color: 0x3a86d4, roughness: 0.5 }));
  body.position.y = 1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 16), new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.6 }));
  head.position.y = 2.1;
  g.add(body, head);
  g.position.copy(FP_POS);
  App.engine.add(g);
  player = g;
  return g;
}

function updateThirdPerson(dt) {
  const eng = App.engine;
  const p = ensurePlayer();
  const fwd = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const str = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const speed = 8 * dt;
  if (fwd || str) {
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    p.position.addScaledVector(dir, fwd * speed);
    p.position.addScaledVector(right, str * speed);
    p.rotation.y = yaw;
  }
  // 相机在角色后上方
  const dist = 7, h = 2.5;
  eng.camera.position.set(
    p.position.x - Math.sin(yaw) * dist * Math.cos(pitch),
    p.position.y + h + Math.sin(pitch) * dist,
    p.position.z - Math.cos(yaw) * dist * Math.cos(pitch)
  );
  eng.camera.lookAt(p.position.x, p.position.y + 1.4, p.position.z);
}

export function toggleFirstPerson(on) {
  const eng = App.engine;
  App.firstPerson = on;
  if (App.thirdPerson) toggleThirdPerson(false, true);
  if (on) {
    eng.controls.enabled = false; eng.tcontrols.detach();
    eng.camera.position.copy(FP_POS);
    eng.camera.lookAt(0, 1.6, -4);
    plControls.lock();
    toast('第一人称：WASD 移动 · 鼠标环视 · ESC 退出');
  } else {
    plControls.unlock();
    eng.controls.enabled = true;
    eng.controls.target.set(0, 1, 0); eng.camera.position.copy(EDIT_POS);
    toast('已返回编辑视角');
  }
}

export function toggleThirdPerson(on, silent) {
  const eng = App.engine;
  App.thirdPerson = on;
  if (App.firstPerson) toggleFirstPerson(false);
  if (on) {
    eng.controls.enabled = false; eng.tcontrols.detach();
    if (player) { yaw = player.rotation.y; }
    ensurePlayer();
    toast('第三人称：WASD 移动 · 按住左键拖动控制视角');
  } else {
    if (player) { eng.remove(player); player = null; }
    eng.controls.enabled = true;
    eng.controls.target.set(0, 1, 0); eng.camera.position.copy(EDIT_POS);
    if (!silent) toast('已返回编辑视角');
  }
}

export function bindUnlock(cb) {
  if (plControls) plControls.addEventListener('unlock', () => {
    if (App.firstPerson) { App.firstPerson = false; App.engine.controls.enabled = true; App.engine.controls.target.set(0, 1, 0); }
    cb();
  });
}

// ---------- 小地图 ----------
export function drawMinimap() {
  if (!minimapCtx) return;
  const ctx = minimapCtx, S = minimapCtx.canvas.width;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(12,18,34,0.85)'; ctx.fillRect(0, 0, S, S);
  const cam = minimapCamera, cx = S / 2, cy = S / 2, scale = S / 80;

  ctx.strokeStyle = 'rgba(120,150,220,0.15)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = i / 8 * S;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  App.objects.forEach(o => {
    if (!o.root.visible) return;
    const x = cx + o.root.position.x * scale, z = cy + o.root.position.z * scale;
    if (x < 0 || x > S || z < 0 || z > S) return;
    ctx.beginPath();
    ctx.arc(x, z, (App.selected === o || o.meta?.marked) ? 4 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = o.meta?.marked ? '#a06bff' : (App.selected === o ? '#ffcf5c' : (o.kind === 'model' ? '#5cc8ff' : '#9be8a0'));
    ctx.fill();
  });

  const focus = App.thirdPerson && player ? player.position : cam.position;
  const px = cx + focus.x * scale, py = cy + focus.z * scale;
  const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
  const ang = Math.atan2(dir.x, dir.z);
  ctx.save(); ctx.translate(px, py); ctx.rotate(-ang);
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-5, 5); ctx.lineTo(0, 2); ctx.lineTo(5, 5);
  ctx.closePath(); ctx.fillStyle = '#ff5fa2'; ctx.fill(); ctx.restore();
}
