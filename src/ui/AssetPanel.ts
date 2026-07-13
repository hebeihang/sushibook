/**
 * AssetPanel — 资产管理器（Kiny Editor 风格）
 *
 * 浏览器 Studio 没有文件系统，资产 = 命名的 URL 引用
 * （图片/音频链接、#颜色、CSS 渐变），存 localStorage。
 * 点击资产 → 在编辑器光标处插入对应的 @bg_show / @bgm_play 命令。
 */

export interface AssetEntry {
  name: string;
  value: string;
  type: 'image' | 'audio';
}

const STORAGE_KEY = 'sushibook_assets';

const DEFAULT_ASSETS: AssetEntry[] = [
  { name: '雾夜渐变', value: 'linear-gradient(180deg, #0b1026, #05070f)', type: 'image' },
  { name: '深海渐变', value: 'linear-gradient(180deg, #04263a, #020c14)', type: 'image' },
];

export class AssetPanel {
  private listEl: HTMLElement;
  private assets: AssetEntry[];
  private onInsert: (snippet: string) => void;

  constructor(listEl: HTMLElement, addBtn: HTMLElement, onInsert: (snippet: string) => void) {
    this.listEl = listEl;
    this.onInsert = onInsert;
    this.assets = this.load();

    addBtn.addEventListener('click', () => this.promptAdd());
    this.render();
  }

  private load(): AssetEntry[] {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as AssetEntry[];
    } catch { /* ignore */ }
    return [...DEFAULT_ASSETS];
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.assets));
  }

  private promptAdd(): void {
    const value = window.prompt('资产地址（图片/音频 URL、#颜色 或 CSS 渐变）：');
    if (!value?.trim()) return;
    const name = window.prompt('资产名称：', value.slice(0, 24)) || value.slice(0, 24);
    const isAudio = /\.(mp3|ogg|wav|m4a|flac)(\?|#|$)/i.test(value);
    this.assets.push({ name: name.trim(), value: value.trim(), type: isAudio ? 'audio' : 'image' });
    this.save();
    this.render();
  }

  private remove(index: number): void {
    this.assets.splice(index, 1);
    this.save();
    this.render();
  }

  private render(): void {
    this.listEl.innerHTML = '';
    if (this.assets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'asset-empty';
      empty.textContent = '暂无资产，点 + 添加';
      this.listEl.appendChild(empty);
      return;
    }

    this.assets.forEach((asset, i) => {
      const item = document.createElement('div');
      item.className = 'asset-item';

      const icon = document.createElement('span');
      icon.className = 'asset-icon';
      icon.textContent = asset.type === 'audio' ? '🎵' : '🖼';

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'asset-name';
      name.textContent = asset.name;
      name.title = `点击插入：${asset.value}`;
      name.addEventListener('click', () => {
        const cmd = asset.type === 'audio'
          ? `@bgm_play("${asset.value}")\n`
          : `@bg_show("${asset.value}")\n`;
        this.onInsert(cmd);
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'asset-del';
      del.textContent = '✕';
      del.title = '删除资产';
      del.addEventListener('click', () => this.remove(i));

      item.append(icon, name, del);
      this.listEl.appendChild(item);
    });
  }
}
