/**
 * SushiML 故事管理器
 * 
 * 替换 SimpleStoryManager，作为 SushiML → 管线 的桥接层。
 * 
 * 职责：
 * 1. 解析 .sushi 源文本为 AST
 * 2. 管理场景导航
 * 3. 提取纯文本 + 字符元数据 供 LayoutEngine 消费
 * 4. 向事件总线发送状态变更
 */

import { parseSushiML, extractTextAndMeta } from './parser';
import { emitter } from '../core/EventBus';
import { gameStore } from '../store/gameStore';
import type { SushiDocument, SushiScene, CharMeta, SceneDirectives, SentenceDirectives, MarkedToken } from './types';
import type { InkState, StateChangeEvent } from '../types/ink';

/**
 * 场景渲染数据
 * 包含纯文本（给 LayoutEngine）和元数据（给 Renderer）
 */
export interface SceneRenderData {
  /** 纯文本（去除所有标注） */
  plainText: string;
  /** 字符级元数据映射 */
  charMeta: CharMeta[];
  /** 场景 ID */
  sceneId: string;
  /** 场景级指令 */
  sceneDirectives: SceneDirectives;
  /** 各句子的指令 */
  sentenceDirectives: SentenceDirectives[];
  /** 标记词语列表 */
  marks: Array<{
    text: string;
    annotation?: string;
    directives: Record<string, string | undefined>;
    markIndex: number;
  }>;
}

export class SushiMLStoryManager {
  private document: SushiDocument;
  private currentSceneId: string;
  private prevSceneId: string = '';
  private prevMood: string = '';

  constructor(source: string) {
    this.document = parseSushiML(source);

    // 默认从第一个场景开始
    if (this.document.sceneOrder.length === 0) {
      throw new Error('SushiML 文档中未找到任何场景');
    }
    this.currentSceneId = this.document.sceneOrder[0];
  }

  /**
   * 推进叙事：读取当前场景并发送事件
   */
  advance(): string | null {
    const scene = this.document.scenes.get(this.currentSceneId);
    if (!scene) {
      console.warn(`未找到场景: ${this.currentSceneId}`);
      return null;
    }

    const renderData = this.buildRenderData(scene);
    const mood = scene.frontmatter.mood || 'default';

    // 构建 InkState 兼容结构
    const inkState: InkState = {
      sceneId: scene.id,
      mood,
      currentText: renderData.plainText,
      choices: scene.choices.map((c, i) => ({ index: i, text: c.text })),
      variables: { mood, scene: scene.id },
      canContinue: false,
    };

    // 变量 diff
    const changed: Record<string, unknown> = {};
    if (mood !== this.prevMood) changed['mood'] = mood;
    if (scene.id !== this.prevSceneId) changed['scene'] = scene.id;
    this.prevMood = mood;
    this.prevSceneId = scene.id;

    // 更新全局状态
    gameStore.getState().setInkState(inkState);

    // 发送状态变更（附带 SushiML 渲染元数据）
    const event: StateChangeEvent = {
      state: inkState,
      changedVariables: changed,
    };
    emitter.emit('ink:stateChange', event);

    // 同时发送 SushiML 专用的渲染数据
    emitter.emit('sushi:sceneData', renderData);

    return renderData.plainText;
  }

  /**
   * 选择选项并跳转场景
   */
  selectChoice(index: number): string | null {
    const scene = this.document.scenes.get(this.currentSceneId);
    if (!scene?.choices[index]) {
      console.warn(`无效的选项索引: ${index}`);
      return null;
    }

    this.currentSceneId = scene.choices[index].target;
    return this.advance();
  }

  /**
   * 获取当前场景的渲染数据
   */
  getCurrentRenderData(): SceneRenderData | null {
    const scene = this.document.scenes.get(this.currentSceneId);
    if (!scene) return null;
    return this.buildRenderData(scene);
  }

  /**
   * 获取所有场景 ID
   */
  get sceneIds(): string[] {
    return this.document.sceneOrder;
  }

  /**
   * 构建场景渲染数据
   */
  private buildRenderData(scene: SushiScene): SceneRenderData {
    const { plainText, charMeta } = extractTextAndMeta(scene);

    // 收集句子级指令
    const sentenceDirectives = scene.sentences.map((s) => s.directives);

    // 收集标记词语
    const marks: SceneRenderData['marks'] = [];
    for (const sentence of scene.sentences) {
      for (const token of sentence.tokens) {
        if (token.type === 'marked') {
          const marked = token as MarkedToken;
          marks.push({
            text: marked.text,
            annotation: marked.annotation,
            directives: marked.directives,
            markIndex: marked.markIndex,
          });
        }
      }
    }

    return {
      plainText,
      charMeta,
      sceneId: scene.id,
      sceneDirectives: scene.frontmatter,
      sentenceDirectives,
      marks,
    };
  }
}
