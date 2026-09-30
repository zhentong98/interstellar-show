// 镜头：看电影的感觉。
//
// - 默认固定在第 8 排正中的"最佳座位"：巨幕在上方占画面大部分，乐团在下方三分之一，
//   画面最下沿能看到前排观众的后脑勺
// - 片段播放时几乎不动，只有极缓慢的呼吸式漂移；高潮时轻微震动
// - 只有入场、换场、谢幕时才沿预设路径自由移动，最后总是回到座位

import * as THREE from 'three';
import { damp, seededRandom } from '../core/math.js';
import { ease } from '../core/timeline.js';
import { SCREEN, STAGE_Y, SEAT_EYE } from './layout.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const deg = THREE.MathUtils.radToDeg;

/** 运镜路径：起点是当前镜头，终点总是座位；这里只列中间的航点 */
const PATHS = {
  // 入场：从大厅最后方的高处，滑过观众席回到第 8 排
  entrance: {
    // 起点在后楼座栏杆的正前方（再往后会被楼座挡住），俯瞰亮着灯的池座
    start: { pos: v(0, 7.4, 24.3), target: v(0, 4.5, -10) },
    pos: [v(0.8, 5.5, 21), v(0.3, 3.2, 13.5)],
    target: [v(0, 6, -12), v(0, 7.5, -12)],
  },
  // 换场 A：推近左侧弦乐，再扫过左侧管风琴音管墙
  sweepLeft: {
    pos: [v(-2.6, 3.1, 4.2), v(-4.8, 5.2, 1.8), v(-2, 4, 6.5)],
    target: [v(-3.6, 2.1, -4), v(-11, 10.5, -13), v(-1, 8, -13)],
  },
  // 换场 B：推近定音鼓和合唱团，再扫过右侧音管墙
  sweepRight: {
    pos: [v(2.4, 3.0, 4.4), v(4.8, 5.4, 1.8), v(2, 4, 6.5)],
    target: [v(5, 2.4, -6), v(11, 11, -13), v(1, 8, -13)],
  },
  // 谢幕：缓缓推近舞台，停一会儿再退回座位
  finale: {
    pos: [v(0, 2.7, 6.8), v(0, 2.7, 6.2)],
    target: [v(0, 4.5, -8), v(0, 5, -8)],
  },
};

export class CameraRig {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;
    this.seat = { position: SEAT_EYE.clone(), target: new THREE.Vector3() };
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.mode = 'seat';
    this.time = 0;
    this.shake = 0;
    this.shakeOffset = new THREE.Vector3();
    this.rand = seededRandom(3);
    this.fitToAspect(camera.aspect);
    this.snapToSeat();
  }

  /**
   * 按画面比例计算座位视角：
   * 上沿留一点巨幕上方的空间，下沿露出台口和前排观众的头顶；
   * 窄屏（竖屏手机）时加大视场角，保证巨幕宽度不超出画面。
   */
  fitToAspect(aspect) {
    const eye = SEAT_EYE;
    const toScreen = eye.z - SCREEN.center.z;
    const top = Math.atan2(SCREEN.bottom + SCREEN.height + 0.6 - eye.y, toScreen);
    const bottom = Math.atan2(STAGE_Y - eye.y, eye.z) - THREE.MathUtils.degToRad(3);
    let vfov = top - bottom;
    const pitch = (top + bottom) / 2;
    const screenHalf = Math.atan2(SCREEN.width / 2, toScreen);
    const neededHalf = Math.atan(Math.tan(screenHalf) / 0.92);
    const hHalf = Math.atan(Math.tan(vfov / 2) * aspect);
    if (hHalf < neededHalf) vfov = 2 * Math.atan(Math.tan(neededHalf) / aspect);

    this.camera.fov = deg(vfov);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.seat.target.set(eye.x, eye.y + Math.tan(pitch) * toScreen, SCREEN.center.z);
  }

  snapToSeat() {
    this.mode = 'seat';
    this.pos.copy(this.seat.position);
    this.target.copy(this.seat.target);
  }

  /** 把镜头放到某条路径的起点（入场前） */
  placeAt(name) {
    const start = PATHS[name]?.start;
    if (!start) return;
    this.mode = 'path';
    this.pos.copy(start.pos);
    this.target.copy(start.target);
  }

  /** 沿预设路径运镜，结束时回到座位 */
  async fly(name, duration, timeline, signal) {
    const def = PATHS[name];
    const posCurve = new THREE.CatmullRomCurve3([this.pos.clone(), ...def.pos, this.seat.position.clone()], false, 'centripetal');
    const tgtCurve = new THREE.CatmullRomCurve3([this.target.clone(), ...def.target, this.seat.target.clone()], false, 'centripetal');
    this.mode = 'path';
    try {
      await timeline.animate(duration, (k) => {
        posCurve.getPoint(k, this.pos);
        tgtCurve.getPoint(k, this.target);
      }, { ease: ease.sine, signal });
    } finally {
      this.snapToSeat();
    }
  }

  /** 镜头震动：amount 约等于巨幕处的偏移米数 */
  addShake(amount) {
    this.shake = Math.min(0.6, this.shake + amount);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.shake = damp(this.shake, 0, 3.5, dt);

    const cam = this.camera;
    cam.position.copy(this.pos);
    const look = this.target.clone();
    if (this.mode === 'seat') {
      // 呼吸式漂移：几厘米、十几秒一个周期
      cam.position.x += Math.sin(t * 0.37) * 0.012;
      cam.position.y += Math.sin(t * 0.23 + 1.3) * 0.01;
      look.x += Math.sin(t * 0.13 + 0.4) * 0.05;
      look.y += Math.sin(t * 0.17 + 2.1) * 0.04;
    }
    if (this.shake > 0.001) {
      const r = this.rand;
      this.shakeOffset.set(r() - 0.5, r() - 0.5, 0).multiplyScalar(this.shake);
      look.add(this.shakeOffset);
    }
    cam.lookAt(look);
  }
}
