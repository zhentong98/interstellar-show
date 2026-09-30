// 模拟播放器：?mock 时代替 YouTube，用于离线开发和自动化测试。
// 画一段带时间码的测试画面，接口与 YouTubeScreenPlayer 一致。
//
//   ?mock          每段 40 秒
//   ?mock=90       每段 90 秒
//   ?mockstall=12  每段在第 12 秒模拟 3 秒缓冲，用来检查幕布和乐团等待姿态

export class MockScreenPlayer {
  constructor(host, { duration = 40, stallAt = null } = {}) {
    this.host = host;
    this.duration = duration;
    this.stallAt = stallAt;
    this.error = null;
    this.state = 'unstarted';
    this.time = 0;
    this.muted = false;
    this.title = '';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    Object.assign(this.canvas.style, { width: '100%', height: '100%', display: 'block' });
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ready = Promise.resolve(this);
    this.last = performance.now();
    this.stallUntil = 0;
    this.stalled = false;
    this.#loop();
  }

  #loop() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (this.state === 'playing') {
      this.time += dt;
      if (this.stallAt !== null && !this.stalled && this.time >= this.stallAt) {
        this.stalled = true;
        this.state = 'buffering';
        this.stallUntil = now + 3000;
      }
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.state = 'ended';
      }
    } else if (this.state === 'buffering' && this.stallUntil && now > this.stallUntil) {
      this.stallUntil = 0;
      this.state = 'playing';
    }
    this.#draw();
    requestAnimationFrame(() => this.#loop());
  }

  #draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const k = this.time / this.duration;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${200 + k * 60}, 45%, 18%)`);
    g.addColorStop(1, `hsl(${20 + k * 40}, 55%, 30%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 移动的竖条，方便看出画面在走
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 8; i++) ctx.fillRect(((i / 8 + this.time * 0.05) % 1) * w, 0, 18, h);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '600 64px Georgia, serif';
    ctx.fillText(this.title || '模拟片段', w / 2, h / 2 - 30);
    ctx.font = '40px ui-monospace, monospace';
    ctx.fillText(`${this.time.toFixed(2)} / ${this.duration.toFixed(0)} 秒 · ${this.state}`, w / 2, h / 2 + 40);
    ctx.font = '24px sans-serif';
    ctx.fillText('?mock 模拟播放器（不含任何影片内容）', w / 2, h - 40);
  }

  async preload(videoId) {
    this.title = videoId;
    this.time = 0;
    this.stalled = false;
    this.state = 'buffering';
    await new Promise((r) => setTimeout(r, 600));
    this.state = 'paused';
    return { ok: true };
  }

  play() {
    this.muted = false;
    this.state = 'buffering';
    setTimeout(() => {
      if (this.state === 'buffering') this.state = 'playing';
    }, 400);
  }

  pause() {
    if (this.state !== 'ended') this.state = 'paused';
  }

  setVolume() {}
  unMute() {
    this.muted = false;
  }
  isMuted() {
    return this.muted;
  }
  getTime() {
    return this.time;
  }
  getDuration() {
    return this.duration;
  }
  getState() {
    return this.state;
  }
  setInteractive(on) {
    this.host.style.pointerEvents = on ? 'auto' : 'none';
  }
}
