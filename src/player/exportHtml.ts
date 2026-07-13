/**
 * 把当前故事源码注入到预先构建好的「自包含 HTML 模板」中，
 * 生成可直接双击在浏览器离线打开的网页版电子书。
 *
 * 模板由 `vite.player.config.ts` 构建并复制到 `public/player-template.html`，
 * 其中包含一个占位符 `"__SUSHI_STORY_SOURCE__"`，位于
 * `<script type="application/json" id="sushi-source">` 内。
 */

const SOURCE_TOKEN = '"__SUSHI_STORY_SOURCE__"';

/**
 * @param template 预先构建好的自包含 HTML（含 p5 + 引擎，全部内联）
 * @param source   当前 SushiML 故事源码
 * @returns 注入故事后的完整 HTML 字符串
 */
export function buildStandaloneHtml(template: string, source: string): string {
  if (!template.includes(SOURCE_TOKEN)) {
    throw new Error('导出模板缺少故事占位符 __SUSHI_STORY_SOURCE__');
  }
  // JSON 序列化后转义 `<`，避免故事中的 `</script>` 提前闭合脚本块
  const injected = JSON.stringify(source).replace(/</g, '\\u003c');
  return template.replace(SOURCE_TOKEN, injected);
}
