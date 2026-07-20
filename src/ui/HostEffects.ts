/**
 * HostEffects — 宿主命令执行器（Kiny §11）
 *
 * 消费 host:command 事件：
 *   @bg_show(value)  显示背景（URL / #颜色 / CSS 渐变）
 *   @bg_hide()       隐藏背景
 *   @bgm_play(url)   循环播放 BGM（同曲重复调用不重启）
 *   @bgm_pause()     暂停
 *   @bgm_stop()      停止并卸载
 */

import { emitter } from '../core/EventBus';
import { markDeclarativeBg } from './stageBackground';

export class HostEffects {
  private bgEl: HTMLElement;
  private audio: HTMLAudioElement | null = null;
  private currentBgmSrc: string = '';

  constructor(bgEl: HTMLElement) {
    this.bgEl = bgEl;

    emitter.on('host:command', ({ name, args }) => {
      try {
        this.execute(name, args);
      } catch (err) {
        console.warn(`宿主命令 @${name} 执行失败:`, err);
      }
    });
  }

  private execute(name: string, args: unknown[]): void {
    switch (name) {
      case 'bg_show': {
        const value = String(args[0] ?? '');
        if (!value) return;
        // 颜色/渐变直接作为 background，其余按图片 URL 处理
        if (/^(#|linear-gradient|radial-gradient|rgb)/.test(value)) {
          this.bgEl.style.background = value;
        } else {
          this.bgEl.style.background = `url("${value}") center / cover no-repeat`;
        }
        this.bgEl.style.opacity = '1';
        // 运行时命令接管背景：声明式标记让位
        markDeclarativeBg(false);
        break;
      }

      case 'bg_hide':
        this.bgEl.style.opacity = '0';
        markDeclarativeBg(false);
        break;

      case 'bgm_play': {
        const src = String(args[0] ?? '');
        if (!src) return;
        if (!this.audio) {
          this.audio = new Audio();
          this.audio.loop = true;
        }
        // 同曲重复调用（热重载常见）不重启
        if (this.currentBgmSrc === src && !this.audio.paused) return;
        if (this.currentBgmSrc !== src) {
          this.audio.src = src;
          this.currentBgmSrc = src;
        }
        void this.audio.play().catch((err) => {
          console.warn('BGM 播放失败（可能需要用户交互后才允许自动播放）:', err);
        });
        break;
      }

      case 'bgm_pause':
        this.audio?.pause();
        break;

      case 'bgm_stop':
        if (this.audio) {
          this.audio.pause();
          this.audio.currentTime = 0;
          this.audio.removeAttribute('src');
          this.currentBgmSrc = '';
        }
        break;

      default:
        console.warn(`未知宿主命令: @${name}`);
    }
  }

  public destroy(): void {
    this.audio?.pause();
    this.audio = null;
  }
}
