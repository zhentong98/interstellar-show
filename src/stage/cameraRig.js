// 镜头：看电影的感觉。
//
// - 默认固定在第 8 排正中的"最佳座位"：巨幕在上方占画面大部分，乐团在下方三分之一，
//   画面最下沿能看到前排观众的后脑勺
// - 片段播放时几乎不动，只有极缓慢的呼吸式漂移；高潮时轻微震动
// - 只有入场、换场、谢幕时才沿预设路径自由移动，最后总是回到座位
//
// 观众也可以自己选镜头（控制条或数字键）：
// - 固定机位：像音乐会转播一样对准指挥、小提琴、大提琴、定音鼓、管风琴、合唱团，镜头缓缓漂移
// - 自由移动：鼠标拖动转视角、滚轮推拉、右键平移、WASD / 方向键移动；手机单指转、双指缩放
// - 自动导播：演奏时按音乐的起伏自动切机位，像电视转播；不演奏时交给入场、换场、谢幕的预设运镜
// 选了座位和自动导播以外的镜头后，入场、换场、谢幕的自动运镜让位给观众的选择。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { damp, seededRandom } from '../core/math.js';
import { ease } from '../core/timeline.js';
import { SCREEN, STAGE_Y, SEAT_EYE, HALL, STAGE } from './layout.js';

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

/**
 * 固定机位：位置、看向的点、视场角（度）。
 * 大多数机位用长焦（视场角小），画面像转播镜头一样压缩纵深、突出主体。
 */
export const SHOTS = {
  wide: { label: '舞台全景', key: '2', pos: v(0, 6.4, 7.2), target: v(0, 2.8, -6.5), fov: 50 },
  conductor: { label: '指挥', key: '3', pos: v(1.2, 2.6, -5.0), target: v(0, 2.55, -1.6), fov: 30 },
  violins: { label: '小提琴', key: '4', pos: v(-0.9, 2.3, 0.4), target: v(-2.5, 1.75, -2.6), fov: 38 },
  // 大提琴坐在最外一道弧，正面平视会被谱架挡住琴身：从前侧方高处斜着俯拍整排
  cellos: { label: '大提琴', key: '5', pos: v(-1.6, 4.3, -3.7), target: v(-4.4, 1.4, -4.9), fov: 38 },
  timpani: { label: '定音鼓', key: '6', pos: v(2.9, 3.1, -1.5), target: v(4.8, 2.1, -4.2), fov: 38 },
  organ: { label: '管风琴', key: '7', pos: v(2.7, 2.5, -7.0), target: v(0.3, 1.8, -8.6), fov: 36 },
  // 放在定音鼓的左后方，定音鼓手不会挡在前景里
  choir: { label: '合唱团', key: '8', pos: v(2.0, 3.3, -4.8), target: v(6.8, 2.6, -9.2), fov: 40 },
};

/** 观众能选的全部镜头（按控制条上的顺序） */
export const VIEWS = [
  { id: 'seat', label: '座位', key: '1' },
  { id: 'auto', label: '自动导播', key: '0' },
  ...Object.entries(SHOTS).map(([id, s]) => ({ id, label: s.label, key: s.key })),
  { id: 'free', label: '自由移动', key: 'F' },
];

/** 自由移动的活动范围：留在音乐厅里，不钻进地板和天花板 */
const FREE_BOUNDS = new THREE.Box3(
  v(-HALL.halfWidth + 0.8, STAGE_Y + 0.3, STAGE.back + 0.8),
  v(HALL.halfWidth - 0.8, HALL.height - 1.5, HALL.back - 1),
);
/**
 * 自动导播。成对的数值是 [安静段落, 激烈段落]，按当前强度插值；时长单位是秒。
 * 座位视角能看到电影，是导播的"主镜头"：每个特写之后多半切回座位，座位停得最久。
 * 按下面的数值，座位视角约占演奏时间的六成多（五首曲目按 cue 表离线模拟为 60%～66%）。
 */
const AUTO = {
  // 特写机位被选中的权重
  weights: {
    wide: [1.5, 2.5], conductor: [2, 2], violins: [2, 1.5], cellos: [1.5, 1.5],
    timpani: [0.3, 1.5], organ: [1, 1], choir: [1, 1.5],
  },
  seatHold: [16, 11],
  shotHold: [5.5, 4.5],
  backToSeat: [0.8, 0.65], // 特写结束后切回座位的概率；否则再接一个特写
  opening: 10, // 每一首开头先在座位看这么久电影
  drumLead: 1.6, // 定音鼓：重击前多久切过去（看鼓手抬槌、落下）
  drumAfter: 1.8, // 重击后再停一会儿
  flashHold: 4.5,
  minShot: 2.5, // 任何镜头至少停这么久：闪光不打断更短的镜头，重击前这么久之内也不再换镜头
  idleBack: 1.2, // 停止演奏超过这么久才切回座位（片段结束、长时间缓冲）；短暂缓冲不切
  pushIn: 0.06, // 每个镜头停留期间慢慢推近的比例
};
const lerpPair = ([calm, loud], k) => calm + (loud - calm) * k;
const autoState = (left = 4) => ({ shot: 'seat', left, elapsed: 0, hold: left, recent: [], idle: 0, locked: false });

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
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
    this.view = 'seat'; // 观众选的镜头
    this.auto = autoState();
    this.blend = null; // 切换镜头时的过渡
    this.keys = new Set();
    this.fitToAspect(camera.aspect);
    this.snapToSeat();
  }

  /**
   * 接上自由移动需要的输入（鼠标、触摸、键盘）。
   * @param {HTMLElement} element 接收拖动的元素
   */
  attachInput(element) {
    this.orbit = new OrbitControls(this.camera, element);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.rotateSpeed = 0.5;
    this.orbit.zoomSpeed = 0.8;
    this.orbit.minDistance = 0.4;
    this.orbit.maxDistance = 30;
    this.orbit.screenSpacePanning = true;
    window.addEventListener('keydown', (e) => { if (MOVE_KEYS[e.code]) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 切换镜头：座位、固定机位或自由移动；过渡约 1.8 秒 */
  setView(id) {
    if (id === this.view || !(id === 'seat' || id === 'auto' || (id === 'free' && this.orbit) || SHOTS[id])) return;
    const cam = this.camera;
    this.view = id;
    if (this.orbit) this.orbit.enabled = id === 'free';
    if (id === 'free') {
      // 从当前画面开始自由移动
      this.blend = null;
      this.mode = 'free';
      this.orbit.target.copy(this.lookAt ?? this.target);
      this.orbit.update();
      return;
    }
    this.blend = { k: 0, pos: cam.position.clone(), target: (this.lookAt ?? this.target).clone(), fov: cam.fov };
    this.auto = autoState();
    if (id === 'seat' || id === 'auto') this.snapToSeat(true);
    else this.mode = 'shot';
  }

  /** 当前实际使用的镜头：自动导播时是导播选中的机位，其余就是观众选的 */
  get active() {
    return this.view === 'auto' ? this.auto.shot : this.view;
  }

  /**
   * 自动导播：演奏时按强度和一次性事件切镜头；不演奏时回到座位，让预设运镜接管。
   * 规则按优先级：
   *   1. 定音鼓重击前 drumLead 秒切到定音鼓，锁住到击打后 drumAfter 秒（闪光也不打断）
   *   2. 闪光切全景（已在全景就回座位）；刚切过来不到 minShot 秒的镜头不打断
   *   3. 停留时间到：座位之后接一个特写；特写之后按 backToSeat 的概率回座位，否则再接一个特写。
   *      重击切镜或闪光前 minShot 秒之内不换新镜头，当前镜头多停一会儿
   */
  #direct(dt, perf) {
    const a = this.auto;
    if (!perf?.playing) {
      a.idle += dt;
      if (a.idle > AUTO.idleBack) {
        if (a.shot !== 'seat') this.#cut('seat', 0);
        // 下一次开演先在座位看一会儿电影；停留时长清零，开头的闪光（例如爆炸）也留在座位上看
        a.left = a.hold = AUTO.opening;
        a.elapsed = 0;
      }
      return;
    }
    a.idle = 0;
    a.elapsed += dt;
    a.left -= dt;
    const k = Math.min(1, Math.max(0, perf.intensity ?? 0));
    const nextHit = perf.nextHit ?? Infinity;

    if (nextHit <= AUTO.drumLead) {
      if (a.shot === 'timpani') a.left = Math.max(a.left, nextHit + AUTO.drumAfter);
      else this.#cut('timpani', nextHit + AUTO.drumAfter);
      a.locked = true;
      return;
    }
    if (a.locked && a.left > 0) return;
    a.locked = false;
    if (perf.events?.some((ev) => ev.type === 'flash') && a.elapsed >= AUTO.minShot) {
      return this.#cut(a.shot === 'wide' ? 'seat' : 'wide', AUTO.flashHold);
    }
    // 重击或闪光快到了：当前镜头多停一会儿，免得新镜头没停够就被切走，或者因为太新而错过闪光
    if (a.left > 0 || nextHit - AUTO.drumLead < AUTO.minShot || (perf.nextFlash ?? Infinity) < AUTO.minShot) return;

    const next = a.shot === 'seat' || this.rand() > lerpPair(AUTO.backToSeat, k) ? this.#pickShot(k) : 'seat';
    this.#cut(next, lerpPair(next === 'seat' ? AUTO.seatHold : AUTO.shotHold, k) * (0.85 + this.rand() * 0.3));
  }

  /** 按权重挑一个特写机位，不重复当前和最近用过的两个 */
  #pickShot(k) {
    const a = this.auto;
    const pool = Object.entries(AUTO.weights).filter(([id]) => id !== a.shot && !a.recent.includes(id));
    let r = this.rand() * pool.reduce((sum, [, w]) => sum + lerpPair(w, k), 0);
    for (const [id, w] of pool) {
      r -= lerpPair(w, k);
      if (r <= 0) return id;
    }
    return pool[pool.length - 1][0];
  }

  /** 导播硬切到某个机位 */
  #cut(id, hold) {
    const a = this.auto;
    if (a.shot !== 'seat') a.recent = [a.shot, ...a.recent].slice(0, 2);
    a.shot = id;
    a.left = a.hold = hold;
    a.elapsed = 0;
    a.locked = false;
    this.blend = null;
    if (id === 'seat') this.snapToSeat(true);
    else this.mode = 'shot';
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

    this.seatFov = deg(vfov);
    if (this.view === 'seat' || this.view === undefined) this.camera.fov = this.seatFov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.seat.target.set(eye.x, eye.y + Math.tan(pitch) * toScreen, SCREEN.center.z);
  }

  /** 回到座位。观众选了别的镜头时（force 除外）保持观众的选择 */
  snapToSeat(force = false) {
    if (this.active !== 'seat' && !force) return;
    this.mode = 'seat';
    this.pos.copy(this.seat.position);
    this.target.copy(this.seat.target);
  }

  /** 把镜头放到某条路径的起点（入场前） */
  placeAt(name) {
    const start = PATHS[name]?.start;
    if (!start || this.active !== 'seat') return;
    this.mode = 'path';
    this.pos.copy(start.pos);
    this.target.copy(start.target);
  }

  /** 沿预设路径运镜，结束时回到座位 */
  async fly(name, duration, timeline, signal) {
    // 观众选了别的镜头：不抢镜头，只占用同样的时长，演出节奏不变
    if (this.active !== 'seat') return timeline.wait(duration, signal);
    const def = PATHS[name];
    const posCurve = new THREE.CatmullRomCurve3([this.pos.clone(), ...def.pos, this.seat.position.clone()], false, 'centripetal');
    const tgtCurve = new THREE.CatmullRomCurve3([this.target.clone(), ...def.target, this.seat.target.clone()], false, 'centripetal');
    this.mode = 'path';
    try {
      await timeline.animate(duration, (k) => {
        // 运镜途中观众切了镜头：停止跟随路径
        if (this.active !== 'seat') return;
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

  /** @param {object} [perf] 当前的演奏数据（自动导播用） */
  update(dt, perf) {
    this.time += dt;
    const t = this.time;
    this.shake = damp(this.shake, 0, 3.5, dt);
    const cam = this.camera;

    if (this.view === 'free') {
      this.#updateFree(dt);
      (this.lookAt ??= new THREE.Vector3()).copy(this.orbit.target);
      return;
    }

    if (this.view === 'auto') this.#direct(dt, perf);

    // 期望的镜头：座位 / 入场等运镜路径 / 固定机位
    const pos = this.tmpPos ??= new THREE.Vector3();
    const look = this.tmpLook ??= new THREE.Vector3();
    let fov = this.seatFov;
    const shot = SHOTS[this.active];
    if (shot) {
      // 转播式的缓慢漂移：镜头像架在摇臂上，轻轻地左右、上下移动
      pos.copy(shot.pos);
      pos.x += Math.sin(t * 0.11) * 0.18;
      pos.y += Math.sin(t * 0.07 + 1.1) * 0.08;
      look.copy(shot.target);
      look.x += Math.sin(t * 0.09 + 0.6) * 0.06;
      fov = shot.fov;
      // 导播切过来的镜头在停留期间慢慢推近
      if (this.view === 'auto') pos.lerp(look, AUTO.pushIn * Math.min(1, this.auto.elapsed / this.auto.hold));
    } else {
      pos.copy(this.pos);
      look.copy(this.target);
      if (this.mode === 'seat') {
        // 呼吸式漂移：几厘米、十几秒一个周期
        pos.x += Math.sin(t * 0.37) * 0.012;
        pos.y += Math.sin(t * 0.23 + 1.3) * 0.01;
        look.x += Math.sin(t * 0.13 + 0.4) * 0.05;
        look.y += Math.sin(t * 0.17 + 2.1) * 0.04;
      }
    }

    // 切换镜头的过渡：从切换那一刻的画面平滑地移过去
    if (this.blend) {
      const b = this.blend;
      b.k = Math.min(1, b.k + dt / 1.8);
      const k = ease.sine(b.k);
      pos.lerpVectors(b.pos, pos, k);
      look.lerpVectors(b.target, look, k);
      fov = b.fov + (fov - b.fov) * k;
      if (b.k >= 1) this.blend = null;
    }

    cam.position.copy(pos);
    if (this.shake > 0.001) {
      const r = this.rand;
      this.shakeOffset.set(r() - 0.5, r() - 0.5, 0).multiplyScalar(this.shake);
      look.add(this.shakeOffset);
    }
    cam.lookAt(look);
    (this.lookAt ??= new THREE.Vector3()).copy(look);
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** 自由移动：OrbitControls 负责转、推拉、平移；WASD / 方向键沿水平面移动，镜头和注视点一起走 */
  #updateFree(dt) {
    const cam = this.camera;
    const o = this.orbit;
    if (Math.abs(cam.fov - 55) > 0.01) {
      cam.fov = damp(cam.fov, 55, 4, dt);
      cam.updateProjectionMatrix();
    }
    if (this.keys.size) {
      const fwd = this.tmpFwd ??= new THREE.Vector3();
      const right = this.tmpRight ??= new THREE.Vector3();
      cam.getWorldDirection(fwd).setY(0).normalize();
      right.crossVectors(fwd, cam.up).normalize();
      let f = 0;
      let r = 0;
      for (const code of this.keys) {
        f += MOVE_KEYS[code][1];
        r += MOVE_KEYS[code][0];
      }
      const step = fwd.multiplyScalar(f).addScaledVector(right, r).multiplyScalar(3.5 * dt);
      cam.position.add(step);
      o.target.add(step);
    }
    o.update();
    // 留在音乐厅里：镜头超出范围时，镜头和注视点一起推回来
    const before = this.tmpPos ??= new THREE.Vector3();
    before.copy(cam.position);
    FREE_BOUNDS.clampPoint(cam.position, cam.position);
    o.target.add(before.sub(cam.position).negate());
  }
}
