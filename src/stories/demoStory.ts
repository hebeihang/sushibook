/**
 * 演示故事文本数据
 * 
 * 由于 Ink 的 JSON 格式复杂且难以手工编写，
 * MVP 阶段我们使用一个简化的故事数据结构，
 * 模拟 Ink 的分支叙事逻辑。
 * 
 * 后续可以接入 inklecate 编译器生成正式的 .ink.json
 */

export interface StoryNode {
  id: string;
  text: string;
  mood: 'default' | 'tense' | 'float';
  choices?: Array<{
    text: string;
    target: string;
  }>;
}

/**
 * 演示故事：文字的海洋
 */
export const DEMO_STORY: Record<string, StoryNode> = {
  start: {
    id: 'start',
    text: '在一片无边的数字海洋中，文字不再是静止的符号。它们像鱼群一样游动，像星辰一样呼吸。每一个字符都拥有自己的灵魂。',
    mood: 'default',
    choices: [
      { text: '探索深海', target: 'ocean' },
      { text: '仰望星空', target: 'sky' },
    ],
  },
  ocean: {
    id: 'ocean',
    text: '你潜入了深海。水波荡漾，文字在洋流中缓缓漂移。每一笔每一划都随着潮汐起伏，仿佛回到了文字诞生的最初。',
    mood: 'float',
    choices: [
      { text: '继续深潜', target: 'abyss' },
      { text: '浮出水面', target: 'surface' },
    ],
  },
  abyss: {
    id: 'abyss',
    text: '深渊之中，光线逐渐消失。文字在黑暗里震颤，仿佛有某种力量在拉扯它们。你感到一股无形的压力正在从四面八方挤压而来。',
    mood: 'tense',
    choices: [
      { text: '回到起点', target: 'start' },
    ],
  },
  surface: {
    id: 'surface',
    text: '你浮出了水面。阳光洒在字里行间，温暖而平静。文字在光芒中缓缓排列，重新找到了属于自己的位置。',
    mood: 'default',
    choices: [
      { text: '回到起点', target: 'start' },
    ],
  },
  sky: {
    id: 'sky',
    text: '你仰望星空。文字化作点点星光，在夜幕中闪烁。每一颗字星都在轻轻摇曳，编织着古老的传说。',
    mood: 'float',
    choices: [
      { text: '进入星云', target: 'nebula' },
      { text: '回到地面', target: 'start' },
    ],
  },
  nebula: {
    id: 'nebula',
    text: '星云深处暗流涌动。文字被引力撕扯，字形扭曲变形。宇宙的力量让一切都在颤抖，但美丽依然在混沌中绽放。',
    mood: 'tense',
    choices: [
      { text: '回到起点', target: 'start' },
    ],
  },
};
