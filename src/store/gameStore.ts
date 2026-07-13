import { createStore } from 'zustand/vanilla';
import type { StoryState, StoryChoice } from '../types/story';
import type { MoodType } from '../types/particle';

/**
 * 全局游戏状态
 */
export interface GameState {
  /** 叙事状态 */
  story: StoryState;
  /** 系统就绪状态 */
  isReady: boolean;
  /** 当前使用的字体 */
  fontFamily: string;

  // Actions
  /** 更新叙事状态 */
  setStoryState: (state: Partial<StoryState>) => void;
  /** 设置系统就绪 */
  setReady: (ready: boolean) => void;
  /** 设置字体 */
  setFontFamily: (font: string) => void;
}

/**
 * 初始叙事状态
 */
const initialStoryState: StoryState = {
  sceneId: 'start',
  mood: 'default' satisfies MoodType,
  currentText: '',
  choices: [] as StoryChoice[],
  variables: {},
  canContinue: false,
};

/**
 * 全局状态仓库（Vanilla Zustand，不依赖 React）
 */
export const gameStore = createStore<GameState>()((set) => ({
  story: initialStoryState,
  isReady: false,
  fontFamily: 'sans-serif',

  setStoryState: (partial) =>
    set((state) => ({
      story: { ...state.story, ...partial },
    })),

  setReady: (ready) => set({ isReady: ready }),

  setFontFamily: (font) => set({ fontFamily: font }),
}));
