# 需要手动下载的素材

云端开发环境连不上 Poly Haven、Mixamo 和 Sketchfab，其中 Mixamo 和 Sketchfab 还需要登录，所以里程碑 2 的人物、乐器、环境光都先用代码程序化生成。
程序化版本没有授权问题，公开部署也能完整运行。下面这些素材能让效果更写实，请你按需下载。

**下载前先确认许可证，下载后把来源、作者、许可证登记到 `CREDITS.md`。**

## 1. 环境光 HDRI（免登录，CC0，推荐）

- 来源：[Poly Haven](https://polyhaven.com/hdris) → 搜索 `music hall`（例如 `music_hall_01`）
- 格式：`.hdr`，2K 分辨率就够（只用来做金属和漆面的反射）
- 放到：`public/hdri/concert_hall.hdr`
- 接入：**已完成**。页面启动时发现这个文件就自动换上，不需要改代码。

## 2. 写实人物（需要登录）

骨骼命名已经和 Mixamo 对齐（`Hips`、`Spine2`、`LeftForeArm`……），姿态驱动用的是与静止姿态无关的 IK，
换成真实模型后，拉弓、按弦、捧谱夹、打拍子的动作逻辑都可以沿用。

授权最清楚的路线：

1. **MakeHuman**（[makehumancommunity.org](http://www.makehumancommunity.org/)，免费软件，导出的模型为 CC0）：
   生成 4～6 个不同体型、肤色的男女（穿深色正装；女性合唱团员穿黑色长裙），导出 FBX
2. **Mixamo**（[mixamo.com](https://www.mixamo.com/)，需要免费的 Adobe 账号）：上传上面的 FBX 自动绑定骨骼，再下载动作。
   动作按关键词搜索（Mixamo 上的具体名称可能不同，挑最接近的）：

   | 用途 | 搜索关键词 | 说明 |
   |---|---|---|
   | 弦乐坐着待命 | `sitting idle` | 坐姿呼吸、小幅晃动 |
   | 小提琴演奏 | `violin` | 身体随拉弓起伏（手臂仍由 IK 接管） |
   | 指挥 | `conducting` / `orchestra` | 上身动作参考 |
   | 合唱 | `singing` / `standing idle` | 站姿呼吸 |
   | 上台 | `walking` | 勾选 In Place |
   | 鞠躬 | `bow` / `bowing` | 谢幕 |
   | 鼓掌 | `clapping` | 终场观众 |
   | 起立 | `sit to stand` / `stand up` | 终场起立 |

   下载设置：FBX 或 GLB、30 fps；动作文件选 *Without Skin*。

3. 放到 `public/models/`，然后告诉我，我来接入加载和动作混合（真实模型接入需要实际文件测试，所以这一步等你下载后再做）。

> ⚠ Mixamo 的条款允许把角色和动作用在自己的作品里，但对"原始文件单独再分发"有限制。
> 把文件提交到公开仓库之前，请你先看一下 Mixamo 的 FAQ，确认可以接受。

## 3. 乐器模型（可选，需要登录）

程序化的提琴、定音鼓、管风琴控制台已经是 PBR 材质。想要更精细的模型，可以在
[Sketchfab](https://sketchfab.com/) 筛选 *Downloadable* + *CC BY* 或 *CC0*，搜索 `violin`、`cello`、`timpani`，下载 glTF 格式。

## 暂时不需要

- 掌声、交谈、咳嗽的录音：里程碑 4 再决定用 Freesound 的 CC0 录音，还是继续用现在的程序化合成。
