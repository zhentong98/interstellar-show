// 姿态驱动：在骨骼上摆出坐/站/走、身体前倾、鞠躬、转头，四肢用 IK。
// 所有目标点都写在角色局部坐标里（面朝 +z，脚底 y = 0），内部再换算到世界坐标。

import * as THREE from 'three';
import { lerp } from '../../core/math.js';
import { aimBone, solveTwoBone } from './rig.js';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** 角色局部坐标 → 世界坐标 */
export const toWorld = (rig, x, y, z, target = _v) => rig.root.localToWorld(target.set(x, y, z));

/**
 * 摆身体（不含手臂）。
 * @param {object} s
 *   sit       0 站 ~ 1 坐
 *   seat      座面高度（米）
 *   lean      身体前倾（弧度），bow 鞠躬（0~1）
 *   twist     上身左右扭转（弧度）
 *   headPitch / headYaw  低头 / 转头
 *   walk      0~1 走路程度，phase 步伐相位
 *   breathe   呼吸相位（弧度），breatheAmp 幅度
 */
export function poseBody(rig, s) {
  const B = rig.bones;
  const sit = s.sit ?? 0;
  const walk = (s.walk ?? 0) * (1 - sit);
  const phase = s.phase ?? 0;
  rig.resetPose();

  // 骨盆：站立 0.94 米高；坐下时落到座面上，稍微往后
  const seat = s.seat ?? 0.46;
  const bob = walk * Math.abs(Math.cos(phase)) * 0.025;
  B.Hips.position.set(0, lerp(0.94, seat + 0.07, sit) + bob, lerp(0, -0.04, sit));
  _e.set(lerp(0, -0.08, sit), (s.twist ?? 0) * 0.3 + walk * Math.sin(phase) * 0.06, 0);
  B.Hips.quaternion.setFromEuler(_e);

  // 脊柱三节平分前倾和鞠躬，最上一节带呼吸
  const bend = (s.lean ?? 0) + (s.bow ?? 0) * 0.95;
  const breathe = Math.sin(s.breathe ?? 0) * (s.breatheAmp ?? 0.012);
  for (const [name, k, extra] of [['Spine', 0.3, 0], ['Spine1', 0.35, 0], ['Spine2', 0.35, breathe]]) {
    _e.set(bend * k + extra, (s.twist ?? 0) * 0.35, 0);
    B[name].quaternion.setFromEuler(_e);
  }
  _e.set((s.headPitch ?? 0) * 0.4 - bend * 0.15, (s.headYaw ?? 0) * 0.4, 0);
  B.Neck.quaternion.setFromEuler(_e);
  _e.set((s.headPitch ?? 0) * 0.6, (s.headYaw ?? 0) * 0.6, (s.headRoll ?? 0));
  B.Head.quaternion.setFromEuler(_e);
  rig.root.updateMatrixWorld(true);

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
    const fwd = _d.set(0, -0.35 + walk * stride * 0.2, 1).applyQuaternion(rig.root.getWorldQuaternion(_q));
    aimBone(B[`${side}Foot`], fwd);
  }
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
