// 程序化 PBR 乐器：提琴家族（小提琴/中提琴/大提琴/低音提琴）、琴弓、合唱谱夹、定音鼓槌。
//
// 提琴坐标系：琴身轴线沿 +z（琴尾 z=0 → 琴头），面板法线朝 +y，原点在琴尾中心。
// 琴身轮廓按真实比例画出上下琴腹和 C 形腰，挤出后倒角做出拱形；漆面用清漆层（clearcoat）。
// 大提琴、低音提琴是同一套几何体按比例放大，再加尾柱。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instrumentWood } from './textures.js';
import { whiteMaterial } from './lightBudget.js';

const C = {
  wood: new THREE.Color(0xffffff), // 乘木纹贴图
  ebony: new THREE.Color(0x0d0b0a),
  maple: new THREE.Color(0xd9c29c),
  string: new THREE.Color(0x9a9a9a),
  stick: new THREE.Color(0x3a1c0e),
  hair: new THREE.Color(0xb3ab96), // 马尾是略带黄的米色，太白会在追光下发光
  felt: whiteMaterial(0xd8d0c0),
  folder: new THREE.Color(0x0a0a0a),
  paper: whiteMaterial(0xe8e2d2),
};

function colored(geo, color) {
  const g = geo.index ? geo : geo;
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

const box = (w, h, d, x, y, z, color) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** 提琴类共用的关键点（小提琴尺寸，其他按比例放大） */
export const VIOLIN_POINTS = {
  chin: new THREE.Vector3(0.03, 0.05, 0.02), // 腮托
  bridge: new THREE.Vector3(0, 0.068, 0.2), // 琴马上沿（弓毛接触点）
  neck: new THREE.Vector3(0, 0.03, 0.47), // 左手握琴颈的位置
  length: 0.59,
};

/** 小提琴琴身轮廓（右半边，从琴尾到琴肩），左右镜像成完整外形 */
function violinOutline() {
  const half = [
    [0.0, 0.0], [0.055, 0.004], [0.088, 0.022], [0.1025, 0.055], [0.1, 0.092], [0.088, 0.122],
    [0.08, 0.14], [0.058, 0.162], [0.056, 0.182], [0.062, 0.2], [0.08, 0.222],
    [0.083, 0.245], [0.084, 0.275], [0.075, 0.31], [0.05, 0.342], [0.0, 0.356],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.splineThru(half.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  shape.splineThru(half.slice(0, -1).reverse().map(([x, y]) => new THREE.Vector2(-x, y)));
  return shape;
}

let violinGeo = null;

/** 小提琴几何体（顶点色 × 木纹贴图） */
export function violinGeometry() {
  if (violinGeo) return violinGeo;
  const body = new THREE.ExtrudeGeometry(violinOutline(), {
    depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.004, bevelSegments: 3, curveSegments: 24,
  });
  // 挤出方向朝 -y，平移到 y ∈ [0, 0.046]
  body.rotateX(Math.PI / 2).translate(0, 0.038, 0);
  body.deleteAttribute('uv');
  body.setAttribute('uv', planarUV(body, 5));
  const parts = [
    colored(body, C.wood),
    box(0.03, 0.007, 0.27, 0, 0.058, 0.44, C.ebony), // 指板
    box(0.026, 0.022, 0.14, 0, 0.034, 0.425, C.wood), // 琴颈
    box(0.026, 0.03, 0.07, 0, 0.036, 0.525, C.wood), // 弦轴箱
    colored(new THREE.TorusGeometry(0.014, 0.007, 8, 16).rotateY(Math.PI / 2).translate(0, 0.045, 0.572), C.wood), // 琴头涡卷
    box(0.042, 0.028, 0.004, 0, 0.058, 0.2, C.maple), // 琴马
    box(0.04, 0.007, 0.11, 0, 0.05, 0.075, C.ebony), // 拉弦板
    colored(new THREE.SphereGeometry(1, 12, 8).scale(0.03, 0.01, 0.028).translate(0.03, 0.05, 0.022), C.ebony), // 腮托
  ];
  // 四根弦：从拉弦板经过琴马到琴枕
  for (const x of [-0.0165, -0.0055, 0.0055, 0.0165]) {
    const len = 0.44;
    parts.push(box(0.0011, 0.0011, len, x * 0.9, 0.066, 0.13 + len / 2, C.string));
  }
  violinGeo = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));
  return violinGeo;
}

/** 按顶点位置生成平面投影 UV（ExtrudeGeometry 自带的 UV 比例不适合木纹） */
function planarUV(geo, scale) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * scale;
    uv[i * 2 + 1] = pos.getZ(i) * scale;
  }
  return new THREE.BufferAttribute(uv, 2);
}

let celloGeo = null;
/** 大提琴 / 低音提琴：小提琴按比例放大（宽和长 ×2.1，厚 ×2.6），加尾柱 */
export function celloGeometry() {
  if (celloGeo) return celloGeo;
  const body = violinGeometry().clone().scale(2.1, 2.6, 2.1);
  const endpin = colored(new THREE.CylinderGeometry(0.006, 0.004, 0.3, 6).rotateX(Math.PI / 2).translate(0, 0.05, -0.14), C.string).toNonIndexed();
  celloGeo = mergeGeometries([body, endpin]);
  return celloGeo;
}
export const CELLO_SCALE = new THREE.Vector3(2.1, 2.6, 2.1);

/** 琴弓：原点在弓根（握弓处），沿 +z 指向弓尖；弓毛在弓杆下方 */
let bowGeo = null;
export const BOW = { length: 0.74, hairY: -0.013 };
export function bowGeometry() {
  if (bowGeo) return bowGeo;
  bowGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.0032, 0.0045, 0.74, 6).rotateX(Math.PI / 2).translate(0, 0, 0.37), C.stick),
    box(0.008, 0.0012, 0.7, 0, BOW.hairY, 0.38, C.hair),
    box(0.012, 0.022, 0.045, 0, -0.008, 0.025, C.ebony), // 弓根（握弓的地方）
    box(0.008, 0.018, 0.012, 0, -0.006, 0.735, C.stick), // 弓尖
  ].map((g) => g.index ? g.toNonIndexed() : g));
  return bowGeo;
}

/** 合唱谱夹：打开的黑色文件夹，中间是白色乐谱；原点在书脊中点，打开时两页朝 +z 方向 */
let folderGeo = null;
export function folderGeometry() {
  if (folderGeo) return folderGeo;
  const page = (s) => [
    box(0.15, 0.22, 0.006, s * 0.075, 0, 0, C.folder).rotateY(-s * 0.28),
    box(0.14, 0.2, 0.002, s * 0.072, 0, 0.004, C.paper).rotateY(-s * 0.28),
  ];
  folderGeo = mergeGeometries([...page(1), ...page(-1)].map((g) => g.toNonIndexed()));
  return folderGeo;
}

/** 定音鼓槌：原点在手握的末端，沿 +z 指向毡头 */
let malletGeo = null;
export function malletGeometry() {
  if (malletGeo) return malletGeo;
  malletGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.006, 0.006, 0.36, 6).rotateX(Math.PI / 2).translate(0, 0, 0.18), C.stick),
    colored(new THREE.SphereGeometry(0.028, 10, 8).translate(0, 0, 0.37), C.felt),
  ].map((g) => g.toNonIndexed()));
  return malletGeo;
}

/** 漆面木材：顶点色 × 木纹贴图，外加一层清漆高光 */
export const varnish = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  map: instrumentWood(),
  color: 0xb07a60, // 压成偏红的深棕色，追光下不会像橙色塑料
  roughness: 0.4,
  clearcoat: 1,
  clearcoatRoughness: 0.12,
});

/** 琴弓、鼓槌、谱夹：普通材质 */
export const accessory = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });

// ——— 木管与圆号 ———
//
// 坐标约定和提琴不同：原点是嘴唇接触的位置（长笛吹孔、双簧管 / 单簧管 / 大管的哨片尖、圆号号嘴），
// 演奏姿态只要把原点放到嘴上。各乐器的轴向见各自的注释。
// 几何体按材质分组（mergeGeometries 的 groups），配 windMaterials 里对应的材质数组做实例化：
// 乌木的清漆光泽、镀银按键、黄铜漆面都来自材质本身，不靠贴图。
// 金属按 lightBudget.js 的约定留一点粗糙度，顶光下是一道柔和的高光，不会被 Bloom 晕成亮点。
// 哨片、软木、缠线、胶木号嘴、孔洞这些小零件共用一个顶点色材质（少几次绘制，阴影贴图里也一样）。

export const windMaterials = {
  // 镀银：比定音鼓的镀铬鼓圈（0.42）更粗、反射率也低一点（缎面银），
  // 细小的套环、按键在顶光下只有一点柔和的闪光，不会被 Bloom 晕成一颗颗发光的亮点
  silver: new THREE.MeshStandardMaterial({ color: 0xaeaeb3, metalness: 1, roughness: 0.55 }),
  // 乌木（非洲黑檀）：近黑的深褐色，隐约的木纹，打蜡后的半光泽
  blackwood: new THREE.MeshPhysicalMaterial({ color: 0x241a16, map: instrumentWood(), roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
  // 大管的枫木：红棕色清漆
  maple: new THREE.MeshPhysicalMaterial({ color: 0xa4522c, map: instrumentWood(), roughness: 0.4, clearcoat: 0.9, clearcoatRoughness: 0.18 }),
  // 圆号：刷清漆的黄铜；喇叭口里面也要看得见，双面
  brass: new THREE.MeshPhysicalMaterial({ color: 0xc99a48, metalness: 1, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.35, side: THREE.DoubleSide }),
  small: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
};

/** 小零件的颜色（共用 small 材质）；键名也是 add() 时用的材质名 */
const SMALL = {
  rubber: new THREE.Color(0x0d0d0d), // 胶木号嘴
  cane: new THREE.Color(0xb89760), // 芦苇哨片
  cork: new THREE.Color(0x7a5c3d),
  thread: new THREE.Color(0x46305f), // 双簧管、大管哨片的缠线
  hole: new THREE.Color(0x040404), // 音孔、管口里面
  ivory: whiteMaterial(0xe8e0cc), // 大管喇叭口的饰环
};

/** 回转体，沿 +z：profile 是 [半径, z] 列表（z 递增） */
function lathe(profile, seg = 24) {
  return new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z)), seg).rotateX(Math.PI / 2);
}

/** 圆台，沿 +z 从 z0（半径 r0）到 z1（半径 r1） */
function tube(r0, r1, z0, z1, seg = 20, open = false) {
  return new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, open).rotateX(Math.PI / 2).translate(0, 0, (z0 + z1) / 2);
}

/**
 * 贴在管身表面的零件：零件自身沿 +y 朝外。a 是绕管轴的角度（0 朝 +y，π/2 朝 +x），R 是管身半径。
 */
function onSurface(geo, R, a, z) {
  return geo.rotateZ(-a).translate(R * Math.sin(a), R * Math.cos(a), z);
}

const cup = (r, h = 0.003) => new THREE.CylinderGeometry(r, r * 0.92, h, 14).translate(0, h / 2, 0);
const ringKey = (r, t = 0.001) => new THREE.TorusGeometry(r, t, 5, 18).rotateX(-Math.PI / 2);
const disc = (r) => new THREE.CircleGeometry(r, 14).rotateX(-Math.PI / 2);
const post = (h = 0.004, r = 0.0014) => new THREE.CylinderGeometry(r, r * 1.3, h, 6).translate(0, h / 2, 0);
/** 按键连杆：沿 z 的细杆，离管轴 R、角度 a */
const rod = (R, a, z0, z1, r = 0.0011) => tube(r, r, z0, z1, 6).translate(R * Math.sin(a), R * Math.cos(a), 0);

/**
 * 沿曲线扫出的管子，半径随位置变化（圆号喇叭口、大管 S 形吹管）。
 * 做法与 TubeGeometry 相同，只是每一圈的半径由 radius(t) 给出；法线最后重新计算，喇叭口的斜面光照才对。
 */
function sweep(points, radius, tubular = 40, radial = 16) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [];
  const uv = [];
  const idx = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, p);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(-Math.cos(v)).addScaledVector(frames.binormals[i], Math.sin(v));
      pos.push(p.x + r * n.x, p.y + r * n.y, p.z + r * n.z);
      uv.push(t * 4, j / radial);
    }
  }
  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geometry: geo, curve };
}

/** 按材质分组合并：返回 { geometry（带 groups）, material（材质数组） } */
function assemble(parts) {
  const byKey = new Map();
  const white = new THREE.Color(1, 1, 1);
  for (const [name, geo] of parts) {
    // 按键和套环同一种镀银；小零件并进顶点色材质。所有零件都带 color 属性，才能合并成一个几何体
    const key = name === 'keys' ? 'silver' : SMALL[name] ? 'small' : name;
    const g = colored(geo.index ? geo.toNonIndexed() : geo, SMALL[name] ?? white);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(g);
  }
  const keys = [...byKey.keys()];
  const geometry = mergeGeometries(keys.map((k) => mergeGeometries(byKey.get(k))), true);
  geometry.computeBoundingSphere();
  return { geometry, material: keys.map((k) => windMaterials[k]) };
}

const memo = (build) => {
  let cached = null;
  return () => (cached ??= build());
};

/**
 * 长笛（Boehm 式，全银）：原点在吹孔，笛身沿 +z 伸向尾管；+y 是吹孔和按键朝的方向（上方），
 * +x 离开演奏者（演奏时朝前）。全长约 0.67 米，管径 19 毫米，开孔式按键。
 */
export const fluteGeometry = memo(() => {
  const R = 0.0095;
  const P = [];
  const add = (k, g) => P.push([k, g]);
  add('silver', lathe([[0.0005, -0.086], [0.005, -0.0856], [0.0078, -0.083], [0.0085, -0.078], [0.0082, -0.075], [0.0093, -0.074], [0.0093, -0.071]], 20));
  add('silver', tube(0.0088, R, -0.071, 0.06, 24));
  add('silver', tube(R, R, 0.06, 0.668, 24, true));
  for (const z of [0.205, 0.555]) add('silver', tube(0.0104, 0.0104, z, z + 0.024, 24)); // 插口
  add('silver', tube(0.0102, 0.0102, 0.662, 0.669, 24));
  add('hole', new THREE.CircleGeometry(R * 0.85, 16).translate(0, 0, 0.668));
  // 唇托：吹孔两侧的弧形银片；吹孔是椭圆的黑洞
  add('silver', new THREE.SphereGeometry(1, 20, 10).scale(0.0125, 0.003, 0.018).translate(-0.002, R + 0.0004, 0));
  add('hole', disc(1).scale(0.0046, 1, 0.006).translate(0, R + 0.0036, 0));
  // 按键：大多在上方、略偏向演奏者一侧（a < 0）；open = 开孔键（中间有孔）
  const keys = [
    [0.255, -0.35, 0.0066, false], [0.285, -0.3, 0.0078, true], [0.315, -0.3, 0.0082, true], [0.345, -0.3, 0.0082, true],
    [0.373, -1.25, 0.0062, false], [0.298, Math.PI - 0.25, 0.0064, false], [0.321, Math.PI - 0.1, 0.006, false],
    [0.43, -0.3, 0.0082, true], [0.46, -0.3, 0.0082, true], [0.49, -0.3, 0.0082, true], [0.525, -1.0, 0.0072, false],
    [0.585, -0.8, 0.0088, false], [0.615, -1.05, 0.0088, false], [0.645, -1.3, 0.0088, false],
  ];
  for (const [z, a, r, open] of keys) {
    add('keys', onSurface(cup(r), R, a, z));
    if (open) {
      add('keys', onSurface(ringKey(r * 0.55, 0.0008), R + 0.0031, a, z));
      add('hole', onSurface(disc(r * 0.42), R + 0.0032, a, z));
    }
  }
  // 连杆和支柱：在按键靠演奏者的一侧
  add('keys', rod(R + 0.0042, -0.95, 0.24, 0.54));
  add('keys', rod(R + 0.0042, -1.45, 0.575, 0.66));
  add('keys', rod(R + 0.0042, Math.PI - 0.6, 0.29, 0.33));
  for (const z of [0.243, 0.395, 0.537]) add('keys', onSurface(post(), R, -0.95, z));
  for (const z of [0.578, 0.657]) add('keys', onSurface(post(), R, -1.45, z));
  return assemble(P);
});

/**
 * 双簧管：原点在哨片尖（嘴唇），管身沿 +z 伸向喇叭口；+y 是正面（手指按孔的一面，离开演奏者），
 * +x 在演奏者左边。全长约 0.65 米（含哨片），圆锥形管身、乌木，按键繁密。
 */
export const oboeGeometry = memo(() => {
  const P = [];
  const add = (k, g) => P.push([k, g]);
  // 哨片：压扁的两片芦苇 + 缠线 + 软木
  add('cane', new THREE.CylinderGeometry(0.0027, 0.0036, 0.028, 12).rotateX(Math.PI / 2).scale(1, 0.34, 1).translate(0, 0, 0.002));
  add('thread', tube(0.0031, 0.0036, 0.015, 0.037, 14));
  add('cork', tube(0.0042, 0.0042, 0.037, 0.052, 14));
  add('silver', tube(0.0098, 0.0098, 0.05, 0.058, 20));
  const radius = (z) => (z < 0.3 ? 0.0104 + (z - 0.075) * 0.0089 : 0.0128 + (z - 0.308) * 0.0081);
  add('blackwood', lathe([[0.0092, 0.058], [0.0104, 0.075], [0.0114, 0.2], [0.0124, 0.3]]));
  add('silver', tube(0.0134, 0.0134, 0.3, 0.308, 20));
  add('blackwood', lathe([[0.0128, 0.308], [0.0136, 0.42], [0.0146, 0.53]]));
  add('silver', tube(0.0156, 0.0156, 0.528, 0.535, 20));
  add('blackwood', lathe([[0.0152, 0.535], [0.0174, 0.55], [0.0181, 0.565], [0.0168, 0.582], [0.0172, 0.6], [0.0198, 0.622], [0.0245, 0.637], [0.0295, 0.646], [0.0312, 0.651], [0.0312, 0.655]], 28));
  add('silver', tube(0.0318, 0.0318, 0.651, 0.656, 28));
  add('hole', new THREE.CircleGeometry(0.027, 20).translate(0, 0, 0.642));
  // 正面的按孔键（中间有半孔）、两侧的小按键、连杆
  for (const z of [0.12, 0.148, 0.176, 0.35, 0.378, 0.406]) {
    add('keys', onSurface(cup(0.0058), radius(z), 0, z));
    add('hole', onSurface(disc(0.0022), radius(z) + 0.0031, 0, z));
  }
  const side = [[0.09, 0.9], [0.105, -1.0], [0.2, 1.2], [0.228, -1.1], [0.262, 1.0], [0.286, -0.9], [0.44, 1.1], [0.468, -1.2],
    [0.5, 1.3], [0.52, -1.0], [0.095, Math.PI - 0.3], [0.132, Math.PI + 0.35], [0.46, Math.PI - 0.5]];
  for (const [z, a] of side) add('keys', onSurface(cup(0.0048, 0.0026), radius(z), a, z));
  for (const [a, z0, z1] of [[0.55, 0.08, 0.29], [-0.55, 0.1, 0.285], [0.62, 0.33, 0.52], [-0.62, 0.33, 0.52], [1.3, 0.2, 0.51], [-1.35, 0.09, 0.3], [Math.PI, 0.08, 0.2]]) {
    const r0 = radius(z0) + 0.0036;
    add('keys', rod(r0, a, z0, z1));
    add('keys', onSurface(post(0.0038), radius(z0), a, z0));
    add('keys', onSurface(post(0.0038), radius(z1), a, z1));
  }
  // 背面的拇指托
  add('silver', onSurface(new THREE.BoxGeometry(0.011, 0.012, 0.016).translate(0, 0.006, 0), radius(0.355), Math.PI, 0.355));
  return assemble(P);
});

/**
 * 单簧管（降 B 调）：原点在号嘴尖稍后（嘴唇），管身沿 +z 伸向喇叭口；+y 是正面，簧片在 −y 一侧（贴下唇），
 * +x 在演奏者左边。全长约 0.68 米，圆柱形管身、乌木，银色环键。
 */
export const clarinetGeometry = memo(() => {
  const P = [];
  const add = (k, g) => P.push([k, g]);
  add('cane', new THREE.BoxGeometry(0.0126, 0.0016, 0.068).translate(0, -0.0083, 0.021));
  add('rubber', lathe([[0.0025, -0.016], [0.0072, -0.012], [0.0104, 0.004], [0.0125, 0.03], [0.0135, 0.07], [0.0138, 0.089]]));
  // 束圈和两颗螺丝
  add('silver', tube(0.0143, 0.0146, 0.033, 0.05, 20));
  for (const z of [0.036, 0.047]) add('silver', new THREE.CylinderGeometry(0.0022, 0.0022, 0.026, 8).rotateZ(Math.PI / 2).translate(0, -0.0168, z));
  // 小筒（中间略鼓）、上节、下节、喇叭口，各节之间是银色套环
  add('blackwood', lathe([[0.0142, 0.089], [0.0158, 0.098], [0.0163, 0.12], [0.0156, 0.145], [0.0148, 0.153]]));
  add('silver', tube(0.0158, 0.0158, 0.086, 0.092, 20));
  add('silver', tube(0.0157, 0.0157, 0.148, 0.154, 20));
  add('blackwood', tube(0.0141, 0.0142, 0.153, 0.39, 24));
  add('silver', tube(0.0156, 0.0156, 0.386, 0.393, 20));
  add('blackwood', tube(0.0146, 0.0149, 0.39, 0.6, 24));
  add('silver', tube(0.0162, 0.0162, 0.596, 0.603, 20));
  add('blackwood', lathe([[0.0163, 0.6], [0.0168, 0.615], [0.0185, 0.635], [0.022, 0.652], [0.0275, 0.664], [0.0325, 0.671], [0.0342, 0.675], [0.0342, 0.678]], 28));
  add('silver', tube(0.0348, 0.0348, 0.674, 0.679, 28));
  add('hole', new THREE.CircleGeometry(0.028, 20).translate(0, 0, 0.666));
  const radius = (z) => (z < 0.39 ? 0.0142 : 0.0148);
  // 正面六个开孔（带环键）
  for (const z of [0.235, 0.262, 0.29, 0.46, 0.49, 0.52]) {
    add('keys', onSurface(ringKey(0.0056, 0.0009), radius(z) + 0.0012, 0, z));
    add('hole', onSurface(disc(0.0036), radius(z) + 0.0004, 0, z));
  }
  const side = [[0.19, 0.9], [0.205, 1.05], [0.22, 1.2], [0.31, -1.0], [0.33, -0.9], [0.55, 1.0], [0.565, -1.0], [0.58, 1.15], [0.585, -1.2], [0.2, -0.8]];
  for (const [z, a] of side) add('keys', onSurface(cup(0.0055, 0.0028), radius(z), a, z));
  for (const [a, z0, z1] of [[0.75, 0.175, 0.37], [-0.75, 0.19, 0.37], [0.7, 0.41, 0.59], [-0.7, 0.41, 0.59], [0.4, 0.53, 0.595], [-0.4, 0.53, 0.595], [1.25, 0.2, 0.3]]) {
    add('keys', rod(radius(z0) + 0.0038, a, z0, z1));
    add('keys', onSurface(post(0.0038), radius(z0), a, z0));
    add('keys', onSurface(post(0.0038), radius(z1), a, z1));
  }
  // 背面：拇指孔、泛音键长片、拇指托
  add('keys', onSurface(ringKey(0.0056, 0.0009), 0.0154, Math.PI, 0.215));
  add('hole', onSurface(disc(0.0034), 0.0146, Math.PI, 0.215));
  add('keys', onSurface(new THREE.BoxGeometry(0.004, 0.0016, 0.06).translate(0, 0.0045, 0), 0.0142, Math.PI + 0.35, 0.21));
  add('silver', onSurface(new THREE.BoxGeometry(0.011, 0.013, 0.02).translate(0, 0.0065, 0), 0.0148, Math.PI, 0.44));
  return assemble(P);
});

/**
 * 大管：原点在哨片尖。管身在自身坐标里竖直：+y 沿管身向上（靴形管在下、喇叭口朝上），
 * +z 朝前（离开演奏者），+x 在演奏者左边；S 形吹管从翼管顶端弯回演奏者嘴边。全高约 1.35 米，红棕色枫木。
 */
export const BASSOON = { reed: new THREE.Vector3(0, 0.926, -0.292) };
export const bassoonGeometry = memo(() => {
  const P = [];
  const add = (k, g) => P.push([k, g]);
  const up = (g) => g.rotateX(-Math.PI / 2); // 沿 z 建的回转体 → 沿 y
  const W = -0.022; // 翼管（靠演奏者）
  const L = 0.022; // 长管（离演奏者远）
  // 靴形管：两根管子并在一起，底部是银色的 U 形弯管盖
  for (const z of [W, L]) add('maple', up(tube(0.027, 0.026, 0.02, 0.5, 20)).translate(0, 0, z));
  add('maple', new THREE.BoxGeometry(0.052, 0.48, 0.044).translate(0, 0.26, 0));
  for (const z of [W, L]) add('silver', up(tube(0.028, 0.028, -0.008, 0.03, 20)).translate(0, 0, z));
  add('silver', new THREE.BoxGeometry(0.056, 0.038, 0.044).translate(0, 0.011, 0));
  for (const z of [W, L]) add('silver', up(tube(0.0285, 0.0285, 0.49, 0.505, 20)).translate(0, 0, z));
  // 翼管（带加厚的"翼"）和长管、喇叭口（顶端一圈白色饰环）
  add('maple', up(lathe([[0.0185, 0.5], [0.0195, 0.6], [0.021, 0.79], [0.0215, 0.805]])).translate(0, 0, W));
  add('maple', new THREE.BoxGeometry(0.03, 0.25, 0.02).translate(0.004, 0.64, W - 0.02));
  add('silver', up(tube(0.022, 0.022, 0.795, 0.81, 18)).translate(0, 0, W));
  add('maple', up(lathe([[0.0205, 0.5], [0.0215, 0.8], [0.0225, 1.07]])).translate(0, 0, L));
  add('silver', up(tube(0.0245, 0.0245, 1.065, 1.08, 20)).translate(0, 0, L));
  add('maple', up(lathe([[0.0235, 1.08], [0.0245, 1.2], [0.026, 1.3], [0.0275, 1.335]])).translate(0, 0, L));
  add('ivory', up(tube(0.03, 0.0305, 1.33, 1.352, 24)).translate(0, 0, L));
  add('hole', new THREE.CircleGeometry(0.025, 18).rotateX(-Math.PI / 2).translate(0, 1.348, L));
  // S 形吹管和哨片
  const bocal = sweep([[0, 0.805, W], [0, 0.845, W - 0.006], [0, 0.895, W - 0.038], [0, 0.924, -0.1], [0, 0.93, -0.17], [0, 0.927, -0.23], [0, 0.926, -0.262]], (t) => 0.0042 - 0.0014 * t, 36, 10);
  add('silver', bocal.geometry);
  add('thread', tube(0.0046, 0.0046, -0.266, -0.256, 12).translate(0, 0.926, 0));
  add('cane', new THREE.BoxGeometry(0.013, 0.0026, 0.028).translate(0, 0.926, -0.279));
  // 按键：靴形管正面是右手的键和连杆，背面是一排拇指键；翼管侧面三个指孔，长管上是左手拇指的长连杆
  const cylZ = (r, h) => new THREE.CylinderGeometry(r, r, h, 12).rotateX(Math.PI / 2);
  for (const [x, y] of [[0.012, 0.2], [-0.012, 0.25], [0.01, 0.31], [-0.01, 0.36], [0.0, 0.41]]) add('keys', cylZ(0.0075, 0.004).translate(x, y, L + 0.03));
  for (const [x, y] of [[0.014, 0.24], [-0.014, 0.28], [0.012, 0.33], [-0.006, 0.4], [0.01, 0.44]]) add('keys', cylZ(0.007, 0.004).translate(x, y, W - 0.03));
  const rodY = (x, z, y0, y1) => up(tube(0.0012, 0.0012, y0, y1, 6)).translate(x, 0, z);
  for (const [x, z, y0, y1] of [[0.02, L + 0.026, 0.15, 0.47], [-0.02, L + 0.026, 0.18, 0.45], [0.018, W - 0.028, 0.2, 0.46], [-0.02, W - 0.026, 0.22, 0.44],
    [0.02, L + 0.02, 0.55, 1.02], [0.012, L + 0.024, 0.6, 0.98], [-0.018, W - 0.018, 0.56, 0.78]]) add('keys', rodY(x, z, y0, y1));
  for (const y of [0.6, 0.66, 0.72]) add('hole', new THREE.CircleGeometry(0.0045, 12).rotateY(Math.PI / 2).translate(0.0195 + 0.004, y, W));
  for (const y of [0.92, 0.97]) add('keys', cylZ(0.0065, 0.004).translate(0.004, y, L + 0.026));
  // 所有零件平移，让哨片尖在原点
  const out = assemble(P);
  out.geometry.translate(-BASSOON.reed.x, -BASSOON.reed.y, -BASSOON.reed.z);
  return out;
});

/**
 * 圆号（双管圆号）：原点在号嘴边缘（嘴唇）。自身坐标就是演奏时的胸腔坐标：+x 演奏者左边、+y 上、+z 前。
 * 号嘴朝右前下方伸出，盘管在右胸前，四个转阀在盘管左上，喇叭口朝右后下方、搭在右大腿上，右手伸在喇叭口里。
 */
const HORN_COIL = { center: new THREE.Vector3(-0.15, -0.26, 0.26), normal: new THREE.Vector3(-0.35, 0.08, 0.93).normalize() };
export const HORN = {};
export const hornGeometry = memo(() => {
  const P = [];
  const add = (k, g) => P.push([k, g]);
  const { center: C, normal: N } = HORN_COIL;
  const upv = new THREE.Vector3(0, 1, 0).addScaledVector(N, -N.y).normalize(); // 盘管平面内的"上"
  const side = new THREE.Vector3().crossVectors(upv, N).normalize(); // 盘管平面内朝演奏者左边
  const inPlane = (s, u) => C.clone().addScaledVector(side, s).addScaledVector(upv, u);
  const toward = (g, dir) => g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
  // 号嘴：杯口在原点
  const d0 = new THREE.Vector3(-0.3, -0.5, 0.81).normalize();
  add('brass', toward(lathe([[0.0082, 0], [0.0096, 0.0025], [0.0093, 0.007], [0.0062, 0.014], [0.0046, 0.03], [0.004, 0.082]], 18), d0));
  add('hole', toward(new THREE.CircleGeometry(0.0072, 14).translate(0, 0, 0.004), d0));
  // 吹管：从号嘴一路变粗，进入盘管左上方
  const lead = [d0.clone().multiplyScalar(0.08), d0.clone().multiplyScalar(0.17), inPlane(0.09, 0.13).add(N.clone().multiplyScalar(0.02)), inPlane(0.03, 0.155)];
  add('brass', sweep(lead.map((p) => p.toArray()), (t) => 0.0045 + 0.002 * t, 30, 10).geometry);
  // 盘管：三圈
  for (const [R, off] of [[0.125, -0.012], [0.14, 0], [0.155, 0.012]]) {
    add('brass', toward(new THREE.TorusGeometry(R, 0.0056, 8, 56), N).translate(C.x + N.x * off, C.y + N.y * off, C.z + N.z * off));
  }
  // 转阀：四个圆筒（轴垂直于盘管平面），外侧是扳键，另有几段 U 形调音管
  const valves = [[0.07, 0.05], [0.07, 0.01], [0.07, -0.03], [0.035, 0.075]];
  for (const [s, u] of valves) {
    const c = inPlane(s, u);
    add('brass', toward(tube(0.016, 0.016, -0.022, 0.022, 18), N).translate(c.x, c.y, c.z));
    for (const e of [-0.024, 0.024]) add('silver', toward(tube(0.017, 0.017, e - 0.003, e + 0.003, 18), N).translate(c.x, c.y, c.z));
  }
  // 扳键：从转阀伸向左手的细长片
  const leverDir = side.clone().multiplyScalar(0.85).addScaledVector(upv, 0.52).normalize();
  const levers = [];
  for (const [s, u] of valves.slice(0, 3)) {
    const base = inPlane(s, u).addScaledVector(N, 0.03);
    const tip = base.clone().addScaledVector(leverDir, 0.065);
    levers.push(tip);
    add('silver', toward(new THREE.BoxGeometry(0.011, 0.0035, 0.065).translate(0, 0, 0.0325), leverDir).translate(base.x, base.y, base.z));
    add('silver', toward(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 12).rotateX(Math.PI / 2), N).translate(tip.x, tip.y, tip.z));
  }
  for (const [s, u, a] of [[0.14, 0.1, 0.4], [0.02, 0.19, 1.3], [-0.16, 0.08, -0.4], [0.16, -0.06, 0]]) {
    const c = inPlane(s, u);
    const g = new THREE.TorusGeometry(0.028, 0.0052, 6, 16, Math.PI).rotateZ(a);
    add('brass', toward(g, N).translate(c.x - N.x * 0.03, c.y - N.y * 0.03, c.z - N.z * 0.03));
  }
  // 喇叭口：从盘管底部出来，向右后下方张开，口径 31 厘米
  const b0 = inPlane(-0.02, -0.155);
  const bell = sweep([b0, b0.clone().add(new THREE.Vector3(-0.03, -0.03, -0.04)), b0.clone().add(new THREE.Vector3(-0.07, -0.06, -0.12)),
    b0.clone().add(new THREE.Vector3(-0.11, -0.08, -0.2)), b0.clone().add(new THREE.Vector3(-0.13, -0.085, -0.235))].map((p) => p.toArray()),
  (t) => 0.0065 + 0.1485 * Math.pow(t, 3.2), 48, 32);
  add('brass', bell.geometry);
  const rim = bell.curve.getPointAt(1);
  const rimDir = bell.curve.getTangentAt(1);
  add('brass', toward(new THREE.TorusGeometry(0.155, 0.0035, 6, 48), rimDir).translate(rim.x, rim.y, rim.z));
  // 左手搭在扳键上，右手伸进喇叭口（喇叭口里靠近身体的一侧）
  HORN.levers = levers[1].clone();
  HORN.leverDir = leverDir.clone();
  HORN.valveNormal = N.clone();
  HORN.bellHand = bell.curve.getPointAt(0.8);
  HORN.bellAxis = bell.curve.getTangentAt(0.8);
  return assemble(P);
});
