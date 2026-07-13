/**
 * OutlinePanel — 节点大纲（Kiny Editor 风格）
 *
 * 列出所有场景（子场景缩进），显示入链计数「→n」，
 * 高亮当前场景；点击 → 编辑器定位 + 预览跳转。
 */

export interface OutlineEntry {
  id: string;
  /** 入链数（被多少处跳转指向） */
  incoming: number;
}

export class OutlinePanel {
  private listEl: HTMLElement;
  private countEl: HTMLElement | null;
  private onSelect: (sceneId: string) => void;
  private currentId: string = '';
  private entries: OutlineEntry[] = [];

  constructor(listEl: HTMLElement, countEl: HTMLElement | null, onSelect: (sceneId: string) => void) {
    this.listEl = listEl;
    this.countEl = countEl;
    this.onSelect = onSelect;
  }

  /** 重建大纲（applySource 成功后调用） */
  public update(entries: OutlineEntry[]): void {
    this.entries = entries;
    if (this.countEl) this.countEl.textContent = String(entries.length);
    this.render();
  }

  /** 高亮当前场景（story:stateChange 时调用） */
  public setCurrent(sceneId: string): void {
    if (this.currentId === sceneId) return;
    this.currentId = sceneId;
    this.listEl.querySelectorAll('.outline-item').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.id === sceneId);
    });
  }

  private render(): void {
    this.listEl.innerHTML = '';
    for (const entry of this.entries) {
      const isSub = entry.id.includes('.');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `outline-item${isSub ? ' sub' : ''}${entry.id === this.currentId ? ' active' : ''}`;
      item.dataset.id = entry.id;

      const dot = document.createElement('span');
      dot.className = 'outline-dot';
      dot.textContent = '◆';

      const name = document.createElement('span');
      name.className = 'outline-name';
      name.textContent = isSub ? entry.id.slice(entry.id.indexOf('.') + 1) : entry.id;

      const count = document.createElement('span');
      count.className = 'outline-count';
      count.textContent = `→${entry.incoming}`;
      count.title = `${entry.incoming} 处跳转指向此场景`;

      item.append(dot, name, count);
      item.addEventListener('click', () => this.onSelect(entry.id));
      this.listEl.appendChild(item);
    }
  }
}
