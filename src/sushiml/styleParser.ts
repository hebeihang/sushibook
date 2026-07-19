/**
 * Phase 5: SushiStyle 解析与合并
 *
 * 样式来源优先级（从高到低）：
 * 1. 内联指令（{color: #f00}）
 * 2. 外部样式表（*.sushi-style）词语规则
 * 3. 外部样式表全局规则
 * 4. 引擎默认值
 */

import type { SushiStyle, ResolvedStyle, WordStyleRule, MoodStyles } from './types';

/** 简易 YAML 解析（仅支持本项目用到的子集） */
export function parseYamlStyle(yamlText: string): SushiStyle {
  const style: SushiStyle = {};
  const lines = yamlText.split('\n');
  let currentSection: 'global' | 'words' | 'moods' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 顶级分段（行首无缩进）
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      if (trimmed === 'global:') {
        currentSection = 'global';
        style.global = {};
        continue;
      }
      if (trimmed === 'words:') {
        currentSection = 'words';
        style.words = {};
        continue;
      }
      if (trimmed === 'moods:') {
        currentSection = 'moods';
        style.moods = {};
        continue;
      }
    }

    // 解析缩进的键值对
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valueStr = trimmed.slice(colonIdx + 1).trim();

    if (!valueStr) {
      // 标签行（如 "tense:" 无值），记住当前 mood
      if (currentSection === 'moods') {
        style.moods![key] = {};
      }
      continue;
    }

    if (currentSection === 'global') {
      parseGlobalProperty(style.global!, key, valueStr);
    } else if (currentSection === 'words') {
      // words 段的词语定义：sword: { color: '#ff6b6b', ... }
      if (valueStr.startsWith('{') && valueStr.endsWith('}')) {
        const rule = parseWordRule(valueStr);
        style.words![key] = rule;
      }
    } else if (currentSection === 'moods') {
      // moods 段：mood 定义（都是 key: { ... } 形式）
      if (valueStr.startsWith('{') && valueStr.endsWith('}')) {
        // 内联对象形式：tense: { typewriter: 100ms }
        const rule = parseWordRule(valueStr) as MoodStyles;
        style.moods![key] = rule;
      }
    }
  }

  return style;
}

function parseGlobalProperty(target: Record<string, any>, key: string, valueStr: string): void {
  if (key === 'typewriter') {
    target.typewriter = parseNumber(valueStr);
  } else if (key === 'pause') {
    target.pause = parseNumber(valueStr);
  }
}

function parseWordRule(objStr: string): WordStyleRule {
  const rule: WordStyleRule = {};
  // 简单正则提取 { color: '#...', size: 1.2, enter: swim, typewriter: 80ms, pause: 600ms }
  const colorMatch = objStr.match(/color:\s*['"#]([^'"]+)['"]/);
  if (colorMatch) {
    rule.color = colorMatch[1].startsWith('#') ? colorMatch[1] : `#${colorMatch[1]}`;
  }

  const sizeMatch = objStr.match(/size:\s*([\d.]+)/);
  if (sizeMatch) {
    rule.size = parseFloat(sizeMatch[1]);
  }

  const enterMatch = objStr.match(/enter:\s*(\w+)/);
  if (enterMatch) {
    rule.enter = enterMatch[1];
  }

  const typewriterMatch = objStr.match(/typewriter:\s*([\d]+)ms?/);
  if (typewriterMatch) {
    (rule as any).typewriter = parseInt(typewriterMatch[1], 10);
  }

  const pauseMatch = objStr.match(/pause:\s*([\d]+)ms?/);
  if (pauseMatch) {
    rule.pause = parseInt(pauseMatch[1], 10);
  }

  return rule;
}

function parseNumber(str: string): number {
  // 移除 ms 后缀
  const num = parseInt(str.replace(/ms?$/i, ''), 10);
  return isNaN(num) ? 0 : num;
}

/**
 * 合并样式表到场景级别
 *
 * @param styleSheet 外部样式表
 * @param mood 当前场景的 mood
 * @returns 合并后的全局样式规则
 */
export function resolveSceneStyle(styleSheet: SushiStyle | undefined, mood: string): ResolvedStyle {
  const result: ResolvedStyle = {};

  // 第一层：全局默认
  if (styleSheet?.global) {
    if (styleSheet.global.typewriter !== undefined) {
      result.typewriter = styleSheet.global.typewriter;
    }
    if (styleSheet.global.pause !== undefined) {
      result.pause = styleSheet.global.pause;
    }
  }

  // 第二层：mood 覆盖
  if (styleSheet?.moods && styleSheet.moods[mood]) {
    const moodStyle = styleSheet.moods[mood];
    if (moodStyle.typewriter !== undefined) {
      result.typewriter = moodStyle.typewriter;
    }
    if (moodStyle.pause !== undefined) {
      result.pause = moodStyle.pause;
    }
  }

  // 第三层：词语样式副本（后续用于词级查询）
  if (styleSheet?.words) {
    result.wordStyles = { ...styleSheet.words };
  }

  return result;
}

/**
 * 查询单个词语的样式
 *
 * @param sceneStyle 场景级已解析样式
 * @param wordText 词语文本
 * @param inlineRule 内联样式（优先级最高）
 * @returns 合并后的词语样式
 */
export function resolveWordStyle(
  sceneStyle: ResolvedStyle | undefined,
  wordText: string,
  inlineRule?: WordStyleRule
): WordStyleRule {
  const result: WordStyleRule = {};

  // 第一层：场景级默认
  if (sceneStyle?.wordStyles && sceneStyle.wordStyles[wordText]) {
    Object.assign(result, sceneStyle.wordStyles[wordText]);
  }

  // 第二层：内联规则覆盖
  if (inlineRule) {
    Object.assign(result, inlineRule);
  }

  return result;
}
