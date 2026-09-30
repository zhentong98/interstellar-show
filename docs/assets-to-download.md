# 需要手动下载的素材

## 现状：已经有一套写实人物，不用下载也能用

`public/models/` 里已经有 7 个写实人物（3 男、3 女、1 位指挥），是用开源的 MakeHuman 人体生成器（MPFB2）在云端生成的：
真实的人体比例和五官、不同年龄体型和肤色、Mixamo 骨骼，演出服和头发由 `scripts/make_cast.py` 制作。
全部是 CC0，可以公开部署，压缩后一共约 900 KB。

它们没有皮肤贴图和布料褶皱，近看仍然不如游戏里的扫描模型。如果想更进一步，可以按下面的步骤换成
Sketchfab 上的真人扫描模型：放进 `public/models/`，改 `cast.json`，就会替换掉现在的人物。

云端开发环境连不上 Poly Haven、Sketchfab 和 Mixamo，Sketchfab 和 Mixamo 还需要登录，所以这一步需要你来下载。

## 一、（可选）更精细的写实人物：Sketchfab 扫描模型 + Mixamo 自动绑骨

### 1. 在 Sketchfab 找模型（需要免费账号）

打开 [sketchfab.com/search](https://sketchfab.com/search?type=models)，设置筛选条件：

- **Downloadable**：勾选
- **License**：只选 `CC0` 或 `CC Attribution`（CC BY）。**不要选** `Non-Commercial`、`No Derivatives` 或 `Standard/Editorial`
- **Face count**：优先 `50k–100k` 或 `100k–250k`（太高网页会很重）
- 搜索关键词（英文效果更好）：
  - 男演奏者：`man suit scan`、`businessman full body`、`tuxedo man`
  - 女演奏者 / 合唱：`woman black dress scan`、`woman evening dress`、`woman formal full body`
  - 指挥：`older man suit`、`tuxedo`

挑选标准：
- **全身、单个人物、没有底座**，最好是 A 字或 T 字站姿（Mixamo 自动绑骨需要）
- **写实**：优先 photogrammetry（真人扫描）或标注 PBR、realistic 的模型，避开卡通、低多边形风格
- 深色正装最理想（音乐会乐手都穿黑色）；衣服颜色不对也没关系，我可以统一调成黑色
- 下载格式选 **glTF** 或 **FBX**（带贴图）

**需要的数量**：男 2～3 个、女 2～3 个、指挥 1 个（可以和男乐手共用）。每个人物会轮流用在不同座位上，再加上个体高矮差异，看起来不会重复。

### 2. 用 Mixamo 自动绑骨（需要免费的 Adobe 账号）

1. 打开 [mixamo.com](https://www.mixamo.com/)，点 **Upload Character**，上传 FBX（或 OBJ + 贴图打成的 zip）
2. 按提示在下巴、手腕、手肘、膝盖、腹股沟放标记点，Skeleton LOD 选 **Standard Skeleton (65)**
3. 绑好后点 **Download**：Format 选 **FBX Binary (.fbx)**，Skin 选 **With Skin**，Pose 选 **T-pose**
4. 同一个账号下，再挑几个动作（Format 同上，Skin 选 **Without Skin**）：

   | 用途 | 搜索关键词 | 文件名建议 |
   |---|---|---|
   | 坐着的乐手：呼吸、轻微晃动 | `sitting idle` | `anims/sitting-idle.fbx` |
   | 站着的合唱和指挥 | `standing idle` 或 `breathing idle` | `anims/standing-idle.fbx` |

   目前只用动作驱动上身（脊柱、脖子、头），手臂和腿由 IK 精确控制，所以两个待机动作就够了。

### 3. 放进项目

```
public/models/
  cast.json
  man-1.fbx
  man-2.fbx
  woman-1.fbx
  woman-2.fbx
  anims/sitting-idle.fbx
  anims/standing-idle.fbx
```

`cast.json`：

```json
{
  "characters": [
    { "file": "man-1.fbx", "gender": "man", "roles": ["strings", "choir", "timpani", "organ", "conductor"], "height": 1.80 },
    { "file": "man-2.fbx", "gender": "man", "roles": ["strings", "choir", "timpani", "organ"], "height": 1.76 },
    { "file": "woman-1.fbx", "gender": "woman", "roles": ["strings", "choir"], "height": 1.66 },
    { "file": "woman-2.fbx", "gender": "woman", "roles": ["strings", "choir"], "height": 1.63 }
  ],
  "animations": {
    "sitIdle": "anims/sitting-idle.fbx",
    "standIdle": "anims/standing-idle.fbx"
  }
}
```

- `roles`：这个人物可以演哪些角色（`strings` 弦乐、`choir` 合唱、`timpani` 定音鼓、`organ` 管风琴、`conductor` 指挥）
- `height`：身高（米），模型会按这个缩放
- 也可以直接用 `.glb`

然后告诉我。我会用 gltf-transform 把模型压缩（Draco 网格压缩、贴图缩到 2K/1K），控制下载体积；
再对照你的模型微调持琴位置、服装颜色，并把作者和许可证登记到 `CREDITS.md`（CC BY 必须署名）。

> ⚠ 许可证提醒
> - CC BY 模型经 Mixamo 绑骨后仍然是 CC BY，署名即可公开使用。
> - Mixamo 的条款允许把绑骨结果和动作用在自己的作品里，但限制把原始动作文件单独再分发。
>   动作文件提交到公开仓库之前，请你看一下 Mixamo 的 FAQ 确认可以接受；不放心的话，可以只在本地用动作文件（不写进 `cast.json` 的 `animations` 就不会加载）。

## 二、环境光 HDRI（免登录，CC0，推荐）

- 来源：[Poly Haven](https://polyhaven.com/hdris) → 搜索 `music hall`（例如 `music_hall_01`）
- 格式：`.hdr`，2K 就够（只用来做金属和漆面的反射）
- 放到：`public/hdri/concert_hall.hdr`，页面发现这个文件就自动换上

## 三、乐器模型（可选）

程序化的提琴、定音鼓、管风琴控制台已经是 PBR 材质。想要更精细，可以用同样的 Sketchfab 筛选条件搜索 `violin`、`cello`、`timpani`，
下载 glTF 后告诉我，我来对齐琴马、琴颈、弓根的位置再接入。

## 暂时不需要

- 掌声、交谈、咳嗽的录音：里程碑 4 再决定用 Freesound 的 CC0 录音，还是继续用现在的程序化合成。
