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
