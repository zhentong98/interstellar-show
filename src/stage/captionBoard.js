// 舞台侧的字幕牌：换场时亮出下一首的曲名，像音乐厅里的字幕屏。

import * as THREE from 'three';
import { SCREEN, HALL, STAGE_Y } from './layout.js';
import { damp } from '../core/math.js';
import { fontsReady, drawSpaced, SERIF_LATIN, SERIF_CJK } from '../ui/fonts.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export class CaptionBoard {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: 0x000000, toneMapped: false });
    const w = 3.4;
    const h = (w * this.canvas.height) / this.canvas.width;
    this.group = new THREE.Group();
    this.group.name = '字幕牌';
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.6, metalness: 0.3 }),
    );
    frame.position.z = -0.045;
    this.group.add(frame, face);
    // 装在舞台右侧管风琴琴箱的立面上（巨幕右下方），合唱团挡不到，略微朝向观众席中央
    this.group.position.set(Math.min(SCREEN.width / 2 + 2.2, HALL.halfWidth - 2), STAGE_Y + 2.1, SCREEN.center.z + 0.9);
    this.group.rotation.y = -0.22;

    this.level = 0;
    this.target = 0;
    this.#clear();
  }

  #clear() {
    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  async #draw(lines) {
    await fontsReady();
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(214, 188, 140, 0.9)';
    ctx.font = `400 34px ${SERIF_CJK}`;
    drawSpaced(ctx, lines.kicker, w / 2, 78, 8);
    ctx.fillStyle = '#f4ecdc';
    ctx.font = `600 ${lines.title.length > 16 ? 76 : 92}px ${SERIF_LATIN}`;
    ctx.fillText(lines.title, w / 2, 200);
    ctx.fillStyle = 'rgba(232, 222, 204, 0.75)';
    ctx.font = `400 40px ${SERIF_CJK}`;
    ctx.fillText(lines.sub, w / 2, 290);
    this.texture.needsUpdate = true;
  }

  /** 亮出下一首 */
  showSong(song, index, total) {
    this.#draw({
      kicker: `下一首 · 第 ${ROMAN[index] ?? index + 1} 首 / 共 ${total} 首`,
      title: song.title,
      sub: song.scene,
    }).then(() => {
      this.target = 1;
    });
  }

  /** 显示一条提示（比如片段无法播放） */
  showMessage(kicker, title, sub = '') {
    this.#draw({ kicker, title, sub }).then(() => {
      this.target = 1;
    });
  }

  hide() {
    this.target = 0;
  }

  update(dt) {
    this.level = damp(this.level, this.target, 3, dt);
    this.material.color.setScalar(this.level * 1.15);
  }
}
