import p5 from 'p5';
import { Particle } from './Particle';
import { DEFAULT_PARTICLE_CONFIG } from '../types/particle';
import { emitter } from '../core/EventBus';
import { cssVarToRGB, type RGB } from '../infrastructure/cssColor';
import { resolveBackground, markDeclarativeBg, isDeclarativeActive } from '../ui/stageBackground';
import { FONT_CONFIG } from '../infrastructure/FontLoader';
import { gameStore } from '../store/gameStore';
import type { LayoutSnapshot, GlyphData } from '../types/layout';
import type { SceneRenderData } from '../sushiml/bridge';
import type { SentenceDirectives } from '../sushiml/types';
import {
  MoodEffects,
  WordStateEffects,
  WordEnterEffects,
  combineOffsets,
  ZERO_OFFSET,
  type EffectContext,
  type EffectOffset,
} from './EffectLibrary';

/**
 * p5.js 渲染器
 *
 * 负责：
 * 1. 初始化 p5.js 实例模式
 * 2. 消费 LayoutSnapshot + SushiML 元数据
 * 3. typewriter + pause 时序控制
 * 4. 场景切换策略：同场景重排 vs 跨场景溶解-重生
 *
 * 粒子分两组管理，避免清理竞态：
 * - active: 当前场景的粒子（索引与 glyph 一一对应，可复用）
 * - dying:  上一场景正在淡出的粒子（淡完即删，删除只发生在 draw 循环）
 */
export class Renderer {
  private p5Instance!: p5;
  private active: Particle[] = [];
  private dying: Particle[] = [];
  private currentSnapshot: LayoutSnapshot | null = null;
  private dissolveTimer: ReturnType<typeof setTimeout> | null = null;
  private containerEl: HTMLElement;
  private noiseOffset: number = 0;
  private tooltipEl!: HTMLElement;

  /** 当前场景的 SushiML 渲染元数据 */
  private currentSceneData: SceneRenderData | null = null;

  /** 当前主题的舞台文字 RGB（从 CSS 变量读取，随主题/背景切换更新） */
  private textRGB: RGB = [230, 230, 240];

  /** #preview-bg 宿主背景层（所有背景最终落到这里，画布保持透明） */
  private hostBgEl: HTMLElement | null = null;

  /** Canvas 内边距 */
  private readonly canvasPadding = { x: 40, y: 60 };

  /** 溶解动画时长 (ms) */
  private readonly DISSOLVE_MS = 400;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.hostBgEl = containerEl.querySelector<HTMLElement>('#preview-bg');
    this.initP5();
    this.listenToEvents();
    // 首帧背景：此时尚未收到 sceneData，回退到主题表面（applySceneBackground 内部处理 null）
    this.applySceneBackground();
  }

  /**
   * 初始化 p5.js 实例模式
   */
  private initP5(): void {
    const sketch = (p: p5) => {
      p.setup = () => {
        const canvas = p.createCanvas(
          Math.max(this.containerEl.clientWidth, 1),
          Math.max(this.containerEl.clientHeight, 1)
        );
        canvas.parent(this.containerEl);

        // 字体配置必须与 MeasureContext / LayoutEngine 完全一致
        // （若字体加载失败回退，store 中存的是实际生效的字体族）
        p.textFont(gameStore.getState().fontFamily || FONT_CONFIG.family);
        p.textSize(FONT_CONFIG.size);
        p.textAlign(p.LEFT, p.TOP);

        this.initTooltip();
      };

      p.draw = () => {
        // 画布保持透明：所有背景（主题表面 / 场景 bg / 全局默认 / @bg_show）都由
        // 底层 #preview-bg 承载，粒子直接绘制在其上，避免叠加层把背景盖成黑色。
        p.clear();
        p.noStroke();
        this.noiseOffset += 0.01;

        const mood = this.currentSnapshot?.mood || 'default';
        const moodFn = MoodEffects[mood];
        const ctx: EffectContext = { p, idleAge: 0, noiseOffset: this.noiseOffset };

        // 淡出中的旧粒子：只做物理更新
        for (const particle of this.dying) {
          particle.update();
          particle.render();
        }
        // 死亡清理只发生在这一处
        if (this.dying.length > 0) {
          this.dying = this.dying.filter((pt) => !pt.isDead);
        }

        // 当前场景粒子
        for (const particle of this.active) {
          particle.update();

          let offset: EffectOffset = ZERO_OFFSET;
          if (particle.isIdle) {
            ctx.idleAge = particle.idleAge;
            // 词语级持续动效
            const effectName = particle.wordStateEffect;
            const wordFn = effectName ? WordStateEffects[effectName] : undefined;
            if (wordFn) {
              offset = wordFn(ctx, particle.anchorX, particle.anchorY);
            }
            // 场景情绪力场
            if (moodFn) {
              offset = combineOffsets(offset, moodFn(ctx, particle.anchorX, particle.anchorY));
            }
          }

          particle.render(offset.dx, offset.dy, offset.alpha ?? 1);
        }

        this.handleTooltip(p.mouseX, p.mouseY);
      };

      p.windowResized = () => {
        const w = Math.max(this.containerEl.clientWidth, 1);
        const h = Math.max(this.containerEl.clientHeight, 1);
        p.resizeCanvas(w, h);
        emitter.emit('system:resize', { width: w, height: h });
      };
    };

    this.p5Instance = new p5(sketch, this.containerEl);
  }

  /**
   * 监听事件总线
   */
  private listenToEvents(): void {
    emitter.on('layout:snapshotUpdate', (snapshot) => {
      this.updateSnapshot(snapshot);
    });

    // 接收 SushiML 场景渲染元数据（必须先于 layout:snapshotUpdate 到达）
    emitter.on('sushi:sceneData', (data) => {
      this.currentSceneData = data;
      this.applySceneBackground();
    });

    emitter.on('theme:changed', () => {
      this.applySceneBackground();
    });
  }

  /**
   * 手动触发 p5 resize（分栏拖拽时容器尺寸变化但 window 不变）
   */
  public resizeToContainer(): void {
    const w = Math.max(this.containerEl.clientWidth, 1);
    const h = Math.max(this.containerEl.clientHeight, 1);
    if (w !== this.p5Instance.width || h !== this.p5Instance.height) {
      this.p5Instance.resizeCanvas(w, h);
      emitter.emit('system:resize', { width: w, height: h });
    }
  }

  /**
   * 更新排版快照
   * 含场景切换检测——同场景重排 vs 跨场景溶解-重生
   */
  public updateSnapshot(snapshot: LayoutSnapshot): void {
    const isSceneChange =
      this.currentSnapshot === null ||
      snapshot.sceneId !== this.currentSnapshot.sceneId;

    if (isSceneChange) {
      const { enter, speedScale } = this.getSceneTransition();
      this.rebuildScene(snapshot, enter, speedScale);
    } else {
      this.reuseParticles(snapshot);
    }

    this.currentSnapshot = snapshot;
  }

  /**
   * 从当前场景指令推导过渡方式与速度倍率
   * enter: fade-in | dissolve | typewriter（默认 dissolve）
   * speed: slow | normal | fast（默认 normal → 1x）
   */
  private getSceneTransition(): {
    enter: 'dissolve' | 'fade-in' | 'typewriter';
    speedScale: number;
  } {
    const dirs = this.currentSceneData?.sceneDirectives;
    const enterRaw = (dirs?.enter ?? 'dissolve').toLowerCase();
    const enter: 'dissolve' | 'fade-in' | 'typewriter' =
      enterRaw === 'fade-in' || enterRaw === 'typewriter' ? enterRaw : 'dissolve';
    const speedRaw = (dirs?.speed ?? 'normal').toLowerCase();
    const speedScale = speedRaw === 'slow' ? 1.6 : speedRaw === 'fast' ? 0.6 : 1;
    return { enter, speedScale };
  }

  /**
   * 跨场景切换：按场景 enter 指令选择过渡方式
   * - dissolve（默认）：旧粒子淡出后，新粒子从上方飞入
   * - fade-in：旧粒子淡出的同时，新粒子在目标位置交叉淡入
   * - typewriter：新粒子按阅读顺序级联出现
   * speed 通过 speedScale 调节过渡时长 / 级联间隔
   */
  private rebuildScene(
    snapshot: LayoutSnapshot,
    enter: 'dissolve' | 'fade-in' | 'typewriter',
    speedScale: number
  ): void {
    // 竞态保护：取消上一次未完成的重建
    if (this.dissolveTimer !== null) {
      clearTimeout(this.dissolveTimer);
      this.dissolveTimer = null;
    }

    // 当前粒子全部转入 dying 组，原地淡出
    for (const particle of this.active) {
      particle.setTarget(particle.currentX, particle.currentY, 0);
      this.dying.push(particle);
    }
    this.active = [];

    if (enter === 'dissolve') {
      // 延迟后重建新场景粒子（等待旧粒子淡出）
      const delay = Math.round(this.DISSOLVE_MS * speedScale);
      this.dissolveTimer = setTimeout(() => {
        this.dissolveTimer = null;
        if (this.active.length === 0) {
          this.active = this.buildParticles(snapshot, enter, speedScale);
        }
      }, delay);
    } else {
      // fade-in / typewriter：立即构建，与旧粒子交叉呈现
      this.active = this.buildParticles(snapshot, enter, speedScale);
    }
  }

  /**
   * 同场景重排：索引复用（resize / 编辑微调 / 分支体追加时触发）
   *
   * 追加式推进支持：新增粒子应用 typewriter 时序（以首个新粒子的
   * 理论延迟为基线归零，使追加块从点击瞬间开始打字）
   */
  private reuseParticles(snapshot: LayoutSnapshot): void {
    const allGlyphs: GlyphData[] = snapshot.lines.flatMap((l) => l.glyphs);
    const prevCount = this.active.length;
    const delays = this.computeGlyphDelays(allGlyphs);
    const baseline = prevCount < delays.length ? delays[prevCount] : 0;

    for (let i = 0; i < allGlyphs.length; i++) {
      const glyph = allGlyphs[i];
      const tx = glyph.x + this.canvasPadding.x;
      const ty = glyph.y + this.canvasPadding.y;

      if (this.active[i]) {
        // 索引复用，状态机保护 setChar；目标未变时不打扰 idle 状态
        const particle = this.active[i];
        particle.setChar(glyph.char);
        if (particle.anchorX !== tx || particle.anchorY !== ty) {
          particle.setTarget(tx, ty, 255);
        }
        this.applyWordMeta(particle, glyph);
      } else {
        // 新增字符（分支体追加/编辑新增）
        const appendDelay = Math.max(0, (delays[i] ?? 0) - baseline);
        let spawnX = tx;
        let spawnY = ty + 20;
        const enterFn = glyph.enterEffect ? WordEnterEffects[glyph.enterEffect] : undefined;
        if (enterFn) {
          const spawn = enterFn(tx, ty);
          spawnX = spawn.x;
          spawnY = spawn.y;
        } else if (appendDelay > 0) {
          spawnX = tx;
          spawnY = ty;
        }
        const particle = new Particle(this.p5Instance, glyph.char, spawnX, spawnY, {
          ...DEFAULT_PARTICLE_CONFIG,
          textColor: this.textRGB,
        });
        particle.setTarget(tx, ty, 255);
        if (appendDelay > 0) {
          particle.setAppearDelay(appendDelay);
        }
        this.applyWordMeta(particle, glyph);
        this.active.push(particle);
      }
    }

    // 多余粒子转入 dying 组淡出
    if (this.active.length > allGlyphs.length) {
      const removed = this.active.splice(allGlyphs.length);
      for (const particle of removed) {
        particle.setTarget(particle.currentX, particle.currentY + 15, 0);
        this.dying.push(particle);
      }
    }
  }

  /**
   * 从快照构建整组新粒子（含入场动效和 typewriter 时序）
   * @param enter 场景级过渡方式，决定出生位置与级联呈现
   * @param speedScale 速度倍率，影响打字机级联间隔
   */
  private buildParticles(
    snapshot: LayoutSnapshot,
    enter: 'dissolve' | 'fade-in' | 'typewriter',
    speedScale: number
  ): Particle[] {
    const allGlyphs = snapshot.lines.flatMap((l) => l.glyphs);
    const delays = this.computeGlyphDelays(allGlyphs);
    const sceneStagger = 28 * speedScale; // 场景级打字机每字间隔（ms）

    return allGlyphs.map((glyph, i) => {
      const tx = glyph.x + this.canvasPadding.x;
      const ty = glyph.y + this.canvasPadding.y;

      // 出生位置：词语入场动效 > 场景过渡策略
      let spawnX = tx;
      let spawnY = ty;
      const enterFn = glyph.enterEffect ? WordEnterEffects[glyph.enterEffect] : undefined;
      if (enterFn) {
        // 词语级入场动效（作者显式指定）始终优先
        const spawn = enterFn(tx, ty);
        spawnX = spawn.x;
        spawnY = spawn.y;
      } else if (enter === 'dissolve') {
        // 默认：非打字机字从上方飞入
        if (delays[i] > 0) {
          spawnX = tx;
          spawnY = ty;
        } else {
          spawnX = tx + (Math.random() - 0.5) * 100;
          spawnY = -20 - Math.random() * 40;
        }
      }
      // fade-in / typewriter：已在目标位置（淡入 / 级联出现）

      const particle = new Particle(this.p5Instance, glyph.char, spawnX, spawnY, {
        ...DEFAULT_PARTICLE_CONFIG,
        textColor: this.textRGB,
      });
      particle.setTarget(tx, ty, 255);

      // 出现延迟：句子级指令 + 场景级打字机级联
      let appear = delays[i];
      if (enter === 'typewriter') {
        appear = Math.max(appear, i * sceneStagger);
      }
      if (appear > 0) {
        particle.setAppearDelay(appear);
      }
      this.applyWordMeta(particle, glyph);

      return particle;
    });
  }

  /** 应用词语级元数据 */
  private applyWordMeta(particle: Particle, glyph: GlyphData): void {
    particle.setWordMeta(
      !!glyph.isMarked,
      glyph.wordColor,
      glyph.enterEffect,
      glyph.annotation
    );
  }

  // ============================================================
  // typewriter + pause 时序计算
  // ============================================================

  /**
   * 计算每个 glyph 的出现延迟（ms）
   *
   * 时序模型：
   *   句子 0: {typewriter: 60ms}
   *     → char[0] at T+0, char[1] at T+60, char[2] at T+120 ...
   *     → 句子 0 结束时间 = T + (charCount × 60)
   *   句子 0: {pause: 800}  (pause-after)
   *     → 下一句在 句子0结束 + 800ms 后开始
   *   句子 1: {pause-before: 500}
   *     → 本句在 上一句结束 + 500ms 后开始
   *   句子 1: 无 typewriter
   *     → 所有字符同时出现（delay = 句子开始时间）
   */
  private computeGlyphDelays(allGlyphs: GlyphData[]): number[] {
    const delays: number[] = new Array(allGlyphs.length).fill(0);
    const sceneData = this.currentSceneData;
    if (!sceneData || sceneData.sentenceDirectives.length === 0) {
      return delays;
    }

    // 检查是否有任何时序指令
    const hasAnyTiming = sceneData.sentenceDirectives.some(
      (d) => d.typewriter || d.pause || d['pause-before'] || d['pause-after']
    );
    if (!hasAnyTiming) return delays;

    let currentTime = 0;
    let prevSentenceIdx = -1;
    let charInSentence = 0;
    let sentenceCharCount = 0;

    for (let i = 0; i < allGlyphs.length; i++) {
      const glyph = allGlyphs[i];
      const si = glyph.sentenceIndex;

      // 进入新句子
      if (si !== prevSentenceIdx) {
        // 上一句的 pause-after（等价于 pause）
        if (prevSentenceIdx >= 0) {
          const prevDir = this.getSentenceDir(prevSentenceIdx);
          currentTime += parseMs(prevDir['pause-after'] || prevDir.pause);
        }

        // 本句的 pause-before
        const curDir = this.getSentenceDir(si);
        currentTime += parseMs(curDir['pause-before']);

        // 预计算本句字符数
        sentenceCharCount = 0;
        for (let j = i; j < allGlyphs.length && allGlyphs[j].sentenceIndex === si; j++) {
          sentenceCharCount++;
        }

        charInSentence = 0;
        prevSentenceIdx = si;
      }

      const dir = this.getSentenceDir(si);
      const typewriterMs = parseMs(dir.typewriter);

      if (typewriterMs > 0) {
        delays[i] = currentTime + charInSentence * typewriterMs;
      } else {
        delays[i] = currentTime > 0 ? currentTime : 0;
      }

      charInSentence++;

      // 句子最后一个字符：推进时间游标
      const nextGlyph = allGlyphs[i + 1];
      if (!nextGlyph || nextGlyph.sentenceIndex !== si) {
        if (typewriterMs > 0) {
          currentTime += sentenceCharCount * typewriterMs;
        }
      }
    }

    return delays;
  }

  /**
   * 安全获取句子指令
   */
  private getSentenceDir(sentenceIndex: number): SentenceDirectives {
    if (!this.currentSceneData) return {};
    return this.currentSceneData.sentenceDirectives[sentenceIndex] || {};
  }

  /**
   * 获取有效渲染区域宽度（减去内边距）
   */
  public get renderWidth(): number {
    return Math.max(this.containerEl.clientWidth - this.canvasPadding.x * 2, 50);
  }

  /**
   * 初始化 Tooltip 元素
   */
  private initTooltip(): void {
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.id = 'sushiml-tooltip';
    this.tooltipEl.className = 'sushiml-tooltip';
    this.containerEl.appendChild(this.tooltipEl);
  }

  /**
   * 处理 Tooltip 检测
   */
  private handleTooltip(mx: number, my: number): void {
    if (!this.tooltipEl) return;
    let activeAnnotation: string | null = null;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const pt = this.active[i];
      if (pt.isMouseOver(mx, my)) {
        const ann = pt.getAnnotation();
        if (ann) {
          activeAnnotation = ann;
          break;
        }
      }
    }

    if (activeAnnotation) {
      this.tooltipEl.innerText = activeAnnotation;
      this.tooltipEl.style.left = `${mx + 15}px`;
      this.tooltipEl.style.top = `${my + 15}px`;
      this.tooltipEl.style.opacity = '1';
    } else {
      this.tooltipEl.style.opacity = '0';
    }
  }

  /**
   * 应用当前场景的背景（三层解析：scene.bg > 全局默认 > 主题表面）。
   * 把背景落到 #preview-bg（画布透明透出），并按背景计算可读文字色。
   */
  private applySceneBackground(): void {
    const data = this.currentSceneData;
    // 解析优先级：场景 frontmatter bg:  >  跟随主题（无 bg: 时）
    const raw = data?.sceneDirectives.bg;
    const { css, text } = resolveBackground(raw);

    if (css) {
      // 声明式背景：显示宿主层并标记为「声明式」
      if (this.hostBgEl) {
        this.hostBgEl.style.background = css;
        this.hostBgEl.style.opacity = '1';
      }
      markDeclarativeBg(true);
      this.textRGB = text ?? cssVarToRGB('--stage-text');
    } else if (isDeclarativeActive()) {
      // 无声明式背景，且上一幕是自己设的 → 清回主题表面（避免残留）
      if (this.hostBgEl) this.hostBgEl.style.opacity = '0';
      markDeclarativeBg(false);
      this.textRGB = cssVarToRGB('--stage-text');
    } else {
      // 无声明式背景，且当前由运行时 @bg_show 控制 → 不动宿主层，沿用其背景
      this.textRGB = cssVarToRGB('--stage-text');
    }

    // 文字色同步给所有粒子
    for (const particle of this.active) {
      particle.updateConfig({ textColor: this.textRGB });
    }
    for (const particle of this.dying) {
      particle.updateConfig({ textColor: this.textRGB });
    }
  }

  /**
   * 销毁渲染器
   */
  public destroy(): void {
    if (this.dissolveTimer !== null) {
      clearTimeout(this.dissolveTimer);
    }
    this.p5Instance.remove();
    this.active = [];
    this.dying = [];
  }
}

// ============================================================
// 工具函数
// ============================================================

/** 解析毫秒值：'60ms' → 60, '1200' → 1200, undefined → 0 */
function parseMs(value: string | undefined): number {
  if (!value || value === '0') return 0;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}
