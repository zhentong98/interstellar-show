// 姿态驱动：在骨骼上摆出坐/站/走、身体前倾、鞠躬、转头，四肢用 IK。
// 所有目标点都写在角色局部坐标里（面朝 +z，脚底 y = 0），内部再换算到世界坐标。

import * as THREE from 'three';
import { lerp } from '../../core/math.js';
import { aimBone, solveTwoBone, rotateWorld } from './rig.js';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/** 角色局部坐标 → 世界坐标 */
export const toWorld = (rig, x, y, z, target = _v) => rig.root.localToWorld(target.set(x, y, z));

const _pq = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _rootQ = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * 绕"角色局部坐标"里的轴旋转一根骨骼（在它当前姿态的基础上叠加）。
 * 不依赖骨骼自身的局部轴向，所以对程序化骨骼和 Mixamo 骨骼（各骨骼轴向各不相同）都成立。
 */
function turn(bone, axis, angle) {
  if (!angle) return;
  _ax.copy(axis).applyQuaternion(_rootQ);
  bone.parent.getWorldQuaternion(_pq);
  _dq.setFromAxisAngle(_ax, angle);
  // 父骨骼坐标系里的增量：pq⁻¹ · 旋转 · pq
  _dq.premultiply(_pq.clone().invert()).multiply(_pq);
  bone.quaternion.premultiply(_dq);
  bone.updateMatrixWorld(true);
}

/**
 * 摆身体（不含手臂）。
 * @param {object} s
 *   sit       0 站 ~ 1 坐
 *   seat      座面高度（米）
 *   lean      身体前倾（弧度），bow 鞠躬（0~1）
 *   twist     上身左右扭转（弧度）
 *   headPitch / headYaw / headRoll  低头 / 转头 / 歪头
 *   walk      0~1 走路程度，phase 步伐相位
 *   breathe   呼吸相位（弧度），breatheAmp 幅度
 *   keepUpper 为 true 时不重置上身（动作捕捉已经在这一帧驱动了脊柱和头），只叠加前倾等
 */
export function poseBody(rig, s) {
  const B = rig.bones;
  const sit = s.sit ?? 0;
  const walk = (s.walk ?? 0) * (1 - sit);
  const phase = s.phase ?? 0;
  rig.resetPose(s.keepUpper);
  rig.root.updateMatrixWorld(true);
  rig.root.getWorldQuaternion(_rootQ);

  // 骨盆：站立时是模型自己的髋高；坐下时落到座面上，稍微往后
  const seat = s.seat ?? 0.46;
  const hip = rig.hipHeight ?? 0.94;
  const bob = walk * Math.abs(Math.cos(phase)) * 0.025;
  const hipsWorld = toWorld(rig, 0, lerp(hip, seat + 0.07, sit) + bob, lerp(0, -0.04, sit), _p);
  B.Hips.position.copy(B.Hips.parent.worldToLocal(hipsWorld));
  B.Hips.updateMatrixWorld(true);
  turn(B.Hips, AXIS_X, lerp(0, -0.08, sit));
  turn(B.Hips, AXIS_Y, (s.twist ?? 0) * 0.3 + walk * Math.sin(phase) * 0.06);

  // 脊柱三节平分前倾和鞠躬，最上一节带呼吸
  const bend = (s.lean ?? 0) + (s.bow ?? 0) * 0.95;
  const breathe = Math.sin(s.breathe ?? 0) * (s.breatheAmp ?? 0.012);
  for (const [name, k, extra] of [['Spine', 0.3, 0], ['Spine1', 0.35, 0], ['Spine2', 0.35, breathe]]) {
    if (!B[name]) continue;
    turn(B[name], AXIS_X, bend * k + extra);
    turn(B[name], AXIS_Y, (s.twist ?? 0) * 0.35);
  }
  turn(B.Neck, AXIS_X, (s.headPitch ?? 0) * 0.4 - bend * 0.15);
  turn(B.Neck, AXIS_Y, (s.headYaw ?? 0) * 0.4);
  turn(B.Head, AXIS_X, (s.headPitch ?? 0) * 0.6);
  turn(B.Head, AXIS_Y, (s.headYaw ?? 0) * 0.6);
  turn(B.Head, AXIS_Z, s.headRoll ?? 0);

  // 双腿 IK：坐着时脚放在身前的地面上，站着时脚在髋部正下方，走路时交替迈步
  for (const [side, sx, ph] of [['Left', 1, 0], ['Right', -1, Math.PI]]) {
    const stride = Math.sin(phase + ph);
    const lift = Math.max(0, Math.cos(phase + ph)) * 0.08;
    const fx = sx * lerp(0.11, 0.14, sit);
    const fy = (rig.ankleHeight ?? 0.075) + walk * lift;
    const fz = lerp(0.03, 0.42, sit) + walk * stride * 0.22;
    const target = toWorld(rig, fx, fy, fz, _p).clone();
    const pole = toWorld(rig, sx * 0.1, lerp(0.5, 0.6, sit), 1.2, _d).clone();
    solveTwoBone(B[`${side}UpLeg`], B[`${side}Leg`], B[`${side}Foot`], target, pole);
    // 脚掌朝前，俯仰和模型站立时一样（鞋底贴地）
    const foot = rig.footDir ?? _d.set(0, -0.35, 1).normalize();
    const fwd = _d.set(0, foot.y / Math.max(0.3, foot.z) + walk * stride * 0.2, 1).applyQuaternion(_rootQ);
    aimBone(B[`${side}Foot`], fwd);
  }
}

const _cq = new THREE.Quaternion();
const _cp = new THREE.Vector3();
const _cs = new THREE.Vector3();

/**
 * 胸腔坐标系：原点在脖子根部，朝向 = 上身相对静止姿态转过的角度，单位是米。
 * 与骨骼自身的轴向和单位无关（Mixamo 骨骼带厘米缩放，轴向也和程序化骨骼不同），乐器就放在这个坐标系里。
 */
export function chestFrame(rig, out) {
  rig.bones.Spine2.getWorldQuaternion(_cq).multiply(rig.chestRestInv);
  rig.bones.Neck.getWorldPosition(_cp);
  return out.compose(_cp, _cq, _cs.setScalar(rig.scale));
}

const _s = new THREE.Vector3();
const _c = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

/**
 * 够不着时先把肩膀（锁骨）朝目标送出去一点，最多约 17°：
 * 手臂偏短的模型不用把胳膊伸成一根棍子，也能握到琴颈和弓根。
 */
function reach(rig, side, target) {
  const B = rig.bones;
  const shoulder = B[`${side}Shoulder`];
  if (!shoulder) return;
  B[`${side}Arm`].getWorldPosition(_s);
  const arm = _s.distanceTo(B[`${side}ForeArm`].getWorldPosition(_c)) + _c.distanceTo(B[`${side}Hand`].getWorldPosition(_p));
  const over = _s.distanceTo(target) - arm * 0.94;
  if (over <= 0) return;
  shoulder.getWorldPosition(_c);
  _from.subVectors(_s, _c);
  _to.subVectors(target, _c);
  const angle = Math.min(0.3, _from.angleTo(_to), over / _from.length());
  _ax.crossVectors(_from, _to);
  if (_ax.lengthSq() < 1e-10) return;
  rotateWorld(shoulder, _ax.normalize(), angle);
}

/**
 * 手臂 IK：把手腕放到 target（世界坐标），肘部朝向 pole 一侧；handDir 指定手掌朝向（可选）。
 */
export function poseArm(rig, side, target, pole, handDir = null) {
  const B = rig.bones;
  reach(rig, side, target);
  solveTwoBone(B[`${side}Arm`], B[`${side}ForeArm`], B[`${side}Hand`], target, pole);
  if (handDir) aimBone(B[`${side}Hand`], handDir);
}

const _hx = new THREE.Vector3();
const _hy = new THREE.Vector3();
const _hz = new THREE.Vector3();
const _hm = new THREE.Matrix4();
const _hq = new THREE.Quaternion();
const _wr = new THREE.Vector3();

/**
 * 握住某样东西：手掌中心放在 center，手指（伸直时）指向 dir，掌心朝向 palm，然后弯曲手指。
 * 先解手臂 IK 把手腕放到位，再转手骨、弯手指。
 * @param {object} grip  curl：手指三节各弯多少（弧度），thumb：拇指弯多少
 */
export function gripArm(rig, side, center, dir, palm, pole, grip = {}) {
  const hand = rig.hands?.[side];
  if (!hand) return poseArm(rig, side, center, pole);
  _hx.copy(dir).normalize();
  _hy.copy(palm);
  _hy.addScaledVector(_hx, -_hy.dot(_hx)).normalize();
  _hz.crossVectors(_hx, _hy);
  // 手腕 = 掌心中点沿手指方向往回退半只手，再离开接触面一点
  const len = hand.len * rig.scale;
  const wrist = _wr.copy(center).addScaledVector(_hx, -len * 0.55).addScaledVector(_hy, -len * 0.12);
  poseArm(rig, side, wrist, pole);

  // 手骨的世界朝向 = 目标基 · 静止姿态里的基⁻¹
  const bone = rig.bones[`${side}Hand`];
  _hq.setFromRotationMatrix(_hm.makeBasis(_hx, _hy, _hz)).multiply(_dq.copy(hand.basis).invert());
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_hq));
  bone.updateMatrixWorld(true);

  // 弯手指：绕"手指 × 掌心"的轴转，手指朝掌心卷
  const [a = 0, b = a, c = b] = grip.curl ?? [];
  if (a || b || c) {
    _ax.crossVectors(_hx, _hy).normalize();
    for (const chain of hand.fingers) chain.forEach((j, k) => rotateWorld(j, _ax, [a, b, c][k]));
  }
  if (grip.thumb && hand.thumb.length) {
    // 拇指：绕手指方向朝掌心收
    _ax.copy(_hx).multiplyScalar(side === 'Left' ? 1 : -1);
    hand.thumb.forEach((j, k) => rotateWorld(j, _ax, grip.thumb * (k ? 0.5 : 1)));
  }
}

/** 手臂自然下垂（站着）或放在腿上（坐着） */
export function restArms(rig, sit) {
  for (const [side, sx] of [['Left', 1], ['Right', -1]]) {
    const t = toWorld(rig, sx * lerp(0.2, 0.15, sit), lerp(0.84, 0.6, sit), lerp(0.04, 0.32, sit)).clone();
    const pole = toWorld(rig, sx * 0.5, 1.0, -0.3).clone();
    poseArm(rig, side, t, pole);
  }
}
