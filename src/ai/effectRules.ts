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
import { extractTrailingDirectives } from '../sushiml/parser';
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
    } else if (t.startsWith('>>') || t.startsWith('* ')) {
      // 粘性 / 一次性选项行
      lineTypes.push('choice');
    } else if (t.startsWith('~') || t.startsWith('//') || t.startsWith('@') || t.startsWith('->') || t.startsWith('>')) {
      // 逻辑行/注释/@控制/独立跳转/分支体：不注入效果
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

  // 保留序言区（首个 ## 之前的所有行）：变量声明 ~、注释 //、前置 frontmatter 等。
  // 否则这些行会被静默丢弃，导致 story 逻辑悄悄失效（bug B4）。
  const firstSceneStart = sceneBounds.length > 0 ? sceneBounds[0].start : lines.length;
  for (let i = 0; i < firstSceneStart; i++) {
    result.push(lines[i]);
  }

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
 * 判断一行是否已有句子级行尾指令
 * 直接复用 parser 的消歧逻辑（含指令 key 白名单）：
 * - `句子。{typewriter: 60ms}` → true
 * - `[[word]]{enter: fly}` → false（词语级）
 * - `金币还剩{gold}` → false（表达式插值，不是指令）
 */
function hasSentenceLevelDirective(line: string): boolean {
  const { directives } = extractTrailingDirectives(line);
  return Object.keys(directives).length > 0;
}
