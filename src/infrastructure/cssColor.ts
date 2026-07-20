/**
 * CSS 颜色工具
 *
 * 将 CSS 变量（hex / rgb / oklch …）解析为 RGB 元组，
 * 并提供对比度计算与颜色混合，用于主题适配。
 */

export type RGB = [number, number, number];

/** 把任意 CSS 变量解析为 [r, g, b]（浏览器会帮我们完成 oklch→rgb 转换） */
export function cssVarToRGB(varName: string): RGB {
  const probe = document.createElement('div');
  probe.style.color = `var(${varName})`;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);

  const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return [20, 20, 28];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** sRGB 相对亮度 */
export function luminance([r, g, b]: RGB): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
}

/** 两个亮度值的 WCAG 对比度 */
export function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 线性混合两个 RGB 颜色，t ∈ [0,1] */
export function blendRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * 确保前景色与背景色达到目标对比度。
 * 若已达标返回原色，否则向背景反色方向混合。
 */
export function ensureContrast(foreground: RGB, background: RGB, target = 4.5): RGB {
  const fgLum = luminance(foreground);
  const bgLum = luminance(background);
  const ratio = contrastRatio(fgLum, bgLum);
  if (ratio >= target) return foreground;

  const targetColor: RGB = bgLum > 0.5 ? [0, 0, 0] : [255, 255, 255];
  // 逐步提高混合比例直到达标（简单迭代）
  for (let t = 0.2; t <= 1; t += 0.1) {
    const candidate = blendRGB(foreground, targetColor, t);
    const candLum = luminance(candidate);
    if (contrastRatio(candLum, bgLum) >= target) return candidate;
  }
  return targetColor;
}

/** 把任意 CSS 颜色字符串解析为 RGB（浏览器完成 oklch/hex/rgb 归一化） */
export function colorStringToRGB(input: string): RGB {
  const probe = document.createElement('div');
  probe.style.color = input;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);

  const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return [20, 20, 28];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * 给定背景色，返回在其上清晰可读的文字色（浅底→近黑，深底→近白）。
 */
export function readableTextOn(bg: RGB): RGB {
  return luminance(bg) > 0.5 ? [17, 17, 17] : [240, 240, 245];
}

/** 读取数值型 CSS 变量，失败返回 fallback */
export function cssVarToNumber(varName: string, fallback: number): number {
  const probe = document.createElement('div');
  probe.style.setProperty('--_probe', `var(${varName})`);
  probe.style.opacity = 'var(--_probe)';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).opacity;
  document.body.removeChild(probe);

  const n = parseFloat(computed);
  return isNaN(n) ? fallback : n;
}
