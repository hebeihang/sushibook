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
 *   + 选项 -> target  → keyword (紫色)
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
      // 注释 //
      if (stream.match(/^\/\/.*$/)) {
        return 'comment';
      }

      // 场景标题 ## / 子场景 ###
      if (stream.match(/^###?\s+\S+/)) {
        return 'heading';
      }

      // Frontmatter 分隔符 ---
      if (stream.match(/^---\s*$/)) {
        state.inFrontmatter = !state.inFrontmatter;
        return 'meta';
      }

      // 逻辑行 ~ 语句
      if (stream.match(/^~.*$/)) {
        return 'operator';
      }

      // 独立跳转 -> 目标
      if (stream.match(/^->\s+\S+\s*$/)) {
        return 'keyword';
      }

      // @if / @elif / @else 条件链
      if (stream.match(/^@(if|elif)\s*\{[^}]*\}\s*$/) || stream.match(/^@else\s*$/)) {
        return 'keyword';
      }

      // @命令(…)
      if (stream.match(/^@[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*$/)) {
        return 'annotation';
      }

      // 选项行 + / * （可带 {条件}，目标可选；支持旧符号 >> 兼容）
      if (stream.match(/^(\+|>>|\*)\s+(\{[^}]*\}\s+)?\S.*$/)) {
        return 'keyword';
      }

      // 分支体层级标记 >（可连续，> 间空格）
      if (stream.match(/^(>\s*)+/)) {
        return 'meta';
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
// 语法高亮主题（daisyUI 语义色，自动适配深浅主题）
// ============================================================

// 语法高亮主题：颜色引用「对比度修正变量」--cm-hl-*（由 ThemeSwitcher 按当前主题
// 的编辑器背景计算，确保极简(lofi)等低对比主题下绿色/亮色仍清晰可读），随主题切换实时更新。
export const sushiMLHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: 'var(--cm-hl-heading)', fontWeight: 'bold' },
    { tag: tags.meta, color: 'var(--cm-hl-meta)', opacity: 0.6 },
    { tag: tags.attributeName, color: 'var(--cm-hl-attr)' },
    { tag: tags.attributeValue, color: 'var(--cm-hl-meta)', opacity: 0.7 },
    { tag: tags.keyword, color: 'var(--cm-hl-keyword)' },
    { tag: tags.link, color: 'var(--cm-hl-link)', fontWeight: '500' },
    { tag: tags.annotation, color: 'var(--cm-hl-annotation)', fontStyle: 'italic' },
    { tag: tags.comment, color: 'var(--cm-hl-comment)', opacity: 0.5, fontStyle: 'italic' },
    { tag: tags.operator, color: 'var(--cm-hl-operator)' },
  ])
);


// ============================================================
// 导出
// ============================================================

export const sushiMLLanguage = StreamLanguage.define(sushiMLParser);
