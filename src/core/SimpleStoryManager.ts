import { emitter } from './EventBus';
import { gameStore } from '../store/gameStore';
import type { InkState, StateChangeEvent } from '../types/ink';
import type { StoryNode } from '../stories/demoStory';

/**
 * 简化故事管理器（MVP 阶段）
 * 
 * 使用自定义故事数据结构替代 Ink.js 的复杂 JSON 格式。
 * 后续可替换为完整的 inkjs Story 接入。
 * 
 * 保留了变量 diff 机制的设计思路。
 */
export class SimpleStoryManager {
  private nodes: Record<string, StoryNode>;
  private currentNodeId: string;
  private prevMood: string = 'default';
  private prevSceneId: string = 'start';

  constructor(nodes: Record<string, StoryNode>, startNodeId: string = 'start') {
    this.nodes = nodes;
    this.currentNodeId = startNodeId;
  }

  /**
   * 获取当前节点并推进叙事
   */
  advance(): string | null {
    const node = this.nodes[this.currentNodeId];
    if (!node) {
      console.warn(`未找到故事节点: ${this.currentNodeId}`);
      return null;
    }

    // 构建 Ink 状态
    const inkState: InkState = {
      sceneId: node.id,
      mood: node.mood,
      currentText: node.text,
      choices: (node.choices || []).map((c, i) => ({
        index: i,
        text: c.text,
      })),
      variables: { mood: node.mood, scene: node.id },
      canContinue: false,
    };

    // 计算变更
    const changed: Record<string, unknown> = {};
    if (node.mood !== this.prevMood) {
      changed['mood'] = node.mood;
    }
    if (node.id !== this.prevSceneId) {
      changed['scene'] = node.id;
    }
    this.prevMood = node.mood;
    this.prevSceneId = node.id;

    // 更新全局状态
    gameStore.getState().setInkState(inkState);

    // 发送事件
    const event: StateChangeEvent = {
      state: inkState,
      changedVariables: changed,
    };
    emitter.emit('ink:stateChange', event);

    return node.text;
  }

  /**
   * 选择一个选项并跳转到目标节点
   */
  selectChoice(index: number): string | null {
    const node = this.nodes[this.currentNodeId];
    if (!node?.choices || index >= node.choices.length) {
      console.warn(`无效的选项索引: ${index}`);
      return null;
    }

    this.currentNodeId = node.choices[index].target;
    return this.advance();
  }

  /**
   * 获取当前节点
   */
  get currentNode(): StoryNode | undefined {
    return this.nodes[this.currentNodeId];
  }
}
