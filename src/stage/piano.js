// 三角钢琴（程序化 PBR）：约 2.1 米长的半音乐会型三角琴，琴盖用长支杆打开，另有琴凳。
//
// 钢琴自身坐标：原点在键盘前沿中点正下方的地面；+z 从键盘指向琴尾；+x 在琴手左边
// （低音区，琴身的直边），高音区一侧是弯进去的琴身，琴盖铰链在直边、从高音一侧掀起朝向观众。
// 外壳是高光黑漆（清漆层），琴盖掀开后能看到金色铸铁板、钢弦（低音区是铜缠弦）、制音器和云杉音板。
// 零件只用三种材质：黑漆（清漆层）、金属（铸铁板、钢弦、铜弦、铜踏板和脚轮，顶点色区分）、
// 哑光（琴键、制音器、音板、毡条、琴凳皮面，顶点色区分），每架琴身 3 次绘制，只有黑漆投影。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { whiteMaterial } from './lightBudget.js';

/** 手在键盘上要用到的尺寸（米） */
export const PIANO = {
  keyTop: 0.725, // 白键上沿
  keyDepth: 0.15, // 白键露出的长度
  halfWidth: 0.611, // 52 个白键 × 23.5 毫米的一半
  benchHeight: 0.5,
  benchOffset: 0.6, // 琴凳中心到键盘前沿
};

const M = {
  // 钢琴漆：清漆层给出黑亮的倒影；清漆粗糙度留一点，顶光在琴身上是一片柔和的高光，而不是被 Bloom 晕开的亮点
  lacquer: new THREE.MeshPhysicalMaterial({ color: 0x070707, roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.4 }),
  matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }),
};

/** 零件名 → [材质, 顶点色] */
const PAINT = {
  lacquer: ['lacquer', 0xffffff],
  plate: ['metal', 0xa8843c], // 金色铸铁板
  steel: ['metal', 0xc8c8c8],
  copper: ['metal', 0xb06c3a], // 低音区的铜缠弦
  brass: ['metal', 0xc9a24e],
  ivory: ['matte', whiteMaterial(0xf0ebdd)],
  ebony: ['matte', 0x0a0909],
  spruce: ['matte', 0xa88457], // 云杉音板
  felt: ['matte', 0x6e1a1a],
  leather: ['matte', 0x0c0c0c],
};

/** 给零件刷顶点色（同一材质的零件合并时属性要一致） */
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** 琴身轮廓（x, z）：低音直边 → 琴尾圆角 → 高音一侧弯进去的曲线 → 高音前角 */
const OUTLINE = [
  [0.75, 0.2], [0.75, 1.95], [0.72, 2.04], [0.62, 2.1], [0.42, 2.1], [0.22, 2.04], [0.05, 1.92], [-0.12, 1.72],
  [-0.28, 1.45], [-0.42, 1.18], [-0.56, 0.96], [-0.68, 0.78], [-0.745, 0.58], [-0.75, 0.4], [-0.75, 0.2],
];

/** 轮廓折线（平滑曲线部分加密），逆时针 */
function outlinePoints(from = 0.2) {
  const curve = new THREE.SplineCurve(OUTLINE.slice(1, -1).map(([x, z]) => new THREE.Vector2(x, z)));
  const pts = [new THREE.Vector2(0.75, from), ...curve.getPoints(80), new THREE.Vector2(-0.75, from)];
  return pts.filter((p) => p.y >= from - 1e-6);
}

/** 向内偏移的轮廓（琴箱壁厚、铁板边距） */
function inset(points, d) {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    // 逆时针多边形：左法线朝内
    return new THREE.Vector2(p.x - t.y * d, p.y + t.x * d);
  });
}

/** 平面形状挤出成水平的板：形状坐标 (x, z)，从 y0 到 y1 */
function slab(shape, y0, y1) {
  return new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 12 })
    .rotateX(Math.PI / 2).translate(0, y1, 0);
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function buildParts() {
  const P = [];
  const add = (k, g) => P.push([k, g]);
  let pts = outlinePoints();
  if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  const outer = new THREE.Shape(pts);
  const inner = inset(pts, 0.04);

  // 琴箱：外壁（中空）+ 底板
  const rim = new THREE.Shape(pts);
  rim.holes.push(new THREE.Path([...inner].reverse()));
  add('lacquer', slab(rim, 0.64, 1.0));
  add('lacquer', slab(outer, 0.62, 0.645));
  // 音板、铸铁板（带几个减重圆孔）
  add('spruce', slab(new THREE.Shape(inner), 0.72, 0.735));
  const platePts = inset(inner, 0.03);
  const plate = new THREE.Shape(platePts);
  for (const [x, z, r] of [[0.3, 0.95, 0.08], [0.02, 1.05, 0.07], [0.35, 1.45, 0.07], [-0.25, 0.75, 0.06], [0.1, 1.55, 0.05]]) {
    plate.holes.push(new THREE.Path().absarc(x, z, r, 0, Math.PI * 2, true));
  }
  add('plate', slab(plate, 0.79, 0.805));
  add('plate', box(1.36, 0.03, 0.12, 0, 0.8, 0.3)); // 前端的弦轴板盖
  // 琴弦：从弦轴拉到琴尾方向的挂弦钉，低音区是铜缠弦；弦轴成排
  const edgeZ = (x) => {
    let best = 0.4;
    for (const p of inner) if (Math.abs(p.x - x) < 0.03 && p.y > best) best = p.y;
    return best;
  };
  for (let i = 0; i < 58; i++) {
    const x = -0.64 + i * 0.0227;
    const z1 = edgeZ(x) - 0.05;
    const len = z1 - 0.34;
    if (len < 0.1) continue;
    add(x > 0.28 ? 'copper' : 'steel', box(x > 0.28 ? 0.0024 : 0.0012, 0.0012, len, x, 0.83, 0.34 + len / 2));
  }
  for (let i = 0; i < 116; i++) {
    const x = -0.64 + i * 0.01135;
    add('steel', new THREE.CylinderGeometry(0.0025, 0.0025, 0.022, 6).translate(x, 0.826, 0.3 + (i % 2) * 0.018));
  }
  // 制音器：弦上一排黑色小木块（高音最后一段没有）
  for (let i = 0; i < 44; i++) add('ebony', box(0.02, 0.022, 0.035, 0.66 - i * 0.0235, 0.852, 0.46));
  add('felt', box(1.3, 0.006, 0.02, 0, 0.834, 0.37));

  // 键床、键盘、键盘两端的扶手、红色毡条、键盖、谱架
  add('lacquer', box(1.5, 0.08, 0.34, 0, 0.66, 0.14));
  add('lacquer', box(1.24, 0.032, 0.012, 0, 0.685, -0.012));
  for (const s of [-1, 1]) add('lacquer', box(0.13, 0.13, 0.34, s * (PIANO.halfWidth + 0.065), 0.765, 0.14));
  const W = 0.0235;
  for (let i = 0; i < 52; i++) add('ivory', box(W - 0.0012, 0.022, PIANO.keyDepth, PIANO.halfWidth - (i + 0.5) * W, PIANO.keyTop - 0.011, PIANO.keyDepth / 2));
  // 黑键：A0 起算，A、C、D、F、G 右边（音高往上）各有一个
  for (let i = 0; i < 51; i++) {
    if (!'ACDFG'.includes('ABCDEFG'[i % 7])) continue;
    add('ebony', box(0.0118, 0.024, 0.093, PIANO.halfWidth - (i + 1) * W, PIANO.keyTop + 0.004, 0.103));
  }
  add('felt', box(1.23, 0.006, 0.012, 0, PIANO.keyTop + 0.012, 0.156));
  add('lacquer', box(1.24, 0.065, 0.018, 0, 0.77, 0.168));
  add('lacquer', box(1.24, 0.1, 0.012, 0, 0.82, 0.19).rotateX(-0.12));
  const desk = box(0.76, 0.27, 0.014, 0, 0.135, 0).rotateX(-0.28).translate(0, 0.99, 0.38);
  add('lacquer', desk);
  add('lacquer', box(0.78, 0.014, 0.06, 0, 0.99, 0.35));

  // 琴盖：前面一截折叠压在主琴盖上，主琴盖以直边为铰链掀起约 35°，由支杆撑着
  const lidAngle = 0.6;
  const lidPts = outlinePoints(0.45);
  const lidShape = new THREE.Shape(THREE.ShapeUtils.isClockWise(lidPts) ? lidPts.reverse() : lidPts);
  const lid = mergeGeometries([
    slab(lidShape, 0, 0.022),
    box(1.5, 0.018, 0.24, 0, 0.031, 0.58),
  ].map((g) => (g.index ? g.toNonIndexed() : g))).translate(-0.75, 0, 0).rotateZ(-lidAngle).translate(0.75, 1.0, 0);
  add('lacquer', lid);
  for (const z of [0.8, 1.35, 1.85]) add('brass', box(0.012, 0.03, 0.06, 0.755, 1.0, z));
  // 支杆：从高音一侧的琴箱上沿撑到琴盖边缘
  const lidPoint = (d, z) => new THREE.Vector3(0.75 - d * Math.cos(lidAngle), 1.0 + d * Math.sin(lidAngle), z);
  const from = new THREE.Vector3(-0.5, 1.0, 1.05);
  const to = lidPoint(1.2, 1.05);
  const stick = new THREE.CylinderGeometry(0.009, 0.009, from.distanceTo(to), 8).translate(0, from.distanceTo(to) / 2, 0);
  stick.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())).translate(from.x, from.y, from.z);
  add('lacquer', stick);

  // 三条腿（带铜脚轮）、踏板架和三个铜踏板
  for (const [x, z] of [[0.62, 0.32], [-0.62, 0.32], [0.36, 1.8]]) {
    add('lacquer', new THREE.CylinderGeometry(0.048, 0.034, 0.56, 14).translate(x, 0.34, z));
    add('lacquer', box(0.13, 0.05, 0.13, x, 0.6, z));
    add('brass', new THREE.CylinderGeometry(0.036, 0.036, 0.03, 14).translate(x, 0.062, z));
    add('brass', new THREE.SphereGeometry(0.028, 12, 8).translate(x, 0.028, z));
  }
  for (const s of [-1, 1]) add('lacquer', box(0.028, 0.54, 0.03, s * 0.07, 0.35, 0.52));
  add('lacquer', box(0.26, 0.07, 0.1, 0, 0.075, 0.52));
  add('lacquer', new THREE.BoxGeometry(0.03, 0.03, 0.68).rotateX(-0.869).translate(0, 0.36, 0.78)); // 踏板架斜撑
  for (const x of [-0.065, 0, 0.065]) add('brass', box(0.042, 0.012, 0.12, x, 0.07, 0.43));

  // 琴凳：皮面、黑漆框、四条腿、两侧的调高旋钮（琴手坐的地方）；单独成一个物体
  const B = [];
  const b = -PIANO.benchOffset;
  B.push(['leather', box(0.56, 0.055, 0.34, 0, PIANO.benchHeight - 0.028, b)]);
  B.push(['lacquer', box(0.58, 0.07, 0.36, 0, PIANO.benchHeight - 0.09, b)]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) B.push(['lacquer', box(0.045, PIANO.benchHeight - 0.12, 0.045, sx * 0.25, (PIANO.benchHeight - 0.12) / 2, b + sz * 0.14)]);
    B.push(['lacquer', new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16).rotateZ(Math.PI / 2).translate(sx * 0.305, PIANO.benchHeight - 0.09, b)]);
  }
  return { body: P, bench: B };
}

/** 同一材质的零件合并成一个网格 */
function byMaterial(parts) {
  const byKey = new Map();
  for (const [name, geo] of parts) {
    const [key, color] = PAINT[name];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(paint(geo, color));
  }
  return [...byKey].map(([key, list]) => {
    const mesh = new THREE.Mesh(mergeGeometries(list), M[key]);
    // 只有黑漆的琴身、琴盖、琴腿投影；琴弦、琴键、踏板这些小零件的影子看不出来，不进阴影贴图
    mesh.castShadow = key === 'lacquer';
    mesh.receiveShadow = true;
    return mesh;
  });
}

/**
 * 按给定的矩阵摆好几架钢琴。每架琴身、每张琴凳各是一个物体（几何体几架共用）：
 * 入场走位（walkPaths.js）按乐团组里每个网格的包围盒绕开道具，琴身和琴凳分开，琴手才能从琴凳侧面坐进去。
 * @param {THREE.Matrix4[]} matrices 每架钢琴自身坐标 → 世界
 * @returns {THREE.Object3D[]}
 */
export function buildPianos(matrices) {
  const { body, bench } = buildParts();
  const parts = [['钢琴', byMaterial(body)], ['琴凳', byMaterial(bench)]];
  const out = [];
  matrices.forEach((matrix, i) => {
    for (const [name, meshes] of parts) {
      const g = new THREE.Group();
      g.name = `${name} ${i + 1}`;
      matrix.decompose(g.position, g.quaternion, g.scale);
      for (const mesh of meshes) g.add(mesh.clone());
      out.push(g);
    }
  });
  return out;
}
