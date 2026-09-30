// 演出中的底部控制条：默认隐藏，鼠标移到屏幕底部才出现（选镜头 / 跳到下一首 / 结束演出）。
// 同时负责"点击继续"之类的提示，以及演出中隐藏鼠标。
// 镜头也能用键盘切换：1 座位、2～8 固定机位、F 自由移动（控制条不出现也能用）。

import { setCursorHidden } from './fullscreen.js';
import { VIEWS } from '../stage/cameraRig.js';

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
      <div class="controls-bar controls-views" role="toolbar" aria-label="镜头">
        ${VIEWS.map((v) => `<button type="button" data-view="${v.id}" aria-pressed="${v.id === 'seat'}" title="快捷键 ${v.key}">${v.label}</button>`).join('')}
      </div>
      <div class="controls-hint" role="status" hidden></div>
      <div class="show-prompt" role="status" hidden></div>`;
    this.bar = root.querySelector('.controls-bar');
    this.views = root.querySelector('.controls-views');
    this.hint = root.querySelector('.controls-hint');
    this.rig = null;
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
    this.views.addEventListener('click', (e) => {
      const id = e.target.closest('button')?.dataset.view;
      if (id) this.setView(id);
    });
    this.onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea')) return;
      const key = e.code === 'KeyF' ? 'F' : e.code.replace(/^(Digit|Numpad)/, '');
      const view = VIEWS.find((v) => v.key === key);
      if (view) this.setView(view.id);
    };
    this.onMove = (e) => this.#handlePointer(e.clientY);
    this.onTouch = (e) => this.#handlePointer(e.touches[0]?.clientY ?? 0, 4000);
    // 提示出现时，点任意处都算"继续"（捕获阶段，保证先于其他处理）
    this.onPromptClick = (e) => {
      if (!this.promptCallback || this.bar.contains(e.target) || this.views.contains(e.target)) return;
      const cb = this.promptCallback;
      this.clearPrompt();
      cb();
    };
  }

  /**
   * @param {object} director 演出状态机
   * @param {import('../stage/cameraRig.js').CameraRig} [rig] 镜头（选机位、自由移动）
   */
  attach(director, rig = null) {
    this.director = director;
    this.rig = rig;
    this.root.hidden = false;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('touchstart', this.onTouch, { passive: true });
    window.addEventListener('pointerdown', this.onPromptClick, true);
    setCursorHidden(true);
  }

  detach() {
    this.setView('seat');
    this.director = null;
    this.rig = null;
    this.root.hidden = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('touchstart', this.onTouch);
    window.removeEventListener('pointerdown', this.onPromptClick, true);
    setCursorHidden(false);
  }

  /** 切换镜头，并更新按钮状态；进入自由移动时提示操作方法 */
  setView(id) {
    if (!this.rig) return;
    this.rig.setView(id);
    const current = this.rig.view;
    for (const b of this.views.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === current));
    clearTimeout(this.hintTimer);
    this.hint.hidden = current !== 'free';
    if (current === 'free') {
      const touch = matchMedia('(pointer: coarse)').matches;
      this.hint.textContent = touch
        ? '单指拖动转视角 · 双指缩放和平移 · 从底部唤出控制条回到座位'
        : '拖动转视角 · 滚轮推拉 · 右键拖动平移 · WASD 移动 · 按 1 回到座位';
      this.hintTimer = setTimeout(() => { this.hint.hidden = true; }, 6000);
    }
    this.#syncCursor();
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  #handlePointer(y, hold = 1200) {
    const near = y > window.innerHeight - REVEAL_ZONE;
    if (near) this.#show(true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.bar.matches(':hover') && !this.views.matches(':hover')) this.#show(false);
    }, near ? Math.max(hold, 2500) : hold);
  }

  #show(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.bar.classList.toggle('visible', on);
    this.views.classList.toggle('visible', on);
    this.#syncCursor();
  }

  #syncCursor() {
    // 自由移动时要用鼠标拖动，始终显示
    setCursorHidden(!!this.director && !this.visible && !this.promptCallback && this.rig?.view !== 'free');
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
