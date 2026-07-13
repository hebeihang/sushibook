/**
 * ChoiceUI — 故事选项按钮
 *
 * 监听 story:stateChange，渲染可点击的分支选项。
 */

import { emitter } from '../core/EventBus';
import type { StoryChoice } from '../types/story';

export class ChoiceUI {
  private container: HTMLElement;
  private onSelect: (index: number) => void;

  constructor(container: HTMLElement, onSelect: (index: number) => void) {
    this.container = container;
    this.onSelect = onSelect;

    emitter.on('story:stateChange', ({ state }) => {
      this.renderChoices(state.choices);
    });
  }

  private renderChoices(choices: StoryChoice[]): void {
    this.container.innerHTML = '';
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = choice.text;
      btn.addEventListener('click', () => this.onSelect(choice.index));
      this.container.appendChild(btn);
    }
  }

  public clear(): void {
    this.container.innerHTML = '';
  }
}
