import { describe, it, expect } from 'vitest';
import { applyEffectRules } from './effectRules';

const SRC = `## start
---
mood: tense
---
第一句正文。
中间一句！
最后一句正文。

>> 继续 -> next

## next
---
mood: default
---
平静的开场。
结尾。`;

describe('applyEffectRules — 效果轨自动注入', () => {
  it('每个场景第一句注入 typewriter，速度随 mood 变化', () => {
    const out = applyEffectRules(SRC);
    expect(out).toContain('第一句正文。{typewriter: 100ms}'); // tense → 100ms
    expect(out).toContain('平静的开场。{typewriter: 60ms}'); // default → 60ms
  });

  it('最后一句注入 pause: 800', () => {
    const out = applyEffectRules(SRC);
    expect(out).toContain('最后一句正文。{pause: 800}');
    expect(out).toContain('结尾。{pause: 800}');
  });

  it('感叹/疑问结尾的中间句注入 pause: 600', () => {
    const out = applyEffectRules(SRC);
    expect(out).toContain('中间一句！{pause: 600}');
  });

  it('不改动 frontmatter、标题和选项行', () => {
    const out = applyEffectRules(SRC);
    expect(out).toContain('## start');
    expect(out).toContain('mood: tense');
    expect(out).toContain('>> 继续 -> next');
  });

  it('已有句子级指令的行跳过注入', () => {
    const src = `## s
自带指令的第一句。{typewriter: 30ms}
最后一句。`;
    const out = applyEffectRules(src);
    expect(out).toContain('自带指令的第一句。{typewriter: 30ms}');
    expect(out).not.toContain('{typewriter: 30ms}{');
  });

  it('词语级指令不被误判为句子级指令（首句仍会注入）', () => {
    const src = `## s
它像[[鱼群]]{enter: swim}一样游动
第二句。`;
    const out = applyEffectRules(src);
    // 首句只有词语级指令 → 仍注入 typewriter
    expect(out).toMatch(/一样游动\{typewriter: \d+ms\}/);
  });

  it('保留首个 ## 之前的序言区（~ 变量声明 / 注释），不被静默丢弃（B4）', () => {
    const src = `~ let gold = 10
// 这是序言区的注释
## start
---
mood: default
---
开场白。
结尾。`;
    const out = applyEffectRules(src);
    // 序言区原样保留
    expect(out).toContain('~ let gold = 10');
    expect(out).toContain('// 这是序言区的注释');
    // 首场景效果注入仍正常（证明序言保留未破坏场景逻辑）
    expect(out).toContain('开场白。{typewriter: 60ms}');
    expect(out).toContain('结尾。{pause: 800}');
  });
});
