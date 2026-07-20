/**
 * ThemeSwitcher — 界面主题切换器
 *
 * 通过切换 <html data-theme> 使用 daisyUI 主题，并用 localStorage 持久化。
 * 主题列表需与 src/theme.css 中 @plugin "daisyui" 启用的主题保持一致。
 */

import { emitter } from '../core/EventBus';
import { cssVarToRGB, ensureContrast } from '../infrastructure/cssColor';

const STORAGE_KEY = 'sushibook-theme';
const DEFAULT_THEME = 'light';

/** 对比度目标：普通文本 WCAG AA 为 4.5 */
const CONTRAST_TARGET = 4.5;

/** 与 theme.css 启用的 daisyUI 主题一一对应（value 为 daisyUI 主题名） */
const THEMES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'light', label: '☀ 浅色' },
  { value: 'dark', label: '🌙 深色' },
  { value: 'cupcake', label: '🧁 蛋糕' },
  { value: 'nord', label: '❄ 北欧' },
  { value: 'winter', label: '🌨 冬日' },
  { value: 'autumn', label: '🍁 秋日' },
  { value: 'valentine', label: '🌸 樱粉' },
  { value: 'lofi', label: '◻ 极简' },
  { value: 'business', label: '💼 商务' },
  { value: 'dracula', label: '🧛 德古拉' },
  { value: 'night', label: '🌌 暗夜' },
  { value: 'coffee', label: '☕ 咖啡' },
];

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* 隐私模式等场景忽略 */
  }
  emitter.emit('theme:changed');
}

/**
 * 对低对比主题（如 lofi）自动加深/提亮内容区文字，确保编辑器与舞台可读。
 * 同时修正语法高亮各 token 颜色（--cm-hl-*），避免极简等主题下亮绿/亮紫看不清。
 */
export function fixLowContrast(): void {
  const root = document.documentElement;
  const content = cssVarToRGB('--color-base-content');
  const editorBg = cssVarToRGB('--color-base-300');
  const stageBg = cssVarToRGB('--stage-bg');

  setOrReset(root, '--cm-text', content, ensureContrast(content, editorBg, CONTRAST_TARGET));
  setOrReset(root, '--stage-text', content, ensureContrast(content, stageBg, CONTRAST_TARGET));

  // 语法高亮：每个 token 取对应语义色，按编辑器背景做对比度修正（普通 4.5 / 弱化 3）
  const info = cssVarToRGB('--color-info');
  const secondary = cssVarToRGB('--color-secondary');
  const warning = cssVarToRGB('--color-warning');
  const success = cssVarToRGB('--color-success');

  setHl(root, '--cm-hl-heading', info, editorBg, 4.5);
  setHl(root, '--cm-hl-operator', info, editorBg, 4.5);
  setHl(root, '--cm-hl-attr', secondary, editorBg, 4.5);
  setHl(root, '--cm-hl-keyword', secondary, editorBg, 4.5);
  setHl(root, '--cm-hl-link', warning, editorBg, 4.5);
  setHl(root, '--cm-hl-annotation', success, editorBg, 4.5); // 极简绿字看不清的根因修复
  setHl(root, '--cm-hl-meta', content, editorBg, 3);
  setHl(root, '--cm-hl-comment', content, editorBg, 3);
}

function setHl(
  root: HTMLElement,
  name: string,
  fg: [number, number, number],
  bg: [number, number, number],
  target: number
): void {
  const adjusted = ensureContrast(fg, bg, target);
  root.style.setProperty(name, `rgb(${adjusted.join(',')})`);
}

function setOrReset(root: HTMLElement, name: string, original: [number, number, number], adjusted: [number, number, number]): void {
  const isSame = original.every((v, i) => v === adjusted[i]);
  if (isSame) {
    root.style.removeProperty(name);
  } else {
    root.style.setProperty(name, `rgb(${adjusted.join(',')})`);
  }
}

/** 初始化主题下拉框：填充选项、回显当前主题、绑定切换 */
export function initThemeSwitcher(select: HTMLSelectElement): void {
  select.innerHTML = THEMES.map(
    (t) => `<option value="${t.value}">${t.label}</option>`
  ).join('');

  const current = readSaved();
  applyTheme(current);
  fixLowContrast();
  select.value = THEMES.some((t) => t.value === current) ? current : DEFAULT_THEME;

  select.addEventListener('change', () => applyTheme(select.value));
  emitter.on('theme:changed', fixLowContrast);
}
