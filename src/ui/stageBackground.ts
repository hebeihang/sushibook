/**
 * 舞台背景 —— Layer 2 表现层属性（三层模型）
 *
 * 设计对齐 SushiBook 三层重构计划书：
 *   - 逐页背景：场景 frontmatter 的 `bg:`（声明式、可随故事导出、优先级最高）
 *   - 全局默认：未设置 bg: 的场景沿用（编辑器级便利，可一键「应用到全部场景」落盘）
 *   - 动态背景：故事内 `@bg_show(...)` / `@bg_hide()` 命令（运行时，已由 HostEffects 处理）
 *
 * 解析优先级（单页 > 全局 > 主题）：
 *   scene.frontmatter.bg  ||  globalDefault  ||  null(跟随主题)
 *
 * 本模块只负责：预设定义、全局默认存取、把任意 bg 表达式解析为
 * { css, text }（css 用于 #preview-bg；text 为建议文字色，null 表示用主题文字色）。
 */

import {
  colorStringToRGB,
  readableTextOn,
  type RGB,
} from '../infrastructure/cssColor';

export interface BgResolution {
  /** 应用到 #preview-bg 的 CSS 背景值；null = 跟随主题 */
  css: string | null;
  /** 建议的文字 RGB；null = 用主题文字色（--stage-text） */
  text: RGB | null;
}

export interface Preset {
  id: string;
  label: string;
  /** 应用到 #preview-bg 的 CSS */
  css: string;
  /** 该预设上的推荐文字色 */
  text: RGB;
}

/** 风格化预设（含羊皮纸等纹理背景）。暗纹/星空/纯黑刻意做出明显差异：
 *  - 纯黑：纯平黑（无渐变、无纹理），与下方两种「有内容」的深色一眼区分
 *  - 暗纹：暖调（棕褐）斜纹编织感，偏「布料」
 *  - 星空：冷调（蓝）径向辉光 + 星点，偏「夜空」 */
export const PRESETS: Preset[] = [
  {
    id: 'parchment',
    label: '羊皮纸',
    css: 'linear-gradient(135deg, #f3e5c3 0%, #e6d2a0 50%, #dcc08e 100%)',
    text: [58, 47, 26],
  },
  {
    id: 'dark-cloth',
    label: '暗纹',
    css: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 5px), linear-gradient(160deg, #342e26 0%, #1b1714 100%)',
    text: [232, 226, 214],
  },
  {
    id: 'starry',
    label: '星空',
    css: 'radial-gradient(1.5px 1.5px at 18% 22%, rgba(255,255,255,0.9), transparent), radial-gradient(1px 1px at 72% 14%, rgba(255,255,255,0.75), transparent), radial-gradient(2px 2px at 44% 40%, rgba(205,225,255,0.85), transparent), radial-gradient(1px 1px at 63% 58%, rgba(255,255,255,0.6), transparent), radial-gradient(circle at 50% 115%, #3a5a9e 0%, #16204a 42%, #050814 100%)',
    text: [222, 232, 255],
  },
  { id: 'white', label: '纯白', css: '#ffffff', text: [26, 26, 26] },
  { id: 'black', label: '纯黑', css: '#000000', text: [230, 230, 240] },
];

// ---- 背景归属标记：声明式(frontmatter bg:) 与 运行时(@bg_show) 共用 #preview-bg，
// 用此标记避免两者互相覆盖。Renderer 设声明式背景时置 true；@bg_show/@bg_hide
// 触发时置 false。Renderer 在「无声明式背景」且此前是自己设的，才清回主题表面。 ----
let declarativeActive = false;

export function markDeclarativeBg(active: boolean): void {
  declarativeActive = active;
}

export function isDeclarativeActive(): boolean {
  return declarativeActive;
}

// ---- 表达式识别 ----
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_RE = /^rgba?\(/i;
const GRAD_RE = /^(linear|radial)-gradient\(/i;
const URL_RE = /^url\(/i;

/** 从渐变/颜色字符串里取出第一个颜色 token（用于对比度计算） */
function firstColorOf(css: string): RGB | null {
  const m = css.match(/(#[0-9a-f]{3,6}|rgba?\([^)]*\))/i);
  if (!m) return null;
  return colorStringToRGB(m[0]);
}

/**
 * 把任意 bg 表达式解析为可应用的 { css, text }。
 * @param raw  - 预设名（parchment/starry…）、#颜色、CSS 渐变、图片 URL，或空
 *              注意：图片 URL 无法预判文字色，text 返回 null（沿用主题文字色）。
 */
export function resolveBackground(raw: string | null | undefined): BgResolution {
  if (!raw || !raw.trim()) return { css: null, text: null };

  const preset = PRESETS.find((p) => p.id === raw.trim());
  if (preset) return { css: preset.css, text: preset.text };

  const v = raw.trim();

  // 图片 URL（无法预判内容，文字色交给主题，用户需自行保证可读）
  if (URL_RE.test(v)) {
    const inner = v.slice(4).replace(/^["']|["']$/g, '').replace(/\)$/, '');
    return { css: `url("${inner}") center / cover no-repeat`, text: null };
  }

  // 颜色 / 渐变 / 任意 CSS 颜色字符串
  const css = v;
  const base = GRAD_RE.test(v) ? firstColorOf(v) : colorStringToRGB(v);
  return { css, text: base ? readableTextOn(base) : null };
}
