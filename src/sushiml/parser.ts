/**
 * SushiML Parser
 * 
 * 将 .sushi 文本解析为 SushiDocument AST。
 * 
 * 解析流程：
 * 1. 按 `## scene_id` 分割场景
 * 2. 提取每个场景的 frontmatter (--- block)
 * 3. 逐行解析正文：
 *    - `>> text -> target` → 选项（双箭头前缀，避免与 MD blockquote 冲突）
 *    - 其他行 → 句子（含行尾 {directives} 和行内 [[marks]]）
 */

import type {
  SushiDocument,
  SushiScene,
  SushiSentence,
  SushiChoice,
  SushiToken,
  SceneDirectives,
  SentenceDirectives,
  WordDirectives,
  CharMeta,
} from './types';

// ============================================================
// 公共 API
// ============================================================

/**
 * 解析 SushiML 源文本
 */
export function parseSushiML(source: string): SushiDocument {
  const scenes = new Map<string, SushiScene>();
  const sceneOrder: string[] = [];
  const blocks = splitIntoSceneBlocks(source);

  for (const block of blocks) {
    const scene = parseScene(block);
    scenes.set(scene.id, scene);
    sceneOrder.push(scene.id);
  }

  return { scenes, sceneOrder };
}

/**
 * 从场景中提取纯文本和字符元数据
 * 用于 LayoutEngine 排版后标注每个 glyph
 */
export function extractTextAndMeta(scene: SushiScene): {
  plainText: string;
  charMeta: CharMeta[];
} {
  const chars: string[] = [];
  const meta: CharMeta[] = [];

  for (const sentence of scene.sentences) {
    for (const token of sentence.tokens) {
      if (token.type === 'text') {
        for (const ch of token.value) {
          chars.push(ch);
          meta.push({ sentenceIndex: sentence.index, isMarked: false });
        }
      } else {
        // MarkedToken：传递词语级颜色、动效和注释
        const wordColor = token.directives.color || undefined;
        const enterEffect = token.directives.enter || undefined;
        const annotation = token.annotation || undefined;
        for (const ch of token.text) {
          chars.push(ch);
          meta.push({
            sentenceIndex: sentence.index,
            isMarked: true,
            markIndex: token.markIndex,
            wordColor,
            enterEffect,
            annotation,
          });
        }
      }
    }
  }

  return { plainText: chars.join(''), charMeta: meta };
}

// ============================================================
// 内部：场景分割
// ============================================================

interface SceneBlock {
  id: string;
  body: string;
}

function splitIntoSceneBlocks(source: string): SceneBlock[] {
  const blocks: SceneBlock[] = [];
  // 匹配 ## scene_id 标题行
  const headerRegex = /^##\s+(\S+)/gm;
  const headers: Array<{ id: string; index: number }> = [];

  let match;
  while ((match = headerRegex.exec(source)) !== null) {
    headers.push({ id: match[1], index: match.index + match[0].length });
  }

  if (headers.length === 0) {
    // 无场景标题，整个文件作为一个场景
    blocks.push({ id: 'start', body: source });
    return blocks;
  }

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i < headers.length - 1 ? source.lastIndexOf('\n', source.indexOf('##', start + 1)) : source.length;
    const body = source.slice(start, end).trim();
    blocks.push({ id: headers[i].id, body });
  }

  return blocks;
}

// ============================================================
// 内部：场景解析
// ============================================================

function parseScene(block: SceneBlock): SushiScene {
  const { frontmatter, remaining } = extractFrontmatter(block.body);
  const lines = remaining.split('\n');

  const sentences: SushiSentence[] = [];
  const choices: SushiChoice[] = [];
  let sentenceIdx = 0;
  let markIdx = 0;
  /** 首次出现追踪：同一场景中相同标记文本只有第一次 isFirstOccurrence=true */
  const seenMarks = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 选项行: >> text -> target（双 > 避免与 blockquote 冲突）
    const choiceMatch = line.match(/^>>\s+(.+?)\s+->\s+(\S+)$/);
    if (choiceMatch) {
      choices.push({ text: choiceMatch[1].trim(), target: choiceMatch[2] });
      continue;
    }

    // 普通句子行
    const sentence = parseSentenceLine(line, sentenceIdx, markIdx, seenMarks);
    sentences.push(sentence);
    sentenceIdx++;
    // 更新全局 markIndex
    for (const token of sentence.tokens) {
      if (token.type === 'marked') markIdx++;
    }
  }

  return {
    id: block.id,
    frontmatter,
    sentences,
    choices,
  };
}

// ============================================================
// 内部：Frontmatter 提取
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

  const frontmatter = parseYamlLike(match[1]);
  const remaining = body.slice(match[0].length);
  return { frontmatter, remaining };
}

/**
 * 简易 YAML 键值解析（仅支持 key: value 单行格式）
 */
function parseYamlLike(text: string): SceneDirectives {
  const result: SceneDirectives = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
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

function parseSentenceLine(
  line: string,
  sentenceIndex: number,
  startMarkIndex: number,
  seenMarks: Set<string>
): SushiSentence {
  // 1. 提取行尾 {directives}
  const { text, directives } = extractTrailingDirectives(line);

  // 2. 解析行内 [[marks]]
  let markIdx = startMarkIndex;
  const tokens = tokenizeLine(text, () => {
    const idx = markIdx;
    markIdx++;
    return idx;
  }, seenMarks);

  // 3. 构建纯文本
  const plainText = tokens
    .map((t) => (t.type === 'text' ? t.value : t.text))
    .join('');

  return { tokens, directives, plainText, index: sentenceIndex };
}

/**
 * 提取行尾 {key: val, ...} 指令
 */
function extractTrailingDirectives(line: string): {
  text: string;
  directives: SentenceDirectives;
} {
  // 匹配行尾的 {key: val, key: val}
  const match = line.match(/\{([^}]+)\}\s*$/);
  if (!match) {
    return { text: line, directives: {} };
  }

  // 消歧：排除词语级指令 [[word]]{directives}
  const beforeBrace = line.slice(0, match.index!);
  if (beforeBrace.endsWith(']]')) {
    // 紧跟在 ]] 后面 → 这是词语级指令
    return { text: line, directives: {} };
  }

  // 消歧：排除连续花括号 [[word]]{word-dir}{sentence-dir}
  // 如果前面以 } 结尾，说明紧跟在另一个 {…} 后面
  // 需要检查更前面是否有 ]]——如果有，整行交给 tokenizeLine 处理
  if (beforeBrace.endsWith('}')) {
    const deeperBefore = beforeBrace.replace(/\{[^}]*\}$/, '');
    if (deeperBefore.endsWith(']]')) {
      return { text: line, directives: {} };
    }
  }

  const directives = parseDirectiveString(match[1]);
  const text = line.slice(0, match.index!).trimEnd();
  return { text, directives };
}

// ============================================================
// 内部：Token 化（行内 [[marks]]）
// ============================================================

function tokenizeLine(
  text: string,
  nextMarkIndex: () => number,
  seenMarks: Set<string>
): SushiToken[] {
  const tokens: SushiToken[] = [];
  let remaining = text;

  // 匹配 [[text]] 或 [[text|annotation]] 后可选跟 {directives}
  const markRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\](?:\{([^}]+)\})?/;

  while (remaining.length > 0) {
    const match = remaining.match(markRegex);
    if (!match || match.index === undefined) {
      // 剩余全是纯文本
      if (remaining) tokens.push({ type: 'text', value: remaining });
      break;
    }

    // 匹配前的纯文本
    if (match.index > 0) {
      tokens.push({ type: 'text', value: remaining.slice(0, match.index) });
    }

    // 标记词语 + 首次出现追踪
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

// ============================================================
// 共享：指令字符串解析
// ============================================================

/**
 * 解析 "key: val, key: val" 格式的指令字符串
 */
function parseDirectiveString(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  // 按逗号分割，每个片段是 key: value
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      // 无冒号的简单标志，如 "flash"
      if (trimmed) result[trimmed] = 'true';
    } else {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (key) result[key] = val;
    }
  }
  return result;
}
