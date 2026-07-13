/**
 * SushiML Parser
 *
 * 将 .sushi 文本解析为 SushiDocument AST（场景 = SceneItem 顺序执行流）。
 *
 * 行级语法：
 *   ## 场景 / ### 子场景（ID = 父.子）
 *   --- frontmatter ---
 *   // 注释
 *   ~ JS 语句
 *   @if {cond} / @elif {cond} / @else     条件链（体用 > 层级）
 *   @命令(参数)                            宿主命令
 *   -> 目标                                独立跳转行
 *   >> [{cond}] 文本 [-> 目标]             粘性选项（体用 > 层级）
 *   *  [{cond}] 文本 [-> 目标]             一次性选项
 *   > …                                    分支体层级（数量=嵌套深度）
 *   其他行 → 句子：行尾 {指令}（白名单）+ [[标记]] + {插值} + {变体} + 行尾 <> 粘连
 */

import type {
  SushiDocument,
  SushiScene,
  SushiSentence,
  SushiChoice,
  SushiToken,
  ExprToken,
  VariantToken,
  VariantKind,
  SceneItem,
  IfBranch,
  SceneDirectives,
  SentenceDirectives,
  WordDirectives,
  CharMeta,
} from './types';
import { SENTENCE_DIRECTIVE_KEYS, END_TARGET } from './types';

// ============================================================
// 公共 API
// ============================================================

export function parseSushiML(source: string): SushiDocument {
  const scenes = new Map<string, SushiScene>();
  const sceneOrder: string[] = [];
  const { prelude, blocks } = splitIntoSceneBlocks(source);

  for (const block of blocks) {
    const scene = parseScene(block);
    scenes.set(scene.id, scene);
    sceneOrder.push(scene.id);
  }

  return { scenes, sceneOrder, prelude };
}

/** 插值/变体 token 的求值回调（由 bridge 注入运行时状态） */
export type TokenResolver = (token: ExprToken | VariantToken) => string;

/**
 * 求解单个句子 → 纯文本 + 字素级元数据
 * @param sentenceIndex - 显示句子索引（由调用方分配，写入每个字素的 CharMeta）
 */
export function resolveSentence(
  sentence: SushiSentence,
  sentenceIndex: number,
  resolver?: TokenResolver
): { text: string; charMeta: CharMeta[] } {
  const chars: string[] = [];
  const meta: CharMeta[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  const pushText = (text: string, base: CharMeta): void => {
    for (const seg of segmenter.segment(text)) {
      chars.push(seg.segment);
      meta.push({ ...base });
    }
  };

  for (const token of sentence.tokens) {
    const base: CharMeta = { sentenceIndex, isMarked: false };
    switch (token.type) {
      case 'text':
        pushText(token.value, base);
        break;
      case 'expr':
      case 'variant': {
        const value = resolver
          ? resolver(token)
          : token.type === 'expr'
            ? `{${token.code}}`
            : `{${token.kind}:${token.items.join('|')}}`;
        if (value) pushText(value, base);
        break;
      }
      case 'marked':
        pushText(token.text, {
          sentenceIndex,
          isMarked: true,
          markIndex: token.markIndex,
          wordColor: token.directives.color || undefined,
          enterEffect: token.directives.enter || undefined,
          annotation: token.annotation || undefined,
        });
        break;
    }
  }

  return { text: chars.join(''), charMeta: meta };
}

/**
 * 从场景顶层句子提取纯文本和字符元数据（兼容视图；运行时使用缓冲追加模型）
 * 句子间以 \n 分隔；上一句带 <> 粘连时直接相接
 */
export function extractTextAndMeta(
  scene: SushiScene,
  resolver?: TokenResolver
): { plainText: string; charMeta: CharMeta[] } {
  const chars: string[] = [];
  const meta: CharMeta[] = [];

  scene.sentences.forEach((sentence, si) => {
    if (si > 0 && !scene.sentences[si - 1].glueAfter) {
      chars.push('\n');
      meta.push({ sentenceIndex: si, isMarked: false });
    }
    const { text, charMeta } = resolveSentence(sentence, si, resolver);
    for (const seg of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      chars.push(seg.segment);
    }
    meta.push(...charMeta);
  });

  return { plainText: chars.join(''), charMeta: meta };
}

// ============================================================
// 内部：序言区与场景分割（含 ### 子场景）
// ============================================================

interface SceneBlock {
  id: string;
  body: string;
}

function splitIntoSceneBlocks(source: string): { prelude: string[]; blocks: SceneBlock[] } {
  const blocks: SceneBlock[] = [];
  // 匹配 ## 场景 或 ### 子场景 标题行（### 先于 ## 判断）
  const headerRegex = /^(###|##)\s+(\S+).*$/gm;
  const headers: Array<{ sub: boolean; name: string; headerStart: number; bodyStart: number }> = [];

  let match;
  while ((match = headerRegex.exec(source)) !== null) {
    headers.push({
      sub: match[1] === '###',
      name: match[2],
      headerStart: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  if (headers.length === 0) {
    blocks.push({ id: 'start', body: source });
    return { prelude: [], blocks };
  }

  const prelude = parsePrelude(source.slice(0, headers[0].headerStart));

  let currentParent = '';
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    let id: string;
    if (h.sub) {
      // 子场景：ID = 父.子（无父时按顶层处理）
      id = currentParent ? `${currentParent}.${h.name}` : h.name;
    } else {
      currentParent = h.name;
      id = h.name;
    }
    const start = h.bodyStart;
    const end = i < headers.length - 1 ? headers[i + 1].headerStart : source.length;
    blocks.push({ id, body: source.slice(start, end).trim() });
  }

  return { prelude, blocks };
}

function parsePrelude(text: string): string[] {
  const statements: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || isComment(line)) continue;
    if (line.startsWith('~')) {
      statements.push(line.slice(1).trim());
    }
  }
  return statements;
}

function isComment(line: string): boolean {
  return line.startsWith('//');
}

// ============================================================
// 内部：场景解析（行级 lexer + 递归下降）
// ============================================================

/** 选项行（带跳转目标）：前缀 (标签)? {条件}? 文本 -> 目标 */
const CHOICE_WITH_TARGET_RE = /^(>>|\*)\s+(?:\(([A-Za-z_][A-Za-z0-9_]*)\)\s+)?(?:\{([^}]+)\}\s+)?(.+?)\s+->\s+(\S+)$/;
/** 选项行（无目标，靠分支体+汇合） */
const CHOICE_BARE_RE = /^(>>|\*)\s+(?:\(([A-Za-z_][A-Za-z0-9_]*)\)\s+)?(?:\{([^}]+)\}\s+)?(.+)$/;
const IF_RE = /^@if\s*\{([^}]+)\}\s*$/;
const ELIF_RE = /^@elif\s*\{([^}]+)\}\s*$/;
const ELSE_RE = /^@else\s*$/;
const COMMAND_RE = /^@([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/;
const DIVERT_RE = /^->\s+(\S+)\s*$/;

interface LexedLine {
  /** 行首 > 的数量（分支体层级） */
  level: number;
  /** 去掉层级标记后的内容 */
  content: string;
}

/** 解析上下文：mark/variant 计数跨整个场景（含分支体）连续 */
interface ParseCtx {
  markIdx: number;
  variantIdx: number;
  seenMarks: Set<string>;
}

function parseScene(block: SceneBlock): SushiScene {
  const { frontmatter, remaining } = extractFrontmatter(block.body);

  // 行级 lex：计算 > 层级，过滤空行与注释
  const lexed: LexedLine[] = [];
  for (const rawLine of remaining.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let level = 0;
    let rest = trimmed;
    // 行首连续的 > 计为层级（> 之间需空格分隔）；
    // ">> " 是粘性选项前缀，不是两层体标记——嵌套选项写作 "> >> 选项"
    while (rest.startsWith('>') && !/^>>\s/.test(rest)) {
      rest = rest.slice(1).trimStart();
      level++;
    }
    if (!rest || isComment(rest)) continue;
    lexed.push({ level, content: rest });
  }

  const ctx: ParseCtx = { markIdx: 0, variantIdx: 0, seenMarks: new Set() };
  const cursor = { lines: lexed, pos: 0 };
  const items = parseItems(cursor, 0, ctx);

  // 顶层兼容视图
  const sentences: SushiSentence[] = [];
  const choices: SushiChoice[] = [];
  const logic: string[] = [];
  for (const item of items) {
    if (item.kind === 'sentence') {
      item.sentence.index = sentences.length;
      sentences.push(item.sentence);
    } else if (item.kind === 'choices') {
      choices.push(...item.choices);
    } else if (item.kind === 'logic') {
      logic.push(item.code);
    }
  }

  return { id: block.id, frontmatter, items, sentences, choices, logic };
}

interface Cursor {
  lines: LexedLine[];
  pos: number;
}

/**
 * 递归下降：解析 level 层级的连续内容项
 * 遇到更浅层级即返回（汇合）
 */
function parseItems(cursor: Cursor, level: number, ctx: ParseCtx): SceneItem[] {
  const items: SceneItem[] = [];

  while (cursor.pos < cursor.lines.length) {
    const line = cursor.lines[cursor.pos];
    if (line.level < level) break; // 汇合到外层

    // 层级比预期深但没有宿主（容错）：按当前层处理
    const content = line.content;

    // ~ 逻辑行
    if (content.startsWith('~')) {
      cursor.pos++;
      items.push({ kind: 'logic', code: content.slice(1).trim() });
      continue;
    }

    // -> 独立跳转
    const divert = content.match(DIVERT_RE);
    if (divert) {
      cursor.pos++;
      items.push({ kind: 'divert', target: divert[1] });
      continue;
    }

    // @if 条件链
    if (IF_RE.test(content)) {
      items.push(parseIfChain(cursor, line.level, ctx));
      continue;
    }

    // @命令(…)（@if/@elif/@else 已在前面处理；游离的 @elif/@else 容错跳过）
    if (ELIF_RE.test(content) || ELSE_RE.test(content)) {
      cursor.pos++;
      continue;
    }
    const cmd = content.match(COMMAND_RE);
    if (cmd) {
      cursor.pos++;
      items.push({ kind: 'command', name: cmd[1], argsSource: cmd[2] });
      continue;
    }

    // 选项组：连续的同层选项行
    if (CHOICE_BARE_RE.test(content) && /^(>>|\*)\s/.test(content)) {
      items.push(parseChoiceGroup(cursor, line.level, ctx));
      continue;
    }

    // 普通句子
    cursor.pos++;
    items.push({ kind: 'sentence', sentence: parseSentenceLine(content, ctx) });
  }

  return items;
}

/** 解析 @if/@elif/@else 链（体在 level+1） */
function parseIfChain(cursor: Cursor, level: number, ctx: ParseCtx): SceneItem {
  const branches: IfBranch[] = [];
  let seenElse = false;

  while (cursor.pos < cursor.lines.length) {
    const line = cursor.lines[cursor.pos];
    if (line.level !== level) break;

    const ifMatch = line.content.match(IF_RE);
    const elifMatch = line.content.match(ELIF_RE);
    const elseMatch = ELSE_RE.test(line.content);

    if (branches.length === 0) {
      if (!ifMatch) break;
      cursor.pos++;
      branches.push({ condition: ifMatch[1].trim(), body: parseItems(cursor, level + 1, ctx) });
      continue;
    }

    if (elifMatch && !seenElse) {
      cursor.pos++;
      branches.push({ condition: elifMatch[1].trim(), body: parseItems(cursor, level + 1, ctx) });
      continue;
    }
    if (elseMatch && !seenElse) {
      seenElse = true;
      cursor.pos++;
      branches.push({ condition: null, body: parseItems(cursor, level + 1, ctx) });
      continue;
    }
    break; // 链结束
  }

  return { kind: 'if', branches };
}

/** 解析选项组：连续同层选项，各自的分支体在 level+1 */
function parseChoiceGroup(cursor: Cursor, level: number, ctx: ParseCtx): SceneItem {
  const choices: SushiChoice[] = [];

  while (cursor.pos < cursor.lines.length) {
    const line = cursor.lines[cursor.pos];
    if (line.level !== level) break;

    let m = line.content.match(CHOICE_WITH_TARGET_RE);
    let target: string | undefined;
    if (m) {
      target = m[5] === END_TARGET ? END_TARGET : m[5];
    } else {
      m = line.content.match(CHOICE_BARE_RE);
      if (!m || !/^(>>|\*)\s/.test(line.content)) break;
    }

    cursor.pos++;
    const body = parseItems(cursor, level + 1, ctx);

    choices.push({
      text: m[4].trim(),
      target,
      once: m[1] === '*',
      condition: m[3]?.trim() || undefined,
      label: m[2] || undefined,
      body,
    });
  }

  return { kind: 'choices', choices };
}

// ============================================================
// 内部：Frontmatter
// ============================================================

function extractFrontmatter(body: string): {
  frontmatter: SceneDirectives;
  remaining: string;
} {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = body.match(fmRegex);
  if (!match) {
    return { frontmatter: {}, remaining: body };
  }
  return { frontmatter: parseYamlLike(match[1]), remaining: body.slice(match[0].length) };
}

function parseYamlLike(text: string): SceneDirectives {
  const result: SceneDirectives = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || isComment(trimmed)) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

// ============================================================
// 内部：句子行解析
// ============================================================

function parseSentenceLine(line: string, ctx: ParseCtx): SushiSentence {
  // 1. 行尾 <> 粘连
  let glueAfter = false;
  let working = line;
  if (working.endsWith('<>')) {
    glueAfter = true;
    working = working.slice(0, -2).trimEnd();
  }

  // 2. 行尾 {directives}（key 全部命中白名单才算指令）
  const { text, directives } = extractTrailingDirectives(working);

  // 3. 行内 [[marks]] + {插值/变体}
  const tokens = tokenizeLine(
    text,
    () => ctx.markIdx++,
    () => ctx.variantIdx++,
    ctx.seenMarks
  );

  const plainText = tokens
    .map((t) => {
      switch (t.type) {
        case 'text': return t.value;
        case 'marked': return t.text;
        case 'expr': return `{${t.code}}`;
        case 'variant': return `{${t.kind}:${t.items.join('|')}}`;
      }
    })
    .join('');

  return { tokens, directives, plainText, index: -1, glueAfter };
}

/**
 * 提取行尾 {key: val, ...} 指令
 *
 * 消歧规则（按序）：
 * 1. 紧跟在 ]] 后（或 ]]{词语指令} 后）的花括号 → 词语级指令，不在此处理
 * 2. 花括号内所有 key 都命中句子指令白名单 → 句子指令
 * 3. 否则 → 保留在文本中，由 tokenizeLine 按插值/变体处理
 */
export function extractTrailingDirectives(line: string): {
  text: string;
  directives: SentenceDirectives;
} {
  const match = line.match(/\{([^}]+)\}\s*([。？！.?!]*)\s*$/);
  if (!match) {
    return { text: line, directives: {} };
  }

  const beforeBrace = line.slice(0, match.index!);

  if (beforeBrace.endsWith(']]')) {
    return { text: line, directives: {} };
  }
  if (beforeBrace.endsWith('}')) {
    const deeperBefore = beforeBrace.replace(/\{[^}]*\}$/, '');
    if (deeperBefore.endsWith(']]')) {
      return { text: line, directives: {} };
    }
  }

  const directives = parseDirectiveString(match[1]);
  const keys = Object.keys(directives);
  const allKnown = keys.length > 0 && keys.every((k) => SENTENCE_DIRECTIVE_KEYS.has(k));
  if (!allKnown) {
    return { text: line, directives: {} };
  }

  const punctuation = match[2] || '';
  return { text: beforeBrace.trimEnd() + punctuation, directives };
}

// ============================================================
// 内部：Token 化
// ============================================================

const MARK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\](?:\{([^}]+)\})?/;
const VARIANT_RE = /^(seq|cycle|once|shuffle)\s*:\s*([\s\S]+)$/;

function tokenizeLine(
  text: string,
  nextMarkIndex: () => number,
  nextVariantIndex: () => number,
  seenMarks: Set<string>
): SushiToken[] {
  const tokens: SushiToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const match = remaining.match(MARK_RE);
    if (!match || match.index === undefined) {
      tokenizePlainSegment(remaining, tokens, nextVariantIndex);
      break;
    }

    if (match.index > 0) {
      tokenizePlainSegment(remaining.slice(0, match.index), tokens, nextVariantIndex);
    }

    const markText = match[1];
    const isFirst = !seenMarks.has(markText);
    if (isFirst) seenMarks.add(markText);

    const directives: WordDirectives = match[3]
      ? parseDirectiveString(match[3])
      : {};

    tokens.push({
      type: 'marked',
      text: markText,
      annotation: match[2] || undefined,
      directives,
      markIndex: nextMarkIndex(),
      isFirstOccurrence: isFirst,
    });

    remaining = remaining.slice(match.index + match[0].length);
  }

  return tokens;
}

function tokenizePlainSegment(
  segment: string,
  tokens: SushiToken[],
  nextVariantIndex: () => number
): void {
  let remaining = segment;
  const braceRe = /\{([^{}]+)\}/;

  while (remaining.length > 0) {
    const m = remaining.match(braceRe);
    if (!m || m.index === undefined) {
      if (remaining) tokens.push({ type: 'text', value: remaining });
      break;
    }

    if (m.index > 0) {
      tokens.push({ type: 'text', value: remaining.slice(0, m.index) });
    }

    const inner = m[1].trim();
    const variant = inner.match(VARIANT_RE);
    if (variant) {
      tokens.push({
        type: 'variant',
        kind: variant[1] as VariantKind,
        items: variant[2].split('|').map((s) => s.trim()),
        variantIndex: nextVariantIndex(),
      });
    } else {
      tokens.push({ type: 'expr', code: inner });
    }

    remaining = remaining.slice(m.index + m[0].length);
  }
}

// ============================================================
// 共享：指令字符串解析
// ============================================================

function parseDirectiveString(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      if (trimmed) result[trimmed] = 'true';
    } else {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (key) result[key] = val;
    }
  }
  return result;
}
