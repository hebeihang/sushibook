import type p5 from 'p5';

/**
 * SushiML 语义化动效库
 *
 * 设计原则：所有持续动效都是「锚点偏移」而非「累积位移」——
 * 效果函数根据锚点坐标和时间计算一个有界偏移量，
 * 粒子的物理位置永远不被动效污染，因此文字不会随时间漂移出画布。
 */

/** 动效计算上下文 */
export interface EffectContext {
  /** p5 实例（noise / frameCount） */
  p: p5;
  /** 粒子进入 idle 状态后经过的帧数 */
  idleAge: number;
  /** 全局噪声偏移（每帧递增） */
  noiseOffset: number;
}

/** 动效输出：相对锚点的偏移 + 可选透明度乘数 */
export interface EffectOffset {
  dx: number;
  dy: number;
  /** 透明度乘数（0-1），未指定则为 1 */
  alpha?: number;
}

export type StateEffectFn = (ctx: EffectContext, ax: number, ay: number) => EffectOffset;

// ============================================================
// 1. 词语入场动效：决定粒子的出生位置（纯函数）
// ============================================================

export const WordEnterEffects: Record<string, (tx: number, ty: number) => { x: number; y: number }> = {
  'fly-in-left': (tx, ty) => ({ x: tx - 300, y: ty }),
  'rain': (tx) => ({ x: tx, y: -50 - Math.random() * 200 }),
  'flare': (tx, ty) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 400 + Math.random() * 200;
    return { x: tx + Math.cos(angle) * dist, y: ty + Math.sin(angle) * dist };
  },
};

// ============================================================
// 2. 词语持续状态动效：idle 后每帧的有界偏移
// ============================================================

export const WordStateEffects: Record<string, StateEffectFn> = {
  /** 缓缓下沉：偏移渐增至 12px 后停住，再轻微起伏 */
  'sink': ({ p, idleAge }, _ax, _ay) => ({
    dx: 0,
    dy: Math.min(idleAge * 0.06, 12) + p.sin(idleAge * 0.03) * 1.5,
  }),

  /** 左右游动 */
  'swim': ({ p }, _ax, ay) => ({
    dx: p.sin(p.frameCount * 0.05 + ay * 0.1) * 4,
    dy: p.sin(p.frameCount * 0.03 + ay * 0.05) * 1.2,
  }),

  /** 火焰升腾抖动 */
  'heat': ({ p, noiseOffset }, ax, ay) => ({
    dx: (p.noise(ax * 0.05, noiseOffset * 8) - 0.5) * 4,
    dy: -p.noise(ay * 0.05, noiseOffset * 8 + 33) * 5,
  }),

  /** 顺风漂流（有界摆动） */
  'drift': ({ p }, ax) => ({
    dx: p.sin(p.frameCount * 0.02 + ax * 0.01) * 8,
    dy: p.sin(p.frameCount * 0.03 + ax * 0.02) * 2.5,
  }),

  /** 星光闪烁：透明度呼吸 + 微颤 */
  'sparkle': ({ p }, ax, ay) => ({
    dx: p.sin(p.frameCount * 0.11 + ax) * 0.8,
    dy: p.cos(p.frameCount * 0.13 + ay) * 0.8,
    alpha: 0.55 + 0.45 * (0.5 + 0.5 * p.sin(p.frameCount * 0.09 + ax * 0.7)),
  }),

  /** 引力拉扯：低频大幅拉伸脉冲 */
  'pull': ({ p, noiseOffset }, ax, ay) => {
    const pulse = 0.5 + 0.5 * p.sin(p.frameCount * 0.02 + ax * 0.05);
    return {
      dx: (p.noise(ax * 0.02, noiseOffset) - 0.5) * 10 * pulse,
      dy: (p.noise(ay * 0.02, noiseOffset + 77) - 0.5) * 10 * pulse,
    };
  },
};

// ============================================================
// 3. 全局场景情绪力场：作用于所有 idle 粒子
// ============================================================

export const MoodEffects: Record<string, StateEffectFn> = {
  /** 平静：微弱透明度呼吸 */
  'default': ({ p }, ax) => ({
    dx: 0,
    dy: 0,
    alpha: 0.94 + 0.06 * p.sin(p.frameCount * 0.02 + ax * 0.01),
  }),

  /** 紧张：高频小幅震颤 */
  'tense': ({ p, noiseOffset }, ax, ay) => ({
    dx: (p.noise(ax * 0.02, noiseOffset * 4) - 0.5) * 5,
    dy: (p.noise(ay * 0.02, noiseOffset * 4 + 100) - 0.5) * 5,
  }),

  /** 梦幻漂浮：Perlin noise 驱动的流体偏移 */
  'float': ({ p, noiseOffset }, ax, ay) => ({
    dx: (p.noise(ax * 0.005, noiseOffset * 0.5) - 0.5) * 14,
    dy: (p.noise(ay * 0.005, noiseOffset * 0.5 + 50) - 0.5) * 10,
  }),

  /** 暴风：定向大风摆动 */
  'storm': ({ p, noiseOffset }, ax, ay) => ({
    dx: p.sin(p.frameCount * 0.04 + ay * 0.02) * 8 + p.noise(ay * 0.01, noiseOffset) * 6,
    dy: (p.noise(ax * 0.01, noiseOffset) - 0.5) * 5,
  }),
};

/** 合并多个效果偏移 */
export function combineOffsets(a: EffectOffset, b: EffectOffset): EffectOffset {
  return {
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    alpha: (a.alpha ?? 1) * (b.alpha ?? 1),
  };
}

export const ZERO_OFFSET: EffectOffset = { dx: 0, dy: 0 };
