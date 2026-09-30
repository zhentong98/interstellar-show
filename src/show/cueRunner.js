// Cue 执行器：每帧取当前播放时间，找到最近一个已经过的 cue，平滑插值 intensity，
// 并在越过时间点时触发一次性事件（flash / shake / drumHit）。
//
// drumHit 会提前 DRUM_LEAD 秒发出，并带上距离击打的剩余时间 lead，
// 让定音鼓手先抬槌再在正确的时刻落下（预读）。

import { damp } from '../core/math.js';

const DRUM_LEAD = 0.18;
const DEFAULT_BPM = 72;

function normalizeEvent(ev) {
  return typeof ev === 'string' ? { type: ev, strength: 1 } : { strength: 1, ...ev };
}

export class CueRunner {
  constructor(cues) {
    this.cues = [...cues].sort((a, b) => a.t - b.t);
    this.events = this.cues
      .flatMap((cue) =>
        (cue.events ?? []).map(normalizeEvent).map((ev) => ({
          ...ev,
          at: cue.t,
          fireAt: cue.t - (ev.type === 'drumHit' ? DRUM_LEAD : 0),
        })),
      )
      .sort((a, b) => a.fireAt - b.fireAt);
    this.reset();
  }

  reset() {
    this.intensity = 0;
    this.lastT = -Infinity;
    this.cue = null;
  }

  /** 找最近一个已经过的 cue（cue 表很短，线性查找足够） */
  #cueAt(t) {
    let current = null;
    for (const cue of this.cues) {
      if (cue.t > t) break;
      current = cue;
    }
    return current;
  }

  /**
   * @param {number} t 当前播放时间（秒）
   * @param {number} dt 帧间隔
   * @param {boolean} advancing 画面是否真的在走（缓冲、广告时为 false）
   */
  update(t, dt, advancing) {
    // 往回跳（重新缓冲、seek）时重置事件触发位置，避免重复触发
    if (t < this.lastT - 0.5) this.lastT = t;

    this.cue = this.#cueAt(t);
    const target = this.cue?.intensity ?? 0;
    // 缓冲时保持当前强度，不让乐团"没声音还在演"——动作由 playing=false 冻结
    if (advancing) this.intensity = damp(this.intensity, target, 1.2, dt);

    const events = [];
    if (advancing) {
      for (const ev of this.events) {
        if (ev.fireAt > this.lastT && ev.fireAt <= t) events.push({ ...ev, lead: Math.max(0, ev.at - t) });
      }
      this.lastT = t;
    }

    return {
      playing: advancing,
      intensity: this.intensity,
      bpm: this.cue?.bpm ?? DEFAULT_BPM,
      cueName: this.cue?.name ?? '',
      events,
    };
  }
}
