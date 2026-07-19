/**
 * Phase 5: 样式编辑面板
 *
 * 在 Studio 左侧栏新增"样式"标签页，让用户编辑 *.sushi-style
 * 暂不自动加载，由用户显式点击"应用样式"按钮。
 */

import { SushiMLStoryManager } from '../sushiml/bridge';
import { parseYamlStyle } from '../sushiml/styleParser';
import type { SushiStyle } from '../sushiml/types';

export class StylePanel {
  private container: HTMLElement;
  private editor: HTMLTextAreaElement;
  private applyBtn: HTMLElement;
  private storyManager: SushiMLStoryManager | null = null;
  private onApply: ((style: SushiStyle) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) || document.createElement('div');

    // 编辑器区
    this.editor = document.createElement('textarea');
    this.editor.id = 'style-editor';
    this.editor.className = 'style-editor';
    this.editor.placeholder = 'YAML 格式样式定义...\n\nglobal:\n  typewriter: 80ms\n\nwords:\n  sword: { color: "#ff6b6b" }\n\nmoods:\n  tense: { typewriter: 100ms }';
    this.editor.spellcheck = false;

    // 应用按钮
    this.applyBtn = document.createElement('button');
    this.applyBtn.textContent = '📄 应用样式';
    this.applyBtn.className = 'style-apply-btn';
    this.applyBtn.onclick = () => this.handleApply();

    // 组装面板
    const header = document.createElement('div');
    header.className = 'style-panel-header';
    header.textContent = '🎨 样式表';

    const controls = document.createElement('div');
    controls.className = 'style-panel-controls';
    controls.appendChild(this.applyBtn);

    this.container.appendChild(header);
    this.container.appendChild(this.editor);
    this.container.appendChild(controls);
  }

  setStoryManager(manager: SushiMLStoryManager): void {
    this.storyManager = manager;
  }

  onStyleApply(callback: (style: SushiStyle) => void): void {
    this.onApply = callback;
  }

  loadStyle(styleText: string): void {
    this.editor.value = styleText;
  }

  private handleApply(): void {
    try {
      const styleText = this.editor.value;
      const style = parseYamlStyle(styleText);

      // 通知监听者
      if (this.onApply) {
        this.onApply(style);
      }

      // 反馈用户
      this.applyBtn.textContent = '✓ 已应用';
      setTimeout(() => {
        this.applyBtn.textContent = '📄 应用样式';
      }, 2000);
    } catch (e) {
      console.error('样式解析错误:', e);
      this.applyBtn.textContent = '✗ 解析错误';
      setTimeout(() => {
        this.applyBtn.textContent = '📄 应用样式';
      }, 2000);
    }
  }

  updateStyle(style: SushiStyle): void {
    // 暂时不自动序列化回 YAML
    // （实际应用中可实现自动格式化）
  }
}
