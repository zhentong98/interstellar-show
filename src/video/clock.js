// 播放时钟：把播放器不连续的 getCurrentTime() 读数，
// 用 performance.now() 在两次读数之间插值成平滑的时间，同时判断播放是否"真的在走"。
//
// 判定：
//   advancing  状态是播放且时间在前进 → 乐团演奏
//   abnormal   缓冲过久、画面卡住、意外暂停（常见于广告）→ 幕布盖住巨幕
//   blocked    请求播放后一直停在未开始/暂停状态 → 很可能被浏览器的自动播放策略拦截
//              （状态是"播放"但时间不走，多半是插播广告：不提示，幕布继续盖着，乐团等待）

const STALL_AFTER = 1.5; // 状态是播放但时间这么久没前进，视为卡住
const BUFFER_TOLERANCE = 1.0; // 短暂缓冲不盖幕布，只让乐团停顿
const BLOCKED_AFTER = 4; // 请求播放后这么久还没开始走，提示观众点击

export class PlaybackClock {
  constructor(player) {
    this.player = player;
    this.time = 0;
    this.duration = 0;
    this.state = 'unstarted';
    this.advancing = false;
    this.abnormal = false;
    this.blocked = false;
    this.started = false; // 是否真正开始走过
    this.waiting = 0; // 画面已经多少秒没有前进（没开始过就从请求播放算起）
    const now = performance.now();
    this.requestedAt = now;
    this.lastRaw = -1;
    // 以创建时刻为基准：第一次读数就已经在走的话，不会被误判成"卡住"
    this.lastAdvanceAt = now;
    this.stateSince = now;
    this.lastFrameAt = now;
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;

    const state = this.player.getState();
    if (state !== this.state) {
      this.state = state;
      this.stateSince = now;
    }
    const raw = this.player.getTime();
    this.duration = this.player.getDuration();

    if (raw !== this.lastRaw) {
      if (raw > this.lastRaw) this.lastAdvanceAt = now;
      if (raw > 0.05 && state === 'playing') this.started = true;
      this.lastRaw = raw;
    }

    const playing = state === 'playing';
    const sinceAdvance = (now - this.lastAdvanceAt) / 1000;
    this.advancing = playing && this.started && sinceAdvance < STALL_AFTER;

    // 插值：播放时按真实时间推进，再温和地向读数靠拢；跳变超过 0.5 秒直接对齐
    if (this.advancing) {
      this.time += dt;
      const err = raw - this.time;
      if (Math.abs(err) > 0.5) this.time = raw;
      else this.time += err * Math.min(1, dt * 3);
    } else {
      this.time = raw;
    }

    this.waiting = this.advancing ? 0 : (now - (this.started ? this.lastAdvanceAt : this.requestedAt)) / 1000;

    const inState = (now - this.stateSince) / 1000;
    const stalledPlaying = playing && this.started && sinceAdvance >= STALL_AFTER;
    const longBuffer = state === 'buffering' && inState > BUFFER_TOLERANCE;
    const unexpectedStop = this.started && (state === 'paused' || state === 'unstarted' || state === 'cued');
    this.abnormal = this.started && (stalledPlaying || longBuffer || unexpectedStop);
    const stopped = state === 'unstarted' || state === 'cued' || state === 'paused';
    this.blocked = !this.started && stopped && (now - this.requestedAt) / 1000 > BLOCKED_AFTER;
  }

  /** 重新请求播放后重置"被拦截"的计时 */
  markRequested() {
    this.requestedAt = performance.now();
  }
}
