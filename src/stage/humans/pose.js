// 姿态驱动：在骨骼上摆出坐/站/走、身体前倾、鞠躬、转头，四肢用 IK。
// 所有目标点都写在角色局部坐标里（面朝 +z，脚底 y = 0），内部再换算到世界坐标。

import * as THREE from 'three';
import { lerp } from '../../core/math.js';
import { aimBone, solveTwoBone } from './rig.js';

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
    const fy = 0.075 + walk * lift;
    const fz = lerp(0.03, 0.42, sit) + walk * stride * 0.22;
    const target = toWorld(rig, fx, fy, fz, _p).clone();
    const pole = toWorld(rig, sx * 0.1, lerp(0.5, 0.6, sit), 1.2, _d).clone();
    solveTwoBone(B[`${side}UpLeg`], B[`${side}Leg`], B[`${side}Foot`], target, pole);
    // 脚掌朝前、略微向下
    const fwd = _d.set(0, -0.35 + walk * stride * 0.2, 1).applyQuaternion(_rootQ);
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

/**
 * 手臂 IK：把手放到 target（世界坐标），肘部朝向 pole 一侧；handDir 指定手掌朝向（可选）。
 */
export function poseArm(rig, side, target, pole, handDir = null) {
  const B = rig.bones;
  solveTwoBone(B[`${side}Arm`], B[`${side}ForeArm`], B[`${side}Hand`], target, pole);
  if (handDir) aimBone(B[`${side}Hand`], handDir);
}

/** 手臂自然下垂（站着）或放在腿上（坐着） */
export function restArms(rig, sit) {
  for (const [side, sx] of [['Left', 1], ['Right', -1]]) {
    const t = toWorld(rig, sx * lerp(0.2, 0.15, sit), lerp(0.84, 0.6, sit), lerp(0.04, 0.32, sit)).clone();
    const pole = toWorld(rig, sx * 0.5, 1.0, -0.3).clone();
    poseArm(rig, side, t, pole);
  }
}
