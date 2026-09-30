// 程序化人体（占位，等 Mixamo 写实模型下载后替换）：
// 按骨骼切分的身体部件——燕尾服/西装、白衬衫前襟和袖口、领结、头发（多种发型）、长礼服裙。
// 每个部件的几何体都在所属骨骼的局部坐标里定义，所以同一套部件可以：
//   - 合并成一个刚性蒙皮的 SkinnedMesh（前排：完整骨骼）
//   - 按部件做成 InstancedMesh，每个实例的矩阵就是骨骼的世界矩阵（后排：一个部件一次绘制）

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { range } from '../../core/math.js';

export const COLORS = {
  suit: new THREE.Color(0x0b0b0d),
  gown: new THREE.Color(0x0c0a0c),
  shirt: new THREE.Color(0xe6e3dc),
  shoe: new THREE.Color(0x050505),
  white: new THREE.Color(0xffffff),
};

const SKIN_TONES = [0xc99a7c, 0xb98566, 0xa87253, 0xe0b699, 0x8a5a3c, 0xd4a88a];
const HAIR_TONES = [0x16110d, 0x221710, 0x3a2717, 0x5b4636, 0x8a8178, 0xa88452, 0x0c0c0e];

/** 人体共用材质：顶点色 + 织物光泽（sheen），在舞台逆光下能勾出衣料的轮廓 */
export const bodyMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  roughness: 0.68,
  sheen: 0.6,
  sheenRoughness: 0.55,
  sheenColor: new THREE.Color(0x3a3a48),
});

/** 随机生成一个人的外观 */
export function createLook(rand, { gender = rand() < 0.5 ? 'man' : 'woman', gown = false, tails = false } = {}) {
  const hairs = gender === 'man' ? ['short', 'short', 'short', 'bald', 'side'] : ['bun', 'long', 'bun', 'bob'];
  return {
    gender,
    gown: gown && gender === 'woman',
    tails: tails && gender === 'man',
    hair: hairs[Math.floor(rand() * hairs.length)],
    skin: new THREE.Color(SKIN_TONES[Math.floor(rand() * SKIN_TONES.length)]).multiplyScalar(range(rand, 0.9, 1.05)),
    hairColor: new THREE.Color(HAIR_TONES[Math.floor(rand() * HAIR_TONES.length)]),
    scale: gender === 'man' ? range(rand, 0.97, 1.06) : range(rand, 0.91, 0.99),
  };
}

// ——— 几何体小工具（全部是带 color 属性的索引几何体，便于合并） ———

function colored(geo, color) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(c, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

const ellipsoid = (rx, ry, rz, x = 0, y = 0, z = 0, seg = 14) =>
  new THREE.SphereGeometry(1, seg, Math.max(8, seg - 4)).scale(rx, ry, rz).translate(x, y, z);

/** 沿 -y 方向的锥台（四肢），从骨骼原点往下 len */
const limb = (r0, r1, len, seg = 12) =>
  new THREE.CylinderGeometry(r0, r1, len, seg, 1).translate(0, -len / 2, 0);

/** 沿 +y 方向的椭圆截面锥台（躯干），depth 是前后厚度与宽度之比 */
const trunk = (rBottom, rTop, h, depth, z = 0, seg = 18) =>
  new THREE.CylinderGeometry(rTop, rBottom, h, seg, 2).translate(0, h / 2, 0).scale(1, 1, depth).translate(0, 0, z);

/** 头发：半球帽，thetaLength 控制盖住多少 */
const hairCap = (r, thetaStart, thetaLength, y = 0.1, z = -0.008) =>
  new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, thetaStart, thetaLength).scale(1, 1.06, 1.1).translate(0, y, z);

// 几何体按 key 缓存：同一个 key 的部件在所有人身上共用同一个几何体（实例化的前提）
const geoCache = new Map();
function part(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

/**
 * 某个外观对应的全部部件。
 * tint = 'skin' | 'hair'：几何体是白色，由外观颜色（蒙皮时烘进顶点色、实例化时用 instanceColor）着色。
 */
export function bodyParts(look) {
  const P = [];
  const add = (bone, key, make, tint = null) => P.push({ bone, key, geo: part(key, make), tint });

  // 骨盆与双腿
  add('Hips', 'pelvis', () => colored(ellipsoid(0.155, 0.12, 0.11, 0, -0.01, 0), COLORS.suit));
  for (const side of ['Left', 'Right']) {
    add(`${side}UpLeg`, 'thigh', () => colored(limb(0.078, 0.056, 0.43), COLORS.suit));
    add(`${side}Leg`, 'shin', () => colored(limb(0.053, 0.04, 0.4), COLORS.suit));
    add(`${side}Foot`, 'shoe', () => colored(ellipsoid(0.045, 0.036, 0.125, 0, -0.035, 0.055), COLORS.shoe));
  }

  // 躯干：外套 + 白衬衫前襟 + 领结
  const jacket = look.gown ? COLORS.gown : COLORS.suit;
  const g = look.gown ? 'gown' : 'suit';
  add('Spine', `spine-${g}`, () => colored(trunk(0.145, 0.15, 0.115, 0.64), jacket));
  add('Spine1', `spine1-${g}`, () => colored(trunk(0.15, 0.163, 0.125, 0.66), jacket));
  add('Spine2', `chest-${g}-${look.gender}`, () => {
    const parts = [
      colored(trunk(0.165, 0.14, 0.17, 0.68, 0.0), jacket),
      // 肩线
      colored(new THREE.CapsuleGeometry(0.058, 0.25, 4, 10).rotateZ(Math.PI / 2).translate(0, 0.105, -0.01), jacket),
    ];
    if (look.gender === 'man') {
      parts.push(colored(new THREE.BoxGeometry(0.085, 0.2, 0.012).translate(0, 0.06, 0.112), COLORS.shirt));
      parts.push(colored(new THREE.BoxGeometry(0.07, 0.024, 0.024).translate(0, 0.16, 0.1), COLORS.suit));
    } else {
      // 女装：领口露出一点肤色（用白色，按肤色着色的部件单独列在下面）
      parts.push(colored(new THREE.BoxGeometry(0.2, 0.04, 0.09).translate(0, 0.15, 0.01), jacket));
    }
    return mergeGeometries(parts);
  });
  if (look.gown) {
    // 长礼服裙：从腰部垂到地面
    add('Hips', 'skirt', () => colored(new THREE.LatheGeometry(
      [[0.14, 0.12], [0.16, 0], [0.2, -0.3], [0.26, -0.62], [0.31, -0.9], [0.3, -0.92]].map(([r, y]) => new THREE.Vector2(r, y)),
      24,
    ).scale(1, 1, 0.85), COLORS.gown));
  }
  if (look.tails) {
    // 燕尾服的后摆
    add('Hips', 'tails', () => colored(mergeGeometries([-1, 1].map((s) => new THREE.BoxGeometry(0.12, 0.52, 0.018)
      .translate(0, -0.22, 0).rotateZ(s * 0.06).translate(s * 0.065, 0, -0.105))), COLORS.suit));
  }

  // 脖子、衣领、头
  add('Neck', 'neck', () => colored(limb(0.05, 0.052, 0.11).rotateX(Math.PI).translate(0, 0, 0.005), COLORS.white), 'skin');
  if (look.gender === 'man') add('Neck', 'collar', () => colored(new THREE.CylinderGeometry(0.058, 0.06, 0.035, 14).translate(0, 0.012, 0.004), COLORS.shirt));
  add('Head', 'head', () => colored(mergeGeometries([
    ellipsoid(0.082, 0.107, 0.097, 0, 0.1, 0.012, 20),
    ellipsoid(0.066, 0.05, 0.07, 0, 0.045, 0.03),
    new THREE.ConeGeometry(0.014, 0.035, 8).rotateX(Math.PI / 2).translate(0, 0.088, 0.112),
    ellipsoid(0.012, 0.028, 0.02, 0.083, 0.095, 0.0, 8),
    ellipsoid(0.012, 0.028, 0.02, -0.083, 0.095, 0.0, 8),
  ]), COLORS.white), 'skin');

  // 发型
  const hairKey = `hair-${look.hair}`;
  add('Head', hairKey, () => {
    const cap = (tl) => hairCap(0.089, 0, tl);
    switch (look.hair) {
      case 'bald':
        return colored(new THREE.SphereGeometry(0.088, 18, 8, Math.PI * 0.35, Math.PI * 1.3, Math.PI * 0.42, Math.PI * 0.22)
          .scale(1, 1.06, 1.1).translate(0, 0.1, -0.006), COLORS.white);
      case 'side':
        return colored(mergeGeometries([cap(Math.PI * 0.5), ellipsoid(0.085, 0.03, 0.08, 0.01, 0.19, 0.01)]), COLORS.white);
      case 'bun':
        return colored(mergeGeometries([cap(Math.PI * 0.55), ellipsoid(0.045, 0.042, 0.045, 0, 0.13, -0.1)]), COLORS.white);
      case 'long':
        return colored(mergeGeometries([cap(Math.PI * 0.58), ellipsoid(0.092, 0.15, 0.06, 0, 0.02, -0.06)]), COLORS.white);
      case 'bob':
        return colored(mergeGeometries([cap(Math.PI * 0.6), ellipsoid(0.098, 0.08, 0.09, 0, 0.06, -0.015)]), COLORS.white);
      default:
        return colored(cap(Math.PI * 0.46), COLORS.white);
    }
  }, 'hair');

  // 手臂：上臂、前臂（带白色袖口）、手
  for (const side of ['Left', 'Right']) {
    add(`${side}Arm`, `arm-${g}`, () => colored(mergeGeometries([
      limb(0.05, 0.043, 0.29),
      ellipsoid(0.055, 0.055, 0.055),
    ]), jacket));
    add(`${side}ForeArm`, `forearm-${g}`, () => mergeGeometries([
      colored(limb(0.042, 0.033, 0.24), jacket),
      colored(new THREE.CylinderGeometry(0.035, 0.034, 0.025, 12).translate(0, -0.235, 0), look.gown ? COLORS.gown : COLORS.shirt),
    ]));
    add(`${side}Hand`, 'hand', () => colored(mergeGeometries([
      ellipsoid(0.02, 0.05, 0.042, 0, -0.05, 0.004, 10),
      ellipsoid(0.013, 0.03, 0.013, 0, -0.03, 0.038, 8),
    ]), COLORS.white), 'skin');
  }
  return P;
}

/** 观众的上半身（胸、肩、上腹）：白色几何体，用 instanceColor 染成各种衣服颜色；在 Spine2 骨骼坐标里 */
export function bustGeometry() {
  return part('audience-bust', () => colored(mergeGeometries([
    trunk(0.15, 0.163, 0.125, 0.66).translate(0, -0.125, 0),
    trunk(0.165, 0.14, 0.17, 0.68),
    new THREE.CapsuleGeometry(0.058, 0.25, 4, 10).rotateZ(Math.PI / 2).translate(0, 0.105, -0.01),
  ]), COLORS.white));
}

const tintColor = (look, tint, base) => {
  if (tint === 'skin') return look.skin;
  if (tint === 'hair') return look.hairColor;
  return base;
};

/**
 * 前排：把部件合并成一个刚性蒙皮的 SkinnedMesh（每个顶点 100% 跟随所属骨骼）。
 * 必须在骨骼处于静止姿态时调用。
 */
export function buildSkinnedBody(rig, look) {
  rig.resetPose();
  rig.root.updateMatrixWorld(true);
  const rootInv = rig.root.matrixWorld.clone().invert();
  const index = new Map(rig.list.map((b, i) => [b.name, i]));
  const m = new THREE.Matrix4();
  const geos = bodyParts(look).map(({ bone, geo, tint }) => {
    const g = geo.clone();
    m.multiplyMatrices(rootInv, rig.bones[bone].matrixWorld);
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const bi = index.get(bone);
    for (let i = 0; i < n; i++) {
      skinIndex[i * 4] = bi;
      skinWeight[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    if (tint) {
      const c = g.attributes.color;
      const t = tintColor(look, tint);
      for (let i = 0; i < n; i++) c.setXYZ(i, c.getX(i) * t.r, c.getY(i) * t.g, c.getZ(i) * t.b);
    }
    return g;
  });
  const mesh = new THREE.SkinnedMesh(mergeGeometries(geos), bodyMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  rig.root.add(mesh);
  rig.root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(rig.list));
  return mesh;
}

/**
 * 后排：按部件实例化。每个部件 key 一个 InstancedMesh，实例矩阵 = 骨骼世界矩阵。
 */
export class Crowd {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '后排乐手（实例化）';
    this.entries = new Map(); // key → { geo, items: [{ member, bone, color }] }
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  /** member 需要有 rig（Rig）和 visible（布尔） */
  add(member, look) {
    for (const { bone, key, geo, tint } of bodyParts(look)) {
      if (!this.entries.has(key)) this.entries.set(key, { geo, items: [] });
      this.entries.get(key).items.push({ member, bone: member.rig.bones[bone], color: tintColor(look, tint, COLORS.white) });
    }
  }

  build() {
    for (const entry of this.entries.values()) {
      const mesh = new THREE.InstancedMesh(entry.geo, bodyMaterial, entry.items.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      entry.items.forEach((item, i) => mesh.setColorAt(i, item.color));
      entry.mesh = mesh;
      this.group.add(mesh);
    }
  }

  update() {
    for (const { mesh, items } of this.entries.values()) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        mesh.setMatrixAt(i, it.member.visible ? it.bone.matrixWorld : this.zero);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
