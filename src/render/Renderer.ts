import p5 from 'p5';
import { Particle } from './Particle';
import { emitter } from '../core/EventBus';
import { FONT_CONFIG } from '../infrastructure/FontLoader';
import type { LayoutSnapshot, GlyphData } from '../types/layout';
import type { MoodType } from '../types/particle';
import type { SceneRenderData } from '../sushiml/bridge';
import type { SentenceDirectives } from '../sushiml/types';

/**
 * p5.js 渲染器
 * 
 * 负责：
 * 1. 初始化 p5.js 实例模式
 * 2. 消费 LayoutSnapshot + SushiML 元数据
 * 3. typewriter + pause 时序控制
 * 4. 场景切换策略：同场景重排 vs 跨场景溶解-重生
 */
export class Renderer {
  private p5Instance!: p5;
  private particles: Particle[] = [];
  private currentSnapshot: LayoutSnapshot | null = null;
  private dissolveTimer: ReturnType<typeof setTimeout> | null = null;
  private containerEl: HTMLElement;
  private noiseOffset: number = 0;
  private tooltipEl!: HTMLElement;

  /** 当前场景的 SushiML 渲染元数据 */
  private currentSceneData: SceneRenderData | null = null;

  /** Canvas 内边距 */
  private readonly canvasPadding = { x: 40, y: 60 };

  /** 溶解动画时长 (ms) */
  private readonly DISSOLVE_MS = 400;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.initP5();
    this.listenToEvents();
  }

  /**
   * 初始化 p5.js 实例模式
   */
  private initP5(): void {
    const sketch = (p: p5) => {
      p.setup = () => {
        const canvas = p.createCanvas(
          this.containerEl.clientWidth,
          this.containerEl.clientHeight
        );
        canvas.parent(this.containerEl);

        // 字体配置必须与 MeasureContext 完全一致
        p.textFont(FONT_CONFIG.family);
        p.textSize(FONT_CONFIG.size);
        p.textAlign(p.LEFT, p.TOP);

        this.initTooltip();
      };

      p.draw = () => {
        // 深色背景
        p.background(12, 12, 18);

        this.noiseOffset += 0.01;

        // 更新所有粒子
        for (const particle of this.particles) {
          particle.update();

          // 应用情绪力场
          const mood = (this.currentSnapshot?.mood || 'default') as MoodType;
          if (mood !== 'default') {
            particle.applyMoodForce(mood, this.noiseOffset);
          }

          particle.display();
        }

        // 清理已死亡粒子
        this.particles = this.particles.filter((p) => !p.isDead);

        this.handleTooltip(p.mouseX, p.mouseY);
      };

      p.windowResized = () => {
        const w = this.containerEl.clientWidth;
        const h = this.containerEl.clientHeight;
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

    // 接收 SushiML 场景渲染元数据
    emitter.on('sushi:sceneData', (data) => {
      this.currentSceneData = data;
    });
  }

  /**
   * 更新排版快照
   * 含场景切换检测——同场景重排 vs 跨场景溶解-重生
   */
  public updateSnapshot(snapshot: LayoutSnapshot): void {
    const isSceneChange =
      this.currentSnapshot !== null &&
      snapshot.sceneId !== this.currentSnapshot.sceneId;

    if (isSceneChange) {
      this.dissolveAndRebuild(snapshot);
    } else {
      this.reuseParticles(snapshot);
    }

    this.currentSnapshot = snapshot;
  }

  /**
   * 跨场景切换：溶解-重生
   * 
   * typewriter 效果在此生效：
   * - 有 typewriter 指令的句子，字符按时序逐个出现
   * - 有 pause 指令的句子，在前一句结束后等待指定时间
   */
  private dissolveAndRebuild(snapshot: LayoutSnapshot): void {
    // 清除之前的计时器（竞态保护）
    if (this.dissolveTimer !== null) {
      clearTimeout(this.dissolveTimer);
    }

    // 所有旧粒子原地淡出
    for (const particle of this.particles) {
      particle.setTarget(particle.currentX, particle.currentY, 0);
    }

    // 延迟后重建
    this.dissolveTimer = setTimeout(() => {
      this.dissolveTimer = null;

      // 清理已死亡粒子
      this.particles = this.particles.filter((p) => !p.isDead);

      // 用新 snapshot 重建
      const allGlyphs = snapshot.lines.flatMap((l) => l.glyphs);

      // 计算每个字符的出现延迟
      const delays = this.computeGlyphDelays(allGlyphs);

      this.particles = allGlyphs.map((glyph, i) => {
        const tx = glyph.x + this.canvasPadding.x;
        const ty = glyph.y + this.canvasPadding.y;

        // typewriter 模式：在目标位置原地出现（不从远处飞入）
        // 非 typewriter：从上方随机位置飞入
        const hasDelay = delays[i] > 0;
        const spawnX = hasDelay
          ? tx
          : tx + (Math.random() - 0.5) * 100;
        const spawnY = hasDelay
          ? ty
          : -20 - Math.random() * 40;

        const particle = new Particle(
          this.p5Instance,
          glyph.char,
          spawnX,
          spawnY
        );
        particle.setTarget(tx, ty, 255);

        // 设置 typewriter 延迟
        if (delays[i] > 0) {
          particle.setAppearDelay(delays[i]);
        }

        // 设置词语级元数据（颜色 + 标记状态 + 动效 + 注释）
        if (glyph.isMarked || glyph.wordColor || glyph.enterEffect || glyph.annotation) {
          particle.setWordMeta(!!glyph.isMarked, glyph.wordColor, glyph.enterEffect, glyph.annotation);
        }

        return particle;
      });
    }, this.DISSOLVE_MS);
  }

  /**
   * 同场景重排：索引复用（resize 时触发）
   */
  private reuseParticles(snapshot: LayoutSnapshot): void {
    const allGlyphs: GlyphData[] = snapshot.lines.flatMap((l) => l.glyphs);

    for (let i = 0; i < allGlyphs.length; i++) {
      const glyph = allGlyphs[i];
      const tx = glyph.x + this.canvasPadding.x;
      const ty = glyph.y + this.canvasPadding.y;

      if (this.particles[i]) {
        // 索引复用，状态机保护 setChar
        this.particles[i].setChar(glyph.char);
        this.particles[i].setTarget(tx, ty, 255);
      } else {
        // 创建新粒子（新增的字符）
        const particle = new Particle(
          this.p5Instance,
          glyph.char,
          tx,
          ty + 20
        );
        particle.setTarget(tx, ty, 255);
        this.particles.push(particle);
      }
    }

    // 多余粒子向中心汇聚并淡出
    if (this.particles.length > allGlyphs.length) {
      const centerX = this.p5Instance.width / 2;
      const centerY = this.p5Instance.height / 2;
      for (let i = allGlyphs.length; i < this.particles.length; i++) {
        this.particles[i].setTarget(centerX, centerY, 0);
      }
    }
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

    let currentTime = 0;       // 累积时间游标
    let prevSentenceIdx = -1;
    let charInSentence = 0;
    let sentenceCharCount = 0; // 当前句子的总字符数

    for (let i = 0; i < allGlyphs.length; i++) {
      const glyph = allGlyphs[i];
      const si = glyph.sentenceIndex;

      // 进入新句子
      if (si !== prevSentenceIdx) {
        // 上一句的 pause-after（等价于 pause）
        if (prevSentenceIdx >= 0) {
          const prevDir = this.getSentenceDir(prevSentenceIdx);
          const pauseAfter = parseMs(prevDir['pause-after'] || prevDir.pause);
          currentTime += pauseAfter;
        }

        // 本句的 pause-before
        const curDir = this.getSentenceDir(si);
        const pauseBefore = parseMs(curDir['pause-before']);
        currentTime += pauseBefore;

        // 预计算本句字符数（用于非 typewriter 句子的时间推进）
        sentenceCharCount = 0;
        for (let j = i; j < allGlyphs.length && allGlyphs[j].sentenceIndex === si; j++) {
          sentenceCharCount++;
        }

        charInSentence = 0;
        prevSentenceIdx = si;
      }

      // 计算本字符的延迟
      const dir = this.getSentenceDir(si);
      const typewriterMs = parseMs(dir.typewriter);

      if (typewriterMs > 0) {
        delays[i] = currentTime + charInSentence * typewriterMs;
      } else {
        // 非 typewriter 句子：如果前面有 typewriter 句子，本句的字符统一在 currentTime 出现
        delays[i] = currentTime > 0 ? currentTime : 0;
      }

      charInSentence++;

      // 如果这是句子的最后一个字符，推进时间游标
      const nextGlyph = allGlyphs[i + 1];
      if (!nextGlyph || nextGlyph.sentenceIndex !== si) {
        if (typewriterMs > 0) {
          currentTime += sentenceCharCount * typewriterMs;
        }
        // 非 typewriter 句子不增加时间（瞬间出现）
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
    return this.containerEl.clientWidth - this.canvasPadding.x * 2;
  }

  /**
   * 初始化 Tooltip 元素
   */
  private initTooltip(): void {
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.id = 'sushiml-tooltip';
    this.tooltipEl.style.cssText = `
      position: absolute;
      background: rgba(30, 30, 45, 0.95);
      color: #fff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(4px);
    `;
    this.containerEl.appendChild(this.tooltipEl);
  }

  /**
   * 处理 Tooltip 检测
   */
  private handleTooltip(mx: number, my: number): void {
    let activeAnnotation: string | null = null;

    // 反向遍历（最新的/最上面的粒子优先）
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.isMouseOver(mx, my)) {
        const ann = p.getAnnotation();
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
   * 销毁渲染器
   */
  public destroy(): void {
    if (this.dissolveTimer !== null) {
      clearTimeout(this.dissolveTimer);
    }
    this.p5Instance.remove();
    this.particles = [];
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
