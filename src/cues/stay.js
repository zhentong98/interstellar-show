// S.T.A.Y. · 墨菲破解讯息，拯救世界
//
// 每项 { t: 秒, name, intensity: 0~1, bpm?, events? }，按时间排序。
// ⚠ 粗略版：按场景的大段落估计，尚未逐秒对照视频校准（?debug 可显示当前时间和 cue）。

export default [
  { t: 0, name: '墨菲回到童年的房间', intensity: 0.2, bpm: 60 },
  { t: 35, name: '书架前的回忆', intensity: 0.32, bpm: 62 },
  { t: 70, name: '发现手表的秒针', intensity: 0.5, bpm: 66 },
  { t: 100, name: '"是我爸爸"，解码数据', intensity: 0.7, bpm: 70 },
  { t: 130, name: '"尤里卡！"抛洒纸页', intensity: 0.82, bpm: 72, events: ['flash'] },
  { t: 160, name: '跑进玉米地，告别', intensity: 0.5, bpm: 64 },
  { t: 190, name: '尾声', intensity: 0.2, bpm: 60 },
];
