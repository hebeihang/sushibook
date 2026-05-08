/**
 * DirectivePanel — 指令面板
 *
 * 三个 Tab：段落指令 / 句子指令 / 词语指令
 * 点击指令按钮 → 在 EditorPanel 光标位置插入模板
 */

import type { EditorPanel } from './EditorPanel';

// ============================================================
// 指令定义
// ============================================================

interface DirectiveItem {
  label: string;
  description: string;
  action: (editor: EditorPanel) => void;
}

interface DirectiveGroup {
  id: string;
  label: string;
  icon: string;
  items: DirectiveItem[];
}

const DIRECTIVE_GROUPS: DirectiveGroup[] = [
  {
    id: 'scene',
    label: '段落',
    icon: '📄',
    items: [
      {
        label: '新场景',
        description: '插入完整场景模板',
        action: (ed) => ed.insertAtCursor(
          '\n## new_scene\n---\nmood: default\n---\n在这里写场景内容。\n\n>> 选项一 -> target1\n>> 选项二 -> target2\n'
        ),
      },
      {
        label: 'mood: default',
        description: '平静情绪',
        action: (ed) => ed.insertAtCursor('mood: default\n'),
      },
      {
        label: 'mood: tense',
        description: '紧张情绪',
        action: (ed) => ed.insertAtCursor('mood: tense\n'),
      },
      {
        label: 'mood: float',
        description: '梦幻情绪',
        action: (ed) => ed.insertAtCursor('mood: float\n'),
      },
      {
        label: 'enter: dissolve',
        description: '溶解进入',
        action: (ed) => ed.insertAtCursor('enter: dissolve\n'),
      },
      {
        label: 'speed: slow',
        description: '慢速渲染',
        action: (ed) => ed.insertAtCursor('speed: slow\n'),
      },
    ],
  },
  {
    id: 'sentence',
    label: '句子',
    icon: '✏️',
    items: [
      {
        label: '{typewriter: 60ms}',
        description: '逐字出现（正常速度）',
        action: (ed) => ed.insertAtCursor('{typewriter: 60ms}'),
      },
      {
        label: '{typewriter: 100ms}',
        description: '逐字出现（慢速）',
        action: (ed) => ed.insertAtCursor('{typewriter: 100ms}'),
      },
      {
        label: '{pause: 800}',
        description: '本句后停顿 800ms',
        action: (ed) => ed.insertAtCursor('{pause: 800}'),
      },
      {
        label: '{pause: 1200}',
        description: '本句后长停顿',
        action: (ed) => ed.insertAtCursor('{pause: 1200}'),
      },
      {
        label: '{pause-before: 500}',
        description: '本句前等待 500ms',
        action: (ed) => ed.insertAtCursor('{pause-before: 500}'),
      },
      {
        label: '{flash: 2}',
        description: '闪烁 2 次',
        action: (ed) => ed.insertAtCursor('{flash: 2}'),
      },
      {
        label: '{size: 2x}',
        description: '放大 2 倍',
        action: (ed) => ed.insertAtCursor('{size: 2x}'),
      },
    ],
  },
  {
    id: 'word',
    label: '词语',
    icon: '🏷️',
    items: [
      {
        label: '[[标记]]',
        description: '标记选中词语',
        action: (ed) => ed.wrapSelection('[[', ']]'),
      },
      {
        label: '[[词语|注释]]',
        description: '带注释的标记',
        action: (ed) => ed.wrapSelection('[[', '|注释文字]]'),
      },
      {
        label: '{enter: fly-in-left}',
        description: '飞入效果',
        action: (ed) => ed.insertAtCursor('{enter: fly-in-left}'),
      },
      {
        label: '{enter: sink}',
        description: '下沉效果',
        action: (ed) => ed.insertAtCursor('{enter: sink}'),
      },
      {
        label: '{color: #ff6b6b}',
        description: '红色强调',
        action: (ed) => ed.insertAtCursor('{color: #ff6b6b}'),
      },
      {
        label: '{color: #6c5ce7}',
        description: '紫色强调',
        action: (ed) => ed.insertAtCursor('{color: #6c5ce7}'),
      },
      {
        label: '{relation: char}',
        description: '角色类型',
        action: (ed) => ed.insertAtCursor('{relation: char}'),
      },
      {
        label: '{glossary: true}',
        description: '词汇注释',
        action: (ed) => ed.insertAtCursor('{glossary: true}'),
      },
      {
        label: '>> 选项 -> 目标',
        description: '插入选项行',
        action: (ed) => ed.insertAtCursor('\n>> 选项文字 -> target_scene\n'),
      },
    ],
  },
];

// ============================================================
// DOM 构建
// ============================================================

export class DirectivePanel {
  private container: HTMLElement;
  private editor: EditorPanel | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  /** 绑定编辑器实例 */
  public setEditor(editor: EditorPanel): void {
    this.editor = editor;
  }

  private render(): void {
    this.container.innerHTML = '';

    // Tab 头
    const tabBar = document.createElement('div');
    tabBar.className = 'dp-tab-bar';

    // Tab 内容容器
    const tabContent = document.createElement('div');
    tabContent.className = 'dp-tab-content';

    DIRECTIVE_GROUPS.forEach((group, idx) => {
      // Tab 按钮
      const tabBtn = document.createElement('button');
      tabBtn.className = `dp-tab-btn ${idx === 0 ? 'active' : ''}`;
      tabBtn.textContent = `${group.icon} ${group.label}`;
      tabBtn.dataset.tab = group.id;
      tabBtn.addEventListener('click', () => {
        // 切换 active
        tabBar.querySelectorAll('.dp-tab-btn').forEach((b) => b.classList.remove('active'));
        tabBtn.classList.add('active');
        tabContent.querySelectorAll('.dp-tab-pane').forEach((p) => (p as HTMLElement).style.display = 'none');
        const pane = tabContent.querySelector(`[data-pane="${group.id}"]`) as HTMLElement;
        if (pane) pane.style.display = 'flex';
      });
      tabBar.appendChild(tabBtn);

      // Tab 面板
      const pane = document.createElement('div');
      pane.className = 'dp-tab-pane';
      pane.dataset.pane = group.id;
      pane.style.display = idx === 0 ? 'flex' : 'none';

      for (const item of group.items) {
        const btn = document.createElement('button');
        btn.className = 'dp-directive-btn';
        btn.title = item.description;
        btn.innerHTML = `<code>${item.label}</code>`;
        btn.addEventListener('click', () => {
          if (this.editor) item.action(this.editor);
        });
        pane.appendChild(btn);
      }

      tabContent.appendChild(pane);
    });

    this.container.appendChild(tabBar);
    this.container.appendChild(tabContent);
  }
}
