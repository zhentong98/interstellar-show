// 演出曲目单：观众在开场前从这里选。每一项是一段电影原片片段，
// 巨幕播放片段画面，声音就是电影里的原声（配乐 + 音效 + 对白）。
//
// youtubeId 已于 2026-09-30 通过 YouTube oEmbed 逐个核实（均可嵌入）。
// 不要凭记忆新增或修改 ID，新增曲目前先用 oEmbed 验证标题和频道。
//
// 字段说明：
//   slug        唯一标识，也是本地媒体文件名：media/<slug>.mp4
//   title       曲目名（该场景的代表配乐）
//   scene       电影场景
//   youtubeId   巨幕播放的片段
//   channel     上传频道；official=false 表示非官方上传，官方片段出现后应替换
//   mood        给灯光和乐手动画的整体基调：'calm' | 'rising' | 'tense' | 'epic' | 'farewell'
//   cues        对应 src/cues/<slug>.js
//
// 按电影时间顺序排列。

export const songs = [
  {
    slug: 'cornfield-chase',
    title: 'Cornfield Chase',
    scene: '玉米地追无人机',
    youtubeId: 'NjkvcO-yKpM', // Cinematic · Cornfield Drone Chase 4K
    channel: 'Cinematic',
    official: false, // 暂未找到官方频道的片段
    mood: 'rising',
  },
  {
    slug: 'wormhole',
    title: 'Wormhole',
    scene: '穿越土星旁的虫洞',
    youtubeId: 'u-ElPzExvPA', // Paramount Movies · Entering the Wormhole in 4K Ultra HD
    channel: 'Paramount Movies',
    official: true,
    mood: 'calm',
  },
  {
    slug: 'mountains',
    title: 'Mountains',
    scene: '米勒星球的巨浪',
    youtubeId: '60h6lpnSgck', // Paramount Movies · "Tidal Wave" Full Scene
    channel: 'Paramount Movies',
    official: true,
    mood: 'tense',
  },
  {
    slug: 'no-time-for-caution',
    title: 'No Time for Caution',
    scene: '对接失控旋转的永恒号',
    youtubeId: 'v2H1s9gj5DA', // Paramount Movies · Docking Scene
    channel: 'Paramount Movies',
    official: true,
    mood: 'epic',
  },
  {
    slug: 'stay',
    title: 'S.T.A.Y.',
    scene: '墨菲破解讯息，拯救世界',
    youtubeId: 'Rvns5DaW-ug', // Paramount Movies · Murph Saves The World (Full Scene)
    channel: 'Paramount Movies',
    official: true,
    mood: 'farewell',
  },
];
