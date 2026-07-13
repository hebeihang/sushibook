// 生成一个演示用导出文件，便于直接双击验证 file:// 离线打开
import { readFileSync, writeFileSync } from 'node:fs';

const TPL = readFileSync('public/player-template.html', 'utf8');
const SOURCE_TOKEN = '"__SUSHI_STORY_SOURCE__"';
const demoStory = `## start
title: 示例故事 · 离线演示
@enter fade 800
@mood calm
message: 这是一段示范文本，包含 < 小于号 与 </script> 这种会被转义的字符，用于验证导出健壮性。
options:
- 继续阅读 @goto next
- 直接结束 @goto end
## next
text: 第二幕：粒子在夜色里缓缓升起。
- 回到开头 @goto start
## end
text: 故事结束。感谢体验 SushiBook 网页版导出。`;

function buildStandaloneHtml(template, source) {
  if (!template.includes(SOURCE_TOKEN)) throw new Error('missing token');
  const injected = JSON.stringify(source).replace(/</g, '\\u003c');
  return template.replace(SOURCE_TOKEN, injected);
}

const out = buildStandaloneHtml(TPL, demoStory);
const f = 'sushibook-demo.html';
writeFileSync(f, out, 'utf8');
const hasModule = /<script[^>]*\stype=["']module["']/.test(out);
console.log(`已生成 ${f} (${(out.length / 1024).toFixed(0)} KB)`);
console.log('含 type="module":', hasModule, '| 外链 ./assets/:', /(\.\/)?assets\//.test(out));
console.log('可双击离线打开：', !hasModule && !/(\.\/)?assets\//.test(out) ? '是 ✅' : '否 ❌');
