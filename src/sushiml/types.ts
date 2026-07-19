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
  mood?: string;    // default | tense | float | storm
  enter?: string;   // fade-in | dissolve | typewriter
  speed?: string;   // slow | normal | fast
  [key: string]: string | undefined;
}

/**
 * 句子级指令 — 行尾 {key: val}
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

/**
 * 句子级（表现层 / Layer 2）指令键白名单。
 *
 * 三层模型下，行尾 {…} 由解析器「解析期打标」：命中本集合 → 表现层句子指令；
 * 命中 {@link WORD_DIRECTIVE_KEYS} 但未紧跟 [[标记词]] → 诊断（错位的词语指令）；
 * 形如 `键: 值` 但键均未知 → 诊断（疑似拼写错误）；其余 → 内容/逻辑层的 {JS 表达式}。
 * 详见 parser.ts 的 classifyTrailingBrace —— 不再靠运行时白名单「事后猜」而静默退化。
 */
export const SENTENCE_DIRECTIVE_KEYS: ReadonlySet<string> = new Set([
  'typewriter',
  'pause',
  'pause-before',
  'pause-after',
  'flash',
  'size',
  'delay',
]);

/** 词语级指令 — [[word]]{key: val} */
export interface WordDirectives {
  enter?: string;     // fly-in-left | rain | flare | sink | swim | heat | drift | sparkle | pull
  relation?: string;  // char | place | item
  glossary?: string;  // "true"
  color?: string;     // "#ff6b6b"
  [key: string]: string | undefined;
}

/**
 * 词语级（表现层 / Layer 2）指令键白名单。
 * 仅在 [[标记词]]{…} 内合法；出现在句尾 {…} 属错位，解析期打标为诊断。
 */
export const WORD_DIRECTIVE_KEYS: ReadonlySet<string> = new Set([
  'enter',
  'relation',
  'glossary',
  'color',
]);

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
   */
  isFirstOccurrence: boolean;
}

/** 表达式插值 token：{ JS 表达式 } */
export interface ExprToken {
  type: 'expr';
  /** 原始表达式代码 */
  code: string;
}

/** 变体函数类型 */
export type VariantKind = 'seq' | 'cycle' | 'once' | 'shuffle';

/** 活文本变体 token：{seq:A|B|C} 等，按场景访问次数推进 */
export interface VariantToken {
  type: 'variant';
  kind: VariantKind;
  items: string[];
  /** 在场景内的变体调用点索引（用于 shuffle 的确定性种子） */
  variantIndex: number;
}

export type SushiToken = TextToken | MarkedToken | ExprToken | VariantToken;

/** 一个句子（一行文本） */
export interface SushiSentence {
  tokens: SushiToken[];
  directives: SentenceDirectives;
  /** 原始形态的纯文本（插值/变体保留 {…} 源码） */
  plainText: string;
  /** 在场景顶层的句子索引（分支体内句子为 -1，显示索引由运行时缓冲分配） */
  index: number;
  /** 粘连：行尾 <>，下一句不换行直接接上 */
  glueAfter: boolean;
}

/** 一个选项 */
export interface SushiChoice {
  text: string;
  /**
   * 跳转目标场景 ID；特殊值 "END" 表示结局。
   * 可为空（undefined）：选中后只执行分支体，之后汇合继续。
   */
  target?: string;
  /** 一次性选项（* 前缀）：选过即消失；>> 为粘性 */
  once: boolean;
  /** 条件表达式（可选）：为假时不显示 */
  condition?: string;
  /**
   * 选项标签（Kiny §5.5）：>> (greet) 文本
   * 等价于一个自动计数的全局变量，值 = 该选项被选中的次数（0 = 未选）
   */
  label?: string;
  /** 分支体（Kiny §6）：选中后追加执行的场景项，执行完毕后汇合 */
  body: SceneItem[];
}

// ============================================================
// 场景执行流（Kiny 风格顺序模型，追加式渲染）
// ============================================================

/** @if 条件链的一个分支 */
export interface IfBranch {
  /** 条件表达式；@else 分支为 null */
  condition: string | null;
  body: SceneItem[];
}

/** 场景内容项：场景体是 SceneItem 的顺序执行流 */
export type SceneItem =
  | { kind: 'sentence'; sentence: SushiSentence }
  | { kind: 'logic'; code: string }
  | { kind: 'command'; name: string; argsSource: string }
  | { kind: 'divert'; target: string }
  | { kind: 'if'; branches: IfBranch[] }
  | { kind: 'choices'; choices: SushiChoice[] };

/** 引擎内置命令集（Kiny §11） */
export const KNOWN_COMMANDS: ReadonlySet<string> = new Set([
  'bg_show',
  'bg_hide',
  'bgm_play',
  'bgm_pause',
  'bgm_stop',
]);

/** 一个场景 */
export interface SushiScene {
  id: string;
  frontmatter: SceneDirectives;
  /** 场景体：顺序执行流 */
  items: SceneItem[];
  /** 顶层句子视图（不含分支体内句子；兼容工具/测试） */
  sentences: SushiSentence[];
  /** 顶层选项视图（所有顶层选项组扁平；兼容工具/测试） */
  choices: SushiChoice[];
  /** 顶层 ~ 逻辑行视图（兼容工具/测试） */
  logic: string[];
}

// ============================================================
// 解析诊断（解析期打标 —— 替代静默退化）
// ============================================================

/**
 * 解析期诊断：当 {…} 的语义无法被明确归层时，产出一条诊断而非静默退化成字面文本。
 * 由 UI 问题面板 / CLI 校验消费，对应「编译期报错」而非运行时输出垃圾文本。
 */
export interface SushiDiagnostic {
  severity: 'error' | 'warning';
  /** 稳定的机器可读码，便于测试与后续定位 */
  code:
    | 'unknown-sentence-directive'           // 句尾 {键: 值} 键未知（疑似拼写错误）
    | 'misplaced-word-directive'            // 词语指令出现在句尾，未紧跟 [[标记词]]
    | 'DEPRECATED_STICKY_OPTION_SYMBOL';    // 粘性选项符号 >> 已弃用，建议改用 +
  message: string;
  /** 出错所在场景 ID（尽力而为的定位信息） */
  scene?: string;
}

/** 完整文档 */
export interface SushiDocument {
  scenes: Map<string, SushiScene>;
  /** 场景 ID 的有序列表（保留原始顺序；子场景 ID 形如 父.子） */
  sceneOrder: string[];
  /** 序言区（第一个 ## 之前）的 ~ 逻辑行：全局变量声明 */
  prelude: string[];
  /** 解析期诊断（内容/表现层归属歧义 → 显式报错，不再静默退化） */
  diagnostics: SushiDiagnostic[];
}

/** 特殊跳转目标：结局 */
export const END_TARGET = 'END';

// ============================================================
// 字符元数据（Parser → LayoutEngine 桥接用）
// ============================================================

/** 每个字素对应的元数据，用于标注 LayoutSnapshot 中的 glyph */
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
