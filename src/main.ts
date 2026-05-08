/**
 * Sushibook 主入口 — 编辑器版
 *
 * 启动流程：字体 → 渲染器 → CodeMirror 编辑器 → 指令面板 → 事件管线
 */

import './style.css';
import { loadFont, FONT_CONFIG } from './infrastructure/FontLoader';
import { Renderer } from './render/Renderer';
import { LayoutEngine } from './core/LayoutEngine';
import { SushiMLStoryManager } from './sushiml/bridge';
import type { SceneRenderData } from './sushiml/bridge';
import { emitter, debounce } from './core/EventBus';
import { gameStore } from './store/gameStore';
import type { StateChangeEvent } from './types/ink';
import type { LayoutSnapshot, GlyphData } from './types/layout';
import { SYSTEM_PROMPT } from './ai/systemPrompt';
import { loadAIConfig, saveAIConfig, generateStory } from './ai/aiService';
import { applyEffectRules } from './ai/effectRules';
import { EditorPanel } from './editor/EditorPanel';
import { DirectivePanel } from './editor/DirectivePanel';
import demoSushiUrl from './stories/demo.sushi?url';

// ============================================================
// DOM 引用
// ============================================================
const loadingScreen = document.getElementById('loading-screen')!;
const canvasContainer = document.getElementById('canvas-container')!;
const choicesContainer = document.getElementById('choices-container')!;
const sceneTitle = document.getElementById('scene-title')!;
const moodIndicator = document.getElementById('mood-indicator')!;
const moodLabel = moodIndicator.querySelector('.mood-label')!;
const editorContainer = document.getElementById('editor-container')!;
const directivePanelEl = document.getElementById('directive-panel')!;
const editorApplyBtn = document.getElementById('editor-apply-btn')!;
const splitHandle = document.getElementById('split-handle')!;
const editorArea = document.getElementById('editor-area')!;

// AI 面板
const aiFab = document.getElementById('ai-fab')!;
const aiPanel = document.getElementById('ai-panel')!;
const aiCloseBtn = document.getElementById('ai-close-btn')!;
const aiPromptInput = document.getElementById('ai-prompt') as HTMLTextAreaElement;
const aiGenerateBtn = document.getElementById('ai-generate-btn')!;
const aiBtnText = aiGenerateBtn.querySelector('.ai-btn-text')!;
const aiBtnLoading = aiGenerateBtn.querySelector('.ai-btn-loading')! as HTMLElement;
const aiSettingsToggle = document.getElementById('ai-settings-toggle')!;
const aiSettingsDiv = document.getElementById('ai-settings')!;
const aiEndpoint = document.getElementById('ai-endpoint') as HTMLInputElement;
const aiApikey = document.getElementById('ai-apikey') as HTMLInputElement;
const aiModel = document.getElementById('ai-model') as HTMLInputElement;
const aiStatus = document.getElementById('ai-status')!;

// ============================================================
// 全局引用
// ============================================================
let renderer: Renderer;
let storyManager: SushiMLStoryManager;
let currentSceneData: SceneRenderData | null = null;
let editorPanel: EditorPanel;
let directivePanel: DirectivePanel;

// ============================================================
// 启动流程
// ============================================================
async function boot(): Promise<void> {
  console.log('🍣 Sushibook 编辑器启动...');

  const fontFamily = await loadFont();
  gameStore.getState().setFontFamily(fontFamily);

  // 渲染器
  renderer = new Renderer(canvasContainer);

  // 加载演示故事
  const demoSource = await fetch(demoSushiUrl).then((r) => r.text());

  // 编辑器
  editorPanel = new EditorPanel(editorContainer, demoSource, (content) => {
    // 自动应用：编辑内容变化时 debounce 后自动渲染
    applyEditorContent(content);
  });

  // 指令面板
  directivePanel = new DirectivePanel(directivePanelEl);
  directivePanel.setEditor(editorPanel);

  // 事件管线
  connectPipeline();
  initAIPanel();
  initSplitHandle();

  // 手动应用按钮
  editorApplyBtn.addEventListener('click', () => {
    applyEditorContent(editorPanel.getContent());
  });

  // 隐藏加载屏幕
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 600);

  // 初始加载
  setTimeout(() => {
    applyEditorContent(demoSource);
  }, 400);
}

// ============================================================
// 编辑器内容应用
// ============================================================
function applyEditorContent(rawSource: string): void {
  try {
    // 注入效果轨
    const enriched = applyEffectRules(rawSource);
    storyManager = new SushiMLStoryManager(enriched);
    console.log(`📖 故事已加载：${storyManager.sceneIds.length} 个场景`);
    storyManager.advance();
    gameStore.getState().setReady(true);
  } catch (err) {
    console.warn('⚠️ SushiML 解析失败:', err);
  }
}

// ============================================================
// 事件管线
// ============================================================
function connectPipeline(): void {
  emitter.on('sushi:sceneData', (data) => {
    currentSceneData = data;
  });

  const debouncedLayout = debounce((event: StateChangeEvent) => {
    const { state } = event;
    const fontFamily = gameStore.getState().fontFamily;
    const font = `${FONT_CONFIG.size}px "${fontFamily}"`;

    const snapshot = LayoutEngine.buildLayoutSnapshot(
      state.currentText, font, renderer.renderWidth,
      FONT_CONFIG.lineHeight, state.sceneId, state.mood
    );

    if (currentSceneData) annotateSnapshot(snapshot, currentSceneData);
    emitter.emit('layout:snapshotUpdate', snapshot);
    updateUI(state.sceneId, state.mood, state.choices);
  }, 50);

  emitter.on('ink:stateChange', debouncedLayout);

  emitter.on('system:resize', () => {
    const ink = gameStore.getState().ink;
    if (!ink.currentText) return;
    const fontFamily = gameStore.getState().fontFamily;
    const font = `${FONT_CONFIG.size}px "${fontFamily}"`;
    const snapshot = LayoutEngine.buildLayoutSnapshot(
      ink.currentText, font, renderer.renderWidth,
      FONT_CONFIG.lineHeight, ink.sceneId, ink.mood
    );
    if (currentSceneData) annotateSnapshot(snapshot, currentSceneData);
    emitter.emit('layout:snapshotUpdate', snapshot);
  });
}

// ============================================================
// SushiML 元数据标注
// ============================================================
function annotateSnapshot(snapshot: LayoutSnapshot, sceneData: SceneRenderData): void {
  const allGlyphs: GlyphData[] = snapshot.lines.flatMap((l) => l.glyphs);
  const { charMeta } = sceneData;
  for (let i = 0; i < allGlyphs.length && i < charMeta.length; i++) {
    allGlyphs[i].sentenceIndex = charMeta[i].sentenceIndex;
    allGlyphs[i].isMarked = charMeta[i].isMarked;
    if (charMeta[i].markIndex !== undefined) allGlyphs[i].markIndex = charMeta[i].markIndex;
    if (charMeta[i].wordColor) allGlyphs[i].wordColor = charMeta[i].wordColor;
    if (charMeta[i].enterEffect) allGlyphs[i].enterEffect = charMeta[i].enterEffect;
    if (charMeta[i].annotation) allGlyphs[i].annotation = charMeta[i].annotation;
  }
}

// ============================================================
// UI 更新
// ============================================================
function updateUI(scene: string, mood: string, choices: Array<{ index: number; text: string }>): void {
  sceneTitle.textContent = scene.toUpperCase();
  moodIndicator.setAttribute('data-mood', mood);
  moodLabel.textContent = mood.toUpperCase();

  choicesContainer.innerHTML = '';
  choices.forEach((choice) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.id = `choice-${choice.index}`;
    btn.innerHTML = `<span>${choice.text}</span>`;
    btn.addEventListener('click', () => storyManager.selectChoice(choice.index));
    choicesContainer.appendChild(btn);
  });
}

// ============================================================
// 分栏拖拽
// ============================================================
function initSplitHandle(): void {
  let isDragging = false;

  splitHandle.addEventListener('mousedown', (e) => {
    isDragging = true;
    splitHandle.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const appWidth = document.getElementById('app')!.clientWidth;
    const pct = Math.min(65, Math.max(20, (e.clientX / appWidth) * 100));
    editorArea.style.width = `${pct}%`;
    // 触发预览区 resize
    emitter.emit('system:resize', {
      width: canvasContainer.clientWidth,
      height: canvasContainer.clientHeight,
    });
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      splitHandle.classList.remove('dragging');
    }
  });
}

// ============================================================
// AI 面板
// ============================================================
function initAIPanel(): void {
  const config = loadAIConfig();
  aiEndpoint.value = config.endpoint;
  aiApikey.value = config.apiKey;
  aiModel.value = config.model;

  aiFab.addEventListener('click', () => {
    aiPanel.classList.add('open');
    aiPromptInput.focus();
  });

  aiCloseBtn.addEventListener('click', closeAIPanel);

  aiSettingsToggle.addEventListener('click', () => {
    const hidden = aiSettingsDiv.style.display === 'none';
    aiSettingsDiv.style.display = hidden ? 'flex' : 'none';
  });

  aiGenerateBtn.addEventListener('click', handleGenerate);

  aiPromptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  });
}

function closeAIPanel(): void {
  aiPanel.classList.remove('open');
}

async function handleGenerate(): Promise<void> {
  const prompt = aiPromptInput.value.trim();
  if (!prompt) { setStatus('请输入故事描述', 'error'); return; }

  const config = {
    endpoint: aiEndpoint.value.trim(),
    apiKey: aiApikey.value.trim(),
    model: aiModel.value.trim(),
  };
  saveAIConfig(config);

  if (!config.apiKey) {
    setStatus('请先在设置中填写 API Key', 'error');
    aiSettingsDiv.style.display = 'flex';
    return;
  }

  aiGenerateBtn.setAttribute('disabled', 'true');
  aiBtnText.style.display = 'none';
  aiBtnLoading.style.display = '';
  setStatus('正在生成故事...', '');

  try {
    const rawSushiML = await generateStory(prompt, config, SYSTEM_PROMPT);
    console.log('🤖 AI 原始输出:\n', rawSushiML);

    setStatus('✅ 生成完成！', 'success');
    await delay(400);

    // 写入编辑器（用户可继续编辑）
    editorPanel.setContent(rawSushiML);

    // 应用到预览
    applyEditorContent(rawSushiML);

    closeAIPanel();
    setStatus('', '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`❌ ${msg}`, 'error');
    console.error('AI 生成失败:', err);
  } finally {
    aiGenerateBtn.removeAttribute('disabled');
    aiBtnText.style.display = '';
    aiBtnLoading.style.display = 'none';
  }
}

function setStatus(text: string, type: string): void {
  aiStatus.textContent = text;
  aiStatus.className = 'ai-status' + (type ? ` ${type}` : '');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 启动！
// ============================================================
boot().catch(console.error);
