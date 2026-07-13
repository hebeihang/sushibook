/**
 * SushiBook — 自包含网页版「播放器」入口
 *
 * 由 `vite.player.config.ts` 构建为单一 HTML 文件（p5 + 引擎全部内联），
 * 故事源码通过页面中的 `<script type="application/json" id="sushi-source">`
 * 注入。产物双击即可在浏览器离线打开，无需服务器。
 *
 * 复用主程序的运行时：SushiMLStoryManager（叙事引擎）、Renderer（粒子渲染）、
 * GlossaryPanel（词汇表）、ChoiceUI（分支选项）、HostEffects（@bg_show 等）。
 */

import { loadFont, FONT_CONFIG } from '../infrastructure/FontLoader';
import { SushiMLStoryManager } from '../sushiml/bridge';
import { LayoutEngine } from '../core/LayoutEngine';
import { Renderer } from '../render/Renderer';
import { emitter, debounce } from '../core/EventBus';
import { HostEffects } from '../ui/HostEffects';
import { GlossaryPanel } from '../ui/GlossaryPanel';
import { ChoiceUI } from '../ui/ChoiceUI';
import { gameStore } from '../store/gameStore';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少 DOM 元素: #${id}`);
  return el;
}

async function init(): Promise<void> {
  // 字体门控：离线时短超时回退系统字体（自包含文件不应干等 CDN）
  const family = await loadFont(FONT_CONFIG.family, FONT_CONFIG.size, 800);
  gameStore.getState().setFontFamily(family);
  const cssFont = `${FONT_CONFIG.size}px "${family}"`;

  // 读取注入的故事源码
  const sourceEl = document.getElementById('sushi-source');
  const source: string = sourceEl ? JSON.parse(sourceEl.textContent || '""') : '';
  if (!source) {
    const lt = document.getElementById('loading-text');
    if (lt) lt.textContent = '未找到故事内容';
    return;
  }

  const storyManager = new SushiMLStoryManager(source);

  const previewCanvas = $('preview-canvas');
  const renderer = new Renderer(previewCanvas);
  new HostEffects($('preview-bg'));

  // 叙事状态 → 排版快照 → 渲染器
  const rebuildLayout = (): void => {
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
  };

  // 词汇表：消费 SceneRenderData.marks
  const glossary = new GlossaryPanel($('glossary-list'), $('glossary-count'), (sceneId) => {
    storyManager.gotoScene(sceneId);
  });
  emitter.on('sushi:sceneData', (data) => glossary.update(data));

  emitter.on('story:stateChange', () => {
    rebuildLayout();
  });

  emitter.on('system:resize', debounce(rebuildLayout, 150));

  // 分支选项 UI
  new ChoiceUI($('preview-choices'), (index) => storyManager.selectChoice(index));

  // 键盘交互：空格/回车重播当前场景，数字键 1-9 选择分支
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      storyManager.advance();
      return;
    }
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      storyManager.selectChoice(num - 1);
    }
  });

  // 触摸：点按预览区重播
  previewCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    storyManager.advance();
  });

  // 首屏渲染
  storyManager.advance();
  document.getElementById('loading-screen')?.classList.add('hidden');
}

init().catch((err) => {
  console.error(err);
  const banner = document.getElementById('error-banner');
  if (banner) {
    banner.textContent = `初始化失败：${err instanceof Error ? err.message : String(err)}`;
    banner.classList.add('visible');
  }
  document.getElementById('loading-screen')?.classList.add('hidden');
});
