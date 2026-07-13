import { describe, it, expect } from 'vitest';
import { buildStandaloneHtml } from './exportHtml';

const TPL =
  '<html><body><script type="application/json" id="sushi-source">"__SUSHI_STORY_SOURCE__"</script></body></html>';

describe('buildStandaloneHtml', () => {
  it('把故事源码注入占位符', () => {
    const out = buildStandaloneHtml(TPL, '## start\n你好');
    expect(out).toContain('"## start\\n你好"');
    expect(out).not.toContain('__SUSHI_STORY_SOURCE__');
  });

  it('转义 < 以避免 </script> 提前闭合', () => {
    const out = buildStandaloneHtml(TPL, 'a < b </script>');
    // 故事里的 </script> 必须被转义，不能额外产生一个脚本结束标签
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003c/script>');
    // 整页只应有模板自带的 1 个 </script>（sushi-source 脚本的结束标签）
    expect((out.match(/<\/script>/g) || []).length).toBe(1);
    // 原始未转义的 </script> 不应出现在注入的数据中
    expect(out).not.toContain(' b </script>"');
  });

  it('模板缺少占位符时抛错', () => {
    expect(() => buildStandaloneHtml('<html></html>', 'x')).toThrow();
  });
});
