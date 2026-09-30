// 把一个 Mixamo 绑定的写实模型包装成和程序化骨骼（rig.js）相同的接口：
// root / bones / list / resetPose / hipHeight，这样拉弓、按弦、打拍子的 IK 驱动可以直接用在真实模型上。
//
// 处理的差异：
//   - 骨骼名带前缀（mixamorig:Hips、mixamorigHips、mixamorig1:Hips …）→ 统一去掉前缀
//   - 单位是厘米、根节点有 0.01 缩放、骨骼局部轴向各不相同 → 按实际身高归一到米，IK 只依赖骨骼方向
//   - 静止姿态是 T 形 → IK 不依赖静止姿态
//   - 可选的动作捕捉：只驱动上身（脊柱、脖子、头），手臂和腿交给 IK

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TIP_CHILD, UPPER } from './rig.js';

const normalize = (name) => name.replace(/^mixamorig\d*[:_]?/i, '');

/** 手的朝向用中指根部 */
const HAND_TIP = { LeftHand: 'LeftHandMiddle1', RightHand: 'RightHandMiddle1' };

export class ModelRig {
  /**
   * @param {object} character cast.js 里的角色（source 是加载好的场景）
   * @param {number} scale 个体差异
   * @param {THREE.AnimationClip} [idleClip] 上身的动作捕捉（可选）
   */
  constructor(character, scale = 1, idleClip = null) {
    this.root = new THREE.Object3D();
    this.model = SkeletonUtils.clone(character.source);
    this.root.add(this.model);
    this.bones = {};
    this.list = [];
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isBone) {
        const n = normalize(o.name);
        if (!this.bones[n]) this.bones[n] = o;
        this.list.push(o);
      }
      if (o.isMesh) this.meshes.push(o);
    });
    // 有的模型脊柱只有两节
    this.bones.Spine1 ??= this.bones.Spine2 ?? this.bones.Spine;
    this.bones.Spine2 ??= this.bones.Spine1;
    for (const need of ['Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']) {
      if (!this.bones[need]) throw new Error(`模型缺少骨骼 ${need}（需要 Mixamo 骨骼）`);
    }

    // 归一化：身高换算成米，脚底放在 y = 0，水平居中
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model, true);
    const height = box.max.y - box.min.y;
    const k = (character.height ?? (character.gender === 'woman' ? 1.66 : 1.78)) / height;
    this.model.scale.multiplyScalar(k);
    const center = box.getCenter(new THREE.Vector3());
    this.model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    this.root.scale.setScalar(scale);
    this.scale = scale;
    this.root.updateMatrixWorld(true);

    for (const bone of this.list) {
      bone.userData.restQuat = bone.quaternion.clone();
      bone.userData.restPos = bone.position.clone();
    }
    for (const [name, child] of Object.entries({ ...TIP_CHILD, ...HAND_TIP })) {
      const bone = this.bones[name];
      const tip = this.bones[child] ?? bone?.children.find((c) => c.isBone);
      if (bone && tip) bone.userData.tip = tip.position.clone();
    }
    this.chestRestInv = this.bones.Spine2.getWorldQuaternion(new THREE.Quaternion()).invert();
    const hips = this.bones.Hips.getWorldPosition(new THREE.Vector3());
    this.hipHeight = this.root.worldToLocal(hips).y;

    // 上身动作捕捉（只保留脊柱、脖子、头的旋转轨道）
    if (idleClip) {
      const tracks = idleClip.tracks.filter((t) => {
        const [node, prop] = t.name.split('.');
        return prop === 'quaternion' && UPPER.has(normalize(node));
      });
      if (tracks.length) {
        this.mixer = new THREE.AnimationMixer(this.model);
        const action = this.mixer.clipAction(new THREE.AnimationClip('upper', idleClip.duration, tracks));
        action.time = Math.random() * idleClip.duration; // 每人从不同位置开始，动作不整齐
        action.play();
      }
    }
  }

  set visible(v) {
    this.root.visible = v;
  }

  /** 推进动作捕捉；返回是否驱动了上身 */
  animate(dt) {
    if (!this.mixer) return false;
    this.mixer.update(dt);
    return true;
  }

  resetPose(keepUpper = false) {
    for (const bone of this.list) {
      if (keepUpper && UPPER.has(normalize(bone.name))) continue;
      bone.quaternion.copy(bone.userData.restQuat);
      bone.position.copy(bone.userData.restPos);
    }
  }
}
