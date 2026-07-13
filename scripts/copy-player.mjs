// 构建后处理：把 dist-player/ 产物内联为单一自包含 HTML，
// 写入 public/player-template.html（「导出 HTML5」功能的模板）。
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist-player');
const htmlPath = resolve(distDir, 'player.html');
const outPath = resolve(root, 'public', 'player-template.html');

if (!existsSync(htmlPath)) {
  console.error('[copy-player] 未找到 dist-player/player.html，请先运行 build:player。');
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');

// 1) 收集被引用的本地 JS / CSS 资源（去重）
const jsRels = new Set();
const cssRels = new Set();

const scriptRe =
  /<script\b[^>]*\bsrc=["'](\.\/assets\/[^"']+\.js)["'][^>]*>\s*<\/script>/gi;
const linkCssRe = /<link\b[^>]*\bhref=["'](\.\/assets\/[^"']+\.css)["'][^>]*>/gi;
const preloadRe =
  /<link\b[^>]*\bhref=["'](\.\/assets\/[^"']+\.js)["'][^>]*rel=["']modulepreload["'][^>]*>/gi;

let m;
while ((m = scriptRe.exec(html)) !== null) jsRels.add(m[1]);
while ((m = preloadRe.exec(html)) !== null) jsRels.add(m[1]);
while ((m = linkCssRe.exec(html)) !== null) cssRels.add(m[1]);

// 2) 读取并转义 JS（把 JS 字符串里的 </script> 转义，避免提前闭合内联块）
const toAbs = (rel) => resolve(distDir, rel.replace(/^\.\//, ''));
let combinedJs = '';
for (const rel of jsRels) {
  const code = readFileSync(toAbs(rel), 'utf8').replace(/<\/script>/gi, '<\\/script>');
  combinedJs += code + '\n;\n';
}
let combinedCss = '';
for (const rel of cssRels) {
  combinedCss += readFileSync(toAbs(rel), 'utf8') + '\n';
}

// 3) 删除所有外部 script / link(modulepreload|stylesheet) 标签
//    使用 replacer 函数而非字符串，避免替换串里的 $& / $` / $' 被当成反向引用
const blank = () => '';
html = html.replace(scriptRe, blank);
html = html.replace(preloadRe, blank);
html = html.replace(linkCssRe, blank);
// 兜底：删除任何残留的 ./assets/ 引用标签
html = html.replace(
  /<script\b[^>]*\bsrc=["']\.\/assets\/[^"']+["'][^>]*>\s*<\/script>/gi,
  blank
);
html = html.replace(/<link\b[^>]*\bhref=["']\.\/assets\/[^"']+["'][^>]*>/gi, blank);

// 4) 注入内联 style（head 内）与内联 script（body 末尾，sushi-source 之后）
//    必须用 replacer 函数：内联 JS 内含 $& / $` / $' 等序列，若用字符串替换会被误解析
if (combinedCss) {
  html = html.replace('</head>', () => `<style>\n${combinedCss}\n</style>\n</head>`);
}
// 经典脚本（非 module）：IIFE 包在 file:// 下双击即可运行，无 CORS 限制
const inlineScript = `<script>\n${combinedJs}\n</script>`;
if (html.includes('</body>')) {
  html = html.replace('</body>', () => `${inlineScript}\n</body>`);
} else {
  html += inlineScript;
}

if (!existsSync(resolve(root, 'public'))) {
  mkdirSync(resolve(root, 'public'), { recursive: true });
}
writeFileSync(outPath, html, 'utf8');

const leftover = /(\.\/)?assets\//.test(html);
console.log(`[copy-player] 已写出 ${outPath}`);
console.log(`  内联 JS 字符数: ${combinedJs.length}`);
console.log(`  内联 CSS 字符数: ${combinedCss.length}`);
console.log(`  残留 ./assets/ 引用: ${leftover ? '有（需检查!）' : '无'}`);
if (leftover) process.exit(2);
