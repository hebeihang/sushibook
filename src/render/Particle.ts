import p5 from 'p5';
import type { ParticleState, ParticleConfig } from '../types/particle';
import { DEFAULT_PARTICLE_CONFIG } from '../types/particle';

/**
 * 字符粒子
 *
 * 每个字符在 Canvas 上对应一个 Particle 对象。
 *
 * 状态机设计（修复"变脸"问题）：
 * - idle:   已到达目标位置，静止中
 * - flying: 正在飞向目标位置
 * - fading: 正在淡出，即将死亡
 *
 * setChar() 在 flying 状态时延迟到粒子落地后才生效，
 * 避免用户看到字符在飞行途中突变（"变脸"问题）。
 *
 * 物理与动效解耦：
 * pos 只由 update() 的物理插值控制；情绪/词语动效通过
 * render(dx, dy, alpha) 以锚点偏移的方式叠加，绝不污染 pos，
 * 因此动效不会造成累积漂移。
 */
export class Particle {
  private p: p5;
  private char: string;
  private pos: p5.Vector;
  private target: p5.Vector;
  private opacity: number = 0;
  private targetOpacity: number = 255;
  private state: ParticleState = 'flying';
  private pendingChar: string | null = null;
  private config: ParticleConfig;

  /** typewriter 延迟（ms） */
  private appearDelay: number = 0;
  /** 粒子创建时间戳 */
  private birthTime: number = 0;
  /** 进入 idle 状态的帧号（用于状态动效计时） */
  private idleSince: number = 0;
  /** 词语级自定义颜色（如 "#ff6b6b"），已解析为 RGB */
  private wordColorRGB: [number, number, number] | null = null;
  /** 是否为标记词语 [[word]] */
  private marked: boolean = false;
  /** 词语持续动效类型 */
  private stateEffect: string | null = null;
  /** 注释文本 */
  private annotation: string | null = null;

  constructor(
    p: p5,
    char: string,
    x: number,
    y: number,
    config: ParticleConfig = DEFAULT_PARTICLE_CONFIG
  ) {
    this.p = p;
    this.char = char;
    this.pos = p.createVector(x, y);
    this.target = p.createVector(x, y);
    this.config = config;
  }

  /**
   * 设置字符内容
   * 如果粒子正在飞行中，延迟到落地后才生效
   */
  public setChar(char: string): void {
    if (this.state === 'idle') {
      this.char = char;
    } else {
      this.pendingChar = char;
    }
  }

  /**
   * 设置飞行目标
   */
  public setTarget(x: number, y: number, opacity: number = 255): void {
    this.target.set(x, y);
    this.targetOpacity = opacity;
    this.state = opacity === 0 ? 'fading' : 'flying';
  }

  /**
   * 设置出现延迟（typewriter 效果）
   * 延迟结束前粒子完全冻结：不移动、不显示
   */
  public setAppearDelay(delayMs: number): void {
    this.appearDelay = delayMs;
    this.birthTime = performance.now();
  }

  /**
   * 设置词语级元数据（颜色、标记状态、持续动效、注释）
   */
  public setWordMeta(isMarked: boolean, wordColor?: string, effect?: string, annotation?: string): void {
    this.marked = isMarked;
    this.wordColorRGB = wordColor ? parseHexColor(wordColor) : null;
    this.stateEffect = effect || null;
    this.annotation = annotation || null;
  }

  /**
   * 每帧物理更新
   * idle 状态早退：静止粒子跳过位置计算
   */
  public update(): void {
    // 延迟门控：冻结直到延迟结束
    if (this.isGated()) return;

    // idle 早退优化：位置和透明度都已稳定，无事可做
    if (this.state === 'idle' && this.opacity === this.targetOpacity) {
      return;
    }

    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;
    const distSq = dx * dx + dy * dy; // 避免 sqrt
    const snapDistSq = this.config.snapDistance * this.config.snapDistance;

    if (distSq < snapDistSq) {
      // 吸附：直接到位，消除微抖
      this.pos.set(this.target.x, this.target.y);

      // 落地时消费 pendingChar（修复"变脸"问题）
      if (this.pendingChar !== null) {
        this.char = this.pendingChar;
        this.pendingChar = null;
      }

      if (this.state === 'flying') {
        this.state = 'idle';
        this.idleSince = this.p.frameCount;
      }
    } else {
      // 缓动飞行
      this.pos.x += dx * this.config.easing;
      this.pos.y += dy * this.config.easing;
    }

    // 透明度补间 + 吸附
    const opacityDelta = this.targetOpacity - this.opacity;
    if (Math.abs(opacityDelta) < this.config.snapOpacity) {
      this.opacity = this.targetOpacity;
    } else {
      this.opacity += opacityDelta * this.config.easing;
    }
  }

  /**
   * 渲染字符
   * @param dx - 动效 X 偏移（相对锚点）
   * @param dy - 动效 Y 偏移
   * @param alphaMul - 透明度乘数（0-1）
   */
  public render(dx: number = 0, dy: number = 0, alphaMul: number = 1): void {
    if (this.isGated()) return;
    if (this.opacity < 1) return;

    const alpha = this.opacity * alphaMul;

    // 颜色优先级：自定义色 > 标记词语高亮色 > 默认色
    if (this.wordColorRGB) {
      const [r, g, b] = this.wordColorRGB;
      this.p.fill(r, g, b, alpha);
    } else if (this.marked) {
      this.p.fill(255, 184, 108, alpha); // #ffb86c 橙金色
    } else {
      const [r, g, b] = this.config.textColor;
      this.p.fill(r, g, b, alpha);
    }
    this.p.noStroke();
    this.p.text(this.char, this.pos.x + dx, this.pos.y + dy);
  }

  /** typewriter 延迟是否仍在生效 */
  private isGated(): boolean {
    return this.appearDelay > 0 && performance.now() - this.birthTime < this.appearDelay;
  }

  /** 粒子是否已静止 */
  public get isIdle(): boolean {
    return this.state === 'idle';
  }

  /** idle 后经过的帧数 */
  public get idleAge(): number {
    return this.state === 'idle' ? this.p.frameCount - this.idleSince : 0;
  }

  /** 粒子是否已死亡（淡出完成） */
  public get isDead(): boolean {
    return this.state === 'fading' && this.opacity <= this.config.snapOpacity;
  }

  /** 目标（锚点）X 坐标 */
  public get anchorX(): number {
    return this.target.x;
  }

  /** 目标（锚点）Y 坐标 */
  public get anchorY(): number {
    return this.target.y;
  }

  /** 当前 X 坐标 */
  public get currentX(): number {
    return this.pos.x;
  }

  /** 当前 Y 坐标 */
  public get currentY(): number {
    return this.pos.y;
  }

  /** 当前状态 */
  public get currentState(): ParticleState {
    return this.state;
  }

  /** 词语持续动效类型 */
  public get wordStateEffect(): string | null {
    return this.stateEffect;
  }

  /**
   * 检查鼠标是否在粒子上（用于 Tooltip）
   */
  public isMouseOver(mx: number, my: number): boolean {
    if (this.opacity < 100) return false; // 还没出现的粒子不触发
    const dSq = (this.pos.x - mx) ** 2 + (this.pos.y - my) ** 2;
    return dSq < 400; // 20px 半径
  }

  /** 获取注释内容 */
  public getAnnotation(): string | null {
    return this.annotation;
  }
}

/** 解析 #rrggbb 颜色，非法输入返回 null */
function parseHexColor(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
