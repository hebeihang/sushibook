/**
 * Ink.js 叙事状态
 */
export interface InkState {
  /** 当前场景/章节 ID */
  sceneId: string;
  /** 当前情绪 */
  mood: string;
  /** 当前段落文本 */
  currentText: string;
  /** 可用选项 */
  choices: InkChoice[];
  /** 所有变量快照 */
  variables: Record<string, unknown>;
  /** 故事是否可以继续推进 */
  canContinue: boolean;
}

/**
 * Ink 选项
 */
export interface InkChoice {
  /** 选项索引 */
  index: number;
  /** 选项文本 */
  text: string;
}

/**
 * 状态变更事件
 */
export interface StateChangeEvent {
  /** 新的 Ink 状态 */
  state: InkState;
  /** 发生变化的变量 */
  changedVariables: Record<string, unknown>;
}
