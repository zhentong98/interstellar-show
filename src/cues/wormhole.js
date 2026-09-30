// Wormhole · 穿越土星旁的虫洞
//
// 每项 { t: 秒, name, intensity: 0~1, bpm?, events? }，按时间排序。
// ⚠ 粗略版：按场景的大段落估计，尚未逐秒对照视频校准（?debug 可显示当前时间和 cue）。

export default [
  { t: 0, name: '接近土星，寂静', intensity: 0.15, bpm: 60 },
  { t: 30, name: '虫洞出现在视野里', intensity: 0.3, bpm: 62 },
  { t: 60, name: '飞船靠近球形入口', intensity: 0.45, bpm: 64 },
  { t: 85, name: '进入虫洞，时空扭曲', intensity: 0.68, bpm: 70, events: ['flash', 'shake'] },
  { t: 115, name: '剧烈颠簸', intensity: 0.75, bpm: 72, events: ['shake'] },
  { t: 140, name: '"握手"：光中的触碰', intensity: 0.45, bpm: 62 },
  { t: 170, name: '穿出虫洞', intensity: 0.25, bpm: 60, events: ['flash'] },
];
