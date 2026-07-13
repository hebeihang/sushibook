import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import type { PreparedTextWithSegments, LayoutCursor } from '@chenglou/pretext';
import { measureContext } from '../infrastructure/MeasureContext';
import type { LayoutSnapshot, GlyphData, LayoutLineSnapshot } from '../types/layout';
import type { CharMeta } from '../sushiml/types';

/**
 * Pretext 排版引擎
 *
 * 核心职责：
 * 1. 调用 Pretext 的 prepareWithSegments() + layoutWithLines() 获取行级排版
 * 2. 在共享 MeasureContext 上做字符级坐标推算
 * 3. 通过 LayoutCursor 将每个 glyph 精确映射回原文字素索引，
 *    从而把 SushiML 的 CharMeta（标记/颜色/动效/注释/句子索引）标注到 glyph 上
 *
 * 关键约束：
 * - 字符级测量必须使用与 p5.js 渲染时完全相同的 font 配置
 * - prepare 结果应缓存（文本未变时复用）
 * - whiteSpace: 'pre-wrap'，句子间的 '\n' 作为硬换行
 */

interface PreparedEntry {
  prepared: PreparedTextWithSegments;
  /** segments[k] 之前的累计字素数（用于 LayoutCursor → 全局字素索引） */
  graphemePrefix: number[];
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export class LayoutEngine {
  /** prepare 缓存：避免对相同文本重复执行 prepare */
  private static prepareCache: Map<string, PreparedEntry> = new Map();
  private static readonly CACHE_LIMIT = 50;

  /**
   * 构建完整排版快照
   *
   * @param text - 要排版的文本（extractTextAndMeta 输出的 plainText）
   * @param font - Canvas font 字符串，如 `20px "Noto Sans SC"`
   * @param containerWidth - 容器宽度（px）
   * @param lineHeight - 行高（px）
   * @param sceneId - 场景 ID
   * @param mood - 情绪
   * @param charMeta - 与 text 字素一一对应的元数据（可选）
   */
  public static buildLayoutSnapshot(
    text: string,
    font: string,
    containerWidth: number,
    lineHeight: number,
    sceneId: string,
    mood: string,
    charMeta?: CharMeta[]
  ): LayoutSnapshot {
    if (!text || text.trim().length === 0 || containerWidth <= 0) {
      return { sceneId, mood, lines: [] };
    }

    // 1. Pretext 准备（带缓存）
    const entry = this.getPrepared(text, font);

    // 2. 行级布局
    const { lines } = layoutWithLines(entry.prepared, containerWidth, lineHeight);

    // 3. 字符级坐标推算 + 元数据标注
    const ctx = measureContext.withFont(font);

    const snapshotLines: LayoutLineSnapshot[] = lines.map((line, lineIdx) => {
      let cursorX = 0;
      const glyphs: GlyphData[] = [];

      // 行首在原文中的全局字素索引（由 LayoutCursor 精确换算）
      const lineGlobalStart = this.cursorToGraphemeIndex(entry, line.start);

      const segments = [...segmenter.segment(line.text)];
      segments.forEach((seg, i) => {
        const charWidth = ctx.measureText(seg.segment).width;
        const globalIdx = lineGlobalStart + i;
        const meta = charMeta?.[globalIdx];

        glyphs.push({
          char: seg.segment,
          x: cursorX,
          y: lineIdx * lineHeight,
          width: charWidth,
          lineIndex: lineIdx,
          wordIndex: this.getWordIndex(line.text, seg.index),
          sentenceIndex: meta?.sentenceIndex ?? 0,
          isMarked: meta?.isMarked,
          markIndex: meta?.markIndex,
          wordColor: meta?.wordColor,
          enterEffect: meta?.enterEffect,
          annotation: meta?.annotation,
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

  // ============================================================
  // 内部
  // ============================================================

  private static getPrepared(text: string, font: string): PreparedEntry {
    const cacheKey = `${font}|||${text}`;
    let entry = this.prepareCache.get(cacheKey);
    if (entry) return entry;

    const prepared = prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' });

    // 预计算每个 segment 的字素前缀和
    const graphemePrefix: number[] = new Array(prepared.segments.length + 1);
    graphemePrefix[0] = 0;
    for (let k = 0; k < prepared.segments.length; k++) {
      let count = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const _ of segmenter.segment(prepared.segments[k])) count++;
      graphemePrefix[k + 1] = graphemePrefix[k] + count;
    }

    entry = { prepared, graphemePrefix };
    this.prepareCache.set(cacheKey, entry);

    // 缓存大小限制，防止内存泄漏
    if (this.prepareCache.size > this.CACHE_LIMIT) {
      const firstKey = this.prepareCache.keys().next().value;
      if (firstKey) this.prepareCache.delete(firstKey);
    }
    return entry;
  }

  /** LayoutCursor → 原文全局字素索引 */
  private static cursorToGraphemeIndex(entry: PreparedEntry, cursor: LayoutCursor): number {
    const base = entry.graphemePrefix[cursor.segmentIndex] ?? 0;
    return base + cursor.graphemeIndex;
  }

  /**
   * 计算字符在行内所属的词索引
   * 通过检测空格来判断词边界
   */
  private static getWordIndex(lineText: string, charOffset: number): number {
    let wordIdx = 0;
    let inWord = false;
    for (let i = 0; i < charOffset && i < lineText.length; i++) {
      const isSpace = /\s/.test(lineText[i]);
      if (isSpace && inWord) {
        wordIdx++;
        inWord = false;
      } else if (!isSpace) {
        inWord = true;
      }
    }
    return wordIdx;
  }
}
