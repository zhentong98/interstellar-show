# Interstellar Show

一场在浏览器里的《星际穿越》电影交响音乐会：观众坐在音乐厅第 8 排，巨幕播放电影原片片段，
乐团在银幕下方现场演奏。从入场、调音、指挥上台、曲间掌声，一直到终场谢幕，全程自动进行。

完整设计见 [`docs/plans/2026-09-30-interstellar-show-design.md`](docs/plans/2026-09-30-interstellar-show-design.md)。

## 观看

- **在线版**：<https://zhentong98.github.io/interstellar-show/>（合并到 `main` 后由 GitHub Actions 自动部署）。
  巨幕通过 YouTube 嵌入播放片段，声音来自片段本身。
- 在节目单上勾选想听的曲目，按"入场"：进入全屏、隐藏鼠标，之后不需要任何操作。
  鼠标移到屏幕底部可以唤出控制条（选镜头 / 下一首 / 结束演出）。
- **换镜头**：默认坐在第 8 排。也可以切到固定机位，像音乐会转播一样看指挥、小提琴、大提琴、定音鼓、管风琴、合唱团，
  或者自由移动。快捷键：`1` 座位、`2` 舞台全景、`3` 指挥、`4` 小提琴、`5` 大提琴、`6` 定音鼓、`7` 管风琴、`8` 合唱团、`F` 自由移动。
  按 `0` 开自动导播：演奏时像电视转播一样跟着音乐切机位（大部分时间留在座位看电影，定音鼓重击前切到定音鼓，闪光时切全景），
  入场、换场、谢幕时交回预设运镜。
  自由移动时拖动鼠标转视角、滚轮推拉、右键拖动平移、`WASD` / 方向键移动；手机上单指转、双指缩放。
- **写实人物**：把 Mixamo 绑好骨骼的模型放进 `public/models/` 并写好 `cast.json`，乐团和指挥会自动换成这些模型
  （前排完整骨骼 + IK，后排烘焙姿势后实例化）；没有的话使用程序化人体。
- **更写实的反射**：把 CC0 的音乐厅 HDRI 放到 `public/hdri/concert_hall.hdr`，页面会自动换上。
  需要手动下载的素材清单和具体步骤见 [`docs/assets-to-download.md`](docs/assets-to-download.md)。
- **本地增强版**（里程碑 3）：把你自己合法拥有的片段放到 `media/<slug>.mp4`（该目录不会被提交），
  乐手会跟着真实音频律动。

## 开发

```bash
npm install
npm run dev      # http://localhost:5173/interstellar-show/
npm run build    # 输出到 dist/
```

调试参数（可以组合使用）：

| 参数 | 作用 |
|---|---|
| `?mock` / `?mock=90` | 用模拟播放器代替 YouTube（每段 40 秒 / 90 秒），离线也能跑完整场 |
| `?mockstall=12` | 模拟播放器在第 12 秒缓冲 3 秒，检查幕布和乐团的等待姿态 |
| `?debug` | 左上角显示当前环节、播放时间、cue 名称、强度和当前镜头，用来对照视频校准 cue 表 |
| `?speed=4` | 仪式环节加速 4 倍（不影响视频本身） |

## 目录

```
src/
  songs.js            曲目数据（YouTube ID 已核实，勿改）
  cues/               演出节奏：ceremony.js 是仪式环节的时长，<slug>.js 是每首的 cue 表
  show/director.js    演出状态机：开演前 → 逐首播放 → 换场 → 终场 → 节目单背面
  show/world.js       场景总装与渲染循环（CSS3D 层 + WebGL 层共用一台相机）
  show/cueRunner.js   按播放时间插值强度、触发 flash / shake / drumHit
  show/post.js        后处理：Bloom + ACES，保留巨幕挖洞需要的 alpha
  stage/              音乐厅、巨幕（挖洞 + 幕布 + Gargantua）、乐团、指挥、观众、灯光、镜头
  stage/humans/       人体骨骼（Mixamo 命名）、IK 姿态、程序化身体、写实模型加载（cast.js / modelRig.js / bake.js）
  stage/atmosphere.js 体积光束、烟雾、浮尘（经过银幕区域时自动淡出）
  video/              YouTube 播放器封装、模拟播放器、播放时钟（插值与异常判定）
  audio/sfx.js        原创合成音效：掌声、交谈、咳嗽、翻谱、调音（A = 440Hz）
  ui/                 节目单、控制条、节目单背面、调试面板
```

## 已知限制

- 每首的 cue 时间点目前是按场景段落粗略估计的，需要打开 `?debug` 对照视频逐段校准。
- 官方频道的片段可能插播广告，前端无法可靠检测或跳过：画面卡住时幕布会盖住巨幕、乐团等待；
  超过 25 秒会拉开幕布让观众自己点"跳过"，或点空白处跳到下一首。
- Safari 对跨域 iframe 的有声自动播放更严格，可能会出现"点击画面继续演出"的提示，点一下即可。

## 版权

仓库里不包含任何受版权保护的音视频。第三方素材登记在 [`CREDITS.md`](CREDITS.md)。
