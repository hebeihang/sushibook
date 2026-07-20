/**
 * StageBackgroundPanel — 预览舞台背景设置（三层模型 · Layer 2 表现层）
 *
 * 背景是表现层属性，最终落到每个场景 frontmatter 的 `bg:` 字段：
 *   - 本场景：写入当前场景的 frontmatter（可随 .sushi 导出，优先级最高）
 *   - 全部场景：写入每个场景的 frontmatter（= 整个故事统一颜色，可导出）
 * 解析优先级：场景 bg:  >  跟随主题。导出后的电子书同样生效。
 *
 * 支持：预设（羊皮纸/暗纹/星空/纯白/纯黑）、颜色、图片 URL、跟随主题。
 */

import type { EditorPanel } from '../editor/EditorPanel';
import { gameStore } from '../store/gameStore';
import { PRESETS, resolveBackground } from './stageBackground';

interface PanelOpts {
  editor: EditorPanel;
  applySource: (source: string) => void;
}

// ---- frontmatter bg: 文本操作（纯字符串，作用于 .sushi 源） ----

/** 复刻 parser 的父子场景 id 推断，定位某场景的标题行 */
function findSceneHeaderLine(source: string, sceneId: string): number {
  const lines = source.split('\n');
  let parent = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,3})\s+(\S+)/);
    if (!m) continue;
    const sub = m[1] === '###';
    const name = m[2];
    const id = sub ? (parent ? `${parent}.${name}` : name) : name;
    if (id === sceneId) return i;
    if (!sub) parent = name;
  }
  return -1;
}

function setSceneBgInSource(source: string, sceneId: string, bg: string): string {
  const lines = source.split('\n');
  const h = findSceneHeaderLine(source, sceneId);
  if (h === -1) return source;

  // 找紧跟标题后的 frontmatter 块
  let i = h + 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i] && lines[i].trim() === '---') {
    const open = i;
    let close = open + 1;
    while (close < lines.length && lines[close].trim() !== '---') close++;
    const end = close < lines.length ? close : lines.length;
    let replaced = false;
    for (let k = open + 1; k < end; k++) {
      if (/^\s*bg\s*:/i.test(lines[k])) {
        lines[k] = `bg: ${bg}`;
        replaced = true;
        break;
      }
    }
    if (!replaced) lines.splice(open + 1, 0, `bg: ${bg}`);
    return lines.join('\n');
  }

  // 无 frontmatter：在标题后插入一个
  lines.splice(h + 1, 0, '---', `bg: ${bg}`, '---');
  return lines.join('\n');
}

function clearSceneBgInSource(source: string, sceneId: string): string {
  const lines = source.split('\n');
  const h = findSceneHeaderLine(source, sceneId);
  if (h === -1) return source;
  let i = h + 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i] && lines[i].trim() === '---') {
    const open = i;
    let close = open + 1;
    while (close < lines.length && lines[close].trim() !== '---') close++;
    const end = close < lines.length ? close : lines.length;
    for (let k = open + 1; k < end; k++) {
      if (/^\s*bg\s*:/i.test(lines[k])) {
        lines.splice(k, 1);
        break;
      }
    }
  }
  return lines.join('\n');
}

function allSceneIds(source: string): string[] {
  const lines = source.split('\n');
  const ids: string[] = [];
  let parent = '';
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(\S+)/);
    if (!m) continue;
    const sub = m[1] === '###';
    const name = m[2];
    const id = sub ? (parent ? `${parent}.${name}` : name) : name;
    if (!sub) parent = name;
    ids.push(id);
  }
  return ids;
}

// ---- 面板 ----

/** 初始化舞台背景设置面板 */
export function initStageBackgroundPanel(container: HTMLElement, opts: PanelOpts): void {
  const toggleBtn = document.getElementById('btn-stage-bg');
  const panel = document.getElementById('stage-bg-panel');
  if (!panel) return;

  toggleBtn?.addEventListener('click', () => panel.classList.toggle('hidden'));

  const scopeSelect = container.querySelector<HTMLSelectElement>('#stage-bg-scope');
  const colorInput = container.querySelector<HTMLInputElement>('#stage-bg-color');
  const imageInput = container.querySelector<HTMLInputElement>('#stage-bg-image');
  const presetContainer = container.querySelector<HTMLElement>('#stage-bg-presets');
  const applyBtn = container.querySelector<HTMLElement>('#stage-bg-apply');
  const clearBtn = container.querySelector<HTMLElement>('#stage-bg-clear');

  if (!presetContainer || !scopeSelect || !applyBtn || !clearBtn) return;

  // 当前选中的背景表达式（'' = 跟随主题）
  let currentValue = '';

  // 预设按钮：跟随主题 + 各风格化预设
  const presets = [{ id: '', label: '跟随主题', css: '', text: '' }, ...PRESETS];
  presetContainer.innerHTML = presets
    .map((p) => {
      const bg = p.css
        ? p.css
        : 'repeating-linear-gradient(45deg,#2a2a3a,#2a2a3a 6px,#33334a 6px,#33334a 12px)';
      const fg = p.id === '' ? '#cfcfe6' : 'var(--stage-text)';
      return `<button type="button" class="stage-bg-preset" data-id="${p.id}" title="${p.label}" style="background:${bg};color:${fg}">${p.label}</button>`;
    })
    .join('');

  function preview(value: string): void {
    currentValue = value;
    // 即时预览（不落盘）：直接解析并应用到宿主层
    const { css, text } = resolveBackground(value);
    const host = document.getElementById('preview-bg');
    if (!host) return;
    if (css) {
      host.style.background = css;
      host.style.opacity = '1';
      if (text) host.style.color = `rgb(${text.join(',')})`;
    } else {
      host.style.opacity = '0';
    }
    highlightPreset(value);
  }

  function apply(): void {
    const scope = scopeSelect!.value; // 'scene' | 'all'
    const src = opts.editor.getContent();
    let next = src;
    if (scope === 'all') {
      next = currentValue
        ? allSceneIds(src).reduce((acc, id) => setSceneBgInSource(acc, id, currentValue), src)
        : allSceneIds(src).reduce((acc, id) => clearSceneBgInSource(acc, id), src);
    } else {
      const sceneId = gameStore.getState().story.sceneId;
      next = currentValue
        ? setSceneBgInSource(src, sceneId, currentValue)
        : clearSceneBgInSource(src, sceneId);
    }
    opts.editor.setContent(next);
    opts.applySource(next);
  }

  function highlightPreset(activeId: string): void {
    presetContainer?.querySelectorAll('.stage-bg-preset').forEach((el) => {
      const btn = el as HTMLElement;
      btn.classList.toggle('active', btn.dataset.id === activeId);
    });
  }

  // 颜色选择（释放时应用）
  colorInput?.addEventListener('change', () => {
    if (colorInput.value) preview(colorInput.value);
  });

  // 图片 URL（失焦或回车时预览）
  imageInput?.addEventListener('change', () => {
    const v = imageInput.value.trim();
    if (v) preview(v);
  });

  // 预设点击
  presetContainer.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.stage-bg-preset');
    if (!btn) return;
    const id = btn.dataset.id ?? '';
    if (id === '') {
      preview('');
      if (colorInput) colorInput.value = '#ffffff';
      if (imageInput) imageInput.value = '';
    } else {
      const preset = PRESETS.find((p) => p.id === id);
      preview(preset ? preset.id : id);
      if (colorInput) colorInput.value = '#ffffff';
      if (imageInput) imageInput.value = '';
    }
  });

  applyBtn.addEventListener('click', apply);
  clearBtn.addEventListener('click', () => {
    currentValue = '';
    apply();
  });

  // 作用域切换时回显当前场景已有的 bg（便于「本场景」模式编辑）
  scopeSelect.addEventListener('change', () => {
    const src = opts.editor.getContent();
    const sceneId = gameStore.getState().story.sceneId;
    const lines = src.split('\n');
    const h = findSceneHeaderLine(src, sceneId);
    let existing = '';
    if (h !== -1) {
      let i = h + 1;
      while (i < lines.length && lines[i].trim() === '') i++;
      if (lines[i] && lines[i].trim() === '---') {
        let close = i + 1;
        while (close < lines.length && lines[close].trim() !== '---') close++;
        for (let k = i + 1; k < close; k++) {
          const m = lines[k].match(/^\s*bg\s*:\s*(.+?)\s*$/i);
          if (m) {
            existing = m[1];
            break;
          }
        }
      }
    }
    preview(existing);
    if (existing && /^#|gradient|url/.test(existing)) colorInput!.value = '#ffffff';
  });
}
