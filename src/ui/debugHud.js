// ?debug 调试面板：显示当前环节、播放时间、cue、强度和镜头，方便对照视频校准 src/cues/<slug>.js

import { VIEWS } from '../stage/cameraRig.js';

const viewLabel = (id) => VIEWS.find((v) => v.id === id)?.label ?? id;

export class DebugHud {
  constructor(director, world) {
    this.director = director;
    this.world = world;
    this.el = document.createElement('pre');
    this.el.className = 'debug-hud';
    document.body.appendChild(this.el);
    this.frames = 0;
    this.lastFps = performance.now();
    this.fps = 0;
    world.onFrame(() => this.#tick());
  }

  #tick() {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFps < 250) return;
    this.fps = Math.round((this.frames * 1000) / (now - this.lastFps));
    this.frames = 0;
    this.lastFps = now;

    const d = this.director;
    const clock = d.phase === 'song' ? d.clock : null;
    const perf = this.world.perf;
    this.el.textContent = [
      `环节   ${d.statusText || d.phase}`,
      clock ? `时间   ${clock.time.toFixed(2)} / ${clock.duration.toFixed(1)} 秒` : null,
      clock ? `播放器 ${clock.state}${clock.abnormal ? ' · 异常' : ''}${clock.blocked ? ' · 被拦截' : ''}` : null,
      clock ? `cue    ${perf.cueName || '—'}` : null,
      `强度   ${perf.intensity.toFixed(2)}${perf.playing ? '' : '（等待）'}`,
      `镜头   ${this.#cameraText()}`,
      `帧率   ${this.fps}`,
    ].filter(Boolean).join('\n');
  }

  #cameraText() {
    const rig = this.world.rig;
    if (rig.view !== 'auto') return viewLabel(rig.view);
    const left = this.world.perf.playing ? `（还剩 ${Math.max(0, rig.auto.left).toFixed(1)} 秒）` : '';
    return `自动导播 · ${viewLabel(rig.active)}${left}`;
  }
}
