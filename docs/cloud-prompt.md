# 云端 Claude Code 任务 prompt

在 claude.ai/code 选择 `zhentong98/interstellar-show` 后，粘贴下面这段。

---

先完整阅读 CLAUDE.md、docs/plans/2026-09-30-interstellar-show-design.md 和 src/songs.js，它们是这个项目的唯一依据。

我们要做一场在浏览器里的"星际穿越电影交响音乐会"：观众坐在音乐厅里，巨大银幕播放电影原片片段，写实的交响乐团在银幕下方现场演奏，从入场、调音、开演、曲间掌声，一直到终场谢幕，全程像真的在看一场 show。

请按以下 4 个里程碑推进，**每个里程碑单独开分支、单独提 PR**，完成一个就停下来，等我确认后再做下一个。

## 里程碑 1：演出骨架（先让整场 show 跑通）
- Vite + Three.js 初始化，vite.config.js 的 base 设为 /interstellar-show/
- 加 .github/workflows/deploy.yml，用 Actions 部署到 GitHub Pages（仓库已开启 Pages，build_type=workflow）
- 节目单选歌页：纸质质感、衬线字体、可多选、默认全选，标注片段来源频道，official=false 的标"非官方上传"
- "入场"按钮：进入全屏、隐藏鼠标、解锁有声播放，之后全程自动，不需要任何操作
- 3D 音乐厅的基础结构（先用简单几何体占位乐手）+ 电影座位视角镜头
- 巨幕：CSS3DRenderer 嵌入 YouTube，在 WebGL 层"挖洞"，让前景物体能遮住视频（见设计文档"巨幕的渲染层次"）
- 完整演出状态机：入场 → 调音 → 指挥上台 → 逐首播放 → 曲间换场（掌声、字幕牌、Gargantua 过渡、预加载下一段）→ 终场谢幕 → 节目单背面
- 处理 YouTube 的沉浸感陷阱：播放器参数、结束前 0.5 秒切走、缓冲和异常时用幕布盖住

## 里程碑 2：写实乐团
- 编制：约 40 人弦乐、30 人合唱、4 架定音鼓、管风琴（含音管墙）、指挥
- 写实人体模型 + 动作捕捉动画 + PBR 乐器；前排完整骨骼，后排 InstancedMesh
- 灯光：HDRI、舞台追光、体积光、薄雾、bloom、ACES；灯光不溢到银幕上
- 前排观众后脑勺剪影
- 所有素材只用授权清晰的，全部登记到 CREDITS.md。需要登录才能下载的素材，先用占位模型，并列出清单让我手动下载

## 里程碑 3：真实演奏同步
- 录制模式 ?record=<slug>：getDisplayMedia 抓标签页音频，实时分析节拍、分频段 onset、管风琴音高（basic-pitch TF.js）、能量包络，导出 src/performance/<slug>.json（只含数值，不含音频）
- 演出时按演奏轨驱动乐手，利用预读提前准备动作：鼓手先抬槌再击打、弦乐按 onset 换弓、管风琴按对应音高的琴键和踏板、合唱乐句前吸气、指挥按节拍画拍子
- 每个乐手加个体差异（反应时间 ±20ms、幅度 ±15%）
- 用 performance.now() 在两次 getCurrentTime() 之间插值
- 没有演奏轨的曲目，回退到 src/cues/<slug>.js 的粗略 cue 表
- 本地模式：存在 media/<slug>.mp4 时改用 VideoTexture + AnalyserNode；提供 scripts/analyze.py 离线分析

## 里程碑 4：打磨
- 声音：CC0 掌声/交谈/咳嗽素材或程序化合成；Web Audio 原创合成调音（A=440Hz）
- 可选的导播模式开关（默认关）
- 移动端降级（关 bloom、减少人数和粒子）
- 桌面 Chrome/Safari 目标 60fps，做一次性能检查

## 硬性约束（任何里程碑都不能违反）
- 不提交任何受版权保护的音频或视频；media/ 已被 gitignore
- 不合成或模仿原曲旋律，Web Audio 只做原创音效
- src/songs.js 里的 YouTube ID 已核实，不要改；不要凭记忆新增 ID
- 代码注释和 UI 文案使用简体中文

现在从里程碑 1 开始。
