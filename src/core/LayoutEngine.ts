import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import type { PreparedTextWithSegments } from '@chenglou/pretext';
import { measureContext } from '../infrastructure/MeasureContext';
import type { LayoutSnapshot, GlyphData, LayoutLineSnapshot } from '../types/layout';

/**
 * Pretext 排版引擎
 * 
 * 核心职责：
 * 1. 调用 Pretext 的 prepareWithSegments() + layoutWithLines() 获取行级排版
 * 2. 在共享 MeasureContext 上做字符级坐标推算
 * 3. 构建 LayoutSnapshot 供 p5.js 粒子系统消费
 * 
 * 关键约束：
 * - 字符级测量必须使用与 p5.js 渲染时完全相同的 font 配置
 * - prepare 结果应缓存（文本未变时复用）
 */
export class LayoutEngine {
  /** prepare 缓存：避免对相同文本重复执行 prepare */
  private static prepareCache: Map<string, PreparedTextWithSegments> = new Map();

  /**
   * 构建完整排版快照
   * 
   * @param text - 要排版的文本
   * @param font - Canvas font 字符串，如 `20px "Noto Sans SC"`
   * @param containerWidth - 容器宽度（px）
   * @param lineHeight - 行高（px）
   * @param sceneId - 场景 ID（来自 Ink）
   * @param mood - 情绪（来自 Ink 变量）
   */
  public static buildLayoutSnapshot(
    text: string,
    font: string,
    containerWidth: number,
    lineHeight: number,
    sceneId: string,
    mood: string
  ): LayoutSnapshot {
    if (!text || text.trim().length === 0) {
      return { sceneId, mood, lines: [] };
    }

    // 1. Pretext 准备（带缓存）
    const cacheKey = `${text}|||${font}`;
    let prepared = this.prepareCache.get(cacheKey);
    if (!prepared) {
      prepared = prepareWithSegments(text, font);
      this.prepareCache.set(cacheKey, prepared);
      // 缓存大小限制，防止内存泄漏
      if (this.prepareCache.size > 50) {
        const firstKey = this.prepareCache.keys().next().value;
        if (firstKey) this.prepareCache.delete(firstKey);
      }
    }

    // 2. 获取行级布局
    const { lines } = layoutWithLines(prepared, containerWidth, lineHeight);

    // 3. 在共享 MeasureContext 上做字符级坐标推算
    const ctx = measureContext.withFont(font);

    // 预计算全局句子边界
    const sentenceBoundaries = this.buildSentenceBoundaries(text);

    const snapshotLines: LayoutLineSnapshot[] = lines.map((line, lineIdx) => {
      let cursorX = 0;
      const glyphs: GlyphData[] = [];

      // 使用 Intl.Segmenter 做字素级分割（与 Pretext 内部对齐）
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const segments = [...segmenter.segment(line.text)];

      segments.forEach((seg, i) => {
        const charWidth = ctx.measureText(seg.segment).width;
        glyphs.push({
          char: seg.segment,
          x: cursorX,
          y: lineIdx * lineHeight,
          width: charWidth,
          lineIndex: lineIdx,
          wordIndex: this.getWordIndex(line.text, seg.index),
          sentenceIndex: this.getSentenceIndex(sentenceBoundaries, lineIdx, lines),
        });
        cursorX += charWidth;
      });

      return {
        text: line.text,
        width: line.width,
        y: lineIdx * lineHeight,
        glyphs,
      };
    });

    return { sceneId, mood, lines: snapshotLines };
  }

  /**
   * 清除 prepare 缓存
   * 在字体变更或大规模文本切换时调用
   */
  public static clearCache(): void {
    this.prepareCache.clear();
  }

  /**
   * 计算字符在行内所属的词索引
   * 通过检测空格和标点来判断词边界
   */
  private static getWordIndex(lineText: string, charOffset: number): number {
    let wordIdx = 0;
    let inWord = false;
    for (let i = 0; i < charOffset && i < lineText.length; i++) {
      const c = lineText[i];
      const isSpace = /\s/.test(c);
      if (isSpace && inWord) {
        wordIdx++;
        inWord = false;
      } else if (!isSpace) {
        inWord = true;
      }
    }
    return wordIdx;
  }

  /**
   * 构建句子边界数组
   * 返回每个句子结束的字符位置
   */
  private static buildSentenceBoundaries(text: string): number[] {
    const boundaries: number[] = [];
    // 匹配中英文句号、问号、感叹号
    const sentenceEnders = /[.。！？!?]/g;
    let match;
    while ((match = sentenceEnders.exec(text)) !== null) {
      boundaries.push(match.index);
    }
    return boundaries;
  }

  /**
   * 计算行所属的句子索引
   */
  private static getSentenceIndex(
    boundaries: number[],
    lineIdx: number,
    lines: Array<{ text: string }>
  ): number {
    // 计算当前行在全文中的累积字符偏移
    let charOffset = 0;
    for (let i = 0; i < lineIdx; i++) {
      charOffset += lines[i].text.length;
    }

    // 找到该偏移在哪个句子内
    let sentenceIdx = 0;
    for (const boundary of boundaries) {
      if (charOffset > boundary) {
        sentenceIdx++;
      } else {
        break;
      }
    }
    return sentenceIdx;
  }
}
