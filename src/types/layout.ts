/**
 * 字符级渲染数据
 * 由 LayoutEngine 输出，供 p5.js 粒子系统消费
 */
export interface GlyphData {
  /** 字符内容（字素级） */
  char: string;
  /** 在 Canvas 上的 X 坐标 */
  x: number;
  /** 在 Canvas 上的 Y 坐标 */
  y: number;
  /** 字符宽度（由 Canvas measureText 测量） */
  width: number;
  /** 所在行索引 */
  lineIndex: number;
  /** 所在词索引 */
  wordIndex: number;
  /** 所在句索引 */
  sentenceIndex: number;
  /** 是否为标记词语（[[word]]） */
  isMarked?: boolean;
  /** 标记词语的全局索引 */
  markIndex?: number;
  /** 词语级颜色（如 "#ff6b6b"） */
  wordColor?: string;
  /** 词语级入场动效（如 "sink"） */
  enterEffect?: string;
  /** 注释文本 */
  annotation?: string;
}

/**
 * 单行排版快照
 */
export interface LayoutLineSnapshot {
  /** 行文本内容 */
  text: string;
  /** 行的测量宽度（由 Pretext 提供） */
  width: number;
  /** 行的 Y 坐标 */
  y: number;
  /** 行内所有字符的渲染数据 */
  glyphs: GlyphData[];
}

/**
 * 完整排版快照
 * 这是 Pretext 排版层到 p5.js 渲染层的唯一数据协议
 */
export interface LayoutSnapshot {
  /** 当前场景 ID（来自 Ink） */
  sceneId: string;
  /** 当前情绪（来自 Ink 变量） */
  mood: string;
  /** 所有行的排版数据 */
  lines: LayoutLineSnapshot[];
}
