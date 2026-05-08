/**
 * 离屏 Canvas 测量上下文（单例）
 * 
 * 关键设计决策：
 * 必须与 p5.js 渲染层使用完全相同的 font 配置，
 * 否则字体渲染上下文不同会导致坐标微偏差。
 */
class MeasureContextSingleton {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('MeasureContext: 无法创建 OffscreenCanvas 2D 上下文');
    }
    this.ctx = ctx;
  }

  /**
   * 获取共享的 2D 上下文
   * 调用方必须在使用前设置 ctx.font
   */
  getContext(): OffscreenCanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * 设置字体并返回上下文（便捷方法）
   */
  withFont(font: string): OffscreenCanvasRenderingContext2D {
    this.ctx.font = font;
    return this.ctx;
  }
}

/** 全局共享的测量上下文 */
export const measureContext = new MeasureContextSingleton();
