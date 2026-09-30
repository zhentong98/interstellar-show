# 素材与致谢

本项目只使用授权清晰的第三方素材。新增任何模型、贴图、动画、字体或音效时，都要在下表登记。
节目单背面（散场页面）会直接读取这张表。

| 素材 | 作者 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| three.js | three.js authors | MIT | 3D 渲染（含 CSS3DRenderer、RoomEnvironment） | [github.com/mrdoob/three.js](https://github.com/mrdoob/three.js) |
| Cormorant Garamond | Christian Thalmann | SIL OFL 1.1 | 节目单与字幕牌的西文衬线字体 | [Google Fonts](https://fonts.google.com/specimen/Cormorant+Garamond) |
| Noto Serif SC | Google、Adobe | SIL OFL 1.1 | 中文衬线字体 | [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Serif+SC) |
| YouTube IFrame Player API | Google | YouTube API 服务条款 | 巨幕嵌入播放电影片段 | [developers.google.com](https://developers.google.com/youtube/iframe_api_reference) |

## 不在仓库里的内容

- **电影片段**：巨幕通过 YouTube 嵌入播放，片段本身不下载、不存储；每段的上传频道见 `src/songs.js`，
  非官方频道的片段在节目单上标注"非官方上传"。
- **原声音乐与音频**：不提交任何受版权保护的音频或视频。用户自己合法拥有的文件只能放在 `media/`（已被 gitignore）。

## 原创内容

- 掌声、观众交谈、咳嗽、翻谱、乐团调音（A = 440Hz）、黑洞过渡的低频氛围：`src/audio/sfx.js` 用 Web Audio 程序化合成，不采样任何录音，也不模仿原曲旋律。
- 黑洞 Gargantua 过渡画面：`src/stage/gargantua.glsl.js` 自绘着色器。
- 里程碑 1 的乐手、观众、音乐厅都是代码生成的简单几何体占位，里程碑 2 换成写实素材时逐项登记。
