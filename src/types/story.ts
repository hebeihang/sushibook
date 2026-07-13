/**
 * 叙事状态类型
 *
 * 与具体叙事引擎解耦：由 SushiMLStoryManager 产出，
 * 供 gameStore / EventBus / Renderer 消费。
 */
export interface StoryState {
  /** 当前场景/章节 ID */
  sceneId: string;
  /** 当前情绪 */
  mood: string;
  /** 当前段落文本 */
  currentText: string;
  /** 可用选项 */
  choices: StoryChoice[];
  /** 所有变量快照 */
  variables: Record<string, unknown>;
  /** 故事是否可以继续推进 */
  canContinue: boolean;
}

/**
 * 故事选项
 */
export interface StoryChoice {
  /** 选项索引 */
  index: number;
  /** 选项文本 */
  text: string;
}

/**
 * 状态变更事件
 */
export interface StateChangeEvent {
  /** 新的叙事状态 */
  state: StoryState;
  /** 发生变化的变量 */
  changedVariables: Record<string, unknown>;
}
