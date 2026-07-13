/**
 * 字体预加载门控
 * 
 * 确保字体在 Pretext prepare() 之前已完全加载。
 * 否则 Canvas measureText 会回退到系统默认字体，
 * 导致测量坐标与实际渲染坐标错位。
 */

/** 默认字体配置 */
export const FONT_CONFIG = {
  family: 'Noto Sans SC',
  /** CSS font 简写格式，与 Canvas ctx.font 格式一致 */
  size: 20,
  lineHeight: 32,
  /**
   * 自托管字体 CSS 路径（优先于 CDN）。
   * 若把字体文件放进 `public/fonts/` 并配好 @font-face，可彻底摆脱 Google Fonts 依赖，
   * 解决国内/离线环境被墙导致的冷启动干等（bug B8）。留空则回退到 CDN。
   */
  localCssUrl: '',
  /** 完整的 CSS font 字符串 */
  get cssFont(): string {
    return `${this.size}px "${this.family}"`;
  },
  /** 解析使用的字体 CSS URL：自托管优先，否则 Google Fonts CDN */
  get fontUrl(): string {
    if (this.localCssUrl) return this.localCssUrl;
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(this.family)}:wght@400;700&display=swap`;
  },
} as const;

/**
 * 预加载字体并阻塞直到可用
 * @returns 成功加载的字体名称
 * @throws 字体加载超时或失败时抛出错误
 */
export async function loadFont(
  family: string = FONT_CONFIG.family,
  size: number = FONT_CONFIG.size,
  timeoutMs: number = 2000
): Promise<string> {
  const fontString = `${size}px "${family}"`;

  // 1. 注入字体 CSS（自托管优先，否则 Google Fonts CDN）；若尚未加载
  const linkId = `font-link-${family.replace(/\s+/g, '-')}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = FONT_CONFIG.fontUrl;
    document.head.appendChild(link);
  }

  // 2. 使用 FontFace API 等待字体加载完成
  try {
    await Promise.race([
      document.fonts.load(fontString),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`字体 "${family}" 加载超时 (${timeoutMs}ms)`)), timeoutMs)
      ),
    ]);

    // 3. 二次确认字体已可用
    const ready = document.fonts.check(fontString);
    if (!ready) {
      console.warn(`字体 "${family}" 加载状态异常，回退到 sans-serif`);
      return 'sans-serif';
    }

    console.log(`✅ 字体 "${family}" 加载完成`);
    return family;
  } catch (error) {
    console.warn(`字体加载失败，回退到 sans-serif:`, error);
    return 'sans-serif';
  }
}
