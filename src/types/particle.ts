/**
 * 粒子状态机
 * idle:   已到达目标位置，静止中
 * flying: 正在飞向目标位置
 * fading: 正在淡出，即将死亡
 */
export type ParticleState = 'idle' | 'flying' | 'fading';

/**
 * 情绪类型
 */
export type MoodType = 'default' | 'tense' | 'float' | 'storm';

/**
 * 粒子配置
 */
export interface ParticleConfig {
  /** Lerp 缓动系数（0-1，越大越快到达） */
  easing: number;
  /** 吸附距离阈值（px），低于此距离直接吸附 */
  snapDistance: number;
  /** 透明度吸附阈值 */
  snapOpacity: number;
  /** 默认文字颜色 [r, g, b] */
  textColor: [number, number, number];
}

/**
 * 默认粒子配置
 */
export const DEFAULT_PARTICLE_CONFIG: ParticleConfig = {
  easing: 0.1,
  snapDistance: 0.5,
  snapOpacity: 2,
  textColor: [230, 230, 240],
};
