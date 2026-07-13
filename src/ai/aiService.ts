/**
 * AI 服务 — OpenAI 兼容 API 调用
 */

export interface AIConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

const STORAGE_KEY = 'sushibook_ai_config';

/** 从 localStorage 加载配置 */
export function loadAIConfig(): AIConfig {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { /* ignore */ }
  }
  return {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
  };
}

/** 保存配置到 localStorage */
export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** 调用 LLM 生成故事 */
export async function generateStory(
  prompt: string,
  config: AIConfig,
  systemPrompt: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('请先设置 API Key');
  }

  // B16：用 AbortController 合并「外部取消」与「超时」，避免长生成期间网络挂起一直转
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 90000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.85,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`API 错误 ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回内容为空');

    return cleanOutput(content);
  } finally {
    clearTimeout(timer);
  }
}

/** 清理 AI 输出：去掉 markdown 代码围栏 */
function cleanOutput(raw: string): string {
  let s = raw.trim();
  // 去掉 ```sushiml ... ``` 或 ```markdown ... ```
  s = s.replace(/^```\w*\s*\n?/, '').replace(/\n?```\s*$/, '');
  return s.trim();
}
