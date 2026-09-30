// 指挥：完整骨骼（SkinnedMesh），双手用 IK。
// 走上台、握手、鞠躬、转身、举棒、按 4/4 拍画拍子、收住、双手停在空中、示意各声部。
// 指挥是"整个乐团真的在演"的最强信号，所以拍子图形要画对：1 拍向下、2 拍向左、3 拍向右、4 拍向上，
// 每一拍落在清楚的击拍点上（手加速落下、在击拍点弹起，棒尖比手慢半拍甩下去）。
// 强度越大图形越大，左手从放松、塑形到和右手对称地一起打；定音鼓重击前双手举起、身体转过去提示，
// 到点一起砸下去。缓冲时（playing=false）停在原处等。
//
// 角色局部坐标面朝 +z；右手在 -x，左手在 +x。
// 朝向：face('audience') → 面朝观众席（+z），face('orchestra') → 背对观众面向乐团。

import * as THREE from 'three';
import { damp, lerp, smoothstep, clamp, seededRandom } from '../core/math.js';
import { STAGE_Y, PODIUM, PODIUM_HEIGHT } from './layout.js';
import { Rig } from './humans/rig.js';
import { createLook, buildSkinnedBody } from './humans/body.js';
import { ModelRig } from './humans/modelRig.js';
import { pickCharacter } from './humans/cast.js';
import { poseBody, gripArm, toWorld } from './humans/pose.js';
import { whiteMaterial } from './lightBudget.js';
import { walkStride } from './walkPaths.js';

const podiumMat = new THREE.MeshStandardMaterial({ color: 0x1b120c, roughness: 0.6 });
// 白色木质指挥棒，按灯光预算的白色反照率上限取色，特写里不会发光
const batonMat = new THREE.MeshStandardMaterial({ color: whiteMaterial(0xf4f1ea), roughness: 0.35 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.6 });

// 各姿势下双手掌心的位置（角色局部坐标：右手 r、左手 l）
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const POSES = {
  rest: { r: v(-0.2, 0.8, 0.06), l: v(0.2, 0.8, 0.06) },
  ready: { r: v(-0.24, 1.44, 0.42), l: v(0.24, 1.38, 0.38) },
  handshake: { r: v(-0.06, 1.02, 0.55), l: v(0.2, 0.8, 0.06) },
  wideHold: { r: v(-0.62, 1.72, 0.26), l: v(0.62, 1.72, 0.26) },
  gestureLeft: { r: v(-0.2, 0.8, 0.06), l: v(0.8, 1.32, 0.3) },
  gestureRight: { r: v(-0.8, 1.32, 0.3), l: v(0.2, 0.8, 0.06) },
  gestureUp: { r: v(-0.45, 1.82, 0.36), l: v(0.45, 1.82, 0.36) },
};

/**
 * 各姿势下手的朝向（角色局部坐标）：dir 手指方向，palm 掌心朝向；左手还有手形。
 * 右手一直握着指挥棒，棒子顺着手指方向伸出去。
 */
const DOWN_IN = { dir: v(0, -1, 0.3), palm: v(1, 0, 0) }; // 手垂在身侧，掌心朝大腿（右手；左手 x 取反）
const ORIENT = {
  rest: { r: DOWN_IN, l: { dir: v(0, -1, 0.3), palm: v(-1, 0, 0) }, shape: 'soft' },
  ready: { r: { dir: v(-0.05, 0.2, 1), palm: v(0.2, -1, 0) }, l: { dir: v(0.1, 0.1, 1), palm: v(-0.3, -1, 0) }, shape: 'soft' },
  handshake: { r: { dir: v(0.1, -0.1, 1), palm: v(1, 0, 0) }, l: { dir: v(0, -1, 0.3), palm: v(-1, 0, 0) }, shape: 'soft' },
  wideHold: { r: { dir: v(-0.5, 0.5, 0.7), palm: v(0, 0.2, 1) }, l: { dir: v(0.5, 0.5, 0.7), palm: v(0, 0.2, 1) }, shape: 'open' },
  gestureLeft: { r: DOWN_IN, l: { dir: v(1, 0.1, 0.5), palm: v(0, 1, 0.2) }, shape: 'open' },
  gestureRight: { r: { dir: v(-1, 0.1, 0.5), palm: v(0, 1, 0.2) }, l: { dir: v(0, -1, 0.3), palm: v(-1, 0, 0) }, shape: 'soft' },
  gestureUp: { r: { dir: v(-0.3, 1, 0.3), palm: v(0, 0, 1) }, l: { dir: v(0.3, 1, 0.3), palm: v(0, 0, 1) }, shape: 'open' },
};

/** 手形：右手握棒（拇指和食指捏住，后三指包住棒尾），左手放松 / 张开 / 食指指向 */
const SHAPES = {
  baton: { curl: [0.55, 0.8, 0.55], fingers: [0.5, 1.05, 1.2, 1.3], thumb: 0.5, mitten: 0.8 },
  soft: { curl: [0.3, 0.42, 0.3], thumb: 0.2, mitten: 0.4 },
  open: { curl: [0.1, 0.16, 0.1], thumb: 0.05, mitten: 0.12 },
  point: { curl: [0.95, 1.15, 0.8], fingers: [0.05, 1, 1.05, 1.1], thumb: 0.6, mitten: 0.35 },
};

// 4/4 拍子图形（右手；+x 是指挥的左边）：每拍击拍点的横向位置、高低，和离开击拍点后的反弹高度。
// 1 拍在正中最低，2 拍向内（左）、3 拍向外（右）且走得最远，4 拍回到中间偏右、击拍点最高、反弹也最高（准备下一小节）
const BEAT_X = [0, 0.5, -0.72, -0.12];
const BEAT_Y = [-1, -0.9, -0.9, -0.72];
const BEAT_REBOUND = [0.95, 0.7, 0.8, 1.55];

/** 指挥台上看各声部的方向（弧度，正值向指挥的左边）：弦乐在左，合唱在右后，定音鼓在右 */
const TARGETS = { strings: 0.3, center: 0, choir: -0.32, timpani: -0.55 };

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

    // 身体：花白短发、燕尾服（没有演员表时的程序化人体）
    const look = createLook(seededRandom(99), { gender: 'man', tails: true });
    look.hair = 'side';
    look.hairColor.set(0x9a948c);
    this.rig = new Rig(1.02);
    buildSkinnedBody(this.rig, look);
    this.body = this.rig.root;
    this.body.visible = false;
    this.group.add(this.body);

    // 指挥棒：粗的一头握在手里（木柄），细的一头指向乐团，长 42 厘米；沿 −y 伸出
    this.baton = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0018, 0.4, 6).translate(0, -0.22, 0), batonMat);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.06, 8).translate(0, -0.01, 0), gripMat);
    for (const m of [shaft, handle]) m.castShadow = true;
    this.baton.add(shaft, handle);
    this.#attachBaton();

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
    // 画拍子时的附加状态：棒尖的甩动、身体转向、左手的动作、定音鼓提示
    this.tip = 0;
    this.lastRy = POSES.rest.r.y;
    this.twist = 0;
    this.focus = 'center';
    this.focusBar = -1;
    this.leftMode = 0; // 0 放松 ~ 1 和右手对称
    this.cue = 0;
    this.afterHit = 9;
    this.lastNextHit = Infinity;
    this.rand = seededRandom(5);
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
    this.#attachBaton();
  }

  /**
   * 把指挥棒挂到右手骨上：棒柄在掌心，沿手指方向（稍微偏向手背）伸出去。
   * 用手骨静止姿态里的"手指方向 + 掌心法线"算，和骨骼自身的轴向、单位无关（Mixamo 手骨带厘米缩放）。
   */
  #attachBaton() {
    const rig = this.rig;
    rig.root.updateMatrixWorld(true);
    const hand = rig.bones.RightHand;
    const info = rig.hands.Right;
    hand.add(this.baton);
    const s = hand.getWorldScale(new THREE.Vector3()).x / rig.root.getWorldScale(new THREE.Vector3()).x;
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(info.basis);
    const palm = new THREE.Vector3(0, 1, 0).applyQuaternion(info.basis);
    const pointing = dir.clone().addScaledVector(palm, -0.2).normalize();
    this.baton.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), pointing);
    this.baton.scale.setScalar(1 / s);
    this.baton.position.copy(dir).multiplyScalar(info.len * 0.5).addScaledVector(palm, info.len * 0.12).divideScalar(s);
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
    const g = this.#gesture(dt, perf);
    // 画拍子时收掉大部分站立待机动作（它会晃来晃去、和拍子打架），其余时候保留
    const mocap = this.rig.animate?.(dt) && !this.walking && this.bow < 0.05;
    this.twist = damp(this.twist, conducting ? g.twist : 0, 2.5, dt);
    poseBody(this.rig, {
      keepUpper: mocap ? (conducting ? 0.2 : 1) : 0,
      sit: 0,
      bow: this.bow,
      lean: conducting ? g.lean : 0.02,
      twist: this.twist,
      dip: conducting ? g.dip : 0,
      walk: this.walking,
      phase: this.walkPhase,
      headPitch: conducting ? g.headPitch : 0.05,
      headYaw: this.twist * 0.8,
      breathe: (performance.now() / 1000) * 1.2,
    });

    const snappy = conducting ? 30 : 5;
    for (const side of ['r', 'l']) {
      const target = g[side];
      const k = side === 'l' && conducting ? 14 : snappy;
      this.hands[side].x = damp(this.hands[side].x, target.x, k, dt);
      this.hands[side].y = damp(this.hands[side].y, target.y, k, dt);
      this.hands[side].z = damp(this.hands[side].z, target.z, k, dt);
    }
    const rig = this.rig;
    const q = this.body.quaternion;
    const world = (vec) => vec.clone().normalize().applyQuaternion(q);

    // 右手握棒：掌心朝下，棒尖指向乐团；棒尖跟着手的速度甩——手往下落时棒尖先垂下去，
    // 在击拍点手弹起的一瞬间棒尖"点"一下，看得出每一拍落在哪里
    let rDir;
    let rPalm;
    if (conducting) {
      const vy = (this.hands.r.y - this.lastRy) / Math.max(dt, 1e-3);
      this.tip = damp(this.tip, clamp(vy * 0.22, -0.38, 0.3), 14, dt);
      const pitch = lerp(-0.25, 0.2, smoothstep(1.0, 1.55, this.hands.r.y)) + this.tip;
      rDir = world(v(-0.12, Math.sin(pitch), Math.cos(pitch)));
      rPalm = world(v(0.25, -1, 0));
    } else {
      const o = ORIENT[this.pose] ?? ORIENT.rest;
      rDir = world(o.r.dir);
      rPalm = world(o.r.palm);
    }
    this.lastRy = this.hands.r.y;
    const turn = conducting ? 16 : 5;
    this.#smoothHand('r', rDir, rPalm, SHAPES.baton, turn, dt);
    gripArm(rig, 'Right', toWorld(rig, ...this.hands.r.toArray()).clone(), this.orient.r.dir, this.orient.r.palm, toWorld(rig, -0.7, 0.95, -0.25).clone(), SHAPES.baton);

    // 左手
    let lDir;
    let lPalm;
    let shape;
    if (conducting) {
      lDir = world(g.lDir);
      lPalm = world(g.lPalm);
      shape = SHAPES[g.shape];
    } else {
      const o = ORIENT[this.pose] ?? ORIENT.rest;
      lDir = world(o.l.dir);
      lPalm = world(o.l.palm);
      shape = SHAPES[o.shape];
    }
    const o = this.#smoothHand('l', lDir, lPalm, shape, conducting ? 7 : 5, dt);
    gripArm(rig, 'Left', toWorld(rig, ...this.hands.l.toArray()).clone(), o.dir, o.palm, toWorld(rig, 0.7, 0.95, -0.25).clone(), o.shape);
  }

  /** 手的朝向和手形平滑过渡（换姿势、掌心翻上翻下时不会一帧跳过去） */
  #smoothHand(side, dir, palm, shape, rate, dt) {
    this.orient ??= {};
    const k = 1 - Math.exp(-rate * dt);
    const o = (this.orient[side] ??= { dir: dir.clone(), palm: palm.clone(), shape: { curl: [...shape.curl], fingers: [1, 1, 1, 1], thumb: shape.thumb, mitten: shape.mitten } });
    o.dir.lerp(dir, k).normalize();
    o.palm.lerp(palm, k).normalize();
    const c = o.shape;
    for (let i = 0; i < 3; i++) c.curl[i] = lerp(c.curl[i], shape.curl[i], k);
    for (let i = 0; i < 4; i++) c.fingers[i] = lerp(c.fingers[i], shape.fingers?.[i] ?? 1, k);
    c.thumb = lerp(c.thumb, shape.thumb, k);
    c.mitten = lerp(c.mitten, shape.mitten, k);
    return o;
  }

  /**
   * 这一帧的手位和身体：非画拍子的姿势直接取 POSES；画拍子时按 perf.bpm 推进拍子（缓冲时停住）。
   * 返回 { r, l, lDir, lPalm, shape, lean, dip, twist, headPitch }
   */
  #gesture(dt, perf) {
    const out = (this.out ??= { r: v(0, 0, 0), l: v(0, 0, 0), lDir: v(0, 0, 1), lPalm: v(0, -1, 0), shape: 'soft', lean: 0, dip: 0, twist: 0, headPitch: 0 });
    if (this.pose !== 'conduct') {
      const p = this.pose === 'hold' ? this.held ?? POSES.rest : POSES[this.pose] ?? POSES.rest;
      out.r.copy(p.r);
      out.l.copy(p.l);
      return out;
    }
    const k = perf.intensity;
    if (perf.playing) this.beat += dt * (perf.bpm / 60);
    const phase = this.beat % 4;
    const i = Math.floor(phase);
    const f = phase - i;
    const j = (i + 1) % 4;

    // —— 右手：击拍点之间是一条"弹起—落下"的弧线 ——
    // 横向在两个击拍点之间移动，大部分位移在弧线中段；纵向离开击拍点时最快、在弧顶最慢、再加速落进下一个击拍点
    const size = 0.42 + 0.8 * k;
    const x = lerp(BEAT_X[i], BEAT_X[j], smoothstep(0.1, 0.9, f));
    const base = lerp(BEAT_Y[i], BEAT_Y[j], f);
    const y = base + BEAT_REBOUND[i] * Math.pow(Math.sin(Math.PI * f), 0.65);
    const center = v(-0.22, 1.3 + 0.04 * k, 0.42 + 0.06 * k);
    out.r.set(center.x + x * 0.3 * size, center.y + y * 0.17 * size, center.z + (1 - y) * 0.02);

    // —— 定音鼓提示：离重击不到 1.3 秒时双手举起、身体转向鼓手，到点一起砸下去 ——
    if (perf.playing) {
      if (this.lastNextHit < 0.4 && perf.nextHit > this.lastNextHit + 0.5) this.afterHit = 0; // 刚打过（nextHit 跳到了下一次）
      this.afterHit += dt;
      this.lastNextHit = perf.nextHit;
    }
    const nh = perf.nextHit;
    const prep = smoothstep(1.3, 0.55, nh); // 举起
    const strike = nh < 0.28 ? 1 - nh / 0.28 : 0; // 最后一下加速砸下
    const release = 1 - smoothstep(0.1, 0.7, this.afterHit); // 砸下后停一下再回到拍子
    const cue = Math.max(nh < 1.3 ? prep : 0, release);
    this.cue = cue;

    // —— 左手：安静时垂在身前放松，中等强度在胸前随乐句托起（掌心向上），强的时候和右手对称一起打 ——
    this.leftMode = damp(this.leftMode, smoothstep(0.62, 0.8, k), 1.5, dt);
    const phrase = Math.sin((this.beat / 8) * Math.PI * 2);
    const shaping = smoothstep(0.25, 0.5, k) * (1 - this.leftMode);
    // 左手也轻轻跟着拍子起落（y 是右手拍子图形的高低），不是一直僵在一个地方
    const calm = v(0.2, 0.98 + 0.03 * phrase + 0.012 * y, 0.2);
    const shape = v(0.28 + 0.03 * phrase, 1.2 + 0.12 * (0.5 + 0.5 * phrase) + 0.1 * k + 0.04 * y, 0.36 + 0.04 * phrase);
    const mirror = v(-(out.r.x - center.x) + 0.22, out.r.y - 0.02, out.r.z - 0.02);
    out.l.copy(calm).lerp(shape, shaping).lerp(mirror, this.leftMode);
    // 左手的手形：放松时掌心朝下，塑形时掌心向上托，对称打拍子时掌心朝下
    // 掌心向上只在乐句往上走（渐强）的半句里，另外半句掌心朝下、往下按
    const up = shaping > 0.5 && this.leftMode < 0.5 && Math.cos((this.beat / 8) * Math.PI * 2) > 0;
    out.lDir.set(0.25, up ? 0.15 : -0.1, 1);
    out.lPalm.set(-0.2, up ? 1 : -1, 0);
    out.shape = up ? 'open' : 'soft';

    // 提示定音鼓：右手把棒举到头的高度，左手食指指向右前方的鼓手；到点双手一起砸在击拍点上
    if (cue > 0.01) {
      const high = v(-0.32, 1.62, 0.4);
      const low = v(-0.24, 1.08, 0.5);
      const pointAt = v(-0.02, 1.4, 0.5);
      const lowL = v(0.2, 1.06, 0.46);
      const s2 = strike * strike;
      const rPose = strike > 0 ? high.clone().lerp(low, s2) : nh < 1.3 ? high : low;
      const lPose = strike > 0 ? pointAt.clone().lerp(lowL, s2) : nh < 1.3 ? pointAt : lowL;
      out.r.lerp(rPose, cue);
      out.l.lerp(lPose, cue);
      if (nh < 1.3 && strike === 0) {
        out.lDir.set(-0.9, 0.12, 1); // 指向右前方的定音鼓
        out.lPalm.set(0.2, -1, 0.1);
        out.shape = 'point';
      } else {
        out.lDir.set(0.2, -0.2, 1);
        out.lPalm.set(0, -1, 0.2);
        out.shape = 'soft';
      }
    }

    // —— 身体 ——
    // 每 8 拍换一次关注的声部（弦乐 / 中间 / 合唱），强度越大越常看合唱和定音鼓；提示重击时转向定音鼓
    const bar = Math.floor(this.beat / 8);
    if (bar !== this.focusBar && perf.playing) {
      this.focusBar = bar;
      const r = this.rand();
      this.focus = r < 0.4 ? 'strings' : r < 0.7 - 0.2 * k ? 'center' : 'choir';
    }
    out.twist = lerp(TARGETS[this.focus] * (0.6 + 0.4 * k), TARGETS.timpani, cue);
    // 击拍点上膝盖微微一沉，第 1 拍最明显；强的时候身体更前倾
    const ictus = Math.exp(-f * 7) * (i === 0 ? 1 : 0.5);
    out.dip = ictus * (0.006 + 0.018 * k) + 0.03 * strike * strike;
    out.lean = 0.04 + 0.07 * k + 0.05 * cue + 0.03 * ictus * k;
    out.headPitch = -0.06 + 0.05 * ictus - 0.05 * cue;
    return out;
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
