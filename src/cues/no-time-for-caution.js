// No Time for Caution · 对接失控旋转的永恒号
//
// 每项 { t: 秒, name, intensity: 0~1, bpm?, events? }，按时间排序。
// ⚠ 粗略版：按场景的大段落估计，尚未逐秒对照视频校准（?debug 可显示当前时间和 cue）。
// 全场的最高潮：只有这一首的峰值达到 1，终场前的掌声也因此最热烈。

export default [
  { t: 0, name: '爆炸余波，永恒号失控', intensity: 0.55, bpm: 72, events: ['flash', 'shake'] },
  { t: 25, name: '短暂的寂静', intensity: 0.3, bpm: 66 },
  { t: 50, name: '"分析永恒号的旋转"', intensity: 0.5, bpm: 70 },
  { t: 80, name: '管风琴进入，开始同步旋转', intensity: 0.7, bpm: 76, events: [{ type: 'drumHit', strength: 0.7 }] },
  { t: 110, name: '旋转加速，"这不可能" "这是必须"', intensity: 0.86, bpm: 80, events: ['shake'] },
  { t: 140, name: '对接高潮', intensity: 1, bpm: 84, events: ['flash', 'shake', { type: 'drumHit', strength: 1 }] },
  { t: 165, name: '锁定成功', intensity: 0.9, bpm: 80, events: [{ type: 'drumHit', strength: 0.9 }] },
  { t: 185, name: '稳住，松一口气', intensity: 0.45, bpm: 68 },
  { t: 210, name: '尾声', intensity: 0.2, bpm: 62 },
];
