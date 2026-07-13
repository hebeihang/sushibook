/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.sushi'],
  build: {
    // B14：生产包默认 1.5MB 无分割，拆分大依赖并放宽告警阈值。
    // 注意 Vite 8 (Rolldown) 的 manualChunks 仅支持函数形式。
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | void {
          if (id.includes('node_modules/p5')) return 'p5';
          if (id.includes('node_modules/@codemirror') || id.includes('node_modules/@lezer')) {
            return 'codemirror';
          }
          if (
            id.includes('node_modules/zustand') ||
            id.includes('node_modules/mitt') ||
            id.includes('node_modules/@chenglou')
          ) {
            return 'vendor';
          }
        },
      },
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
