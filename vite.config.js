import { defineConfig } from 'vite';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// public 中的本地动捕文件仅供开发使用，生产构建完成后移除生成的副本。
function excludeLocalAnimations() {
  let outputPath;
  return {
    name: 'exclude-local-mixamo-animations',
    apply: 'build',
    configResolved(config) {
      outputPath = resolve(config.root, config.build.outDir, 'models/anims');
    },
    async closeBundle() {
      await rm(outputPath, { recursive: true, force: true });
    },
  };
}

// 部署到 GitHub Pages 的项目页：https://<用户>.github.io/interstellar-show/
export default defineConfig({
  base: '/interstellar-show/',
  plugins: [excludeLocalAnimations()],
  build: {
    target: 'es2022',
    // three.js 本身就有六七百 KB，提高告警阈值避免无意义的提示
    chunkSizeWarningLimit: 1200,
  },
});
