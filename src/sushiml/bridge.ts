/**
 * SushiML 故事管理器
 *
 * SushiML → 渲染管线 的桥接层 + 有状态执行引擎（Kiny 风格顺序模型）。
 *
 * 执行模型（追加式推进）：
 * - 场景体是 SceneItem 顺序流，帧栈逐项执行
 * - 句子在执行时求值（插值/变体），追加进显示缓冲
 * - 遇到可见选项组暂停等待；选中后执行分支体（文字追加），执行完汇合继续
 * - -> 目标 跳转清空缓冲进入新场景（跨场景 = 溶解重建）
 * - -> END 结局画面 + 重新开始
 */

import { parseSushiML, resolveSentence } from './parser';
import { execStatement, evalExpression, evalToText, evalCondition, deterministicIndex, type VarTable } from './evaluator';
import { emitter } from '../core/EventBus';
import { gameStore } from '../store/gameStore';
import type {
  SushiDocument,
  SushiScene,
  SushiChoice,
  SceneItem,
  CharMeta,
  SceneDirectives,
  SentenceDirectives,
  ExprToken,
  VariantToken,
} from './types';
import { END_TARGET, KNOWN_COMMANDS } from './types';
import type { StoryState, StateChangeEvent } from '../types/story';

/**
 * 场景渲染数据
 */
export interface SceneRenderData {
  /** 纯文本（插值/变体已求值；句间 \n，粘连句直接相接） */
  plainText: string;
  /** 字符级元数据映射（字素级，与 plainText 对齐） */
  charMeta: CharMeta[];
  /** 场景 ID */
  sceneId: string;
  /** 场景级指令 */
  sceneDirectives: SceneDirectives;
  /** 各显示句子的指令（索引 = charMeta.sentenceIndex） */
  sentenceDirectives: SentenceDirectives[];
  /** 标记词语列表 */
  marks: Array<{
    text: string;
    annotation?: string;
    directives: Record<string, string | undefined>;
    markIndex: number;
    /** 同场景中该文本首次出现时为 true（其余重复提及为 false） */
    isFirstOccurrence: boolean;
  }>;
}

/** 已求值的显示句子（追加缓冲的单元） */
interface DisplaySentence {
  text: string;
  charMeta: CharMeta[];
  directives: SentenceDirectives;
  glueAfter: boolean;
}

/** 执行帧 */
interface ExecFrame {
  items: SceneItem[];
  index: number;
}

/** 结局伪场景 ID */
export const END_SCENE_ID = 'END';
const END_SCREEN_TEXT = '· 完 ·';
const RESTART_CHOICE_TEXT = '↻ 重新开始';
const RESUME_CHOICE_PREFIX = '↩ 回到「';
const RESUME_CHOICE_SUFFIX = '」继续探索';

export class SushiMLStoryManager {
  private document: SushiDocument;
  private currentSceneId: string;
  private prevSceneId: string = '';
  private prevMood: string = '';

  // ---- 运行时状态 ----
  private vars: VarTable = {};
  private visits: Map<string, number> = new Map();
  private chosenOnce: Set<string> = new Set();
  private ended: boolean = false;

  // ---- 场景执行状态 ----
  private frames: ExecFrame[] = [];
  private buffer: DisplaySentence[] = [];
  private pendingChoices: Array<{ choice: SushiChoice; key: string }> = [];
  /** 当前场景内已遇到的选项组序号（once key 的稳定成分） */
  private groupCounter: number = 0;
  /**
   * 最近一次呈现的选项组（重新武装用）：
   * 分支体汇合后若场景已无新停点，重新呈现该组（once 已选项过滤），
   * 形成「调查循环」——反复查看线索直到选择带跳转的选项。
   */
  private lastGroup: { choices: SushiChoice[]; groupNo: number } | null = null;

  constructor(source: string) {
    this.document = parseSushiML(source);
    if (this.document.sceneOrder.length === 0) {
      throw new Error('SushiML 文档中未找到任何场景');
    }
    this.installBuiltins();
    this.runPrelude(false);
    this.registerLabels(false);
    this.currentSceneId = this.document.sceneOrder[0];
    this.enterFlow(this.currentSceneId, false);
  }

  /**
   * 注册选项标签为自动计数全局变量（Kiny §5.5）
   * @param preserve - 热重载模式：已存在的计数保留
   */
  private registerLabels(preserve: boolean): void {
    const seen = new Set<string>();
    for (const scene of this.document.scenes.values()) {
      walkItems(scene.items, (item) => {
        if (item.kind !== 'choices') return;
        for (const choice of item.choices) {
          if (!choice.label) continue;
          if (seen.has(choice.label)) {
            throw new Error(`选项标签重复: (${choice.label})`);
          }
          seen.add(choice.label);
          const exists = Object.prototype.hasOwnProperty.call(this.vars, choice.label);
          if (exists && !preserve) {
            throw new Error(`选项标签与变量重名: ${choice.label}`);
          }
          if (!exists) {
            this.vars[choice.label] = 0;
          }
        }
      });
    }
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 热重载：保留变量/访问计数/once 状态，确定性重放当前场景
   * （重放不推进访问计数、不执行 ~ 逻辑行，保证反复编辑时状态稳定）
   */
  reload(source: string): void {
    this.document = parseSushiML(source);
    if (this.document.sceneOrder.length === 0) {
      throw new Error('SushiML 文档中未找到任何场景');
    }
    this.runPrelude(true);
    this.registerLabels(true);
    if (this.ended) return;
    const target = this.document.scenes.has(this.currentSceneId)
      ? this.currentSceneId
      : this.document.sceneOrder[0];
    this.enterFlow(target, true);
  }

  /**
   * 重新开始：清空全部运行时状态，回到第一个场景
   */
  restart(): string | null {
    this.vars = {};
    this.visits.clear();
    this.chosenOnce.clear();
    this.ended = false;
    this.prevSceneId = '';
    this.prevMood = '';
    this.installBuiltins();
    this.runPrelude(false);
    this.registerLabels(false);
    this.enterFlow(this.document.sceneOrder[0], false);
    return this.advance();
  }

  private runPrelude(declareIfMissing: boolean): void {
    for (const stmt of this.document.prelude) {
      execStatement(stmt, this.vars, { declareIfMissing });
    }
  }

  private installBuiltins(): void {
    this.vars['visits'] = (sceneId: string): number => this.visits.get(sceneId) ?? 0;
  }

  // ============================================================
  // 执行引擎
  // ============================================================

  /** 进入场景并执行到第一个停点（选项组 / 场景耗尽 / 跳转出去） */
  private enterFlow(sceneId: string, replay: boolean): void {
    this.prepareScene(sceneId, replay);
    this.runUntilStop(replay);
  }

  private prepareScene(sceneId: string, replay: boolean): void {
    this.currentSceneId = sceneId;
    this.ended = false;
    if (!replay) {
      this.visits.set(sceneId, (this.visits.get(sceneId) ?? 0) + 1);
    }
    this.buffer = [];
    this.pendingChoices = [];
    this.groupCounter = 0;
    this.lastGroup = null;
    const scene = this.document.scenes.get(sceneId);
    this.frames = scene ? [{ items: scene.items, index: 0 }] : [];
  }

  /**
   * 帧栈执行循环
   * @param replay - 重放模式：跳过 ~ 逻辑行（避免副作用重复），其余照常
   */
  private runUntilStop(replay: boolean): void {
    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1];
      if (frame.index >= frame.items.length) {
        this.frames.pop();
        continue;
      }
      const item = frame.items[frame.index++];

      switch (item.kind) {
        case 'sentence': {
          const resolved = resolveSentence(item.sentence, this.buffer.length, (t) =>
            this.resolveToken(t, this.currentSceneId)
          );
          this.buffer.push({
            text: resolved.text,
            charMeta: resolved.charMeta,
            directives: item.sentence.directives,
            glueAfter: item.sentence.glueAfter,
          });
          break;
        }

        case 'logic':
          if (!replay) {
            execStatement(item.code, this.vars);
          }
          break;

        case 'command': {
          if (!KNOWN_COMMANDS.has(item.name)) {
            console.warn(`未知命令: @${item.name}`);
            break;
          }
          const args = this.evalCommandArgs(item.argsSource);
          emitter.emit('host:command', { name: item.name, args });
          break;
        }

        case 'divert': {
          if (item.target === END_TARGET) {
            this.ended = true;
            this.frames = [];
            this.pendingChoices = [];
            return;
          }
          const resolved = this.resolveTarget(item.target);
          if (!resolved) {
            console.warn(`跳转目标不存在: ${item.target}`);
            this.frames = [];
            return;
          }
          // 跨场景跳转：重置缓冲进入新场景（不递归，直接换帧）
          // 关键修复 B6：replay 模式下保持 replay，避免热重载期间目标场景 visits 被反复 +1
          this.prepareScene(resolved, replay);
          continue;
        }

        case 'if': {
          for (const branch of item.branches) {
            if (branch.condition === null || evalCondition(branch.condition, this.vars)) {
              this.frames.push({ items: branch.body, index: 0 });
              break;
            }
          }
          break;
        }

        case 'choices': {
          const groupNo = this.groupCounter++;
          const visible = this.filterVisible(item.choices, groupNo);
          if (visible.length > 0) {
            this.pendingChoices = visible;
            this.lastGroup = { choices: item.choices, groupNo };
            return; // 停点：等待选择
          }
          // 全部不可见：跳过选项组，汇合继续（Kiny 后备语义）
          break;
        }
      }
    }

    // 帧栈耗尽且无新停点：重新武装最近的选项组（调查循环）
    if (!this.ended && this.pendingChoices.length === 0 && this.lastGroup) {
      const visible = this.filterVisible(this.lastGroup.choices, this.lastGroup.groupNo);
      if (visible.length > 0) {
        this.pendingChoices = visible;
      }
    }
  }

  /** 选项可见性过滤：once 已选 / 条件为假 → 隐藏 */
  private filterVisible(
    choices: SushiChoice[],
    groupNo: number
  ): Array<{ choice: SushiChoice; key: string }> {
    const visible: Array<{ choice: SushiChoice; key: string }> = [];
    choices.forEach((choice, idx) => {
      const key = `${this.currentSceneId}::g${groupNo}::${idx}`;
      if (choice.once && this.chosenOnce.has(key)) return;
      if (choice.condition && !evalCondition(choice.condition, this.vars)) return;
      visible.push({ choice, key });
    });
    return visible;
  }

  /**
   * 求值命令实参（逗号分隔的 JS 表达式列表）。
   * 失败时不再抛出——降级为把整段原始参数作为单个字符串下发，由 HostEffects 自行解析。
   * 这样未加引号的命令（如 @bg_show(linear-gradient(180deg, #0b1026, #05070f))、
   * 裸颜色值 @bg_show(#0b1026)）不会让执行流崩溃（bug B5）。
   */
  private evalCommandArgs(argsSource: string): unknown[] {
    const src = argsSource.trim();
    if (!src) return [];
    // 优先按 JS 表达式求值（兼容数字、带引号字符串、数组等）
    try {
      const result = evalExpression(`[${src}]`, this.vars);
      return Array.isArray(result) ? result : [result];
    } catch {
      // 降级：覆盖「裸 CSS 渐变 / 图片 URL / 裸颜色值」等常见用例
      return [src];
    }
  }

  /**
   * 目标解析：绝对 id → 同父子场景 → 跨父全局回退。
   * B11 修复：相对解析排除"解析回当前场景自身"，避免子场景内 `-> <自身名>` 形成自跳转死循环；
   * 相对解析失败时回退到其它父下同名子场景，支持跨父绝对寻址。
   */
  private resolveTarget(target: string): string | null {
    // 1. 精确匹配（绝对 id）
    if (this.document.scenes.has(target)) return target;
    // 2. 相对：当前父.目标（排除解析回自身，避免自跳转死循环）
    const parent = this.currentSceneId.split('.')[0];
    const candidate = `${parent}.${target}`;
    if (this.document.scenes.has(candidate) && candidate !== this.currentSceneId) return candidate;
    // 3. 全局回退：查找其它父下同名子场景（排除自身），缓解跨父同名无绝对寻址
    for (const id of this.document.sceneOrder) {
      if (id === this.currentSceneId) continue;
      const leaf = id.split('.').pop();
      if (leaf === target && this.document.scenes.has(id)) return id;
    }
    return null;
  }

  // ============================================================
  // 导航
  // ============================================================

  /**
   * 推进叙事：发送当前缓冲（或结局画面）。幂等，不推进执行。
   */
  advance(): string | null {
    if (this.ended) {
      return this.emitEndScreen();
    }
    const scene = this.document.scenes.get(this.currentSceneId);
    if (!scene) {
      console.warn(`未找到场景: ${this.currentSceneId}`);
      return null;
    }
    const renderData = this.buildRenderData(scene);
    const mood = scene.frontmatter.mood || 'default';

    const storyState: StoryState = {
      sceneId: scene.id,
      mood,
      currentText: renderData.plainText,
      choices: this.pendingChoices.map((vc, i) => ({ index: i, text: vc.choice.text })),
      variables: { ...this.variables, mood, scene: scene.id },
      canContinue: false,
    };

    this.emitState(storyState, renderData);
    return renderData.plainText;
  }

  /**
   * 选择选项：执行分支体（文字追加）→ 汇合或跳转
   * @param index - 可见选项列表中的索引
   */
  selectChoice(index: number): string | null {
    if (this.ended) {
      // 结局画面：0 = 重新开始（清档）；1 = 回到结局前场景继续探索（不清档）
      if (index === 1 && this.document.scenes.has(this.currentSceneId)) {
        this.enterFlow(this.currentSceneId, false);
        return this.advance();
      }
      return this.restart();
    }

    const picked = this.pendingChoices[index];
    if (!picked) {
      console.warn(`无效的选项索引: ${index}`);
      return null;
    }
    const { choice, key } = picked;

    // 目标前置校验（存在分支体时目标在体末执行）
    if (
      choice.target &&
      choice.target !== END_TARGET &&
      !this.resolveTarget(choice.target)
    ) {
      console.warn(`选项指向不存在的场景: ${choice.target}`);
      return null;
    }

    if (choice.once) {
      this.chosenOnce.add(key);
    }
    // 选项标签自动计数（在分支体执行前生效，体内 @if {label} 可见）
    if (choice.label) {
      const current = this.vars[choice.label];
      this.vars[choice.label] = (typeof current === 'number' ? current : 0) + 1;
    }
    this.pendingChoices = [];

    if (choice.body.length > 0) {
      // 分支体 +（可选）体末跳转
      const items: SceneItem[] = choice.target
        ? [...choice.body, { kind: 'divert', target: choice.target }]
        : choice.body;
      this.frames.push({ items, index: 0 });
    } else if (choice.target) {
      this.frames.push({ items: [{ kind: 'divert', target: choice.target }], index: 0 });
    }
    // 无体无目标：直接汇合（外层帧继续）

    this.runUntilStop(false);
    return this.advance();
  }

  /**
   * 跳转到指定场景（不校验来源，供调试/预览用）
   */
  gotoScene(sceneId: string): string | null {
    const resolved = this.resolveTarget(sceneId);
    if (!resolved) {
      console.warn(`未找到场景: ${sceneId}`);
      return null;
    }
    // B10 修复：大纲点击跳转属"预览"，不推进 visits（避免隐性改变变体序列）
    this.enterFlow(resolved, true);
    return this.advance();
  }

  // ============================================================
  // 查询
  // ============================================================

  /** 当前场景 ID（结局时为 END） */
  get sceneId(): string {
    return this.ended ? END_SCENE_ID : this.currentSceneId;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  get sceneIds(): string[] {
    return this.document.sceneOrder;
  }

  /** 变量表快照（只读副本，函数型内置项除外） */
  get variables(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.vars)) {
      if (typeof v !== 'function') snapshot[k] = v;
    }
    return snapshot;
  }

  /**
   * 校验所有跳转目标（选项 + 独立跳转，含分支体内；END 合法；子场景相对解析）
   */
  validateLinks(): Array<{ scene: string; target: string }> {
    const dangling: Array<{ scene: string; target: string }> = [];
    for (const [id, scene] of this.document.scenes) {
      const parent = id.split('.')[0];
      const check = (target: string | undefined): void => {
        if (!target || target === END_TARGET) return;
        if (this.document.scenes.has(target)) return;
        if (this.document.scenes.has(`${parent}.${target}`)) return;
        dangling.push({ scene: id, target });
      };
      walkItems(scene.items, (item) => {
        if (item.kind === 'divert') check(item.target);
        if (item.kind === 'choices') item.choices.forEach((c) => check(c.target));
      });
    }
    return dangling;
  }

  /**
   * 入链统计：每个场景被多少处跳转/选项指向（大纲面板用）
   */
  linkStats(): Map<string, number> {
    const stats = new Map<string, number>();
    for (const id of this.document.sceneOrder) stats.set(id, 0);
    for (const [id, scene] of this.document.scenes) {
      const parent = id.split('.')[0];
      const bump = (target: string | undefined): void => {
        if (!target || target === END_TARGET) return;
        const resolved = this.document.scenes.has(target)
          ? target
          : this.document.scenes.has(`${parent}.${target}`)
            ? `${parent}.${target}`
            : null;
        if (resolved) stats.set(resolved, (stats.get(resolved) ?? 0) + 1);
      };
      walkItems(scene.items, (item) => {
        if (item.kind === 'divert') bump(item.target);
        if (item.kind === 'choices') item.choices.forEach((c) => bump(c.target));
      });
    }
    return stats;
  }

  /**
   * 硬死胡同：既无跳转，也**没有任何选项组**（连粘性选项都没有）→ 到达即卡死。
   * B9 修复：不再把"存在粘性选项组"误判为有出口；粘性死循环/一次性死胡同由下方专门方法报告，三者不重叠。
   */
  deadEndScenes(): string[] {
    if (this.document.sceneOrder.length <= 1) return [];
    const result: string[] = [];
    for (const id of this.document.sceneOrder) {
      const scene = this.document.scenes.get(id);
      if (!scene) continue;
      let hasDivert = false;
      let hasChoiceGroup = false;
      walkItems(scene.items, (item) => {
        if (item.kind === 'divert') hasDivert = true;
        if (item.kind === 'choices') hasChoiceGroup = true;
      });
      if (!hasDivert && !hasChoiceGroup) result.push(id);
    }
    return result;
  }

  /**
   * 粘性死循环（B9 补报）：存在选项组，但组内所有选项都是粘性
   * （无 target、无 body）→ 选中后原地汇合，永远无进展。
   */
  stickyDeadEnds(): string[] {
    const result: string[] = [];
    for (const id of this.document.sceneOrder) {
      const scene = this.document.scenes.get(id);
      if (!scene) continue;
      let hasDivert = false;
      let hasStickyGroup = false;
      walkItems(scene.items, (item) => {
        if (item.kind === 'divert') hasDivert = true;
        if (item.kind === 'choices' && item.choices.length > 0) {
          const allSticky = item.choices.every(
            (c) => !c.target && c.body.length === 0
          );
          if (allSticky) hasStickyGroup = true;
        }
      });
      if (!hasDivert && hasStickyGroup) result.push(id);
    }
    return result;
  }

  /**
   * 一次性死胡同（B9 补报）：无跳转，且所有"可执行选项"都是 `* once`
   * → 选完即消失，此后场景无出口卡死。
   */
  onceOnlyDeadEnds(): string[] {
    const result: string[] = [];
    for (const id of this.document.sceneOrder) {
      const scene = this.document.scenes.get(id);
      if (!scene) continue;
      let hasDivert = false;
      const allExitAreOnce: boolean[] = [];
      walkItems(scene.items, (item) => {
        if (item.kind === 'divert') hasDivert = true;
        if (item.kind === 'choices') {
          for (const c of item.choices) {
            if (this.choiceHasExit(c)) allExitAreOnce.push(!!c.once);
          }
        }
      });
      if (!hasDivert && allExitAreOnce.length > 0 && allExitAreOnce.every((v) => v)) {
        result.push(id);
      }
    }
    return result;
  }

  private choiceHasExit(choice: { target?: string; once?: boolean; body: SceneItem[] }): boolean {
    if (choice.target && choice.target !== END_TARGET) return true;
    if (choice.body.some((b) => b.kind === 'divert')) return true;
    return choice.body.length > 0;
  }

  /**
   * 获取当前渲染数据
   */
  getCurrentRenderData(): SceneRenderData | null {
    if (this.ended) {
      return this.buildEndRenderData();
    }
    const scene = this.document.scenes.get(this.currentSceneId);
    if (!scene) return null;
    return this.buildRenderData(scene);
  }

  // ============================================================
  // 内部：渲染数据
  // ============================================================

  private resolveToken(token: ExprToken | VariantToken, sceneId: string): string {
    if (token.type === 'expr') {
      return evalToText(token.code, this.vars);
    }
    const visit = Math.max(this.visits.get(sceneId) ?? 1, 1);
    const n = token.items.length;
    if (n === 0) return '';
    switch (token.kind) {
      case 'seq':
        return token.items[Math.min(visit - 1, n - 1)];
      case 'cycle':
        return token.items[(visit - 1) % n];
      case 'once':
        return visit - 1 < n ? token.items[visit - 1] : '';
      case 'shuffle':
        return token.items[deterministicIndex(`${sceneId}#${token.variantIndex}#${visit}`, n)];
    }
  }

  /** 从显示缓冲构建渲染数据（粘连感知拼接） */
  private buildRenderData(scene: SushiScene): SceneRenderData {
    const chars: string[] = [];
    const meta: CharMeta[] = [];

    this.buffer.forEach((ds, i) => {
      if (i > 0 && !this.buffer[i - 1].glueAfter) {
        chars.push('\n');
        meta.push({ sentenceIndex: i, isMarked: false });
      }
      chars.push(ds.text);
      meta.push(...ds.charMeta);
    });

    // 收集标记词语（静态视图，供 tooltip/词汇表等）
    const marks: SceneRenderData['marks'] = [];
    walkItems(scene.items, (item) => {
      if (item.kind === 'sentence') {
        for (const token of item.sentence.tokens) {
          if (token.type === 'marked') {
            marks.push({
              text: token.text,
              annotation: token.annotation,
              directives: token.directives,
              markIndex: token.markIndex,
              isFirstOccurrence: token.isFirstOccurrence,
            });
          }
        }
      }
    });

    return {
      plainText: chars.join(''),
      charMeta: meta,
      sceneId: scene.id,
      sceneDirectives: scene.frontmatter,
      sentenceDirectives: this.buffer.map((ds) => ds.directives),
      marks,
    };
  }

  private buildEndRenderData(): SceneRenderData {
    // 结局统计（引擎通用指标，从访问计数自动生成）
    const sceneCount = this.visits.size;
    let totalVisits = 0;
    for (const n of this.visits.values()) totalVisits += n;
    const statsLine = `这段旅程，你到访了 ${sceneCount} 个场景，共驻足 ${totalVisits} 次。`;

    const sentences = [END_SCREEN_TEXT, statsLine];
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const chars: string[] = [];
    const charMeta: CharMeta[] = [];
    sentences.forEach((text, si) => {
      if (si > 0) {
        chars.push('\n');
        charMeta.push({ sentenceIndex: si, isMarked: false });
      }
      for (const seg of segmenter.segment(text)) {
        chars.push(seg.segment);
        charMeta.push({ sentenceIndex: si, isMarked: false });
      }
    });

    return {
      plainText: chars.join(''),
      charMeta,
      sceneId: END_SCENE_ID,
      sceneDirectives: { mood: 'float' },
      sentenceDirectives: [
        { typewriter: '120ms', 'pause-after': '500' },
        { typewriter: '40ms' },
      ],
      marks: [],
    };
  }

  private emitEndScreen(): string {
    const renderData = this.buildEndRenderData();
    const choices = [{ index: 0, text: RESTART_CHOICE_TEXT }];
    // 结局前场景仍存在时提供「继续探索」（不清档返回，方便走其他分支）
    if (this.document.scenes.has(this.currentSceneId)) {
      choices.push({
        index: 1,
        text: `${RESUME_CHOICE_PREFIX}${this.currentSceneId}${RESUME_CHOICE_SUFFIX}`,
      });
    }
    const storyState: StoryState = {
      sceneId: END_SCENE_ID,
      mood: 'float',
      currentText: renderData.plainText,
      choices,
      variables: { ...this.variables },
      canContinue: false,
    };
    this.emitState(storyState, renderData);
    return renderData.plainText;
  }

  /** 更新 store + 发送事件（sceneData 先于 stateChange，Renderer 依赖此顺序） */
  private emitState(storyState: StoryState, renderData: SceneRenderData): void {
    const changed: Record<string, unknown> = {};
    if (storyState.mood !== this.prevMood) changed['mood'] = storyState.mood;
    if (storyState.sceneId !== this.prevSceneId) changed['scene'] = storyState.sceneId;
    this.prevMood = storyState.mood;
    this.prevSceneId = storyState.sceneId;

    gameStore.getState().setStoryState(storyState);

    emitter.emit('sushi:sceneData', renderData);

    const event: StateChangeEvent = {
      state: storyState,
      changedVariables: changed,
    };
    emitter.emit('story:stateChange', event);
  }
}

// ============================================================
// 工具：深度遍历场景项
// ============================================================

function walkItems(items: SceneItem[], visit: (item: SceneItem) => void): void {
  for (const item of items) {
    visit(item);
    if (item.kind === 'if') {
      for (const branch of item.branches) walkItems(branch.body, visit);
    } else if (item.kind === 'choices') {
      for (const choice of item.choices) walkItems(choice.body, visit);
    }
  }
}
