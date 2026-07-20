/**
 * SushiBook Studio 主入口
 *
 * 三栏布局（Kiny Editor 风格）：
 *   左：资产管理 + 节点大纲
 *   中：SushiML 编辑器 + 问题面板
 *   右：粒子预览 + 指令面板
 *
 * 数据流：
 *   EditorPanel (.sushi 源文本)
 *     → SushiMLStoryManager.reload()/advance()   [解析 + 执行引擎]
 *     → emitter: sushi:sceneData + story:stateChange (+ host:command)
 *     → rebuildLayout(): LayoutEngine.buildLayoutSnapshot()
 *     → emitter: layout:snapshotUpdate
 *     → Renderer.updateSnapshot()  [同场景追加复用 / 跨场景溶解重建]
 */

import './theme.css';
import './style.css';
import { loadFont, FONT_CONFIG } from './infrastructure/FontLoader';
import { SushiMLStoryManager } from './sushiml/bridge';
import { LayoutEngine } from './core/LayoutEngine';
import { Renderer } from './render/Renderer';
import { emitter, debounce } from './core/EventBus';
import { EditorPanel } from './editor/EditorPanel';
import { DirectivePanel } from './editor/DirectivePanel';
import { ChoiceUI } from './ui/ChoiceUI';
import { AIPanel } from './ui/AIPanel';
import { HostEffects } from './ui/HostEffects';
import { OutlinePanel } from './ui/OutlinePanel';
import { GlossaryPanel } from './ui/GlossaryPanel';
import { AssetPanel } from './ui/AssetPanel';
import { ProblemsPanel, type Problem } from './ui/ProblemsPanel';
import { initThemeSwitcher } from './ui/ThemeSwitcher';
import { initStageBackgroundPanel } from './ui/StageBackgroundPanel';
import { gameStore } from './store/gameStore';
import { buildStandaloneHtml } from './player/exportHtml';
import demoSource from './stories/demo.sushi?raw';

// ============================================================
// DOM 工具
// ============================================================

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少 DOM 元素: #${id}`);
  return el;
}

/** 初始化致命错误横幅（正常运行期问题走问题面板） */
function showFatal(message: string): void {
  const banner = document.getElementById('error-banner');
  if (!banner) {
    console.error(message);
    return;
  }
  banner.textContent = message;
  banner.classList.add('visible');
}

// ============================================================
// 应用初始化
// ============================================================

async function init(): Promise<void> {
  // 0. 主题切换器（尽早绑定，index.html 已提前套用已存主题避免闪烁）
  initThemeSwitcher($('theme-select') as HTMLSelectElement);

  // 1. 字体门控：Pretext 测量前必须完成加载，否则坐标错位
  const family = await loadFont();
  gameStore.getState().setFontFamily(family);
  const cssFont = `${FONT_CONFIG.size}px "${family}"`;

  // 2. 叙事管理器
  const storyManager = new SushiMLStoryManager(demoSource);

  // 3. 渲染器 + 宿主效果（@bg_show / @bgm_play）
  const previewCanvas = $('preview-canvas');
  const renderer = new Renderer(previewCanvas);
  new HostEffects($('preview-bg'));

  // 4. 问题面板 + 节点大纲
  const problemsPanel = new ProblemsPanel($('problems-list'), $('problems-status'), $('status-chip'));

  // 5. 排版重建：叙事状态 → LayoutSnapshot
  function rebuildLayout(): void {
    const data = storyManager.getCurrentRenderData();
    if (!data) return;
    const snapshot = LayoutEngine.buildLayoutSnapshot(
      data.plainText,
      cssFont,
      renderer.renderWidth,
      FONT_CONFIG.lineHeight,
      data.sceneId,
      data.sceneDirectives.mood || 'default',
      data.charMeta
    );
    emitter.emit('layout:snapshotUpdate', snapshot);
  }

  // 6. 静态校验 → 问题面板
  function validate(): void {
    const problems: Problem[] = [];
    // 解析期诊断（{…} 归层歧义 → 显式报错，替代静默退化）
    for (const d of storyManager.diagnostics) {
      problems.push({
        severity: d.severity,
        message: d.scene ? `场景「${d.scene}」${d.message}` : d.message,
      });
    }
    for (const d of storyManager.validateLinks()) {
      problems.push({ severity: 'error', message: `选项指向不存在的场景: ${d.scene} → ${d.target}` });
    }
    for (const id of storyManager.deadEndScenes()) {
      problems.push({ severity: 'warning', message: `死胡同场景「${id}」：既无跳转也无选项，到达即卡死` });
    }
    for (const id of storyManager.stickyDeadEnds()) {
      problems.push({ severity: 'warning', message: `粘性死循环「${id}」：选项无目标也无内容，选中后无进展` });
    }
    for (const id of storyManager.onceOnlyDeadEnds()) {
      problems.push({ severity: 'warning', message: `一次性死胡同「${id}」：唯一出口是 * once 选项，选完即卡死` });
    }
    problemsPanel.set(problems);
  }

  // 7. 编辑器 + 指令面板 + 资产 + 大纲
  // B12 缓解：相同 source 去重，避免重复全量 reload + 粒子重排
  let lastAppliedSource = '';
  const applySource = (source: string): void => {
    if (source === lastAppliedSource) return;
    lastAppliedSource = source;
    try {
      storyManager.reload(source);
      validate();
      refreshOutline();
      storyManager.advance();
    } catch (err) {
      problemsPanel.set([{
        severity: 'error',
        message: `解析失败：${err instanceof Error ? err.message : String(err)}`,
      }]);
    }
  };

  /** 选项/键盘/大纲导航的统一兜底 */
  const safeRun = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      problemsPanel.pushRuntime(err instanceof Error ? err.message : String(err));
    }
  };

  const editor = new EditorPanel($('editor-mount'), demoSource, (content) => {
    applySource(content);
  });

  // 0.5 预览舞台背景设置面板（三层模型：背景写入场景 frontmatter 的 bg:）
  initStageBackgroundPanel($('preview-section'), { editor, applySource });

  const directivePanel = new DirectivePanel($('directive-panel'));
  directivePanel.setEditor(editor);

  new AssetPanel($('asset-list'), $('btn-asset-add'), (snippet) => {
    editor.insertAtCursor(snippet);
  });

  const outline = new OutlinePanel($('outline-list'), $('outline-count'), (sceneId) => {
    editor.revealScene(sceneId);
    safeRun(() => storyManager.gotoScene(sceneId));
  });

  function refreshOutline(): void {
    const stats = storyManager.linkStats();
    outline.update(
      storyManager.sceneIds.map((id) => ({ id, incoming: stats.get(id) ?? 0 }))
    );
  }

  // 词汇表：消费 SceneRenderData.marks（B3 修复）
  const glossary = new GlossaryPanel($('glossary-list'), $('glossary-count'), (sceneId) => {
    editor.revealScene(sceneId);
    safeRun(() => storyManager.gotoScene(sceneId));
  });
  emitter.on('sushi:sceneData', (data) => glossary.update(data));

  $('btn-apply').addEventListener('click', () => applySource(editor.getContent()));
  $('btn-restart').addEventListener('click', () => safeRun(() => storyManager.restart()));
  $('btn-export').addEventListener('click', () => void exportHtml5(editor.getContent()));

  // 8. 状态联动：徽标 + 大纲高亮 + 排版重建
  emitter.on('story:stateChange', ({ state }) => {
    rebuildLayout();
    $('badge-scene').textContent = state.sceneId.toUpperCase();
    $('badge-mood').textContent = state.mood;
    outline.setCurrent(state.sceneId);
  });

  emitter.on('system:resize', debounce(() => rebuildLayout(), 150));

  // 9. 选项 UI
  new ChoiceUI($('preview-choices'), (index) => safeRun(() => storyManager.selectChoice(index)));

  // 10. AI 生成
  const aiPanel = new AIPanel((generated) => {
    editor.setContent(generated);
    applySource(generated);
  });
  $('btn-ai').addEventListener('click', () => aiPanel.open());

  // 11. 键盘交互（编辑器内输入不拦截）
  window.addEventListener('keydown', (e) => {
    const inEditor = (e.target as HTMLElement)?.closest?.('.cm-editor, textarea, input');

    // Ctrl/Cmd + Enter：任何位置都可应用
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      applySource(editor.getContent());
      return;
    }
    if (inEditor) return;

    // Space / Enter：重播当前场景
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      safeRun(() => storyManager.advance());
      return;
    }
    // 数字键 1-9：选择分支
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      const choices = gameStore.getState().story.choices;
      if (num <= choices.length) {
        safeRun(() => storyManager.selectChoice(num - 1));
      }
    }
  }, { capture: true });

  // 12. 分栏拖拽
  initSplitBar(renderer);

  // 13. 触摸支持：点按预览区重播当前场景
  previewCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    safeRun(() => storyManager.advance());
  });

  // 14. 首次渲染
  validate();
  refreshOutline();
  storyManager.advance();
  gameStore.getState().setReady(true);
}

// ============================================================
// 导出 HTML5（自包含单文件）
// ============================================================

/** 把当前故事导出为可双击独立打开的网页版电子书 */
async function exportHtml5(source: string): Promise<void> {
  try {
    const resp = await fetch('player-template.html');
    if (!resp.ok) throw new Error('导出模板缺失，请先运行 npm run build:player');
    const template = await resp.text();
    const html = buildStandaloneHtml(template, source);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sushibook-story.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出 HTML5 网页（可双击独立打开）');
  } catch (err) {
    console.error(err);
    toast(`导出失败：${err instanceof Error ? err.message : String(err)}`, true);
  }
}

/** 轻量提示条 */
function toast(message: string, isError = false): void {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-err' : '');
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

// ============================================================
// 分栏拖拽
// ============================================================

function initSplitBar(renderer: Renderer): void {
  const bar = $('split-bar');
  const editorPane = $('editor-pane');
  let dragging = false;

  const syncCanvas = debounce(() => renderer.resizeToContainer(), 100);

  bar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const sidebarWidth = document.getElementById('sidebar')?.clientWidth ?? 0;
    const pct = ((e.clientX - sidebarWidth) / (window.innerWidth - sidebarWidth)) * 100;
    editorPane.style.width = `${Math.min(Math.max(pct, 20), 70)}%`;
    syncCanvas();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    renderer.resizeToContainer();
  });
}

// ============================================================
// 启动
// ============================================================

init()
  .catch((err) => {
    console.error('初始化失败:', err);
    showFatal(`初始化失败：${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    document.getElementById('loading-screen')?.classList.add('hidden');
  });
