// 木管、圆号、钢琴：座位、道具（弧形台阶、钢琴和琴凳）、乐器姿态和演奏动作。
//
// 编制按原声核实（Wikipedia《Interstellar (soundtrack)》：34 人弦乐、24 人木管、4 架钢琴、60 人合唱，
// Temple Church 的管风琴；铜管几乎不用，只有首席圆号），缩编成：木管 8 人（长笛、双簧管、单簧管、大管各 2）、
// 圆号 4 支、钢琴 2 架。位置见 layout.js 的 WOODWINDS / HORNS / PIANOS。
//
// 由 orchestra.js 接入，那边只留几处钩子：
//   - #createMusicians：windMusicians() 追加乐手，assignWindSlots() 分配乐器的实例槽位
//   - #buildProps：buildWindProps() 加台阶、钢琴和琴凳；木管、圆号的椅子和谱架沿用弦乐那一套
//   - #buildInstruments：windParts() 加乐器的实例化网格
//   - #poseMusician / #placeInstrument：这些声部转给 WindPlayers.pose / place
//   - update()：每帧 WindPlayers.update() 推进换气、休息、手指
//
// 动作全部是程序化的（公开版没有动作捕捉），沿用 humans/pose.js 的姿态和 IK，节奏跟着全团共用的拍子
// （orchestra.js 的 beat，弦乐弓法、身体随乐句的起伏用的也是它）：
//   - 乐器的吹口 / 哨片 / 号嘴贴在嘴唇上（嘴的位置按每个扫描人物的脸测一次），角度跟着上身走；
//     双手的握点写在乐器自己的坐标里，所以手永远握在乐器上
//   - 同一声部在乐句交界处一起换气：胸口抬起、肩膀微耸、头微微上扬，乐器离开嘴唇一两厘米；
//     安静段落偶尔把乐器放到腿上歇一两个乐句（烘焙的后排乐手只跟随全体举起 / 放下，免得烘焙姿势来回跳）
//   - 手指按音符一根根起落（一拍一个音到四个十六分音符，随强度），偶尔抬眼看指挥
//   - 钢琴手双手在键盘上跟着拍子左右移动弹琶音，每个八分音符按一下键

import * as THREE from 'three';
import { damp, lerp, clamp01, range, seededRandom } from '../core/math.js';
import { STAGE_Y, PODIUM, WINGS, WOODWINDS, HORNS, PIANOS } from './layout.js';
import { createLook } from './humans/body.js';
import { poseBody, gripArm, toWorld, chestFrame } from './humans/pose.js';
import { fluteGeometry, oboeGeometry, clarinetGeometry, bassoonGeometry, hornGeometry, HORN } from './instruments.js';
import { buildPianos, PIANO } from './piano.js';

export const WIND_SECTIONS = ['flute', 'oboe', 'clarinet', 'bassoon', 'horn'];
const OWN = new Set([...WIND_SECTIONS, 'piano']);

/** 声部 → 演员表里的角色类型（cast.json 的 roles） */
export const WIND_ROLES = { flute: 'winds', oboe: 'winds', clarinet: 'winds', bassoon: 'winds', horn: 'brass', piano: 'piano' };
/** 后排烘焙的声部类别（和弦乐一样烘焙 演奏 / 放下 / 站立 三个姿势） */
export const WIND_BAKE_KIND = { flute: 'flute', oboe: 'oboe', clarinet: 'clarinet', bassoon: 'bassoon', horn: 'horn', piano: 'piano' };

const GEOMETRY = { flute: fluteGeometry, oboe: oboeGeometry, clarinet: clarinetGeometry, bassoon: bassoonGeometry, horn: hornGeometry };

// ——— 座位与道具 ———

/** 以指挥台为圆心的方位角（度）→ 舞台坐标 */
function polar(r, deg) {
  const th = THREE.MathUtils.degToRad(deg);
  return [PODIUM.x + r * Math.cos(th), PODIUM.z - r * Math.sin(th)];
}
const faceConductor = (x, z) => Math.atan2(PODIUM.x - x, PODIUM.z + 0.4 - z);

/**
 * 新声部的乐手。base 是 orchestra.js 里补齐通用字段的函数，rand 是乐团共用的随机数。
 * 木管从右侧台上场（和合唱、定音鼓一样），圆号和钢琴手从左侧台上场（走弦乐后面）。
 */
export function windMusicians(base, rand) {
  const list = [];
  const row = (spec, sections, extra) => sections.forEach((section, i) => {
    const [x, z] = polar(spec.r, lerp(spec.from, spec.to, i / Math.max(1, sections.length - 1)));
    list.push(base({
      section,
      x,
      z,
      seated: true,
      seat: new THREE.Vector3(x, STAGE_Y + spec.riser, z),
      yaw: faceConductor(x, z),
      standDist: spec.standDist,
      look: createLook(rand),
      ...extra,
    }));
  });
  // 全部用带完整骨骼的写实模型（前排）：圆号如果走烘焙，四个人物各烘三个姿势，反而比蒙皮模型画得多
  WOODWINDS.rows.forEach((r, i) => row(r, r.sections, { entry: WINGS.right, depth: 1 - 0.1 * i, front: true }));
  // 圆号和钢琴手离所有特写机位都远：落座后隔帧更新姿态（halfRate，orchestra.js 的 update 按它跳帧）
  row(HORNS.row, ['horn', 'horn', 'horn', 'horn'], { entry: WINGS.left, depth: 0.85, front: true, halfRate: true });
  PIANOS.forEach((p, i) => list.push(base({
    section: 'piano',
    seated: true,
    seatHeight: PIANO.benchHeight,
    seat: p.pianist.clone(),
    yaw: p.yaw,
    entry: WINGS.left,
    depth: 1,
    front: true,
    ownSeat: true, // 坐钢琴自带的琴凳，不要椅子和谱架
    pianoIndex: i,
    halfRate: true,
    look: createLook(rand),
  })));
  return list;
}

/** 乐器实例槽位：每个声部一个实例化网格 */
export function assignWindSlots(m, slots) {
  if (!WIND_SECTIONS.includes(m.section)) return;
  slots[m.section] ??= 0;
  m.slot[m.section] = slots[m.section]++;
}

/** 各声部乐器的实例化网格（make 是 orchestra.js 建网格的函数） */
export function windParts(musicians, make) {
  const parts = {};
  for (const [section, build] of Object.entries(GEOMETRY)) {
    const n = musicians.filter((m) => m.section === section).length;
    if (!n) continue;
    const { geometry, material } = build();
    parts[section] = make(geometry, material, n);
    // 只有大管投影：长笛、双簧管、单簧管又细又小，圆号在左后方离得远，影子都看不出来（每盏投影灯少画几次）
    if (section !== 'bassoon') parts[section].castShadow = false;
  }
  return parts;
}

const riserMaterial = new THREE.MeshStandardMaterial({ color: 0x1d1611, roughness: 0.6 });

/**
 * 以指挥台为圆心的弧形台阶，切成每段约 6° 的扇形块做实例化：
 * 入场走位（walkPaths.js）按每个网格 / 实例的包围盒标障碍，整块弧形的包围盒会把旁边的过道一起堵死，
 * 切成小段之后每段的包围盒都贴着弧形。
 */
function arcRiser({ r0, r1, from, to, h }) {
  const a0 = THREE.MathUtils.degToRad(Math.min(from, to));
  const a1 = THREE.MathUtils.degToRad(Math.max(from, to));
  const n = Math.max(1, Math.round(THREE.MathUtils.radToDeg(a1 - a0) / 6));
  const step = (a1 - a0) / n;
  // 一段扇形：形状平面里的 (x, y) 对应舞台的 (x, −z)（圆心在指挥台），挤出方向是高度
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r1, 0, step, false);
  shape.absarc(0, 0, r0, step, 0, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, riserMaterial, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    // 绕竖直轴转 φ 相当于方位角加 φ
    m.makeRotationY(a0 + i * step).setPosition(PODIUM.x, STAGE_Y, PODIUM.z);
    mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = true;
  return mesh;
}

/** 钢琴在琴手自身坐标里的位置：键盘前沿在琴凳前方 benchOffset */
const PIANO_IN_PIANIST = new THREE.Matrix4().makeTranslation(0, 0, PIANO.benchOffset);

/** 木管和圆号的台阶、两架钢琴和琴凳 */
export function buildWindProps(group) {
  for (const r of [...WOODWINDS.risers, HORNS.riser]) group.add(arcRiser(r));
  // 每架钢琴、每张琴凳各是乐团组里的一个子物体：入场走位按它们各自的包围盒绕开
  const matrices = PIANOS.map(({ pianist, yaw }) => new THREE.Matrix4().makeRotationY(yaw).setPosition(pianist).multiply(PIANO_IN_PIANIST));
  group.add(...buildPianos(matrices));
}

// ——— 乐器姿态 ———

/** 由位置、长轴（+z）、近似的上方向（+y）构造矩阵 */
function frame(origin, axis, up) {
  const z = new THREE.Vector3(...axis).normalize();
  const x = new THREE.Vector3(...up).cross(z).normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...origin);
}
const turnOf = (axis, up) => new THREE.Quaternion().setFromRotationMatrix(frame([0, 0, 0], axis, up));
const vec = (a) => new THREE.Vector3(...a);
/** 握点（乐器自身坐标）：掌心中心 p，手指伸直时的方向 dir，掌心朝向 palm */
const hold = (p, dir, palm) => ({ p: vec(p), dir: vec(dir).normalize(), palm: vec(palm).normalize() });

/**
 * 各乐器的姿态：
 *   play       演奏时乐器相对上身（胸腔坐标：+x 左、+y 上、+z 前）的朝向
 *   lip        原点离嘴唇的微调（胸腔坐标，米），breath 是换气时离开嘴唇的方向
 *   seat/stand 放下时的位置（角色局部坐标：脚底 y = 0，面朝 +z）：坐着放在腿上 / 站着拿在身侧
 *   grips      三种姿势下左右手的握点；'lap' 是手放在大腿上，'side' 是手垂在身侧
 *   poles      肘部朝向（角色局部坐标）；curl 手指弯曲；body 演奏时的身体姿态；phrase 乐句长度（秒）
 */
const KINDS = {
  flute: {
    // 笛身伸向右边、略向前下，吹孔朝上；上身略向右转、头转回来看谱，头微微右倾
    play: turnOf([-0.95, -0.12, 0.28], [0, 1, 0]),
    lip: vec([0, -0.013, 0.012]),
    breath: vec([0, -0.004, 0.01]),
    seat: frame([0.14, 0.64, 0.25], [-1, -0.03, 0.22], [0, 1, 0]),
    stand: frame([-0.2, 1.38, 0.14], [0, -1, 0.02], [0, 0, 1]),
    grips: {
      // 左手在笛子外侧，手背朝观众，手指从上方弯回来按键；右手在内侧，手指从上方按下去，拇指托在下面
      play: { Left: hold([0.022, -0.004, 0.3], [0, 1, -0.3], [-1, 0, 0]), Right: hold([-0.02, -0.006, 0.46], [0, 1, 0.15], [1, 0, 0]) },
      seat: { Left: 'lap', Right: hold([0, 0.02, 0.47], [1, 0, 0], [0, -1, 0]) },
      stand: { Left: 'side', Right: hold([-0.02, 0, 0.47], [0, 1, 0], [1, 0, 0]) },
    },
    poles: { play: { Left: [0.25, 0.75, 0.4], Right: [-0.65, 1.0, 0.05] }, rest: { Left: [0.5, 0.9, -0.2], Right: [-0.5, 0.9, -0.2] } },
    curl: { play: [0.95, 1.05, 0.6], rest: [0.6, 0.7, 0.4] },
    body: { twist: -0.15, headYaw: 0.18, headPitch: 0.04, headRoll: -0.1, lean: 0.03 },
  },
  oboe: {
    // 双簧管比单簧管更贴近身体（约 40°），头略低
    play: turnOf([0, -0.8, 0.6], [0, 0.6, 0.8]),
    lip: vec([0, -0.002, 0.004]),
    breath: vec([0, -0.012, 0.012]),
    seat: frame([-0.12, 1.2, 0.33], [0, -1, 0.04], [0, 0.04, 1]),
    stand: frame([-0.2, 1.28, 0.12], [0, -1, 0.02], [0, 0, 1]),
    grips: {
      // 两手从两侧握住管身，手指绕到正面按孔，拇指在背面
      play: { Left: hold([0.015, -0.004, 0.16], [-0.2, 1, 0], [-1, -0.2, 0]), Right: hold([-0.016, -0.004, 0.39], [0.2, 1, 0], [1, -0.2, 0]) },
      seat: { Left: 'lap', Right: hold([-0.016, -0.004, 0.4], [0.2, 1, 0], [1, -0.2, 0]) },
      stand: { Left: 'side', Right: hold([-0.016, -0.004, 0.4], [0.2, 1, 0], [1, -0.2, 0]) },
    },
    poles: { play: { Left: [0.5, 0.85, -0.05], Right: [-0.5, 0.8, -0.05] }, rest: { Left: [0.5, 0.9, -0.2], Right: [-0.5, 0.9, -0.2] } },
    curl: { play: [0.85, 0.95, 0.5], rest: [0.9, 1.0, 0.6] },
    body: { headPitch: 0.12, lean: 0.06 },
  },
  clarinet: {
    // 单簧管约 45° 斜向前下，喇叭口在两膝之间
    play: turnOf([0, -0.72, 0.69], [0, 0.69, 0.72]),
    lip: vec([0, -0.006, 0.004]),
    breath: vec([0, -0.01, 0.012]),
    seat: frame([-0.12, 1.24, 0.32], [0, -1, 0.04], [0, 0.04, 1]),
    stand: frame([-0.2, 1.3, 0.12], [0, -1, 0.02], [0, 0, 1]),
    grips: {
      play: { Left: hold([0.016, -0.004, 0.25], [-0.2, 1, 0], [-1, -0.2, 0]), Right: hold([-0.017, -0.004, 0.48], [0.2, 1, 0], [1, -0.2, 0]) },
      seat: { Left: 'lap', Right: hold([-0.017, -0.004, 0.45], [0.2, 1, 0], [1, -0.2, 0]) },
      stand: { Left: 'side', Right: hold([-0.017, -0.004, 0.45], [0.2, 1, 0], [1, -0.2, 0]) },
    },
    poles: { play: { Left: [0.55, 0.85, -0.05], Right: [-0.55, 0.8, -0.05] }, rest: { Left: [0.5, 0.9, -0.2], Right: [-0.5, 0.9, -0.2] } },
    curl: { play: [0.8, 0.9, 0.5], rest: [0.9, 1.0, 0.6] },
    body: { headPitch: 0.1, lean: 0.06 },
  },
  bassoon: {
    // 大管斜挂在身前：靴形管在右大腿外侧（坐着时用座带托住），喇叭口在头的左上方，S 形吹管弯回嘴边
    play: turnOf([0.05, 0, 1], [0.34, 0.94, 0]),
    lip: vec([0, -0.004, 0.006]),
    breath: vec([0, -0.006, 0.012]),
    seat: frame([0.03, 1.2, 0.27], [0.03, 0, 1], [0.24, 0.97, 0]),
    stand: frame([-0.06, 1.52, 0.12], [0, 0, 1], [0.1, 1, 0]),
    grips: {
      // 左手在翼管上、右手在靴形管上，都从侧面握住，手指绕到前面按孔
      play: { Left: hold([0.034, -0.306, 0.27], [-0.3, 0, 1], [-1, 0, -0.3]), Right: hold([-0.036, -0.626, 0.292], [0.3, 0, 1], [1, 0, -0.3]) },
    },
    poles: { play: { Left: [0.5, 1.0, -0.1], Right: [-0.55, 0.75, -0.15] }, rest: { Left: [0.5, 1.0, -0.1], Right: [-0.55, 0.75, -0.15] } },
    curl: { play: [0.8, 0.9, 0.5], rest: [0.8, 0.9, 0.5] },
    body: { headPitch: 0.04, lean: 0.04 },
  },
  horn: {
    // 圆号的几何体按演奏时的胸腔坐标建，再绕号嘴往下转一点：盘管在右胸前偏低，喇叭口落到右胯旁、搭在大腿上
    play: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3),
    lip: vec([0, -0.002, 0.004]),
    breath: vec([0, -0.004, 0.01]),
    seat: frame([0.04, 1.06, 0.25], [0, -0.3, 1], [0, 1, 0.3]),
    stand: frame([0.05, 1.3, 0.24], [0, 0, 1], [0, 1, 0]),
    grips: null, // 由圆号几何体里的扳键、喇叭口位置算出来（见 hornGrips）
    poles: { play: { Left: [0.55, 0.9, -0.1], Right: [-0.6, 0.8, -0.35] }, rest: { Left: [0.55, 0.9, -0.1], Right: [-0.6, 0.8, -0.35] } },
    curl: { play: [0.6, 0.7, 0.45], rest: [0.6, 0.7, 0.45] },
    body: { headPitch: 0.06, lean: 0.05 },
  },
};
// 大管、圆号放下时手也留在乐器上
KINDS.bassoon.grips.seat = KINDS.bassoon.grips.play;
KINDS.bassoon.grips.stand = KINDS.bassoon.grips.play;

/** 圆号的握点：左手从前面扣住扳键（手指朝转阀、掌心朝演奏者），右手伸进喇叭口 */
function hornGrips() {
  hornGeometry();
  const palmR = new THREE.Vector3(1, 0.3, 0).addScaledVector(HORN.bellAxis, -HORN.bellAxis.x).normalize();
  const left = {
    p: HORN.levers.clone().addScaledVector(HORN.leverDir, 0.035).addScaledVector(HORN.valveNormal, 0.022),
    dir: HORN.leverDir.clone().negate(),
    palm: HORN.valveNormal.clone().negate(),
  };
  const right = { p: HORN.bellHand.clone(), dir: HORN.bellAxis.clone().negate(), palm: palmR };
  const g = { Left: left, Right: right };
  return { play: g, seat: g, stand: g };
}

/** 钢琴手：身体前倾、低头看键盘 */
const PIANIST = { lean: 0.1, headPitch: 0.24, curl: [0.55, 0.7, 0.4], curlRest: [0.3, 0.4, 0.25], poles: { Left: [0.5, 0.75, -0.2], Right: [-0.5, 0.75, -0.2] } };

// ——— 嘴的位置 ———

/** 程序化人体：嘴在头骨骼坐标里的位置（body.js 的头部几何） */
const PROCEDURAL_MOUTH = new THREE.Vector3(0, 0.05, 0.1);
const stripPrefix = (name) => name.replace(/^mixamorig\d*[:_]?/i, '');

/**
 * 扫描人物的嘴：在静止姿态里找头部正中线上最靠前的点（鼻尖），嘴唇在它下方约 4 厘米、靠后 1 厘米多。
 * 结果换算到头骨骼的局部坐标，之后头怎么转，嘴都跟着走。每个人物只测一次。
 */
function measureMouth(character) {
  const src = character.source;
  src.updateMatrixWorld(true);
  let head = null;
  src.traverse((o) => { if (!head && o.isBone && stripPrefix(o.name) === 'Head') head = o; });
  if (!head) return PROCEDURAL_MOUTH;
  const box = new THREE.Box3().setFromObject(src, true);
  const unit = (box.max.y - box.min.y) / (character.height ?? (character.gender === 'woman' ? 1.66 : 1.78)); // 模型单位 / 米
  const own = new Set();
  head.traverse((b) => { if (b.isBone) own.add(b); });
  const headPos = head.getWorldPosition(new THREE.Vector3());
  const v = new THREE.Vector3();
  let nose = null;
  src.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const ids = new Set(mesh.skeleton.bones.map((b, i) => (own.has(b) ? i : -1)).filter((i) => i >= 0));
    if (!ids.size) return;
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (ids.has(skinIndex.getComponent(i, k))) w += skinWeight.getComponent(i, k);
      if (w < 0.5) continue;
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(v.x - headPos.x) > 0.012 * unit || v.y < headPos.y - 0.06 * unit || v.y > headPos.y + 0.16 * unit) continue;
      if (!nose || v.z > nose.z) nose = v.clone();
    }
  });
  if (!nose) return PROCEDURAL_MOUTH;
  const mouth = nose.add(new THREE.Vector3(0, -0.042, -0.013).multiplyScalar(unit));
  return head.worldToLocal(mouth);
}

function mouthWorld(rig, character, out) {
  const local = character ? (character.mouth ??= measureMouth(character)) : PROCEDURAL_MOUTH;
  // IK 不再逐次刷新整棵骨骼树（humans/rig.js），读头骨骼的世界矩阵前先沿父链刷新一次
  const head = rig.bones.Head;
  head.updateWorldMatrix(true, false);
  return head.localToWorld(out.copy(local));
}

// ——— 演奏 ———

const SIDES = [['Left', 1], ['Right', -1]];
const ONE = new THREE.Vector3(1, 1, 1);
const IDLE = { breath: 0, rest: 0, finger: new Float32Array(8) };

const _a = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
const _b = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
/** 两个变换之间插值：位置线性、旋转球面插值 */
function blend(out, a, b, k) {
  a.decompose(_a.p, _a.q, _a.s);
  b.decompose(_b.p, _b.q, _b.s);
  return out.compose(_a.p.lerp(_b.p, k), _a.q.slerp(_b.q, k), _a.s.lerp(_b.s, k));
}

const grip = () => ({ center: new THREE.Vector3(), dir: new THREE.Vector3(), palm: new THREE.Vector3() });

/**
 * 管乐手的换气、休息、按键都跟着全团共用的拍子（orchestra.js 的 beat，和弦乐弓法、身体随乐句的起伏同一个拍子）：
 *   - 乐句按小节划分，同一声部在乐句交界处一起换气（每人早晚差零点几拍）；越响乐句越短
 *   - 安静段落里，乐句交界处有时放下乐器歇一两个乐句，下一个交界处先吸一口气再举起来
 *   - 手指按音符起落：安静时一拍一个音，激烈时四个十六分音符
 * 调音时拍子不走，按秒计时吹长音、偶尔换气。
 */
const PHRASE_BEATS = { flute: [8, 4], oboe: [8, 8], clarinet: [8, 8], bassoon: [8, 4], horn: [8, 4] };
const SECTION_LAG = { flute: 0, oboe: 0.12, clarinet: -0.1, bassoon: 0.06, horn: -0.05, piano: 0 };

export class WindPlayers {
  constructor(musicians) {
    this.members = musicians.filter((m) => OWN.has(m.section));
    this.rand = seededRandom(7);
    KINDS.horn.grips ??= hornGrips();
    for (const m of this.members) {
      m.wind = {
        lag: SECTION_LAG[m.section] + range(this.rand, -0.12, 0.12), // 换气比拍点早晚多少拍
        phraseIndex: null,
        restUntil: -1,
        tuneLeft: range(this.rand, 1, 4),
        breathT: -1,
        breathDur: 0.6,
        breath: 0,
        rest: 0,
        restTarget: 0,
        note: null,
        finger: new Float32Array(8),
        fingerTarget: new Float32Array(8),
      };
    }
    const V = () => new THREE.Vector3();
    this.tmp = {
      chest: new THREE.Matrix4(), local: new THREE.Matrix4(), play: new THREE.Matrix4(), rest: new THREE.Matrix4(), M: new THREE.Matrix4(),
      piano: new THREE.Matrix4(), p: V(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), s: V(), mouth: V(), off: V(),
      g: [grip(), grip(), grip()], c: V(), d: V(), n: V(), pole: V(), rq: new THREE.Quaternion(),
      grip: { curl: [0, 0, 0], thumb: 0.35, fingers: [1, 1, 1, 1], mitten: 1 },
    };
    this.beat = 0;
  }

  owns(m) {
    return OWN.has(m.section);
  }

  /** 每帧：换气、休息、手指。beat 是全团共用的拍子（演奏时才走） */
  update(dt, perf, tuning, beat = 0) {
    this.beat = beat;
    const r = this.rand;
    const k = perf.playing ? perf.intensity ?? 0 : 0;
    for (const m of this.members) {
      const s = m.wind;
      const sounding = m.present && m.raise > 0.5 && (perf.playing || tuning);
      if (s.breathT >= 0) {
        s.breathT += dt / s.breathDur;
        if (s.breathT >= 1) s.breathT = -1;
      }
      const breathe = (min, max) => {
        s.breathT = 0;
        s.breathDur = range(r, min, max);
      };
      if (!sounding || m.section === 'piano') {
        s.restTarget = 0;
        s.restUntil = -1;
        s.phraseIndex = null;
        if (!sounding) s.breathT = -1;
      } else if (!perf.playing) {
        // 调音：拍子不走，按秒吹长音，偶尔换一口气
        if ((s.tuneLeft -= dt) <= 0) {
          s.tuneLeft = range(r, 3, 6);
          breathe(0.5, 0.8);
        }
      } else {
        const [calm, loud] = PHRASE_BEATS[m.section];
        const len = k > 0.6 ? loud : calm; // 吹得越响，一口气撑得越短
        const index = Math.floor((beat + s.lag) / len);
        // 一首刚开始（或缓冲后接着演）的头两个乐句大家都在吹，不马上放下
        if (s.phraseIndex === null) s.freshUntil = index + 2;
        if (s.phraseIndex !== null && index !== s.phraseIndex) {
          if (s.restUntil > index) {
            // 还在休息
          } else if (s.restTarget === 1) {
            // 歇够了：举起来，先吸一口气再进
            s.restTarget = 0;
            breathe(0.55, 0.85);
          } else if (!m.baked && index > s.freshUntil && r() < clamp01(0.45 - 0.6 * k)) {
            // 安静段落：放下乐器歇一两个乐句（后排烘焙的乐手不单独休息，免得姿势来回跳）
            s.restTarget = 1;
            s.restUntil = index + (r() < 0.6 ? 1 : 2);
          } else {
            breathe(0.45, 0.7);
          }
        }
        s.phraseIndex = index;
      }
      s.rest = damp(s.rest, s.restTarget, 2.4, dt);
      s.breath = s.breathT >= 0 ? Math.sin(Math.PI * s.breathT) ** 2 : 0;
      // 手指：按音符起落；调音（长音）、换气、休息时不动
      const fingering = sounding && perf.playing && s.restTarget === 0 && s.breathT < 0;
      const perBeat = k < 0.3 ? 1 : k < 0.65 ? 2 : 4;
      const note = Math.floor((beat + s.lag * 0.5) * perBeat);
      if (note !== s.note || !fingering) {
        s.note = note;
        for (let i = 0; i < 8; i++) s.fingerTarget[i] = fingering ? range(r, -0.15, 0.1) : 0;
      }
      for (let i = 0; i < 8; i++) s.finger[i] = damp(s.finger[i], s.fingerTarget[i], 26, dt);
    }
  }

  /** 身体：坐 / 站 / 走、演奏时的前倾和转头、偶尔抬眼看指挥、换气时的吸气 */
  pose(m, t, perf) {
    const rig = m.rig;
    const s = m.baked ? IDLE : m.wind;
    const walking = m.walk > 0 && m.walk < 1;
    if (m.halfRate && s.shadowRig !== rig) {
      // 圆号手、钢琴手在左后方、离所有特写机位都远，影子几乎看不见：不进阴影贴图，省下三盏投影灯里的绘制
      s.shadowRig = rig;
      for (const mesh of rig.meshes ?? []) mesh.castShadow = false;
    }
    rig.root.position.copy(m.pos);
    rig.root.rotation.set(0, m.facing ?? m.yaw, 0); // 走路时朝着前进方向（walkOn 写入）
    const play = m.raise * (1 - s.rest);
    const B = m.section === 'piano' ? PIANIST : KINDS[m.section].body;
    const inhale = s.breath;
    const glance = (m.glance ?? 0) * play;
    // 身体随乐句的起伏已经在 m.lean 里（orchestra.js 按全团的拍子算）；这里只加演奏姿势和吸气
    poseBody(rig, {
      sit: m.sit,
      seat: m.seatHeight,
      lean: m.lean + (B.lean ?? 0) * play - 0.03 * inhale,
      bow: m.bow,
      twist: (B.twist ?? 0) * play,
      headYaw: m.headYaw * (1 - play) + (B.headYaw ?? 0) * play,
      headPitch: (B.headPitch ?? 0) * play - 0.08 * glance - 0.05 * inhale,
      headRoll: (B.headRoll ?? 0) * play,
      walk: walking ? m.stride ?? 1 : 0,
      phase: m.walkPhase,
      // 吸气：胸口抬起（脊柱最上一节后仰）、两肩微耸；平时是很轻的呼吸
      breathe: inhale > 0.01 ? -Math.PI / 2 : t * 1.1 + m.phase,
      breatheAmp: inhale > 0.01 ? 0.05 * inhale : 0.01,
      shrug: 0.08 * inhale,
      keepUpper: m.keepUpper,
    });
  }

  /** 乐器和双手 */
  place(m, t, perf, write) {
    if (m.section === 'piano') return this.#placePianist(m, t, perf);
    const K = KINDS[m.section];
    const rig = m.rig;
    const s = m.baked ? IDLE : m.wind;
    const T = this.tmp;
    const play = m.raise * (1 - s.rest);

    // 演奏位置：乐器随上身转动，原点（吹孔 / 哨片 / 号嘴）贴在嘴唇上，换气时稍微离开
    chestFrame(rig, T.chest).decompose(T.p, T.q, T.s);
    mouthWorld(rig, m.character, T.mouth);
    T.off.copy(K.lip).addScaledVector(K.breath, s.breath).applyQuaternion(T.q);
    T.play.compose(T.mouth.add(T.off), T.q2.multiplyQuaternions(T.q, K.play), ONE);
    // 放下的位置在角色局部坐标里；去掉个体身高缩放，乐器保持真实大小
    blend(T.local, K.stand, K.seat, m.sit);
    T.rest.multiplyMatrices(rig.root.matrixWorld, T.local).decompose(T.p, T.q, T.s);
    T.rest.compose(T.p, T.q, ONE);
    blend(T.M, T.rest, T.play, play);
    write(m.section, m.slot[m.section], T.M);

    // 双手：演奏 / 坐着放下 / 站着放下三种握法按权重混合
    const w = [play, (1 - play) * m.sit, (1 - play) * (1 - m.sit)];
    const specs = [K.grips.play, K.grips.seat, K.grips.stand];
    for (const [side, sx] of SIDES) {
      const c = T.c.set(0, 0, 0);
      const d = T.d.set(0, 0, 0);
      const n = T.n.set(0, 0, 0);
      specs.forEach((spec, i) => {
        if (w[i] < 1e-4) return;
        const g = this.#resolve(rig, m, spec[side], T.M, sx, T.g[i]);
        c.addScaledVector(g.center, w[i]);
        d.addScaledVector(g.dir, w[i]);
        n.addScaledVector(g.palm, w[i]);
      });
      const pp = K.poles.play[side];
      const pr = K.poles.rest[side];
      const pole = toWorld(rig, lerp(pr[0], pp[0], play), lerp(pr[1], pp[1], play), lerp(pr[2], pp[2], play), T.pole);
      const g = this.#grip(s, sx, play * (1 - s.breath), K.curl.rest, K.curl.play, play);
      gripArm(rig, side, c, d.normalize(), n.normalize(), pole.clone(), g);
    }
  }

  /**
   * 握法：三节弯曲按演奏程度在放下 / 演奏之间插值，每根手指再按音符起落（gripArm 的 fingers 倍数，
   * 正的 finger 值按下去、负的抬起来）；只有一根指骨的模型四指一起动（mitten）。
   */
  #grip(s, sx, amount, rest, playCurl, play) {
    const g = this.tmp.grip;
    for (let j = 0; j < 3; j++) g.curl[j] = lerp(rest[j], playCurl[j], play);
    let sum = 0;
    for (let f = 0; f < 4; f++) {
      // 手指离按键只抬一两厘米：弯曲倍数在 0.75～1.2 之间变化
      const v = s.finger[f + (sx > 0 ? 0 : 4)] * amount;
      g.fingers[f] = 1 + 1.8 * v;
      sum += v;
    }
    g.mitten = 1 + 1.2 * (sum / 4);
    return g;
  }

  /** 握点换算到世界坐标：乐器上的点跟着乐器，'lap' / 'side' 跟着身体 */
  #resolve(rig, m, spec, M, sx, out) {
    if (spec === 'lap' || spec === 'side') {
      const q = rig.root.getWorldQuaternion(this.tmp.rq);
      if (spec === 'lap') {
        toWorld(rig, sx * 0.13, m.seatHeight + 0.14, 0.3, out.center);
        out.dir.set(0, -0.25, 1).applyQuaternion(q).normalize();
        out.palm.set(0, -1, 0);
      } else {
        toWorld(rig, sx * 0.22, 0.82, 0.02, out.center);
        out.dir.set(0, -1, 0);
        out.palm.set(-sx, 0, 0).applyQuaternion(q);
      }
      return out;
    }
    out.center.copy(spec.p).applyMatrix4(M);
    out.dir.copy(spec.dir).transformDirection(M);
    out.palm.copy(spec.palm).transformDirection(M);
    return out;
  }

  /**
   * 钢琴手：跟着全团的拍子弹琶音——左手在低音区、右手在高音区，两拍一个来回地左右移动，
   * 每个八分音符按一下键（手腕下沉），强度越大跨度越大；放下时手放在腿上。
   */
  #placePianist(m, t, perf) {
    const rig = m.rig;
    const T = this.tmp;
    const s = m.baked ? IDLE : m.wind;
    // 钢琴相对琴手的位置是固定的（烘焙时角色在原点也成立）
    rig.root.getWorldPosition(T.p);
    rig.root.getWorldQuaternion(T.q);
    const P = T.piano.compose(T.p, T.q, ONE).multiply(PIANO_IN_PIANIST);
    const play = m.raise;
    const k = perf.playing ? perf.intensity ?? 0 : 0;
    const live = !m.baked && perf.playing;
    const beat = this.beat + (m.pianoIndex ?? 0) * 0.5; // 两架琴错开半拍，像两个声部
    for (const [side, sx] of SIDES) {
      const ph = Math.PI * beat + (sx > 0 ? 0 : 1.9);
      const x = sx * 0.2 + (live ? Math.sin(ph) * (0.04 + 0.14 * k) : 0);
      const press = live ? Math.max(0, Math.sin(Math.PI * 2 * beat + (sx > 0 ? 0 : 1))) * 0.01 * (0.4 + k) : 0;
      const keys = T.g[0];
      keys.center.set(x, PIANO.keyTop + 0.035 - press, 0.075).applyMatrix4(P);
      keys.dir.set(0, -0.5, 1).transformDirection(P);
      keys.palm.set(0, -1, 0).transformDirection(P);
      const lap = this.#resolve(rig, m, 'lap', null, sx, T.g[1]);
      const c = T.c.lerpVectors(lap.center, keys.center, play);
      const d = T.d.lerpVectors(lap.dir, keys.dir, play).normalize();
      const n = T.n.lerpVectors(lap.palm, keys.palm, play).normalize();
      const pp = PIANIST.poles[side];
      const g = this.#grip(s, sx, play, PIANIST.curlRest, PIANIST.curl, play);
      gripArm(rig, side, c, d, n, toWorld(rig, pp[0], pp[1], pp[2], T.pole).clone(), g);
    }
  }
}
