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
        description: '溶解进入（默认）：旧文字淡出后新文字飞入',
        action: (ed) => ed.insertAtCursor('enter: dissolve\n'),
      },
      {
        label: 'enter: fade-in',
        description: '淡入进入：新旧文字交叉淡入',
        action: (ed) => ed.insertAtCursor('enter: fade-in\n'),
      },
      {
        label: 'enter: typewriter',
        description: '打字机进入：新文字按阅读顺序级联出现',
        action: (ed) => ed.insertAtCursor('enter: typewriter\n'),
      },
      {
        label: 'speed: slow',
        description: '慢速（过渡时长 ×1.6）',
        action: (ed) => ed.insertAtCursor('speed: slow\n'),
      },
      {
        label: 'speed: fast',
        description: '快速（过渡时长 ×0.6）',
        action: (ed) => ed.insertAtCursor('speed: fast\n'),
      },
      {
        label: '### 子场景',
        description: '场景内分段；跳转用 -> 子名（同父内）或 -> 父.子',
        action: (ed) => ed.insertAtCursor('\n### 子场景名\n子场景内容。\n'),
      },
      {
        label: '-> 跳转',
        description: '独立跳转行（场景/子场景/END）',
        action: (ed) => ed.insertAtCursor('\n-> target_scene\n'),
      },
      {
        label: '@bg_show(…)',
        description: '显示背景：图片 URL、#颜色 或 CSS 渐变',
        action: (ed) => ed.insertAtCursor('@bg_show("linear-gradient(180deg, #0b1026, #05070f)")\n'),
      },
      {
        label: '@bgm_play(…)',
        description: '循环播放背景音乐',
        action: (ed) => ed.insertAtCursor('@bgm_play("assets/ambient.mp3")\n'),
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
        description: '从左侧飞入',
        action: (ed) => ed.insertAtCursor('{enter: fly-in-left}'),
      },
      {
        label: '{enter: rain}',
        description: '从天而降',
        action: (ed) => ed.insertAtCursor('{enter: rain}'),
      },
      {
        label: '{enter: flare}',
        description: '四周炸裂汇聚',
        action: (ed) => ed.insertAtCursor('{enter: flare}'),
      },
      {
        label: '{enter: sink}',
        description: '缓缓下沉',
        action: (ed) => ed.insertAtCursor('{enter: sink}'),
      },
      {
        label: '{enter: swim}',
        description: '左右游动',
        action: (ed) => ed.insertAtCursor('{enter: swim}'),
      },
      {
        label: '{enter: sparkle}',
        description: '星光闪烁',
        action: (ed) => ed.insertAtCursor('{enter: sparkle}'),
      },
      {
        label: '{enter: pull}',
        description: '引力拉扯',
        action: (ed) => ed.insertAtCursor('{enter: pull}'),
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
        label: '>> 选项 -> 目标',
        description: '粘性选项（可重复选）',
        action: (ed) => ed.insertAtCursor('\n>> 选项文字 -> target_scene\n'),
      },
      {
        label: '* 选项 -> 目标',
        description: '一次性选项（选过即消失）',
        action: (ed) => ed.insertAtCursor('\n* 选项文字 -> target_scene\n'),
      },
      {
        label: '>> 选项 -> END',
        description: '结局选项（显示结束画面）',
        action: (ed) => ed.insertAtCursor('\n>> 合上书页 -> END\n'),
      },
    ],
  },
  {
    id: 'logic',
    label: '逻辑',
    icon: '🧮',
    items: [
      {
        label: '// 注释',
        description: '整行注释，不参与输出',
        action: (ed) => ed.insertAtCursor('// '),
      },
      {
        label: '~ let 变量 = 值',
        description: '声明全局变量（放在第一个 ## 之前）或场景变量',
        action: (ed) => ed.insertAtCursor('~ let gold = 10\n'),
      },
      {
        label: '~ 赋值',
        description: '进入场景时执行的赋值语句',
        action: (ed) => ed.insertAtCursor('~ gold = gold + 1\n'),
      },
      {
        label: '{变量} 插值',
        description: '把 JS 表达式的值插入正文',
        action: (ed) => ed.insertAtCursor('{gold}'),
      },
      {
        label: '{cond ? "A" : "B"}',
        description: '行内条件文本（JS 三元表达式）',
        action: (ed) => ed.insertAtCursor('{gold >= 5 ? "富有" : "拮据"}'),
      },
      {
        label: '>> {条件} 选项',
        description: '条件选项：条件为假时隐藏',
        action: (ed) => ed.insertAtCursor('\n>> {gold >= 5} 买下它 -> shop\n'),
      },
      {
        label: '>> (标签) 选项',
        description: '选项标签：自动计数选中次数，条件/插值中用 {标签} 读取',
        action: (ed) => ed.insertAtCursor('\n>> (greet) 问候他\n> "你好。"\n'),
      },
      {
        label: '{seq:A|B|C}',
        description: '依次推进，停在最后一项（按场景访问次数）',
        action: (ed) => ed.insertAtCursor('{seq:第一次。|第二次。|之后都是这句。}'),
      },
      {
        label: '{cycle:A|B|C}',
        description: '循环轮换',
        action: (ed) => ed.insertAtCursor('{cycle:白天。|黄昏。|夜晚。}'),
      },
      {
        label: '{once:A|B}',
        description: '依次输出，用完为空',
        action: (ed) => ed.insertAtCursor('{once:只在第一次显示。|只在第二次显示。}'),
      },
      {
        label: '{shuffle:A|B|C}',
        description: '每次访问随机取一项（确定性随机）',
        action: (ed) => ed.insertAtCursor('{shuffle:选项甲。|选项乙。|选项丙。}'),
      },
      {
        label: '@if / @else 条件段',
        description: '条件为真才追加的叙事段（体用 > 层级）',
        action: (ed) => ed.insertAtCursor('\n@if {gold >= 5}\n> 条件为真时显示。\n@else\n> 否则显示这句。\n'),
      },
      {
        label: '选项分支体',
        description: '选中后追加局部叙事，之后汇合（调查循环）',
        action: (ed) => ed.insertAtCursor('\n* 凑近细看\n> 选中后追加的文字。\n> 可以多行。\n>> 继续 -> next_scene\n'),
      },
      {
        label: '<> 粘连',
        description: '行尾粘连：下一句不换行直接接上',
        action: (ed) => ed.insertAtCursor('<>'),
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
