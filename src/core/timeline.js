// 演出时钟：所有补间和等待都由渲染循环推进。
// 标签页隐藏时 requestAnimationFrame 停止，演出流程也随之暂停，不会"跳着演"。
//
// 每个等待/补间都可以挂一个 AbortSignal：观众按"下一首"时中止当前环节，
// 补间立即跳到终点，Promise 以 SkipSignal 拒绝，由导演（Director）接住。

import { clamp01 } from './math.js';

export class SkipSignal extends Error {
  constructor() {
    super('跳过当前环节');
    this.name = 'SkipSignal';
  }
}

export const isSkip = (err) => err instanceof SkipSignal;

/** 不需要等待结果的后台动画：吞掉跳过信号，其他错误照常报告 */
export function background(promise) {
  promise.catch((err) => {
    if (!isSkip(err)) console.error(err);
  });
  return promise;
}

export const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
  sine: (k) => 0.5 - 0.5 * Math.cos(Math.PI * k),
};

export class Timeline {
  constructor() {
    this.time = 0;
    this.speed = 1; // 调试用：?speed=4 加速仪式环节（不影响视频本身）
    this.tasks = new Set();
  }

  update(dt) {
    this.time += dt * this.speed;
    for (const task of this.tasks) task.tick(this.time);
  }

  /**
   * 补间：duration 秒内把进度从 0 推到 1，每帧调用 fn(缓动后的进度)。
   * 被中止时立即调用 fn(1) 跳到终点。
   */
  animate(duration, fn, { ease: easing = ease.inOut, delay = 0, signal } = {}) {
    const tick = (elapsed) => {
      if (elapsed < delay) return;
      fn(easing(duration > 0 ? clamp01((elapsed - delay) / duration) : 1));
    };
    return this.#task(delay + duration, tick, signal, () => fn(easing(1)));
  }

  /** 等待若干秒（演出时钟） */
  wait(seconds, signal) {
    return this.#task(seconds, null, signal, null);
  }

  #task(total, onTick, signal, onAbort) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        onAbort?.();
        reject(new SkipSignal());
        return;
      }
      const start = this.time;
      const cleanup = () => {
        this.tasks.delete(task);
        signal?.removeEventListener('abort', abort);
      };
      const task = {
        tick: (now) => {
          const elapsed = now - start;
          onTick?.(elapsed);
          if (elapsed >= total) {
            cleanup();
            resolve();
          }
        },
      };
      const abort = () => {
        cleanup();
        onAbort?.();
        reject(new SkipSignal());
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.tasks.add(task);
    });
  }
}
