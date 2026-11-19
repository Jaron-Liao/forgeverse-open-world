// 物品信息系统：点击物体看完整信息、改标签名、标记对比、定位返回
import { App, toast } from './state.js';
import { bus } from './state.js';

let current = null;

function ensureMeta(rec) {
  if (!rec.meta) rec.meta = { tags: [], marked: false, note: '' };
  return rec.meta;
}

export function showItemInfo(rec) {
  if (!rec) return;
  current = rec;
  const meta = ensureMeta(rec);
  document.getElementById('icName').textContent = rec.name;
  const tags = document.getElementById('icTags');
  tags.innerHTML = '';
  meta.tags.forEach((t, i) => {
    const el = document.createElement('span');
    el.className = 'ic-tag';
    el.textContent = t;
    el.title = '点击删除';
    el.onclick = () => { meta.tags.splice(i, 1); showItemInfo(rec); bus.emit('itemmeta'); };
    tags.appendChild(el);
  });
  const p = rec.root.position;
  document.getElementById('icMeta').innerHTML =
    `类型：${rec.type} · 分类：${rec.kind}<br>坐标：X ${p.x.toFixed(1)} / Y ${p.y.toFixed(1)} / Z ${p.z.toFixed(1)}<br>` +
    `可见：${rec.root.visible ? '是' : '否'} · 标签 ${meta.tags.length} 个`;
  document.getElementById('icMark').textContent = meta.marked ? '★' : '☆';
  document.getElementById('infoCard').classList.add('show');
}

export function hideItemInfo() {
  document.getElementById('infoCard').classList.remove('show');
  current = null;
}

export function initItemInfo(onLocate) {
  document.getElementById('icClose').onclick = hideItemInfo;
  document.getElementById('icAddTag').onclick = () => {
    if (!current) return;
    const inp = document.getElementById('icNewTag');
    const v = inp.value.trim();
    if (!v) return;
    ensureMeta(current).tags.push(v);
    inp.value = '';
    // 同步标签到物体名字后缀，便于同类/异类对比记忆
    showItemInfo(current);
    bus.emit('itemmeta');
    toast('标签已添加：' + v);
  };
  document.getElementById('icNewTag').onkeydown = e => {
    if (e.key === 'Enter') document.getElementById('icAddTag').click();
  };
  document.getElementById('icMark').onclick = () => {
    if (!current) return;
    const m = ensureMeta(current);
    m.marked = !m.marked;
    document.getElementById('icMark').textContent = m.marked ? '★' : '☆';
    bus.emit('itemmeta');
    toast(m.marked ? '已标记 ★' : '已取消标记');
  };
  document.getElementById('icLocate').onclick = () => {
    if (current && onLocate) onLocate(current);
  };
  // 点击物体时弹出信息卡
  bus.on('select', rec => { if (rec) showItemInfo(rec); else hideItemInfo(); });
}

// 搜索：物体 / 任务 / 笔记
export function searchAll(query, noteText) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  App.objects.forEach(o => {
    const meta = o.meta || {};
    const hay = [o.name, o.type, o.kind, ...(meta.tags || [])].join(' ').toLowerCase();
    if (hay.includes(q)) out.push({ kind: '物体', label: o.name, sub: (meta.tags || []).join(',') || o.type, ref: o });
  });
  App.tasks.forEach(t => { if (t.text.toLowerCase().includes(q)) out.push({ kind: '任务', label: t.text, sub: t.done ? '已完成' : '待办', ref: t }); });
  if (noteText && noteText.toLowerCase().includes(q)) out.push({ kind: '笔记', label: noteText.slice(0, 40), sub: '信息台', ref: null });
  return out;
}
