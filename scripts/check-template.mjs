// 验证自包含模板结构是否正确：
// 浏览器会把 `</script>`(未转义) 视为脚本块结束。JS 字符串里出现的 </script>
// 必须转义成 <\/script>，否则会提前闭合内联脚本块导致整页崩溃。
import { readFileSync } from 'node:fs';

const h = readFileSync('public/player-template.html', 'utf8');

// 未转义的 </script>（即 < 紧跟 /，中间没有反斜杠）
const unescapedRe = /<(?<!\\)\/script>/g;
const unescaped = (h.match(unescapedRe) || []).length;

// 转义后的 <\/script>
const escaped = (h.match(/<\\\/script>/g) || []).length;

// 合法的脚本块应为：1 个内联 module 脚本 + 1 个 sushi-source json 脚本 = 2 个未转义结束标签
console.log('unescaped </script> (real closing tags):', unescaped, unescaped === 2 ? 'OK' : 'CHECK');
console.log('escaped <\\/script> inside JS:', escaped, escaped > 0 ? 'OK' : 'NONE?');

console.log('has #sushi-source json:', /id="sushi-source"/.test(h));
console.log('has inline module script:', /<script type="module">[\s\S]+<\/script>/.test(h));
console.log('has leftover external ./assets/ ref:', /(\.\/)?assets\//.test(h));
console.log('has google fonts @import (would fail offline):', /@import\s+url\(['"]?https?:/.test(h));

if (unescaped !== 2 || /(\.\/)?assets\//.test(h)) {
  console.error('VALIDATION FAILED');
  process.exit(1);
}
console.log('\nVALIDATION PASSED ✅');
