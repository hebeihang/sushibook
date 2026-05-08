import { createStore } from 'zustand/vanilla';
import type { InkState, InkChoice } from '../types/ink';
import type { MoodType } from '../types/particle';

/**
 * 全局游戏状态
 */
export interface GameState {
  /** Ink 叙事状态 */
  ink: InkState;
  /** 系统就绪状态 */
  isReady: boolean;
  /** 当前使用的字体 */
  fontFamily: string;

  // Actions
  /** 更新 Ink 状态 */
  setInkState: (state: Partial<InkState>) => void;
  /** 设置系统就绪 */
  setReady: (ready: boolean) => void;
  /** 设置字体 */
  setFontFamily: (font: string) => void;
}

/**
 * 初始 Ink 状态
 */
const initialInkState: InkState = {
  sceneId: 'start',
  mood: 'default' satisfies MoodType,
  currentText: '',
  choices: [] as InkChoice[],
  variables: {},
  canContinue: false,
};

/**
 * 全局状态仓库（Vanilla Zustand，不依赖 React）
 */
export const gameStore = createStore<GameState>()((set) => ({
  ink: initialInkState,
  isReady: false,
  fontFamily: 'sans-serif',

  setInkState: (partial) =>
    set((state) => ({
      ink: { ...state.ink, ...partial },
    })),

  setReady: (ready) => set({ isReady: ready }),

  setFontFamily: (font) => set({ fontFamily: font }),
}));
