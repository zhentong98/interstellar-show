# 素材与致谢

本项目只使用授权清晰的第三方素材。新增任何模型、贴图、动画、字体或音效时，都要在下表登记。
节目单背面（散场页面）会直接读取这张表。

| 素材 | 作者 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| Eric Rigged 001（`scan-man-1.glb`） | Renderpeople | CC BY 4.0 | 写实乐团人物；经 Mixamo 自动绑骨；贴图最大 2K、WebP 与 Draco 压缩 | [Sketchfab](https://sketchfab.com/3d-models/eric-rigged-001-rigged-3d-business-man-a46bc9f67aaa415bb4f3241eef900e7f) |
| Indian Man in suit（`scan-man-2.glb`） | Nodeaxis Interactive | CC BY 4.0 | 写实乐团人物；经 Mixamo 自动绑骨；贴图最大 2K、WebP 与 Draco 压缩 | [Sketchfab](https://sketchfab.com/3d-models/indian-man-in-suit-985dd9756d89464b9380414b5b12d8aa) |
| Businessman (Rigged)（`scan-man-3.glb`） | Jungle Jim | CC BY 4.0 | 指挥（五指齐全，握指挥棒）；保留原有 65 骨骼绑定，统一为 Mixamo 命名并补齐牙齿的头部绑定；贴图最大 2K、WebP 与 Draco 压缩 | [Sketchfab](https://sketchfab.com/3d-models/businessman-rigged-8933d61fcb1e46f3aead661227bb4fed) |
| Carla Rigged 001（`scan-woman-1.glb`） | Renderpeople | CC BY 4.0 | 写实乐团人物；经 Mixamo 自动绑骨；贴图最大 2K、WebP 与 Draco 压缩 | [Sketchfab](https://sketchfab.com/3d-models/carla-rigged-001-rigged-3d-business-women-acf520f450d14dd799f98a6fede3edf5) |
| Claudia Rigged 002（`scan-woman-2.glb`） | Renderpeople | CC BY 4.0 | 写实乐团人物；经 Mixamo 自动绑骨；贴图最大 2K、WebP 与 Draco 压缩 | [Sketchfab](https://sketchfab.com/3d-models/claudia-rigged-002-3d-rigged-business-women-c659bd0accab47c6bbe390cf822a2b92) |
| Sophia Animated 003（`scan-woman-3.glb`） | Renderpeople | CC BY 4.0 | 写实乐团人物；经 Mixamo 自动绑骨，移除原附带动画；贴图最大 2K、WebP 与 Draco 压缩 | [Sketchfab](https://sketchfab.com/3d-models/sophia-animated-003-animated-3d-woman-dc448c3be0e74f96a55fb475a13433cf) |
| Music Hall 01（2K HDRI，`public/hdri/concert_hall.hdr`） | Sergej Majboroda / Poly Haven | CC0 1.0 | 音乐厅环境反射与照明 | [Poly Haven](https://polyhaven.com/a/music_hall_01) |
| three.js | three.js authors | MIT | 3D 渲染（含 CSS3DRenderer、后处理 Bloom、HDRLoader） | [github.com/mrdoob/three.js](https://github.com/mrdoob/three.js) |
| 原有乐手与指挥模型（`man-*.glb`、`woman-*.glb`、`conductor.glb`） | MakeHuman 社区（基础网格、体型目标、Mixamo 骨骼，经 MPFB2 生成）；演出服、头发和材质由 `scripts/make_cast.py` 制作 | CC0 1.0 | 乐团写实人物（已不在演员表中，保留作备用） | [MPFB2](https://github.com/makehumancommunity/mpfb2) |
| Draco 解码器 | Google | Apache 2.0 | 解压经 Draco 压缩的人物模型（`public/draco/`，随 three.js 分发） | [github.com/google/draco](https://github.com/google/draco) |
| Cormorant Garamond | Christian Thalmann | SIL OFL 1.1 | 节目单与字幕牌的西文衬线字体 | [Google Fonts](https://fonts.google.com/specimen/Cormorant+Garamond) |
| Noto Serif SC | Google、Adobe | SIL OFL 1.1 | 中文衬线字体 | [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Serif+SC) |
| YouTube IFrame Player API | Google | YouTube API 服务条款 | 巨幕嵌入播放电影片段 | [developers.google.com](https://developers.google.com/youtube/iframe_api_reference) |

## 不在仓库里的内容

- **电影片段**：巨幕通过 YouTube 嵌入播放，片段本身不下载、不存储；每段的上传频道见 `src/songs.js`，
  非官方频道的片段在节目单上标注"非官方上传"。
- **原声音乐与音频**：不提交任何受版权保护的音频或视频。用户自己合法拥有的文件只能放在 `media/`（已被 gitignore）。

## 原创内容

- 木管和圆号（长笛、双簧管、单簧管、大管、圆号：`src/stage/instruments.js`）、三角钢琴和琴凳（`src/stage/piano.js`）：程序化几何体 + PBR 材质，不使用外部模型。
- 掌声、观众交谈、咳嗽、翻谱、乐团调音（A = 440Hz）、黑洞过渡的低频氛围：`src/audio/sfx.js` 用 Web Audio 程序化合成，不采样任何录音，也不模仿原曲旋律。
- 黑洞 Gargantua 过渡画面：`src/stage/gargantua.glsl.js` 自绘着色器。
- 人物：`src/stage/humans/` 按骨骼程序化生成的身体（燕尾服、衬衫、礼服裙、多种发型），骨骼命名与 Mixamo 一致。
- 乐器：`src/stage/instruments.js` 程序化建模的小提琴、中提琴、大提琴、低音提琴、琴弓，以及定音鼓和管风琴控制台。
- 贴图：`src/stage/textures.js` 用 Canvas 现场生成的木纹、舞台地板、墙板、琴键和音管发光渐变。
- 环境光：`src/stage/environment.js` 程序生成的音乐厅环境；如果本地放了 HDRI 则优先使用（见 `docs/assets-to-download.md`）。
- 体积光、烟雾和浮尘：`src/stage/atmosphere.js` 自写着色器。

写实人物模型的加载管线已经就绪（`src/stage/humans/cast.js`、`modelRig.js`、`bake.js`）。需要登录才能下载的写实人物、动作捕捉动画和乐器模型，清单见 [`docs/assets-to-download.md`](docs/assets-to-download.md)，下载并接入后在上表登记。

## 本地 Mixamo 动作

- `public/models/anims/sitting-idle.fbx`：Adobe Mixamo，Sitting Idle（Sitting With Breathing Idle）。
- `public/models/anims/standing-idle.fbx`：Adobe Mixamo，Standing Idle。
- 两个动作均以 FBX Binary、Without Skin、30 fps、无关键帧缩减导出。来源：[Mixamo](https://www.mixamo.com/)。
- 原始动作文件已被 Git 忽略，仅保存在本地，不随公开仓库分发。本地开发通过 `.env.local` 中的 `VITE_LOCAL_MIXAMO=1` 启用；发布构建不请求这些动作。
