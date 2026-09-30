// Cornfield Chase · 玉米地追无人机
//
// 每项 { t: 秒, name, intensity: 0~1, bpm?, events? }，按时间排序。
// intensity 驱动乐手动作幅度和灯光；events 是一次性事件：flash / shake / drumHit。
//
// ⚠ 粗略版：按场景的大段落估计，尚未逐秒对照视频校准。
//   打开 ?debug 可以在屏幕角落看到当前播放时间和 cue，方便微调。

export default [
  { t: 0, name: '开场对白，车里的日常', intensity: 0.18, bpm: 66 },
  { t: 20, name: '发现无人机，琴声进入', intensity: 0.35, bpm: 72 },
  { t: 45, name: '卡车冲进玉米地', intensity: 0.55, bpm: 76, events: ['shake'] },
  { t: 75, name: '追逐加速，弦乐层层叠上', intensity: 0.72, bpm: 80 },
  { t: 105, name: '冲到坝边急刹', intensity: 0.85, bpm: 80, events: [{ type: 'drumHit', strength: 0.8 }, 'shake'] },
  { t: 125, name: '笔记本接管无人机', intensity: 0.6, bpm: 74 },
  { t: 160, name: '无人机降落，情绪回落', intensity: 0.3, bpm: 68 },
  { t: 190, name: '尾声', intensity: 0.15, bpm: 64 },
];
