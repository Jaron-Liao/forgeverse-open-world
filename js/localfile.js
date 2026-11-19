// 本地文件存档 / 读档：用户自选路径保存 JSON，读取本地 JSON 恢复
import { toast } from './state.js';
import { deserialize } from './io.js';

let fileHandle = null;

export async function saveToLocalFile(data) {
  const json = JSON.stringify(data, null, 2);
  // 优先使用 File System Access API（Chrome/Edge），可真正选择路径并覆盖
  if (window.showSaveFilePicker) {
    try {
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: (data.worldName || 'forgeverse') + '.json',
          types: [{ description: 'ForgeVerse 存档', accept: { 'application/json': ['.json'] } }],
        });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      toast('已保存到本地文件');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      // 回退到下载
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (data.worldName || 'forgeverse') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('已导出存档文件');
}

export function loadFromLocalFile(onLoaded) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        deserialize(data);
        if (onLoaded) onLoaded(data);
        toast('已从本地文件恢复');
      } catch (err) { toast('读取失败：文件格式不正确'); }
    };
    r.readAsText(f);
  };
  inp.click();
}
