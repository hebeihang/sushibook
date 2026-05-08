/**
 * SushiML AST 类型定义
 * 
 * 三层粒度：Scene(段落级) → Sentence(句子级) → Token(词语级)
 * 双轨设计：每层都有独立的 directives 用于效果标注
 */

// ============================================================
// 指令类型（效果轨）
// ============================================================

/** 段落级指令 — frontmatter */
export interface SceneDirectives {
  mood?: string;    // default | tense | float
  enter?: string;   // fade-in | dissolve | typewriter
  speed?: string;   // slow | normal | fast
  [key: string]: string | undefined;
}

/**
 * 句子级指令 — 行内 {key: val}
 * 
 * pause 语义约定：
 *   {pause: 1200}        → pause-after（默认：本句显示完毕后等待 1200ms 再显示下一句）
 *   {pause-before: 800}  → 本句出现前等待 800ms
 *   {pause-after: 1200}  → 等价于 {pause: 1200}
 */
export interface SentenceDirectives {
  typewriter?: string;      // "60ms" | "80ms" — 逐字出现间隔
  pause?: string;           // "800" — 等价于 pause-after
  'pause-before'?: string;  // "800" — 本句出现前等待
  'pause-after'?: string;   // "1200" — 本句出现后等待
  flash?: string;           // "2" | "3"
  size?: string;            // "1.5x" | "2x"
  delay?: string;           // "500"
  [key: string]: string | undefined;
}

/** 词语级指令 — [[word]]{key: val} */
export interface WordDirectives {
  enter?: string;     // fly-in-left | sink | swim
  relation?: string;  // char | place | item
  glossary?: string;  // "true"
  color?: string;     // "#ff6b6b" | "accent"
  [key: string]: string | undefined;
}

// ============================================================
// AST 节点类型（内容轨）
// ============================================================

/** 文本片段 token */
export interface TextToken {
  type: 'text';
  value: string;
}

/** 标记词语 token */
export interface MarkedToken {
  type: 'marked';
  text: string;
  annotation?: string;       // [[text|annotation]] 中的注释
  directives: WordDirectives;
  /** 在场景内的全局标记索引 */
  markIndex: number;
  /**
   * 首次出现规则：
   * 同一场景中相同 text 的标记，只有第一次出现时为 true。
   * 带有 enter 指令的标记，默认只在首次出现时执行动效。
   */
  isFirstOccurrence: boolean;
}

export type SushiToken = TextToken | MarkedToken;

/** 一个句子（一行文本） */
export interface SushiSentence {
  tokens: SushiToken[];
  directives: SentenceDirectives;
  /** 去掉标注后的纯文本 */
  plainText: string;
  /** 在场景内的句子索引 */
  index: number;
}

/** 一个选项 */
export interface SushiChoice {
  text: string;
  target: string;
}

/** 一个场景 */
export interface SushiScene {
  id: string;
  frontmatter: SceneDirectives;
  sentences: SushiSentence[];
  choices: SushiChoice[];
}

/** 完整文档 */
export interface SushiDocument {
  scenes: Map<string, SushiScene>;
  /** 场景 ID 的有序列表（保留原始顺序） */
  sceneOrder: string[];
}

// ============================================================
// 字符元数据（Parser → LayoutEngine 桥接用）
// ============================================================

/** 每个字符对应的元数据，用于标注 LayoutSnapshot 中的 glyph */
export interface CharMeta {
  sentenceIndex: number;
  isMarked: boolean;
  markIndex?: number;
  /** 词语级颜色指令（如 "#ff6b6b"） */
  wordColor?: string;
  /** 词语级入场动效（如 "sink"） */
  enterEffect?: string;
  /** [[词语|注释]] 中的注释文本 */
  annotation?: string;
}
