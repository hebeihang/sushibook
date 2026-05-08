import { Story } from 'inkjs';
import { emitter } from './EventBus';
import { gameStore } from '../store/gameStore';
import type { InkState, InkChoice, StateChangeEvent } from '../types/ink';

/**
 * Ink.js 叙事管理器
 * 
 * 关键设计：
 * - inkjs 本身没有变量变更事件钩子
 * - 必须在每次 story.Continue() 后主动 diff 变量快照
 */
export class StoryManager {
  private story: Story;
  private prevVariables: Record<string, unknown> = {};

  constructor(storyJson: string | object) {
    // inkjs 接受 JSON 字符串或已解析的对象
    this.story = new Story(
      typeof storyJson === 'string' ? storyJson : JSON.stringify(storyJson)
    );
  }

  /**
   * 推进叙事到下一段
   * @returns 当前段落文本，如果无法继续则返回 null
   */
  advance(): string | null {
    if (!this.story.canContinue) {
      return null;
    }

    // 持续读取直到碰到选择或无法继续
    let fullText = '';
    while (this.story.canContinue) {
      const text = this.story.Continue();
      if (text) {
        fullText += text;
      }
    }

    // 主动 diff 变量（inkjs 无变量变更事件）
    const currentVars = this.snapshotVariables();
    const changed = this.diffVariables(this.prevVariables, currentVars);
    this.prevVariables = currentVars;

    // 获取情绪和场景 ID
    const mood = this.getVariable('mood') as string || 'default';
    const sceneId = this.getVariable('scene') as string || 'start';

    // 获取当前可用选项
    const choices = this.getChoices();

    // 更新全局状态
    const inkState: InkState = {
      sceneId,
      mood,
      currentText: fullText.trim(),
      choices,
      variables: currentVars,
      canContinue: this.story.canContinue,
    };

    gameStore.getState().setInkState(inkState);

    // 发送状态变更事件
    const event: StateChangeEvent = {
      state: inkState,
      changedVariables: changed,
    };
    emitter.emit('ink:stateChange', event);

    return fullText.trim();
  }

  /**
   * 选择一个选项并推进叙事
   */
  selectChoice(index: number): string | null {
    if (index < 0 || index >= this.story.currentChoices.length) {
      console.warn(`无效的选项索引: ${index}`);
      return null;
    }

    this.story.ChooseChoiceIndex(index);
    return this.advance();
  }

  /**
   * 获取当前可用选项
   */
  getChoices(): InkChoice[] {
    return this.story.currentChoices.map((choice) => ({
      index: choice.index,
      text: choice.text.trim(),
    }));
  }

  /**
   * 获取单个变量值
   */
  getVariable(name: string): unknown {
    try {
      return this.story.variablesState.$(name);
    } catch {
      return undefined;
    }
  }

  /**
   * 故事是否可以继续
   */
  get canContinue(): boolean {
    return this.story.canContinue;
  }

  /**
   * 是否有可选择的选项
   */
  get hasChoices(): boolean {
    return this.story.currentChoices.length > 0;
  }

  /**
   * 拍摄变量快照
   * inkjs 的 variablesState 需要通过 $ 方法访问
   */
  private snapshotVariables(): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    // inkjs v2.x 通过 _globalVariables 暴露变量名
    try {
      const globalVars = (this.story.variablesState as any)._globalVariables;
      if (globalVars && typeof globalVars.forEach === 'function') {
        globalVars.forEach((_value: unknown, key: string) => {
          vars[key] = this.story.variablesState.$(key);
        });
      }
    } catch (error) {
      console.warn('变量快照读取失败:', error);
    }
    return vars;
  }

  /**
   * Diff 两个变量快照
   */
  private diffVariables(
    prev: Record<string, unknown>,
    current: Record<string, unknown>
  ): Record<string, unknown> {
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(current)) {
      if (prev[key] !== current[key]) {
        changed[key] = current[key];
      }
    }
    return changed;
  }
}
