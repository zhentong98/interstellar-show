# Interstellar Show

网页版 3D 演出：乐团在音乐厅演奏星际穿越对接配乐，巨幕播放对接片段。
完整设计见 `docs/plans/2026-09-30-interstellar-show-design.md`，实现前先读它。

## 硬性约束

- **绝不提交受版权保护的音视频**（原声、电影片段）。它们只能由用户本人放在 `media/`，该目录已被 gitignore。
- 不得用代码合成或模仿《No Time for Caution》等原曲旋律；Web Audio 只做原创的氛围/冲击音效。
- 公开部署版本必须在没有 `media/` 的情况下完整可用（回退到 YouTube 嵌入）。

## 技术约定

- Vite + Three.js，纯静态，部署到 GitHub Pages（`vite.config.js` 的 `base` 设为 `/interstellar-show/`）
- 代码注释与 UI 文案使用简体中文
- 演出节奏集中在 `src/cues.js`，不要把时间点散落在其他文件

## 常用命令

- `npm run dev` 本地开发
- `npm run build` 构建
