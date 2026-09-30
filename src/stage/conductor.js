// 指挥：燕尾服、完整骨骼（SkinnedMesh），双手用 IK。
// 走上台、握手、鞠躬、转身、举棒、按 4/4 拍画拍子、收住、双手停在空中、示意各声部。
// 指挥是"整个乐团真的在演"的最强信号，所以拍子图形要画对：1 拍向下、2 拍向左、3 拍向右、4 拍向上。
//
// 角色局部坐标面朝 +z；右手在 -x，左手在 +x。
// 朝向：face('audience') → 面朝观众席（+z），face('orchestra') → 背对观众面向乐团。

import * as THREE from 'three';
import { damp, lerp, smoothstep, seededRandom } from '../core/math.js';
import { STAGE_Y, PODIUM, PODIUM_HEIGHT } from './layout.js';
import { Rig, aimBone } from './humans/rig.js';
import { createLook, buildSkinnedBody } from './humans/body.js';
import { ModelRig } from './humans/modelRig.js';
import { pickCharacter } from './humans/cast.js';
import { poseBody, poseArm, toWorld } from './humans/pose.js';
import { walkStride } from './walkPaths.js';

const podiumMat = new THREE.MeshStandardMaterial({ color: 0x1b120c, roughness: 0.6 });
const batonMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.35, emissive: 0x222018 });

// 各姿势下双手的位置（角色局部坐标：右手 r、左手 l）
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const POSES = {
  rest: { r: v(-0.2, 0.84, 0.05), l: v(0.2, 0.84, 0.05) },
  ready: { r: v(-0.24, 1.46, 0.4), l: v(0.24, 1.4, 0.36) },
  handshake: { r: v(-0.06, 1.02, 0.52), l: v(0.2, 0.84, 0.05) },
  wideHold: { r: v(-0.62, 1.74, 0.22), l: v(0.62, 1.74, 0.22) },
  gestureLeft: { r: v(-0.2, 0.84, 0.05), l: v(0.78, 1.32, 0.28) },
  gestureRight: { r: v(-0.78, 1.32, 0.28), l: v(0.2, 0.84, 0.05) },
  gestureUp: { r: v(-0.45, 1.84, 0.34), l: v(0.45, 1.84, 0.34) },
};

// 4/4 拍子图形：每拍的横向落点（+x 是指挥的左边）和反弹高度
const BEAT_X = [0, 0.55, -0.7, -0.1];
const BEAT_REBOUND = [0.9, 0.7, 0.8, 1.5];

export class Conductor {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '指挥';

    // 指挥台（带扶栏）
    this.podium = new THREE.Mesh(new THREE.BoxGeometry(1.1, PODIUM_HEIGHT, 1.1), podiumMat);
    this.podium.position.set(PODIUM.x, STAGE_Y + PODIUM_HEIGHT / 2, PODIUM.z);
    this.podium.receiveShadow = true;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.04).translate(0, 0.95, -0.52), podiumMat);
    rail.position.copy(this.podium.position);
    this.group.add(this.podium, rail);

    // 身体：花白短发、燕尾服
    const look = createLook(seededRandom(99), { gender: 'man', tails: true });
    look.hair = 'side';
    look.hairColor.set(0x9a948c);
    this.rig = new Rig(1.02);
    buildSkinnedBody(this.rig, look);
    this.body = this.rig.root;
    this.body.visible = false;
    this.group.add(this.body);

    // 指挥棒握在右手，沿手的方向伸出去
    this.baton = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.007, 0.42, 6).translate(0, -0.21, 0), batonMat);
    this.baton.position.set(0, -0.07, 0.015);
    this.baton.rotation.x = 0.35;
    this.baton.castShadow = true;
    this.rig.bones.RightHand.add(this.baton);

    // 状态
    this.pose = 'rest';
    this.hands = { r: POSES.rest.r.clone(), l: POSES.rest.l.clone() };
    this.held = null;
    this.yaw = Math.PI / 2;
    this.yawTarget = Math.PI / 2;
    this.bow = 0;
    this.bowTarget = 0;
    this.walking = 0;
    this.walkPhase = 0;
    this.beat = 0;
    this.body.position.set(0, STAGE_Y, 0);
  }

  /** 换成写实模型（演员表里 roles 含 conductor 的人物） */
  useCast(cast) {
    const rig = new ModelRig(pickCharacter(cast, 'conductor', 'man', 0), 1, cast.clips.standIdle);
    rig.root.position.copy(this.body.position);
    rig.root.visible = this.body.visible;
    this.group.remove(this.body);
    this.rig = rig;
    this.body = rig.root;
    this.group.add(this.body);
    // 指挥棒挂到新的右手上；模型骨骼带着厘米单位的缩放，要抵消掉
    this.rig.root.updateMatrixWorld(true);
    const hand = rig.bones.RightHand;
    hand.add(this.baton);
    const ws = hand.getWorldScale(new THREE.Vector3());
    this.baton.scale.setScalar(1 / ws.x);
    this.baton.position.set(0, 0, 0);
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

  faceTowards(point) {
    this.yawTarget = Math.atan2(point.x - this.body.position.x, point.z - this.body.position.z);
  }

  setPose(name) {
    if (name === 'hold') this.held = { r: this.hands.r.clone(), l: this.hands.l.clone() };
    this.pose = name;
  }

  /**
   * 沿路径走过去：经过各个点的平滑曲线，起步、匀速、停步；步幅随步速加大，步伐按走过的距离推进。
   * @param {THREE.Vector3[]} points 途经点（最后一个是终点）
   */
  async walk(points, duration, timeline, signal) {
    this.body.visible = true;
    const start = this.body.position.clone().setY(STAGE_Y);
    const pts = [start, ...points.map((p) => p.clone().setY(STAGE_Y))].filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 0.02);
    if (pts.length < 2) return timeline.wait(duration, signal);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const total = curve.getLength() || 1;
    const gait = walkStride(total / Math.max(0.1, duration * 0.85));
    const ramp = Math.min(0.25, 0.6 / duration); // 起步和停步各占的比例
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    this.walking = gait.amount;
    try {
      await timeline.animate(duration, (k) => {
        const u = Math.min(1, Math.max(0, k));
        curve.getPointAt(u, p);
        this.walkPhase = u * total * gait.phasePerMeter;
        const y = this.body.position.y;
        this.body.position.set(p.x, y, p.z);
        // 朝向看前方 0.4 米：拐弯时提前转身
        if (u < 0.999) {
          curve.getPointAt(Math.min(1, u + 0.4 / total), ahead);
          if (ahead.distanceToSquared(p) > 1e-4) this.yawTarget = Math.atan2(ahead.x - p.x, ahead.z - p.z);
        }
      }, { ease: (k) => rampEase(k, ramp), signal });
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
    this.pose = pose;
  }

  update(dt, perf) {
    this.yaw = dampAngle(this.yaw, this.yawTarget, 5, dt);
    this.bow = damp(this.bow, this.bowTarget, 3.2, dt);
    const onPodium = Math.hypot(this.body.position.x - PODIUM.x, this.body.position.z - PODIUM.z) < 0.5;
    this.body.position.y = damp(this.body.position.y, STAGE_Y + (onPodium ? PODIUM_HEIGHT : 0), 10, dt);
    this.body.rotation.set(0, this.yaw, 0);

    const conducting = this.pose === 'conduct';
    const mocap = this.rig.animate?.(dt) && !this.walking && this.bow < 0.05;
    poseBody(this.rig, {
      keepUpper: mocap,
      sit: 0,
      bow: this.bow,
      lean: conducting ? 0.04 + perf.intensity * 0.06 : 0.02,
      walk: this.walking,
      phase: this.walkPhase,
      headPitch: conducting ? -0.05 : 0.05,
      breathe: performance.now() / 1000 * 1.2,
    });

    const target = this.#handTargets(dt, perf);
    const snappy = conducting ? 16 : 5;
    for (const side of ['r', 'l']) {
      this.hands[side].x = damp(this.hands[side].x, target[side].x, snappy, dt);
      this.hands[side].y = damp(this.hands[side].y, target[side].y, snappy, dt);
      this.hands[side].z = damp(this.hands[side].z, target[side].z, snappy, dt);
    }
    const rig = this.rig;
    poseArm(rig, 'Right', toWorld(rig, ...this.hands.r.toArray()).clone(), toWorld(rig, -0.7, 0.9, -0.25).clone());
    poseArm(rig, 'Left', toWorld(rig, ...this.hands.l.toArray()).clone(), toWorld(rig, 0.7, 0.9, -0.25).clone());
    // 右手腕朝前，指挥棒指向乐团
    const q = this.body.getWorldQuaternion(new THREE.Quaternion());
    aimBone(rig.bones.RightHand, new THREE.Vector3(-0.1, lerp(-0.6, 0.2, smoothstep(0.95, 1.4, this.hands.r.y)), 1).applyQuaternion(q));
  }

  #handTargets(dt, perf) {
    if (this.pose === 'hold') return this.held ?? POSES.rest;
    if (this.pose !== 'conduct') return POSES[this.pose] ?? POSES.rest;

    // 画拍子：缓冲时（playing=false）停在当前位置等待
    if (perf.playing) this.beat += dt * (perf.bpm / 60);
    const phase = this.beat % 4;
    const i = Math.floor(phase);
    const f = phase - i;
    const size = 0.4 + 0.75 * perf.intensity;
    const x = lerp(BEAT_X[i], BEAT_X[(i + 1) % 4], smoothstep(0.15, 0.85, f));
    const y = -1 + BEAT_REBOUND[i] * Math.pow(Math.sin(Math.PI * f), 0.7);
    return {
      r: v(-0.24 + x * 0.3 * size, 1.3 + y * 0.18 * size, 0.42),
      // 左手随强度抬起，给出力度提示
      l: v(0.26, 1.02 + perf.intensity * 0.42 + y * 0.03, 0.34 + perf.intensity * 0.08),
    };
  }
}

/** 起步加速、匀速、停步减速（梯形速度），ramp 是加速段占的比例 */
function rampEase(k, ramp) {
  const v = 1 / (1 - ramp);
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  if (k < ramp) return (v * k * k) / (2 * ramp);
  if (k > 1 - ramp) return 1 - (v * (1 - k) ** 2) / (2 * ramp);
  return v * (k - ramp / 2);
}

/** 角度的指数趋近，走最短的方向 */
function dampAngle(a, b, lambda, dt) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}
