/**
 * AIPanel — AI 生成故事弹窗
 *
 * 流程：用户输入创意 prompt → aiService 调 LLM（只产内容轨）
 * → effectRules 自动注入效果轨 → 写回编辑器。
 */

import { loadAIConfig, saveAIConfig, generateStory, type AIConfig } from '../ai/aiService';
import { SYSTEM_PROMPT } from '../ai/systemPrompt';
import { applyEffectRules } from '../ai/effectRules';

export class AIPanel {
  private overlay: HTMLElement;
  private config: AIConfig;
  private onGenerated: (sushiSource: string) => void;
  private busy = false;
  private controller: AbortController | null = null;

  constructor(onGenerated: (sushiSource: string) => void) {
    this.onGenerated = onGenerated;
    this.config = loadAIConfig();
    this.overlay = this.build();
    document.body.appendChild(this.overlay);
  }

  public open(): void {
    this.overlay.classList.add('visible');
    (this.overlay.querySelector('#ai-prompt') as HTMLTextAreaElement)?.focus();
  }

  public close(): void {
    // B16：生成中关闭即中断网络请求（取消）
    if (this.busy) {
      this.controller?.abort();
    }
    this.overlay.classList.remove('visible');
  }

  private build(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'ai-overlay';
    overlay.innerHTML = `
      <div id="ai-modal" role="dialog" aria-label="AI 生成故事">
        <div class="ai-modal-header">
          <span>✨ AI 生成故事</span>
          <button type="button" class="btn-ghost" id="ai-close">✕</button>
        </div>
        <div class="ai-modal-body">
          <label class="ai-label">故事创意</label>
          <textarea id="ai-prompt" rows="3"
            placeholder="例如：一个字修复师在废弃图书馆里发现了一本会呼吸的书……"></textarea>

          <details class="ai-settings">
            <summary>API 设置</summary>
            <label class="ai-label">Endpoint（OpenAI 兼容）</label>
            <input id="ai-endpoint" type="text" />
            <label class="ai-label">API Key</label>
            <input id="ai-key" type="password" autocomplete="off" />
            <label class="ai-label">模型</label>
            <input id="ai-model" type="text" />
          </details>

          <div id="ai-status"></div>
        </div>
        <div class="ai-modal-footer">
          <button type="button" class="btn-ghost" id="ai-cancel">取消</button>
          <button type="button" class="btn-primary" id="ai-generate">生成</button>
        </div>
      </div>
    `;

    const $ = <T extends HTMLElement>(sel: string) => overlay.querySelector(sel) as T;

    // 填充已保存配置
    $<HTMLInputElement>('#ai-endpoint').value = this.config.endpoint;
    $<HTMLInputElement>('#ai-key').value = this.config.apiKey;
    $<HTMLInputElement>('#ai-model').value = this.config.model;

    $('#ai-close').addEventListener('click', () => this.close());
    $('#ai-cancel').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    $('#ai-generate').addEventListener('click', () => void this.generate(overlay));

    return overlay;
  }

  private async generate(overlay: HTMLElement): Promise<void> {
    if (this.busy) return;
    const $ = <T extends HTMLElement>(sel: string) => overlay.querySelector(sel) as T;
    const status = $('#ai-status');
    const generateBtn = $<HTMLButtonElement>('#ai-generate');

    const prompt = $<HTMLTextAreaElement>('#ai-prompt').value.trim();
    if (!prompt) {
      status.textContent = '请先输入故事创意';
      status.className = 'error';
      return;
    }

    // 保存配置
    this.config = {
      endpoint: $<HTMLInputElement>('#ai-endpoint').value.trim(),
      apiKey: $<HTMLInputElement>('#ai-key').value.trim(),
      model: $<HTMLInputElement>('#ai-model').value.trim(),
    };
    saveAIConfig(this.config);

    this.busy = true;
    generateBtn.disabled = true;
    status.textContent = '生成中…（约 10-30 秒，可取消）';
    status.className = '';

    this.controller = new AbortController();
    try {
      const raw = await generateStory(prompt, this.config, SYSTEM_PROMPT, {
        signal: this.controller.signal,
        timeoutMs: 90000,
      });
      // 效果规则引擎：自动注入 typewriter / pause 效果轨
      const withEffects = applyEffectRules(raw);
      this.onGenerated(withEffects);
      status.textContent = '';
      this.busy = false;
      this.controller = null;
      generateBtn.disabled = false;
      this.close();
    } catch (err) {
      this.busy = false;
      this.controller = null;
      generateBtn.disabled = false;
      // B16：识别取消（AbortError）给出友好提示，不视为错误
      if (err instanceof DOMException && err.name === 'AbortError') {
        status.textContent = '已取消生成';
        status.className = '';
        return;
      }
      status.textContent = err instanceof Error ? err.message : String(err);
      status.className = 'error';
    }
  }
}
