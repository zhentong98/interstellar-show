// 演出曲目单：观众在开场前从这里选歌。
// youtubeId 已于 2026-09-30 通过 YouTube oEmbed 逐个核实（均可嵌入）。
// 不要凭记忆新增或修改 ID，新增曲目前先用 oEmbed 验证。
//
// 字段说明：
//   slug        唯一标识，也是本地媒体文件名：media/<slug>.mp4 或 media/<slug>.mp3
//   youtubeId   公开模式下的音源
//   screen      巨幕内容：'youtube' 直接显示视频画面；'gargantua' 显示自绘黑洞 shader
//               （官方原声视频的画面只是静态封面，所以大多数曲目用 gargantua）
//   mood        给灯光和乐手动画的整体基调：'calm' | 'rising' | 'tense' | 'epic' | 'farewell'
//   cues        对应 src/cues/<slug>.js

export const songs = [
  {
    slug: 'day-one',
    title: 'Day One',
    scene: '主题旋律，贯穿全片',
    youtubeId: '5fS_XkPLRzo', // HansZimmerVEVO · Interstellar Suite: Part 1, Day One (Official Audio)
    screen: 'gargantua',
    mood: 'calm',
  },
  {
    slug: 'cornfield-chase',
    title: 'Cornfield Chase',
    scene: '玉米地追无人机',
    youtubeId: 'JuSsvM8B4Jc', // WaterTower Music · 官方原声
    screen: 'gargantua',
    mood: 'rising',
  },
  {
    slug: 'mountains',
    title: 'Mountains',
    scene: '米勒星球的巨浪',
    youtubeId: 'yAd6J0Yb4gQ', // WaterTower Music · 官方原声
    screen: 'gargantua',
    mood: 'tense',
  },
  {
    slug: 'no-time-for-caution',
    title: 'No Time for Caution',
    scene: '对接场景',
    youtubeId: 'onVhbeY7nLM', // 4K HDR Media · Docking Scene（带电影画面）
    screen: 'youtube',
    mood: 'epic',
  },
  {
    slug: 'stay',
    title: 'S.T.A.Y.',
    scene: '结尾，情感收束',
    youtubeId: 'Ia3eQ7QD9Z0', // WaterTower Music · 官方原声
    screen: 'gargantua',
    mood: 'farewell',
  },
];
