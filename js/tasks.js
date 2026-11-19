import { App, bus, addXP, setPet, toast, uid } from './state.js';

const ACH = [
  { n: 1, name: '初出茅庐', tip: '完成首个任务' },
  { n: 5, name: '小有成效', tip: '完成 5 个任务' },
  { n: 10, name: '建造师', tip: '完成 10 个任务' },
  { n: 20, name: '造物大师', tip: '完成 20 个任务' },
];
let unlocked = new Set();

export function addTask(text) {
  text = (text || '').trim();
  if (!text) return;
  App.tasks.push({ id: uid(), text, done: false });
  renderTasks();
}
export function toggleTask(id) {
  const t = App.tasks.find(t => t.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done) {
    addXP(20);
    const doneCnt = App.tasks.filter(x => x.done).length;
    ACH.forEach(a => { if (doneCnt >= a.n && !unlocked.has(a.n)) { unlocked.add(a.n); toast('🏆 成就解锁：' + a.name); setPet('happy', '成就达成：' + a.name + '！'); } });
    setPet('happy', '任务完成 +20 XP，继续冲！');
  } else { setPet('work', '加油，还差一点～'); }
  renderTasks();
}
export function delTask(id) {
  App.tasks = App.tasks.filter(t => t.id !== id);
  renderTasks();
}

export function renderTasks() {
  const ul = document.getElementById('taskList');
  if (!ul) return;
  ul.innerHTML = '';
  App.tasks.forEach(t => {
    const li = document.createElement('li');
    li.className = t.done ? 'done' : '';
    li.innerHTML = `<span class="ck">${t.done ? '✓' : ''}</span><span>${t.text}</span><span class="del">🗑</span>`;
    li.querySelector('.ck').onclick = () => toggleTask(t.id);
    li.querySelector('.del').onclick = () => delTask(t.id);
    ul.appendChild(li);
  });
  const pct = Math.round(App.xp / (App.level * 100) * 100);
  const fill = document.getElementById('xpFill'); if (fill) fill.style.width = pct + '%';
  const txt = document.getElementById('xpTxt'); if (txt) txt.textContent = `${App.xp} / ${App.level * 100} XP`;
  const lv = document.getElementById('lvNum'); if (lv) lv.textContent = App.level;
}

export function initTasks() {
  bus.on('xp', () => renderTasks());
  bus.on('levelup', lv => { toast('🎉 升到 Lv.' + lv + '！'); setPet('happy', '升级啦，Lv.' + lv + '，你越来越强！'); });
  renderTasks();
}
