/**
 * GlossaryPanel — 词汇表（消费 SushiML 的标记词）
 *
 * 监听 `sushi:sceneData` 事件，渲染**当前场景**中通过 `[[词]]` /
 * `[[词|注释]]` / `[[词]{relation: char}]` 标记的关键概念。
 *
 * 这是 B3 修复的核心：此前 `SceneRenderData.marks` 被计算出来却从未被
 * 任何 UI 消费（renderer 的 tooltip 只读 glyph 上的 annotation，不读此列表）。
 * 本面板把 `marks` / `directives.relation` / `isFirstOccurrence` 三个原本
 * 「算而不用」的字段真正用起来。
 *
 * - 词文本：标记词本身
 * - 关系徽章：词语级 `relation`（char 角色 / place 地点 / item 物品）
 * - 注释：行内 `[[词|注释]]` 的注释部分
 * - 重提标记：同一场景中非首次出现的重复提及（`isFirstOccurrence === false`）
 *
 * 点击某条 → 在编辑器跳转到所在场景（与大纲点击一致）。
 */

import type { SceneRenderData } from '../sushiml/bridge';

interface RelationMeta {
  label: string;
  className: string;
}

/** 词语级 relation 的展示元数据（对应 WordDirectives.relation） */
const RELATION_META: Record<string, RelationMeta> = {
  char: { label: '角色', className: 'rel-char' },
  place: { label: '地点', className: 'rel-place' },
  item: { label: '物品', className: 'rel-item' },
};

export class GlossaryPanel {
  private listEl: HTMLElement;
  private countEl: HTMLElement | null;
  private onSelect: (sceneId: string) => void;
  private currentSceneId: string = '';

  constructor(
    listEl: HTMLElement,
    countEl: HTMLElement | null,
    onSelect: (sceneId: string) => void
  ) {
    this.listEl = listEl;
    this.countEl = countEl;
    this.onSelect = onSelect;
    this.renderEmpty();
  }

  /** 场景数据更新时调用（监听 `sushi:sceneData`） */
  public update(data: SceneRenderData): void {
    this.currentSceneId = data.sceneId;
    this.render(data.marks);
  }

  private renderEmpty(): void {
    this.listEl.innerHTML =
      '<div class="glossary-empty">当前场景没有标记词。<br/>用 <code>[[词语]]</code> 或 <code>[[词语|注释]]</code> 标记关键概念。</div>';
    if (this.countEl) this.countEl.textContent = '0';
  }

  private render(
    marks: ReadonlyArray<SceneRenderData['marks'][number]>
  ): void {
    this.listEl.innerHTML = '';
    if (this.countEl) this.countEl.textContent = String(marks.length);

    if (marks.length === 0) {
      this.renderEmpty();
      return;
    }

    for (const m of marks) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'glossary-item';

      const head = document.createElement('div');
      head.className = 'glossary-head';

      const word = document.createElement('span');
      word.className = 'glossary-word';
      word.textContent = m.text;
      head.appendChild(word);

      const rel = m.directives?.relation;
      if (rel && RELATION_META[rel]) {
        const badge = document.createElement('span');
        badge.className = `glossary-badge ${RELATION_META[rel].className}`;
        badge.textContent = RELATION_META[rel].label;
        head.appendChild(badge);
      }

      // 重复提及（同场景中非首次出现的标记词）
      if (m.isFirstOccurrence === false) {
        const dup = document.createElement('span');
        dup.className = 'glossary-dup';
        dup.textContent = '重提';
        dup.title = '同一场景中该词的重复提及（首次出现外的其他提及）';
        head.appendChild(dup);
      }

      item.appendChild(head);

      if (m.annotation) {
        const note = document.createElement('span');
        note.className = 'glossary-note';
        note.textContent = m.annotation;
        item.appendChild(note);
      }

      item.addEventListener('click', () => this.onSelect(this.currentSceneId));
      this.listEl.appendChild(item);
    }
  }
}
