// 端到端模拟「导出 HTML5」：读模板 + 注入故事 + 校验产物
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TPL = readFileSync('public/player-template.html', 'utf8');
const SOURCE_TOKEN = '"__SUSHI_STORY_SOURCE__"';
const sampleStory = `## start
title: 测试故事
@enter fade 800
选项 < 危险区 </script> 与正常文本
- 继续 @goto next
## next
text: 第二幕`;

function buildStandaloneHtml(template, source) {
  if (!template.includes(SOURCE_TOKEN)) throw new Error('missing token');
  const injected = JSON.stringify(source).replace(/</g, '\\u003c');
  return template.replace(SOURCE_TOKEN, injected);
}

const out = buildStandaloneHtml(TPL, sampleStory);
const f = 'dist/__e2e_export_check.html';
writeFileSync(f, out);

const unescaped = (out.match(/<\/script>/g) || []).length;
const escaped = (out.match(/<\\\/script>/g) || []).length;
console.log('token removed:', !out.includes('__SUSHI_STORY_SOURCE__'));
console.log('story injected (escaped </script> present):', out.includes('\\u003c/script>'));
console.log('unescaped </script> count (expect 2):', unescaped);
console.log('escaped <\\/script> count:', escaped);
console.log('leftover ./assets/ ref:', /(\.\/)?assets\//.test(out));
console.log('google fonts @import:', /@import\s+url\(['"]?https?:/.test(out));

// 校验：文件内不含 ES module 脚本（file:// 双击需经典脚本）
const hasModuleScript = /<script[^>]*\stype=["']module["']/.test(out);
console.log('contains type="module" (expect false):', hasModuleScript);

// 抽取内联经典脚本做语法检查
const m = out.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
if (m) {
  writeFileSync('dist/__e2e_inline.js', m[1]);
  try {
    execSync('node --check dist/__e2e_inline.js', { stdio: 'pipe' });
    console.log('inline JS syntax: OK');
  } catch (e) {
    console.log('inline JS syntax FAILED:\n', String(e.stderr || e).slice(0, 400));
  }
} else {
  console.log('could not extract inline script');
}

const ok =
  !out.includes('__SUSHI_STORY_SOURCE__') &&
  unescaped === 2 &&
  !hasModuleScript &&
  !/(\.\/)?assets\//.test(out);
console.log('\nE2E RESULT:', ok ? 'PASS ✅' : 'FAIL ❌');
process.exit(ok ? 0 : 1);
