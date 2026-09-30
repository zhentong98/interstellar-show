// Mountains · 米勒星球的巨浪
//
// 每项 { t: 秒, name, intensity: 0~1, bpm?, events? }，按时间排序。
// ⚠ 粗略版：按场景的大段落估计，尚未逐秒对照视频校准（?debug 可显示当前时间和 cue）。
// 这一段的配乐有持续的"滴答"节拍，bpm 取得比较稳定。

export default [
  { t: 0, name: '降落在浅水星球，滴答声', intensity: 0.25, bpm: 64 },
  { t: 40, name: '涉水寻找信标', intensity: 0.38, bpm: 64 },
  { t: 80, name: '找到残骸，"那不是山"', intensity: 0.55, bpm: 66 },
  { t: 110, name: '巨浪升起', intensity: 0.8, bpm: 68, events: [{ type: 'drumHit', strength: 0.9 }, 'shake'] },
  { t: 135, name: '巨浪压顶', intensity: 0.92, bpm: 70, events: ['flash', 'shake', { type: 'drumHit', strength: 1 }] },
  { t: 165, name: '引擎进水，等待排空', intensity: 0.55, bpm: 64 },
  { t: 200, name: '脱离，时间的代价', intensity: 0.3, bpm: 60 },
];
