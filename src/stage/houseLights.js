// 观众席灯光：每一排一个亮度值（0~1）。
// 驱动三样东西：侧墙壁灯/天花筒灯的亮度、观众的受光（Audience 读取 levels）、整体的半球环境光。
// "逐排熄灭"就是按排错开时间把 levels 推到 0。

import * as THREE from 'three';
import { SEATING } from './layout.js';
import { LUX, candela } from './lightBudget.js';

const WASH_COLOR = 0xffd2a0;
const WASH_HEIGHT = 19.5;
const HEAD_HEIGHT = 2; // 观众头顶的大致高度（池座前后排平均）

export class HouseLights {
  constructor(lamps) {
    this.lamps = lamps; // { mesh, rowOf }
    this.levels = new Float32Array(SEATING.rows + 1).fill(1);
    // 厅内的暖色漫反射补光（照度约为洗墙光的六分之一）；环境贴图另外提供一部分，见 World
    this.hemi = new THREE.HemisphereLight(0xffe0c0, 0x1a110b, 0);
    this.hemi.position.set(0, 20, 10);
    // 天花的两大片暖色洗墙光：开演前满场暖黄，熄灯后完全关掉。
    // 按观众头顶的照度定亮度（lightBudget.js）；光锥收窄一点，少往舞台上溢
    this.washes = [8, 22].map((z) => {
      const l = new THREE.SpotLight(WASH_COLOR, 0, 0, 0.8, 0.9, 2);
      l.position.set(0, WASH_HEIGHT, z);
      l.target.position.set(0, 0, z + 1);
      l.baseIntensity = candela(LUX.house, WASH_HEIGHT - HEAD_HEIGHT, WASH_COLOR);
      return l;
    });
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
    this.hemi.intensity = 0.03 + 0.35 * avg;
    // 前半场、后半场各一盏，分别跟随对应几排的亮度（逐排熄灭时从后往前暗下去）
    const half = SEATING.rows / 2;
    let front = 0;
    let back = 0;
    for (let row = 1; row <= SEATING.rows; row++) {
      if (row <= half) front += this.levels[row] / half;
      else back += this.levels[row] / half;
    }
    this.washes[0].intensity = this.washes[0].baseIntensity * front;
    this.washes[1].intensity = this.washes[1].baseIntensity * back;
    // 灯光没变化时不重复上传灯具颜色
    let signature = 0;
    for (let row = 1; row <= SEATING.rows; row++) signature += this.levels[row] * row;
    if (Math.abs(signature - this.lastSignature) < 1e-4) return;
    this.lastSignature = signature;
    const { mesh, rowOf } = this.lamps;
    for (let i = 0; i < rowOf.length; i++) {
      const level = this.levels[rowOf[i]];
      // 灯具发光面比 Bloom 门槛亮一截，亮灯时会微微晕开
      mesh.setColorAt(i, this.tmpColor.copy(this.lampColor).multiplyScalar(0.05 + 4 * level));
    }
    mesh.instanceColor.needsUpdate = true;
  }
}
