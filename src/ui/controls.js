// 演出中的底部控制条：默认隐藏，鼠标移到屏幕底部才出现（跳到下一首 / 结束演出）。
// 同时负责"点击继续"之类的提示，以及演出中隐藏鼠标。

import { setCursorHidden } from './fullscreen.js';

const REVEAL_ZONE = 110; // 距底部多少像素内唤出控制条

export class ShowControls {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="controls-bar" role="toolbar" aria-label="演出控制">
        <span class="controls-status"></span>
        <button type="button" data-action="next">下一首</button>
        <button type="button" data-action="end">结束演出</button>
      </div>
      <div class="show-prompt" role="status" hidden></div>`;
    this.bar = root.querySelector('.controls-bar');
    this.status = root.querySelector('.controls-status');
    this.promptEl = root.querySelector('.show-prompt');
    this.director = null;
    this.visible = false;
    this.promptCallback = null;
    this.hideTimer = null;

    this.bar.addEventListener('click', (e) => {
      const action = e.target.closest('button')?.dataset.action;
      if (action === 'next') this.director?.skip();
      if (action === 'end') this.director?.end();
    });
    this.onMove = (e) => this.#handlePointer(e.clientY);
    this.onTouch = (e) => this.#handlePointer(e.touches[0]?.clientY ?? 0, 4000);
    // 提示出现时，点任意处都算"继续"（捕获阶段，保证先于其他处理）
    this.onPromptClick = (e) => {
      if (!this.promptCallback || this.bar.contains(e.target)) return;
      const cb = this.promptCallback;
      this.clearPrompt();
      cb();
    };
  }

  attach(director) {
    this.director = director;
    this.root.hidden = false;
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('touchstart', this.onTouch, { passive: true });
    window.addEventListener('pointerdown', this.onPromptClick, true);
    setCursorHidden(true);
  }

  detach() {
    this.director = null;
    this.root.hidden = true;
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('touchstart', this.onTouch);
    window.removeEventListener('pointerdown', this.onPromptClick, true);
    setCursorHidden(false);
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  #handlePointer(y, hold = 1200) {
    const near = y > window.innerHeight - REVEAL_ZONE;
    if (near) this.#show(true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.bar.matches(':hover')) this.#show(false);
    }, near ? Math.max(hold, 2500) : hold);
  }

  #show(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.bar.classList.toggle('visible', on);
    this.#syncCursor();
  }

  #syncCursor() {
    setCursorHidden(!!this.director && !this.visible && !this.promptCallback);
  }

  /** 显示一条需要观众点击的提示，点击任意处后执行 onClick */
  prompt(text, onClick) {
    this.promptEl.textContent = text;
    this.promptEl.hidden = false;
    this.promptCallback = onClick;
    this.#syncCursor();
  }

  clearPrompt() {
    this.promptEl.hidden = true;
    this.promptCallback = null;
    this.#syncCursor();
  }
}
