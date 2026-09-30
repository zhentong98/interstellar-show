# 已安装的人物与环境素材

更新日期：2026-09-30。六个人物使用 CC BY 4.0，保留原有 CC0 指挥；旧人物文件仍保留。

| 文件 | 来源 | 作者 | 许可证 | 文件大小 | 骨骼数 | 处理方式 |
|---|---|---|---|---|---|---|
| `scan-man-1.glb` | [Eric Rigged 001](https://sketchfab.com/3d-models/eric-rigged-001-rigged-3d-business-man-a46bc9f67aaa415bb4f3241eef900e7f) | Renderpeople | CC BY 4.0 | 1.36 MB | 65 | 经 Mixamo 自动绑骨 |
| `scan-man-2.glb` | [Indian Man in suit](https://sketchfab.com/3d-models/indian-man-in-suit-985dd9756d89464b9380414b5b12d8aa) | Nodeaxis Interactive | CC BY 4.0 | 1.27 MB | 65 | 经 Mixamo 自动绑骨 |
| `scan-man-3.glb` | [Businessman (Rigged)](https://sketchfab.com/3d-models/businessman-rigged-8933d61fcb1e46f3aead661227bb4fed) | Jungle Jim | CC BY 4.0 | 2.63 MB | 65 | 保留原有 65 骨骼绑定，统一为 Mixamo 命名 |
| `scan-woman-1.glb` | [Carla Rigged 001](https://sketchfab.com/3d-models/carla-rigged-001-rigged-3d-business-women-acf520f450d14dd799f98a6fede3edf5) | Renderpeople | CC BY 4.0 | 1.77 MB | 33 | 经 Mixamo 自动绑骨 |
| `scan-woman-2.glb` | [Claudia Rigged 002](https://sketchfab.com/3d-models/claudia-rigged-002-3d-rigged-business-women-c659bd0accab47c6bbe390cf822a2b92) | Renderpeople | CC BY 4.0 | 1.65 MB | 33 | 经 Mixamo 自动绑骨 |
| `scan-woman-3.glb` | [Sophia Animated 003](https://sketchfab.com/3d-models/sophia-animated-003-animated-3d-woman-dc448c3be0e74f96a55fb475a13433cf) | Renderpeople | CC BY 4.0 | 0.58 MB | 33 | 经 Mixamo 自动绑骨，移除原附带动画 |

## 环境光

`public/hdri/concert_hall.hdr`：Poly Haven 的 Music Hall 01，作者 Sergej Majboroda，CC0 1.0，2048 × 1024，6,462,080 字节。
来源：https://polyhaven.com/a/music_hall_01

## 本地动作

两个 Adobe Mixamo 动作只保存在本地，并被 Git 忽略：

- `public/models/anims/sitting-idle.fbx`：533,536 字节，4.3 秒，65 骨骼。
- `public/models/anims/standing-idle.fbx`：728,160 字节，6 秒，65 骨骼。

本机 `.env.local` 已设置 `VITE_LOCAL_MIXAMO=1`，开发服务器才会加载这些动作。公开演员表不含原始动作引用；CI 从已提交文件构建，不包含这两个文件。生产构建还会排除动作目录，因此本地 `npm run build` 的发布产物也不包含这两个文件。

## 选材与兼容性说明

- Eric、Carla、Claudia、Sophia 是 Renderpeople 官方发布的扫描人物；另外两位男性是写实人物模型。
- 所有成品保留蒙皮和演奏接口所需的关键骨骼，实际骨骼数见上表。Mixamo 均选择 Standard Skeleton (65)，但部分扫描模型的指骨被服务合并；这类模型的手指精细动作存在限制。Businessman 原有骨骼集合与标准 Mixamo 骨骼一致；重复自动绑骨未完成，因此保留原绑定并统一骨骼命名，同时补齐两件牙齿网格的头部绑定。
- Sophia 的服饰偏休闲，本次没有找到同时符合授权和绑骨要求的黑色长裙人物。
- 原始下载包和绑骨中间文件不纳入仓库；只提交 GLB 成品。
- `src/songs.js` 未修改。

## 视觉验收后的调整（2026-09-30）

- 握姿：手骨按掌心法线（手部顶点主成分分析得出）转向，男性模型的手指会弯曲：左手托住琴颈、手指弯过指板，右手掌心朝下搭在弓杆上；定音鼓手半握拳，合唱团捏住谱夹两侧。女性模型只有一根手指骨，手指只能整体弯曲。
- 手臂偏短的模型（Sophia）够不着时先把肩膀送出去一点，左手和弓根都能握到。
- 坐下时按每个模型自己的脚踝高度和脚掌俯仰放脚，男性模型鞋底不再陷进地板约 3 厘米。
- 扫描贴图里接近纯白的布料压暗，弦乐、合唱、定音鼓的顶光调暗约三成，Bloom 门槛 0.82 → 0.95；琴漆改成深红棕，弓毛和鼓皮调暗。
- 已知问题：Sophia 在合唱团里两臂交叉扭在胸前（改握姿之前就存在），原因待查；指挥仍是 MakeHuman 生成的旧模型。

## 灯光预算（2026-09-30，第二轮灯光修正）

上一轮只调了几盏顶光和 Bloom 门槛，特写机位里仍然过曝、光柱盖住乐器。这一轮按统一的照度约定重做（`src/stage/lightBudget.js`）：

- 灯光按"打到目标处的照度"定义，由距离换算成坎德拉。一个声部的主光合计 3.6（弦乐区是前后两盏叠加），观众席亮灯时观众头顶 2.2；原来弦乐、管风琴区域有多盏灯叠加，照度达到 11～14，观众席洗墙光在观众头顶有 15～22。
- 白色漫反射材质（乐谱纸、琴键、鼓槌毡头）的线性反照率上限 0.6，最亮的白布在最强的主光下仍低于 Bloom 门槛；鼓皮改成反照率约 0.3 的羊皮纸色，鼓圈和铜鼓身留一点粗糙度，舞台地板改成哑光。
- Bloom 改成软膝减门槛：只有超出门槛的那部分亮度会发光，灯头、台灯、音管底光和爆闪照样晕开，刚过门槛的白衬衫不会被晕成一团。门槛 1.0，曝光 1.15。
- 体积光束按视线穿过光锥的解析路径长度着色，只画光锥背面（伸到舞台面以下的部分压回舞台面），被乐手和乐器挡住的那部分光柱不再叠在他们身上；镜头钻进光锥时也不会出现一大团白光。侧光吊杆的光柱减弱、消散得更快。
- 开发服务器上 HDRI 以前因为 Content-Type 为空一直没加载（只有线上部署才加载），现在两边一致；环境光按贴图的平均辐照度折算，HDRI 和程序环境的亮度不再相差 25 倍。
