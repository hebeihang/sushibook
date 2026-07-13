/**
 * EditorPanel — CodeMirror 6 编辑器封装
 *
 * 职责：
 * 1. 初始化 CodeMirror 并挂载到容器
 * 2. SushiML 语法高亮
 * 3. 内容变化时 debounce 发射 EventBus 事件
 * 4. 暴露光标操作 API（供指令面板调用）
 */

import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { sushiMLLanguage, sushiMLHighlight } from './sushiMLLanguage';

// ============================================================
// 暗色编辑器主题
// ============================================================
const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#0e0e16',
    color: '#d4d4e0',
    fontSize: '13.5px',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Noto Sans SC', monospace",
    lineHeight: '1.65',
    padding: '16px 0',
    caretColor: '#6c5ce7',
  },
  '.cm-cursor': {
    borderLeftColor: '#6c5ce7',
    borderLeftWidth: '2px',
  },
  '.cm-gutters': {
    backgroundColor: '#0a0a12',
    color: '#444460',
    border: 'none',
    borderRight: '1px solid rgba(255,255,255,0.04)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
    color: '#6c5ce7',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(108, 92, 231, 0.04)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(108, 92, 231, 0.25) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(108, 92, 231, 0.3) !important',
  },
  '.cm-line': {
    padding: '0 16px',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '&.cm-focused': {
    outline: 'none',
  },
}, { dark: true });

// ============================================================
// EditorPanel
// ============================================================

export class EditorPanel {
  private view: EditorView;
  private onChange: (content: string) => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 500;

  constructor(container: HTMLElement, initialContent: string, onChange: (content: string) => void) {
    this.onChange = onChange;

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        sushiMLLanguage,
        sushiMLHighlight,
        darkTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.scheduleUpdate();
          }
        }),
      ],
    });

    this.view = new EditorView({ state, parent: container });
  }

  /** debounce 发射内容变更 */
  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.onChange(this.getContent());
    }, this.DEBOUNCE_MS);
  }

  /** 获取当前编辑器内容 */
  public getContent(): string {
    return this.view.state.doc.toString();
  }

  /** 设置编辑器内容（外部加载故事时） */
  public setContent(text: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
    });
  }

  /**
   * 在光标位置插入文本
   * 指令面板的核心 API
   */
  public insertAtCursor(text: string): void {
    const pos = this.view.state.selection.main.head;
    this.view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length },
    });
    this.view.focus();
  }

  /**
   * 用模板包裹选中文本
   * 例如：选中 "Billy" → 包裹为 [[Billy]]
   */
  public wrapSelection(before: string, after: string): void {
    const { from, to } = this.view.state.selection.main;
    const selected = this.view.state.sliceDoc(from, to);

    if (selected) {
      this.view.dispatch({
        changes: { from, to, insert: `${before}${selected}${after}` },
        selection: { anchor: from + before.length + selected.length + after.length },
      });
    } else {
      // 无选中：插入模板并将光标放在中间
      this.view.dispatch({
        changes: { from, insert: `${before}${after}` },
        selection: { anchor: from + before.length },
      });
    }
    this.view.focus();
  }

  /**
   * 跳转到场景声明行并滚动到视口中央
   * @param sceneId - 场景 ID（子场景为 父.子，按 ### 子名 定位）
   */
  public revealScene(sceneId: string): void {
    const dotIdx = sceneId.indexOf('.');
    const name = dotIdx === -1 ? sceneId : sceneId.slice(dotIdx + 1);
    const marker = dotIdx === -1 ? '##' : '###';
    const re = new RegExp(`^${marker}\\s+${escapeRegExp(name)}\\b`);

    const doc = this.view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (re.test(line.text)) {
        this.view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
        this.view.focus();
        return;
      }
    }
  }

  /** 销毁 */
  public destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.view.destroy();
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
