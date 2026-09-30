# 交接：改到本地继续开发

更新日期：2026-09-30。云端开发到此暂停，之后在本地电脑继续。

## 1. 拉代码

本地已有仓库：

```bash
cd interstellar-show
git fetch origin
git checkout claude/auto-director
npm install
npm run dev
```

还没有仓库就先 `git clone https://github.com/zhentong98/interstellar-show.git`，再执行上面的命令。

`claude/auto-director` = PR #4（`claude/camera-views`）+ 一个未测试的提交；不含 PR #3，PR #3 合并进 `main` 后会带上。

## 2. 本地打开

- 真实 YouTube 原声：http://localhost:5173/interstellar-show/
- 模拟播放器 + 调试面板：http://localhost:5173/interstellar-show/?mock=90&debug
- 本机 `.env.local` 设置 `VITE_LOCAL_MIXAMO=1` 时，开发服务器会加载 `public/models/anims/` 里的两个 Mixamo 动作（不提交）。

## 3. 当前状态

| 项目 | 状态 |
|---|---|
| [PR #3](https://github.com/zhentong98/interstellar-show/pull/3) 合唱团两臂交叉修复 | 已完成，等合并 |
| [PR #4](https://github.com/zhentong98/interstellar-show/pull/4) 固定机位 + 自由移动 | 已完成，等看效果和合并 |
| 自动导播（快捷键 `0`） | 在 `claude/auto-director`，能构建，未测试 |
| 开场仪式从约 1 分钟压到约 30 秒 | 同上 |
| 开演前"下一首"显示为"跳过开场" | 同上 |
| 里程碑 3、4 | 未开始，等确认 |

已知限制：指挥仍是 MakeHuman 生成的旧模型；女性扫描模型的手指不能单独弯曲。

## 4. 给本地 Claude Code 的 prompt

```
继续开发 zhentong98/interstellar-show。先阅读 CLAUDE.md、README.md、docs/assets-installed.md、docs/handover-local.md。
当前在分支 claude/auto-director 上工作（基于 PR #4 的 claude/camera-views，多了一个未测试的提交）。

硬性约束：
- 不提交任何受版权保护的音视频；media/ 和 public/models/anims/ 已被 gitignore
- 不合成或模仿原曲旋律，Web Audio 只做原创音效
- src/songs.js 的 YouTube ID 不要改
- 代码注释和 UI 文案用简体中文
- 不要擅自合并 PR 或部署，每项做完停下来等我确认

现状：
- PR #3（合唱团两臂交叉修复）和 PR #4（固定机位 + 自由移动）已开，等我合并。
- claude/auto-director 上有三项已写好、能构建、但没在浏览器里测过的改动：
  1. 自动导播（src/stage/cameraRig.js 的 AUTO 和 #direct，快捷键 0）：演奏时按强度加权切机位，
     定音鼓重击前切定音鼓，闪光时切全景，不演奏时交回预设运镜
  2. 开场仪式从约 1 分钟压到约 30 秒（src/cues/ceremony.js）
  3. 开演前控制条的"下一首"显示为"跳过开场"（src/ui/controls.js）

请先做：
1. npm run dev，用 ?mock=90&debug 和真实 YouTube 各看一遍：
   - 开场约 30 秒，节奏自然，"跳过开场"能直接开始第一首
   - 按 0 开自动导播：切镜节奏舒服，座位视角（看得到电影）占大部分时间，
     Cornfield Chase 第 105 秒前后会切到定音鼓；换场时回到预设运镜
   - 1～8、F 各机位和自由移动在真实显卡上过渡流畅；定音鼓机位（6）鼓手的头在画面里
2. 发现的问题直接修，然后把 claude/auto-director 合进 claude/camera-views 推送（更新 PR #4），
   在 PR 描述里补上这三项和测试结果。不要合并 PR。
3. 做完告诉我结果，等我确认后再讨论里程碑 3。
```

## 5. 研究结论："让乐团发出声音"

- **线上版（YouTube）做不到。** 浏览器不允许网页读取或处理跨域 YouTube 播放器里的声音。线上版只能靠节奏表（`src/cues/<slug>.js`）让乐团"看起来"在演奏；能做的是打开 `?debug` 对着视频逐段校准节奏表。
- **本地版可以，建议并进里程碑 3。** 用户把自己合法拥有的片段放进 `media/<slug>.mp4`，用 `<video>` 播放并接入 Web Audio：
  - `AnalyserNode` 实时取音量、低频能量和节拍，驱动弓速、定音鼓、灯光；
  - 按镜头位置调整声音：推到定音鼓时低频加重，推到小提琴时弦乐频段更清楚，再加音乐厅卷积混响，让声音像是从舞台发出来。
- **进阶：分离音轨。** 在本地用开源的 Demucs 把片段拆成 vocals（合唱）、drums（定音鼓）、bass（管风琴低音）、other（弦乐）四轨，每轨用 `PannerNode` 放在舞台上对应的位置，镜头走到哪里，混音就跟着变。分离结果只放在 `media/`，不提交。管弦乐的分离效果不会完美，需要实测。
- **不建议合成乐器声音。** 按约束不能模仿原曲旋律，原创的乐器声又会和电影原声打架。
