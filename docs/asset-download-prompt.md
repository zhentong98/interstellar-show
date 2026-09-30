# 素材下载任务 prompt

在你自己电脑上的 Claude Code 里粘贴下面这段（需要它能操作浏览器，例如装了 Claude in Chrome 扩展），
并且你已经在浏览器里登录好 Sketchfab 和 Adobe（Mixamo）账号。

---

你要帮我给项目 `zhentong98/interstellar-show` 准备写实人物素材。先阅读仓库里的 `CLAUDE.md`、`docs/assets-to-download.md`、`CREDITS.md` 和 `public/models/cast.json`，然后在分支 `claude/milestone-2-spectacle` 上工作。

背景：这是一场浏览器里的交响音乐会，乐团乐手目前是程序生成的人体（`public/models/` 里的 7 个 GLB）。我要换成游戏级质感的真人扫描模型。网页的加载管线已经做好：只要把绑好 Mixamo 骨骼的模型放进 `public/models/`、写进 `cast.json`，就会自动替换。

## 规则（必须遵守）

- **账号**：我已经在浏览器里登录了 Sketchfab 和 Adobe。遇到登录页、验证码、两步验证、付款页面就停下来告诉我。不要输入任何密码，不要注册新账号，不要购买任何东西。
- **许可证**：只下载 **CC0** 或 **CC BY（CC Attribution）** 的模型。`Non-Commercial`、`No Derivatives`、`Standard`、`Editorial` 以及没写许可证的一律不要。
- **禁止的内容**：不要真实名人、公众人物或明显是某个真实可辨认个人的模型；不要成人内容。
- **记录**：每个下载的模型都要记下网址、作者、许可证，后面要写进 `CREDITS.md`（CC BY 必须署名）。
- **不能提交的东西**：仓库里绝对不能提交受版权保护的音频或视频；`src/songs.js` 不要改。
- **文字**：代码注释和文档用简体中文。

## 步骤

### 1. 环境光 HDRI（免登录）
在 https://polyhaven.com/hdris 搜索 `music hall`，下载一张音乐厅全景图的 2K `.hdr`（CC0），保存为 `public/hdri/concert_hall.hdr`。

### 2. 在 Sketchfab 挑选真人模型
打开 https://sketchfab.com/search?type=models ，筛选：
- Downloadable 勾选
- License 只选 CC0 和 CC Attribution
- Face count 优先 50k–250k

搜索词：`man suit scan`、`businessman full body scan`、`tuxedo man`、`woman black dress scan`、`woman evening dress full body`、`woman formal full body`。

挑 **男 3 个、女 3 个**，标准：
- 写实（photogrammetry 扫描或写实 PBR），不要卡通或低多边形风格
- 全身、单个人物、没有底座，最好是 A 字或 T 字站姿
- 深色正装优先（音乐会乐手穿黑色）；女性最好有一个穿黑色长裙（给合唱团用）
- 贴图齐全

每个下载 FBX 或 glTF 格式，保存到临时目录（不要放进仓库）。
下载前把 6 个候选（缩略图、网址、许可证、面数）列给我确认，我同意后再下载。

### 3. 用 Mixamo 自动绑骨
打开 https://www.mixamo.com/ ，对每个模型：
1. Upload Character，上传 FBX（glTF 的话先用 Blender 转成 FBX；没有 Blender 就告诉我）
2. 按提示放下巴、手腕、手肘、膝盖、腹股沟标记点，Skeleton LOD 选 Standard Skeleton (65)
3. 下载：FBX Binary、With Skin、T-pose

保存为 `public/models/scan-man-1.fbx`、`scan-man-2.fbx`、`scan-man-3.fbx`、`scan-woman-1.fbx`、`scan-woman-2.fbx`、`scan-woman-3.fbx`。

然后在同一个账号里下载两个待机动作（FBX Binary、Without Skin）：
- 搜 `sitting idle`，保存为 `public/models/anims/sitting-idle.fbx`
- 搜 `standing idle` 或 `breathing idle`，保存为 `public/models/anims/standing-idle.fbx`

### 4. 压缩体积
- 能用 Blender 就把 FBX 转成 GLB（保留骨骼和贴图），然后：
  - `npx @gltf-transform/cli resize 输入.glb 输出.glb --width 2048 --height 2048`
  - `npx @gltf-transform/cli draco 输入.glb 输出.glb`
  - 目标：每个人物小于 8 MB
- 没有 Blender 就保留 FBX，但检查体积；单个超过 20 MB 就告诉我。

### 5. 更新 `public/models/cast.json`
- 把 6 个扫描模型加进 `characters`：男性的 `roles` 为 `["strings", "choir", "timpani", "organ"]`，女性为 `["strings", "choir"]`，并写上 `height`（米）
- 保留现有的 `conductor.glb` 条目作为指挥（除非有更合适的扫描模型）
- 原来的 `man-*`、`woman-*` 条目删掉，但文件本身保留
- 加上 `"animations": { "sitIdle": "anims/sitting-idle.fbx", "standIdle": "anims/standing-idle.fbx" }`

### 6. 登记致谢
在 `CREDITS.md` 表格里，每个扫描模型加一行：素材名、作者、许可证、用途、来源网址。
另外注明"经 Mixamo 自动绑骨"。

### 7. Mixamo 动作的许可证
Mixamo 条款限制把原始动作文件单独再分发。提交 `public/models/anims/` 之前先问我：
- 我说可以 → 正常提交
- 我说不行 → 把 `public/models/anims/` 加进 `.gitignore`，只在本地用

### 8. 测试
1. `npm install`，`npm run dev`，打开 http://localhost:5173/interstellar-show/?mock=60&debug
2. 点"入场"，确认人物全部加载（浏览器控制台没有"人物模型加载失败"之类的错误）
3. 等开始演奏后截图：座位视角一张，把镜头拉近乐手再截一张
4. 检查：
   - 小提琴是否架在左肩，左手握琴颈、右手握弓
   - 人物有没有穿模、飘浮、比例异常

如果持琴位置明显不对，不要自己改动 IK 代码。截图给我，并说明哪个模型、什么问题。

### 9. 提交
在分支 `claude/milestone-2-spectacle` 上提交，提交信息写明加了哪些模型和许可证，然后 `git push`。
最后告诉我：下载了哪些模型（网址、作者、许可证）、每个文件多大、截图、遇到的问题。
