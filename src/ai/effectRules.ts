/**
 * 效果规则引擎
 * 
 * AI 只输出内容轨，本模块自动注入效果轨标注。
 * 这正是双轨分离的核心价值：AI 负责语义，规则引擎负责效果。
 * 
 * 规则：
 * 1. 每个场景的第一句 → typewriter（速度随 mood 变化）
 * 2. 最后一句正文 → pause-after 800ms
 * 3. 以 ！？… 结尾的句子 → pause-after 600ms
 */
export function applyEffectRules(source: string): string {
  const lines = source.split('\n');
  const result: string[] = [];

  let inFrontmatter = false;
  let currentMood = 'default';
  let isFirstContent = false;
  let contentLines: number[] = []; // 当前场景的正文行索引

  // 第一遍：收集结构信息
  const lineTypes: Array<'header' | 'fm-delim' | 'fm-body' | 'choice' | 'empty' | 'content'> = [];
  const sceneBounds: Array<{ start: number; end: number; mood: string }> = [];
  let currentSceneStart = -1;
  let sceneMood = 'default';

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('## ')) {
      if (currentSceneStart >= 0) {
        sceneBounds.push({ start: currentSceneStart, end: i - 1, mood: sceneMood });
      }
      currentSceneStart = i;
      sceneMood = 'default';
      lineTypes.push('header');
    } else if (t === '---') {
      inFrontmatter = !inFrontmatter;
      lineTypes.push('fm-delim');
    } else if (inFrontmatter) {
      const m = t.match(/^mood:\s*(\w+)/);
      if (m) sceneMood = m[1];
      lineTypes.push('fm-body');
    } else if (t.startsWith('>>')) {
      lineTypes.push('choice');
    } else if (!t) {
      lineTypes.push('empty');
    } else {
      lineTypes.push('content');
    }
  }
  if (currentSceneStart >= 0) {
    sceneBounds.push({ start: currentSceneStart, end: lines.length - 1, mood: sceneMood });
  }
  inFrontmatter = false;

  // 第二遍：为每个场景找出正文行并注入效果
  for (const scene of sceneBounds) {
    contentLines = [];
    for (let i = scene.start; i <= scene.end; i++) {
      if (lineTypes[i] === 'content') contentLines.push(i);
    }

    for (let i = scene.start; i <= scene.end; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (lineTypes[i] !== 'content') {
        result.push(line);
        continue;
      }

      // 已有句子级行尾指令？跳过（避免重复注入）
      // 逻辑与 parser.extractTrailingDirectives 保持一致
      if (hasSentenceLevelDirective(trimmed)) {
        result.push(line);
        continue;
      }

      const isFirst = (i === contentLines[0]);
      const isLast = (i === contentLines[contentLines.length - 1]);
      const hasDrama = /[！？…!?]$/.test(trimmed);

      if (isFirst) {
        // 第一句：typewriter，速度随 mood
        const speed = scene.mood === 'tense' ? '100ms' :
                      scene.mood === 'float' ? '80ms' : '60ms';
        result.push(`${trimmed}{typewriter: ${speed}}`);
      } else if (isLast) {
        // 最后一句：长停顿
        result.push(`${trimmed}{pause: 800}`);
      } else if (hasDrama) {
        // 戏剧性结尾：短停顿
        result.push(`${trimmed}{pause: 600}`);
      } else {
        result.push(line);
      }
    }
  }

  return result.join('\n');
}

/**
 * 判断一行是否已有句子级行尾指令（与 parser.extractTrailingDirectives 对齐）
 * - `句子。{typewriter: 60ms}` → true
 * - `[[word]]{enter: fly}` → false（词语级）
 * - `[[word]]{enter: fly}。{pause: 800}` → true（句子级在最后）
 */
function hasSentenceLevelDirective(line: string): boolean {
  const match = line.match(/\{([^}]+)\}\s*$/);
  if (!match) return false;

  const before = line.slice(0, match.index!);

  // 紧跟在 ]] 后面 → 词语级
  if (before.endsWith(']]')) return false;

  // 紧跟在 } 后面 → 检查更前面是否有 ]]
  if (before.endsWith('}')) {
    const deeper = before.replace(/\{[^}]*\}$/, '');
    if (deeper.endsWith(']]')) return false;
  }

  return true;
}
