import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * 构建网页版播放器：输出到 dist-player/。
 * 真正的「单一自包含 HTML」内联发生在 scripts/copy-player.mjs 里（构建后从磁盘读取
 * JS / CSS 并内联），这样不依赖 Vite 内部 HTML 注入时序，更稳定、可调试。
 */
export default defineConfig({
  base: './',
  build: {
    outDir: resolve(root, 'dist-player'),
    emptyOutDir: true,
    cssCodeSplit: false,
    // 现代浏览器原生支持 modulepreload，关闭 polyfill 以减少额外脚本标签
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: resolve(root, 'player.html'),
      output: {
        // 输出为 IIFE（经典脚本），这样内联后双击 file:// 打开也不会触发
        // ES module 的 CORS 限制（Chrome 对 file:// 下的 module 脚本有同源限制）。
        format: 'iife',
        name: 'SushiBookPlayer',
        entryFileNames: 'assets/player.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
