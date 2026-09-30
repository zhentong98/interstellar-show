import { defineConfig } from 'vite';

// 部署到 GitHub Pages 的项目页：https://<用户>.github.io/interstellar-show/
export default defineConfig({
  base: '/interstellar-show/',
  build: {
    target: 'es2022',
    // three.js 本身就有六七百 KB，提高告警阈值避免无意义的提示
    chunkSizeWarningLimit: 1200,
  },
});
