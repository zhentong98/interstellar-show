// 观众席灯光：每一排一个亮度值（0~1）。
// 驱动三样东西：侧墙壁灯/天花筒灯的亮度、观众的受光（Audience 读取 levels）、整体的半球环境光。
// "逐排熄灭"就是按排错开时间把 levels 推到 0。

import * as THREE from 'three';
import { SEATING } from './layout.js';

export class HouseLights {
  constructor(lamps) {
    this.lamps = lamps; // { mesh, rowOf }
    this.levels = new Float32Array(SEATING.rows + 1).fill(1);
    this.hemi = new THREE.HemisphereLight(0xffe0c0, 0x1a110b, 1.4);
    this.hemi.position.set(0, 20, 10);
    this.lampColor = new THREE.Color(0xffd6a0);
    this.tmpColor = new THREE.Color();
    this.lastSignature = -1;
  }

  get average() {
    let sum = 0;
    for (let row = 1; row <= SEATING.rows; row++) sum += this.levels[row];
    return sum / SEATING.rows;
  }

  setAll(level) {
    this.levels.fill(level);
  }

  /**
   * 逐排渐变到 target。from = 'back' 表示从最后一排开始（开演熄灯），'front' 从第一排开始（散场亮灯）。
   * 最后一排渐变结束时 resolve。
   */
  fadeRows(target, { from = 'back', stagger = 0.16, fade = 1.4 }, timeline, signal) {
    const jobs = [];
    for (let row = 1; row <= SEATING.rows; row++) {
      const order = from === 'back' ? SEATING.rows - row : row - 1;
      const start = this.levels[row];
      jobs.push(timeline.animate(fade, (k) => {
        this.levels[row] = start + (target - start) * k;
      }, { delay: order * stagger, signal }));
    }
    return Promise.all(jobs);
  }

  update() {
    const avg = this.average;
    this.hemi.intensity = 0.06 + 1.35 * avg;
    // 灯光没变化时不重复上传灯具颜色
    let signature = 0;
    for (let row = 1; row <= SEATING.rows; row++) signature += this.levels[row] * row;
    if (Math.abs(signature - this.lastSignature) < 1e-4) return;
    this.lastSignature = signature;
    const { mesh, rowOf } = this.lamps;
    for (let i = 0; i < rowOf.length; i++) {
      const level = this.levels[rowOf[i]];
      mesh.setColorAt(i, this.tmpColor.copy(this.lampColor).multiplyScalar(0.03 + 2.2 * level));
    }
    mesh.instanceColor.needsUpdate = true;
  }
}
