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
 * Lerp + 吸附阈值设计（修复微抖问题）：
 * 当距离小于 SNAP_DISTANCE 时直接吸附到目标位置，
 * 使粒子在静止后完全停止计算，为情绪动效腾出干净的切换空间。
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
  /** 词语级自定义颜色（如 "#ff6b6b"） */
  private wordColor: string | null = null;
  /** 是否为标记词语 [[word]] */
  private isMarked: boolean = false;
  /** 词语入场动效类型 */
  private enterEffect: string | null = null;
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
      // 粒子静止：立即生效，无视觉突变
      this.char = char;
    } else {
      // 粒子飞行中：挂起，等落地后在 update() 里消费
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

    // 针对特定入场特效初始化位置
    if (this.state === 'flying' && this.enterEffect === 'fly-in-left') {
      this.pos.set(x - 200, y); // 从左侧飞入
      this.opacity = 0;
    }
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
   * 设置词语级元数据（颜色、标记状态、动效、注释）
   */
  public setWordMeta(isMarked: boolean, wordColor?: string, enter?: string, annotation?: string): void {
    this.isMarked = isMarked;
    this.wordColor = wordColor || null;
    this.enterEffect = enter || null;
    this.annotation = annotation || null;
  }

  /**
   * 每帧更新
   * 含吸附逻辑：距离 < threshold 时直接吸附
   */
  public update(): void {
    // 延迟门控：冻结直到延迟结束
    if (this.appearDelay > 0 && performance.now() - this.birthTime < this.appearDelay) {
      return;
    }

    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;
    const distSq = dx * dx + dy * dy; // 避免 sqrt，性能更好
    const snapDistSq =
      this.config.snapDistance * this.config.snapDistance;

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
      }
    } else {
      // 缓动飞行
      this.pos.x += dx * this.config.easing;
      this.pos.y += dy * this.config.easing;
    }

    // 处理特殊入场持续动效
    if (this.state === 'idle') {
      if (this.enterEffect === 'sink') {
        this.pos.y += 0.2; // 缓慢下沉
      } else if (this.enterEffect === 'swim') {
        this.pos.x += Math.sin(this.p.frameCount * 0.05) * 0.5; // 左右游动
      }
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
   */
  public display(): void {
    // 延迟门控
    if (this.appearDelay > 0 && performance.now() - this.birthTime < this.appearDelay) {
      return;
    }
    if (this.opacity < 1) return;

    // 颜色优先级：自定义色 > 标记词语高亮色 > 默认色
    if (this.wordColor) {
      // 解析 hex 颜色
      const hex = this.wordColor.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      this.p.fill(r, g, b, this.opacity);
    } else if (this.isMarked) {
      // 标记词语默认高亮（淡紫/金色）
      this.p.fill(255, 184, 108, this.opacity); // #ffb86c 橙金色
    } else {
      const [r, g, b] = this.config.textColor;
      this.p.fill(r, g, b, this.opacity);
    }
    this.p.noStroke();
    this.p.text(this.char, this.pos.x, this.pos.y);
  }

  /**
   * 应用情绪力场（Week 3 预留接口）
   * 只在 idle 状态时叠加，flying 时不叠加
   */
  public applyMoodForce(mood: string, _noiseOffset: number): void {
    if (this.state !== 'idle') return;

    switch (mood) {
      case 'tense': {
        // 高频震颤
        const nx = (this.p.noise(this.pos.x * 0.01, _noiseOffset) - 0.5) * 4;
        const ny =
          (this.p.noise(this.pos.y * 0.01, _noiseOffset + 100) - 0.5) * 4;
        this.pos.x += nx;
        this.pos.y += ny;
        break;
      }
      case 'float': {
        // 流体漂浮
        const fx =
          (this.p.noise(this.pos.x * 0.005, _noiseOffset * 0.5) - 0.5) * 2;
        const fy =
          (this.p.noise(this.pos.y * 0.005, _noiseOffset * 0.5 + 50) - 0.5) *
          1.5;
        this.pos.x += fx;
        this.pos.y += fy;
        break;
      }
      default: {
        // 默认呼吸感：微弱透明度波动
        const breathe =
          this.p.sin(this.p.frameCount * 0.02 + this.pos.x * 0.01) * 10;
        this.opacity = Math.min(255, Math.max(0, this.targetOpacity + breathe));
        break;
      }
    }
  }

  /** 粒子是否已静止 */
  public get isIdle(): boolean {
    return this.state === 'idle';
  }

  /** 粒子是否已死亡（淡出完成） */
  public get isDead(): boolean {
    return this.state === 'fading' && this.opacity <= this.config.snapOpacity;
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
