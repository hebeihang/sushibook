/**
 * SushiML 语法高亮 — CodeMirror 6 StreamLanguage
 *
 * 颜色方案：
 *   ## 场景标题      → heading (蓝色)
 *   --- frontmatter  → meta (灰色)
 *   mood: tense      → meta (灰色) + keyword (紫色)
 *   [[词语]]         → link (橙色)
 *   [[词语|注释]]    → link + string (注释)
 *   {指令}           → annotation (绿色)
 *   >> 选项 -> target → keyword (紫色)
 */

import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// ============================================================
// Stream Parser
// ============================================================

interface SushiMLState {
  inFrontmatter: boolean;
}

const sushiMLParser: StreamParser<SushiMLState> = {
  startState(): SushiMLState {
    return { inFrontmatter: false };
  },

  token(stream, state): string | null {
    // 行首匹配
    if (stream.sol()) {
      // 场景标题 ##
      if (stream.match(/^##\s+\S+/)) {
        return 'heading';
      }

      // Frontmatter 分隔符 ---
      if (stream.match(/^---\s*$/)) {
        state.inFrontmatter = !state.inFrontmatter;
        return 'meta';
      }

      // 选项行 >> text -> target
      if (stream.match(/^>>\s+.+->\s+\S+/)) {
        return 'keyword';
      }
    }

    // Frontmatter 内容
    if (state.inFrontmatter) {
      // key:
      if (stream.match(/^[a-zA-Z-]+(?=:)/)) {
        return 'attributeName';
      }
      // : value
      if (stream.match(/^:\s*.+/)) {
        return 'attributeValue';
      }
      stream.next();
      return 'meta';
    }

    // 行内 [[词语|注释]]{指令} 或 [[词语]]{指令}
    if (stream.match(/\[\[/)) {
      // 读取到 ]] 为止
      while (!stream.eol()) {
        if (stream.match(/\]\]/)) {
          return 'link';
        }
        // | 分隔符后的注释部分
        if (stream.match(/\|/)) {
          // 继续读取注释直到 ]]
          while (!stream.eol()) {
            if (stream.match(/\]\]/)) {
              return 'link';
            }
            stream.next();
          }
          return 'link';
        }
        stream.next();
      }
      return 'link';
    }

    // 行内 {指令}
    if (stream.match(/\{/)) {
      while (!stream.eol()) {
        if (stream.match(/\}/)) {
          return 'annotation';
        }
        stream.next();
      }
      return 'annotation';
    }

    // 普通文本
    stream.next();
    return null;
  },
};

// ============================================================
// 语法高亮主题（暗色主题）
// ============================================================

export const sushiMLHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: '#6cb4ee', fontWeight: 'bold' },
    { tag: tags.meta, color: '#666680' },
    { tag: tags.attributeName, color: '#bb86fc' },
    { tag: tags.attributeValue, color: '#8888aa' },
    { tag: tags.keyword, color: '#bb86fc' },
    { tag: tags.link, color: '#ffb86c', fontWeight: '500' },
    { tag: tags.annotation, color: '#50fa7b', fontStyle: 'italic' },
  ])
);

// ============================================================
// 导出
// ============================================================

export const sushiMLLanguage = StreamLanguage.define(sushiMLParser);
