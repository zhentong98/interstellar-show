// 人体骨骼：骨骼命名与 Mixamo 一致（去掉 "mixamorig:" 前缀），
// 之后换成从 Mixamo 下载的写实模型时，同一套姿态驱动（IK）可以直接作用在真实骨骼上。
//
// 角色局部坐标：面朝 +z，左手在 +x，脚底在 y = 0。静止姿态是双臂自然下垂（I 形）。
// IK 只依赖"骨骼指向子骨骼的方向"，不依赖静止姿态本身，所以对 Mixamo 的 T 形静止姿态同样有效。

import * as THREE from 'three';

/** [骨骼名, 父骨骼, 相对父骨骼的位置] */
const SPEC = [
  ['Hips', null, [0, 0.94, 0]],
  ['Spine', 'Hips', [0, 0.09, 0]],
  ['Spine1', 'Spine', [0, 0.11, 0]],
  ['Spine2', 'Spine1', [0, 0.12, 0]],
  ['Neck', 'Spine2', [0, 0.15, 0]],
  ['Head', 'Neck', [0, 0.09, 0.01]],
  ['HeadTop_End', 'Head', [0, 0.2, 0]],
  ['LeftShoulder', 'Spine2', [0.05, 0.1, -0.01]],
  ['LeftArm', 'LeftShoulder', [0.13, -0.02, 0]],
  ['LeftForeArm', 'LeftArm', [0, -0.28, 0]],
  ['LeftHand', 'LeftForeArm', [0, -0.25, 0]],
  ['LeftHandEnd', 'LeftHand', [0, -0.09, 0]],
  ['RightShoulder', 'Spine2', [-0.05, 0.1, -0.01]],
  ['RightArm', 'RightShoulder', [-0.13, -0.02, 0]],
  ['RightForeArm', 'RightArm', [0, -0.28, 0]],
  ['RightHand', 'RightForeArm', [0, -0.25, 0]],
  ['RightHandEnd', 'RightHand', [0, -0.09, 0]],
  ['LeftUpLeg', 'Hips', [0.09, -0.06, 0]],
  ['LeftLeg', 'LeftUpLeg', [0, -0.42, 0]],
  ['LeftFoot', 'LeftLeg', [0, -0.39, 0]],
  ['LeftToeBase', 'LeftFoot', [0, -0.05, 0.13]],
  ['RightUpLeg', 'Hips', [-0.09, -0.06, 0]],
  ['RightLeg', 'RightUpLeg', [0, -0.42, 0]],
  ['RightFoot', 'RightLeg', [0, -0.39, 0]],
  ['RightToeBase', 'RightFoot', [0, -0.05, 0.13]],
];

/** 每根骨骼"指向"的子骨骼（IK 用它确定骨骼方向） */
const TIP_CHILD = {
  Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandEnd',
  RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandEnd',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
};

export const BONE_NAMES = SPEC.map(([name]) => name);

/** 动作捕捉驱动上身时，这些骨骼不重置 */
export const UPPER = new Set(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']);

export { TIP_CHILD };

export class Rig {
  /** @param {number} scale 身高缩放（个体差异） */
  constructor(scale = 1) {
    this.root = new THREE.Object3D();
    this.bones = {};
    this.list = [];
    for (const [name, parent, pos] of SPEC) {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.fromArray(pos);
      (parent ? this.bones[parent] : this.root).add(bone);
      this.bones[name] = bone;
      this.list.push(bone);
    }
    this.root.scale.setScalar(scale);
    this.scale = scale;
    for (const bone of this.list) {
      bone.userData.restQuat = bone.quaternion.clone();
      bone.userData.restPos = bone.position.clone();
      const tip = TIP_CHILD[bone.name];
      if (tip) bone.userData.tip = this.bones[tip].position.clone();
    }
    this.root.updateMatrixWorld(true);
    this.chestRestInv = this.bones.Spine2.getWorldQuaternion(new THREE.Quaternion()).invert();
    // 静止姿态双臂下垂，掌心朝向大腿；程序化的手没有手指骨骼
    this.hands = {
      Left: handInfo(this, 'Left', new THREE.Vector3(-1, 0, 0)),
      Right: handInfo(this, 'Right', new THREE.Vector3(1, 0, 0)),
    };
  }

  /** 站立时髋部离地的高度（米，未乘个体缩放） */
  get hipHeight() {
    return 0.94;
  }

  /** 回到静止姿态；keepUpper 时保留上身（脊柱、脖子、头）当前的旋转 */
  resetPose(keepUpper = false) {
    for (const bone of this.list) {
      if (keepUpper && UPPER.has(bone.name)) continue;
      bone.quaternion.copy(bone.userData.restQuat);
      bone.position.copy(bone.userData.restPos);
    }
  }

  worldPos(name, target = new THREE.Vector3()) {
    return this.bones[name].getWorldPosition(target);
  }
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

/**
 * 手的朝向信息（握琴、握弓用）：
 *   basis  手骨局部坐标里"手指方向 + 掌心法线"组成的正交基（四元数）
 *   len    手腕到中指根部的长度（米，未乘个体缩放）
 *   fingers / thumb  各手指的前三节骨骼（没有就是空数组）
 * @param {THREE.Vector3} palmLocal 掌心法线（手骨局部坐标，指向掌心一侧）
 */
export function handInfo(rig, side, palmLocal) {
  const bone = rig.bones[`${side}Hand`];
  const dir = bone.userData.tip.clone().normalize();
  const palm = palmLocal.clone().addScaledVector(dir, -palmLocal.dot(dir)).normalize();
  const basis = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(dir, palm, new THREE.Vector3().crossVectors(dir, palm)),
  );
  const s = bone.getWorldScale(new THREE.Vector3()).x / rig.root.getWorldScale(new THREE.Vector3()).x;
  const chain = (name) => [1, 2, 3].map((k) => rig.bones[`${side}Hand${name}${k}`]).filter(Boolean);
  return {
    basis,
    len: bone.userData.tip.length() * s,
    fingers: FINGERS.map(chain).filter((c) => c.length),
    thumb: chain('Thumb'),
  };
}

// ——— IK 工具 ———

const _pq = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _rest = new THREE.Vector3();
const _want = new THREE.Vector3();

/** 旋转骨骼，让它指向子骨骼的方向对准世界方向 dir（保留静止姿态的扭转） */
export function aimBone(bone, dir) {
  const tip = bone.userData.tip;
  if (!tip || dir.lengthSq() < 1e-10) return;
  bone.parent.getWorldQuaternion(_pq);
  _want.copy(dir).normalize().applyQuaternion(_pq.invert());
  _rest.copy(tip).normalize().applyQuaternion(bone.userData.restQuat);
  _q.setFromUnitVectors(_rest, _want);
  bone.quaternion.copy(_q).multiply(bone.userData.restQuat);
  bone.updateMatrixWorld(true);
}

const _wq = new THREE.Quaternion();
const _wd = new THREE.Quaternion();

/** 让骨骼绕世界坐标里的轴转 angle（叠加在当前姿态上） */
export function rotateWorld(bone, axis, angle) {
  if (!angle) return;
  bone.parent.getWorldQuaternion(_wq);
  _wd.setFromAxisAngle(axis, angle);
  // 父骨骼坐标系里的增量：pq⁻¹ · 旋转 · pq
  _wd.premultiply(_wq.clone().invert()).multiply(_wq);
  bone.quaternion.premultiply(_wd);
  bone.updateMatrixWorld(true);
}

const _s = new THREE.Vector3();
const _m = new THREE.Vector3();
const _e = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * 两段骨骼 IK（手臂、腿）：让 upper→lower→end 的末端到达 target（世界坐标），
 * 关节（肘、膝）朝向 pole 所在的一侧。够不着时尽量伸直。
 */
export function solveTwoBone(upper, lower, end, target, pole) {
  upper.getWorldPosition(_s);
  lower.getWorldPosition(_m);
  end.getWorldPosition(_e);
  const a = _s.distanceTo(_m);
  const b = _m.distanceTo(_e);
  _t.copy(target);
  _dir.subVectors(_t, _s);
  let d = _dir.length();
  if (d < 1e-5) return;
  _dir.divideScalar(d);
  d = Math.min(d, (a + b) * 0.999);
  d = Math.max(d, Math.abs(a - b) + 1e-4);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  _pole.subVectors(pole, _s);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _pole.normalize();
  const elbow = _tmp.copy(_s).addScaledVector(_dir, along).addScaledVector(_pole, h);
  aimBone(upper, _m.subVectors(elbow, _s));
  lower.getWorldPosition(_m);
  aimBone(lower, _e.copy(_t).sub(_m));
}
