# 写实人物素材交接

## 接手范围

继续 `claude/milestone-2-spectacle` 分支及 PR #2。素材已经下载、转换并接入，不需要重新选模、注册账号或下载同一批素材。接下来重点是最终网页视觉检查及演奏姿态微调，不要直接开始里程碑 3，也不要擅自合并 PR 或部署。

先读 `CLAUDE.md`、`docs/assets-installed.md`、`CREDITS.md`、`public/models/cast.json`。

## 已完成

- 六个 CC BY 4.0 人物 GLB 已放入 `public/models/`，三男三女，每个约 0.58–2.63 MB；来源、作者及许可见素材说明。
- 保留原有 CC0 指挥 `conductor.glb` 和全部旧人物文件，演员表使用新人物。
- Music Hall 01（CC0）的 2K HDRI 已放入 `public/hdri/concert_hall.hdr`。
- 人物使用最大 2K 贴图、WebP 及 Draco；没有把原始下载 ZIP、FBX 中间文件或任何影片/音频纳入仓库。
- 第三位男性保留原有标准 65 骨骼，统一骨骼名称，并修复了两件牙齿网格未跟随 Head 的问题。
- 三位女性在 Mixamo 选择 Standard Skeleton (65) 后实际返回 33 骨骼，部分指骨被合并；现有演奏接口的必需骨骼齐全，手指细节仍需近景确认。
- Sophia 服饰偏休闲；本次没有找到同时满足授权及适配要求的黑色长裙人物。

## 动作仅本地可用

本机 `public/models/anims/` 有 sitting-idle.fbx 和 standing-idle.fbx；`.env.local` 设置 `VITE_LOCAL_MIXAMO=1`。两者均被 Git 忽略，不在本次推送中。云端 Claude 无法取得这些本地文件，不要把它们的缺失当作仓库损坏，也不要在公开演员表加不存在的动画引用。

加载器仅在开发环境且显式启用开关时读取这些动作；生产构建还会移除输出目录的动作副本。云端和发布版本继续使用已有程序化演奏动作。

## 验证状态与剩余工作

- 构建及六个 GLB 的结构检查已通过；本地动作的 FBX 解析也通过。提交前已再次核对构建、发布产物及最新修改的男性模型；独立复核确认两件牙齿均以 100% 权重绑定 Head。
- 浏览器初查曾确认六个模型全部加载、前排上身动捕 19/19 生效，未出现模型加载错误。
- [座位视角初查图](screenshots/assets-seat-initial.jpg) 使用 `?mock`，不含电影画面。该截图是在牙齿绑定最后修复之前取得，仅供对照，不能代替最终验收。
- 最终版本的弦乐近景、合唱近景，以及牙齿修复后的网页复核尚未完成。初查画面白色服装高光较强，调试 HUD 曾显示约 23 FPS；这不是正式性能基准。
- 请运行 `npm ci`、`npm run dev`，从 `/interstellar-show/?mock=60&debug` 入场。分别拍座位视角和乐手近景，检查左肩架琴、左手琴颈、右手持弓、穿模、浮空和比例。
- 先给出具体模型、问题位置和截图，再处理持琴/IK 微调。此前没有修改 `src/songs.js` 或演奏 IK。
- 修复后再做一轮定点检查；避免为了全场大截图反复卡在软件渲染。

原始素材及处理中间文件位于本机 Downloads 和 `/private/tmp/interstellar-source/`，不会出现在云端检出目录。
