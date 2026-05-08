import mitt from 'mitt';
import type { StateChangeEvent } from '../types/ink';
import type { LayoutSnapshot } from '../types/layout';
import type { SceneRenderData } from '../sushiml/bridge';

/**
 * 事件类型映射
 */
export type EventMap = {
  /** Ink 状态变更 */
  'ink:stateChange': StateChangeEvent;
  /** 排版快照更新 */
  'layout:snapshotUpdate': LayoutSnapshot;
  /** SushiML 场景渲染数据 */
  'sushi:sceneData': SceneRenderData;
  /** 系统就绪 */
  'system:ready': void;
  /** 窗口 resize */
  'system:resize': { width: number; height: number };
};


/** 全局事件总线 */
export const emitter = mitt<EventMap>();

/**
 * 防抖包装器
 * 用于保护排版引擎免受快速连续触发
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delayMs: number
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
}
