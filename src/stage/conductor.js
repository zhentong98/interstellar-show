// 指挥（里程碑 1：几何体占位）：走上台、握手、鞠躬、转身、举棒、按 4/4 拍画拍子、收住。
// 指挥是"整个乐团真的在演"的最强信号，所以即使是占位模型也要把拍子图形画对。
//
// 角色局部坐标面朝 +z；右手在 -x，左手在 +x。
// 朝向：face('audience') → 面朝观众席（+z），face('orchestra') → 背对观众面向乐团。

import * as THREE from 'three';
import { damp, lerp, smoothstep } from '../core/math.js';
import { STAGE_Y, PODIUM, PODIUM_HEIGHT } from './layout.js';

const mat = {
  suit: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.7 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.8 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb58a6c, roughness: 0.6 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.9 }),
  baton: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.4 }),
  podium: new THREE.MeshStandardMaterial({ color: 0x1b120c, roughness: 0.5 }),
};

// 姿势：每只手臂 { fwd: 向前抬起角, side: 向外张开角 }（弧度）
const POSES = {
  rest: { r: { fwd: 0.08, side: 0.1 }, l: { fwd: 0.08, side: 0.1 } },
  ready: { r: { fwd: 1.45, side: 0.28 }, l: { fwd: 1.3, side: 0.35 } },
  handshake: { r: { fwd: 0.95, side: 0.05 }, l: { fwd: 0.1, side: 0.12 } },
  wideHold: { r: { fwd: 2.0, side: 0.85 }, l: { fwd: 2.0, side: 0.85 } },
  gestureLeft: { r: { fwd: 0.2, side: 0.1 }, l: { fwd: 0.6, side: 1.3 } },
  gestureRight: { r: { fwd: 0.6, side: 1.3 }, l: { fwd: 0.2, side: 0.1 } },
  gestureUp: { r: { fwd: 1.9, side: 0.5 }, l: { fwd: 1.9, side: 0.5 } },
};

// 4/4 拍子图形：每拍的"点"位置（右手，局部 x 正方向是指挥的左边）
// 第 1 拍向下、第 2 拍向左、第 3 拍向右、第 4 拍向上准备下一小节
const BEAT_X = [0, 0.55, -0.7, -0.1];
const BEAT_REBOUND = [0.9, 0.7, 0.8, 1.5];

export class Conductor {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '指挥';

    // 指挥台
    this.podium = new THREE.Mesh(new THREE.BoxGeometry(1.1, PODIUM_HEIGHT, 1.1), mat.podium);
    this.podium.position.set(PODIUM.x, STAGE_Y + PODIUM_HEIGHT / 2, PODIUM.z);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.04, 0.04).translate(0, 0.95, -0.52),
      mat.podium,
    );
    rail.position.copy(this.podium.position);
    this.group.add(this.podium, rail);

    // 身体
    this.body = new THREE.Group();
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    const leg = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.8, 4, 8).translate(0, -0.475, 0), mat.suit));
      return g;
    };
    this.legL = leg();
    this.legR = leg();
    this.legL.position.x = 0.1;
    this.legR.position.x = -0.1;
    this.hips.add(this.legL, this.legR);

    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.torso.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.4, 4, 12).translate(0, 0.38, 0), mat.suit));
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 10).translate(0, 0.74, 0), mat.shirt);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12).scale(0.92, 1.12, 1).translate(0, 0.9, 0), mat.skin);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.1, 1.05).translate(0, 0.92, -0.01), mat.hair);
    this.torso.add(collar, head, hair);

    const arm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24, 0.62, 0);
      shoulder.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.52, 4, 8).translate(0, -0.3, 0), mat.suit));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8).translate(0, -0.62, 0), mat.skin);
      shoulder.add(hand);
      this.torso.add(shoulder);
      return shoulder;
    };
    this.armR = arm(-1);
    this.armL = arm(1);
    // 指挥棒握在右手，顺着手臂方向略微上挑
    this.baton = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.42, 6).translate(0, -0.21, 0), mat.baton);
    this.baton.position.set(0, -0.63, 0.02);
    this.baton.rotation.x = -0.35;
    this.armR.add(this.baton);
    this.group.add(this.body);

    // 状态
    this.pose = 'rest';
    this.arms = { r: { ...POSES.rest.r }, l: { ...POSES.rest.l } };
    this.yaw = Math.PI / 2;
    this.yawTarget = Math.PI / 2;
    this.bow = 0;
    this.bowTarget = 0;
    this.walking = 0;
    this.walkPhase = 0;
    this.beat = 0;
    this.body.position.set(0, STAGE_Y, 0);
    this.body.visible = false;
  }

  /** 瞬间放到某处（跳过环节时用） */
  place(position, facing) {
    this.body.visible = true;
    this.body.position.copy(position);
    this.face(facing);
    this.yaw = this.yawTarget;
  }

  face(target) {
    if (target === 'audience') this.yawTarget = 0;
    else if (target === 'orchestra') this.yawTarget = Math.PI;
    else if (typeof target === 'number') this.yawTarget = target;
  }

  /** 面向某个点（比如与首席握手） */
  faceTowards(point) {
    this.yawTarget = Math.atan2(point.x - this.body.position.x, point.z - this.body.position.z);
  }

  setPose(name) {
    this.pose = name;
  }

  /** 沿路径走过去（直线段），走完后停住 */
  async walk(points, duration, timeline, signal) {
    this.body.visible = true;
    const path = [this.body.position.clone(), ...points];
    const lengths = path.slice(1).map((p, i) => p.distanceTo(path[i]));
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    this.walking = 1;
    try {
      await timeline.animate(duration, (k) => {
        let d = k * total;
        let i = 0;
        while (i < lengths.length - 1 && d > lengths[i]) d -= lengths[i++];
        const a = path[i];
        const b = path[i + 1];
        const f = lengths[i] > 0 ? Math.min(1, d / lengths[i]) : 1;
        this.body.position.lerpVectors(a, b, f);
        if (lengths[i] > 0.05 && k < 1) this.yawTarget = Math.atan2(b.x - a.x, b.z - a.z);
      }, { ease: (k) => smoothstep(0, 1, k), signal });
    } finally {
      this.walking = 0;
    }
  }

  /** 鞠躬：弯下去再直起来 */
  async bowOnce(duration, timeline, signal, depth = 1) {
    const pose = this.pose;
    this.pose = 'rest';
    this.bowTarget = depth;
    try {
      await timeline.wait(duration * 0.5, signal);
    } finally {
      this.bowTarget = 0;
    }
    await timeline.wait(duration * 0.5, signal);
    this.pose = pose === 'rest' ? 'rest' : pose;
  }

  update(dt, perf) {
    this.yaw = dampAngle(this.yaw, this.yawTarget, 5, dt);
    this.body.rotation.y = this.yaw;
    this.bow = damp(this.bow, this.bowTarget, 3.2, dt);
    this.torso.rotation.x = this.bow * 0.85;

    // 走路：腿交替摆动、身体轻微起伏
    if (this.walking) this.walkPhase += dt * 7.5;
    const swing = this.walking ? Math.sin(this.walkPhase) * 0.4 : 0;
    this.legL.rotation.x = damp(this.legL.rotation.x, swing, 12, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, -swing, 12, dt);
    this.hips.position.y = 0.95 + (this.walking ? Math.abs(Math.cos(this.walkPhase)) * 0.03 : 0);

    // 站上指挥台：离台中心近时抬高
    const onPodium = Math.hypot(this.body.position.x - PODIUM.x, this.body.position.z - PODIUM.z) < 0.5;
    this.body.position.y = damp(this.body.position.y, STAGE_Y + (onPodium ? PODIUM_HEIGHT : 0), 10, dt);

    const target = this.#armTarget(dt, perf);
    for (const side of ['r', 'l']) {
      this.arms[side].fwd = damp(this.arms[side].fwd, target[side].fwd, target.snappy ? 14 : 5, dt);
      this.arms[side].side = damp(this.arms[side].side, target[side].side, target.snappy ? 14 : 5, dt);
    }
    // 向前抬 = 绕 x 轴负方向；右臂向外 = 绕 z 轴负方向，左臂相反
    this.armR.rotation.set(-this.arms.r.fwd, 0, -this.arms.r.side, 'XZY');
    this.armL.rotation.set(-this.arms.l.fwd, 0, this.arms.l.side, 'XZY');
  }

  #armTarget(dt, perf) {
    if (this.pose === 'hold') return this.held ?? (this.held = structuredClone(this.arms));
    this.held = null;
    if (this.pose !== 'conduct') return POSES[this.pose] ?? POSES.rest;

    // 画拍子：缓冲时（playing=false）停在当前位置等待
    if (perf.playing) this.beat += dt * (perf.bpm / 60);
    const phase = this.beat % 4;
    const i = Math.floor(phase);
    const f = phase - i;
    const size = 0.35 + 0.75 * perf.intensity;
    // 横向：在两个拍点之间平滑移动；纵向：每拍落到最低点再弹起
    const x = lerp(BEAT_X[i], BEAT_X[(i + 1) % 4], smoothstep(0.15, 0.85, f));
    const y = -1 + BEAT_REBOUND[i] * Math.pow(Math.sin(Math.PI * f), 0.7);
    return {
      snappy: true,
      r: { fwd: 1.05 + y * 0.32 * size, side: 0.3 - x * 0.45 * size },
      // 左手随强度抬起，给出力度提示
      l: { fwd: 0.55 + perf.intensity * 0.8 + y * 0.08, side: 0.3 + perf.intensity * 0.2 },
    };
  }
}

/** 角度的指数趋近，走最短的方向 */
function dampAngle(a, b, lambda, dt) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}
