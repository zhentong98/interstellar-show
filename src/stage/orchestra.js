// 乐团：约 40 人弦乐（左侧四道弧）、30 人合唱（右后方台阶）、4 架定音鼓（右前方）、管风琴手（中央控制台）。
// 木管 8 人（指挥正前方偏右的两层台阶）、圆号 4 支（弦乐后方台阶）、钢琴 2 架（左后角）在 winds.js，这里只留接入的钩子。
//
// 每位乐手都有一副按 Mixamo 命名的骨骼（humans/rig.js），用 IK 摆姿势：
//   - 拉弓的右手追着弓根走，按弦的左手握着琴颈，弓毛始终压在琴马附近的弦上
//   - 合唱团双手捧着打开的谱夹，随乐句呼吸；鼓手先抬槌再落下；管风琴手双手在键盘上
// 渲染分两种：
//   - 前排（第一、二道弧的弦乐、定音鼓手、管风琴手）：SkinnedMesh，完整骨骼
//   - 后排（第三、四道弧和合唱团）：身体部件做成 InstancedMesh，矩阵直接取骨骼的世界矩阵
// 乐器全部是实例化的程序化 PBR 模型（instruments.js）。
//
// 对外接口与里程碑 1 相同：walkOn / snapSeated / standConcertmaster / setTuning / setReady /
// standUp / bowAll / turnPages / drumHit / update

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, clamp01, lerp, seededRandom, range, smoothstep } from '../core/math.js';
import { STAGE_Y, PODIUM, WINGS, ORGAN_CONSOLE } from './layout.js';
import { Rig } from './humans/rig.js';
import { createLook, buildSkinnedBody, Crowd } from './humans/body.js';
import { poseBody, poseArm, gripArm, restArms, toWorld, chestFrame } from './humans/pose.js';
import { ModelRig } from './humans/modelRig.js';
import { pickCharacter } from './humans/cast.js';
import { bakePose } from './humans/bake.js';
import {
  violinGeometry, celloGeometry, bowGeometry, folderGeometry, malletGeometry,
  VIOLIN_POINTS, CELLO_SCALE, BOW, varnish, accessory,
} from './instruments.js';
import { organKeys } from './textures.js';
import { LUX, candela, whiteMaterial } from './lightBudget.js';
import { windMusicians, assignWindSlots, windParts, buildWindProps, WindPlayers, WIND_ROLES, WIND_BAKE_KIND, WIND_SECTIONS } from './winds.js';

// 白色漫反射材质按 lightBudget.js 的反照率上限取色；金属留一点粗糙度，
// 顶光在鼓圈、鼓身上是一道柔和的高光，而不是一圈被 Bloom 晕开的亮环
const mat = {
  chair: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.55, metalness: 0.2 }),
  stand: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35, metalness: 0.7 }),
  paper: new THREE.MeshStandardMaterial({ color: whiteMaterial(0xe8e2d4), roughness: 0.9, side: THREE.DoubleSide }),
  copper: new THREE.MeshPhysicalMaterial({ color: 0xc77b45, metalness: 1, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 1, roughness: 0.42 }),
  // 鼓皮是羊皮纸色的小牛皮，反照率约 0.3
  drumHead: new THREE.MeshStandardMaterial({ color: 0xa0977f, roughness: 0.75, emissive: 0xffe0b0, emissiveIntensity: 0 }),
  riser: new THREE.MeshStandardMaterial({ color: 0x1d1611, roughness: 0.6 }),
  console: new THREE.MeshPhysicalMaterial({ color: 0x3e2413, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.25 }),
  keys: new THREE.MeshStandardMaterial({ map: organKeys(), roughness: 0.35 }),
  // 台灯的发光面本身比被照亮的表面亮得多，才会被 Bloom 晕开
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc27a).multiplyScalar(3) }),
};

// ——— 布局 ———

/** 弦乐：以指挥台为圆心的四道弧，从台口一侧（首席）排到舞台纵深 */
function stringSeats() {
  const arcs = [
    { r: 2.3, n: 7, from: 172, to: 104 },
    { r: 3.4, n: 10, from: 174, to: 100 },
    { r: 4.5, n: 11, from: 175, to: 98 },
    { r: 5.6, n: 12, from: 176, to: 97 },
  ];
  const sections = [
    ['violin1', 7],
    ['violin1', 5, 'violin2', 5],
    ['violin2', 5, 'viola', 6],
    ['viola', 2, 'cello', 6, 'bass', 4],
  ];
  const seats = [];
  arcs.forEach((arc, a) => {
    const plan = [];
    const spec = sections[a];
    for (let i = 0; i < spec.length; i += 2) for (let k = 0; k < spec[i + 1]; k++) plan.push(spec[i]);
    for (let i = 0; i < arc.n; i++) {
      const th = THREE.MathUtils.degToRad(lerp(arc.from, arc.to, i / (arc.n - 1)));
      seats.push({ section: plan[i], x: PODIUM.x + arc.r * Math.cos(th), z: PODIUM.z - arc.r * Math.sin(th), arc: a });
    }
  });
  return seats;
}

/** 合唱：右后方三层台阶，每层 10 人 */
function choirSpots() {
  const spots = [];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 10; i++) {
      spots.push({ section: 'choir', x: 3.3 + i * 0.74 + (row % 2) * 0.37, z: -8.0 - row * 1.0, elevation: 0.3 * (row + 1), row });
    }
  }
  return spots;
}

/** 定音鼓手的位置；四架鼓以他为圆心、朝指挥方向排成弧形 */
const TIMPANIST = new THREE.Vector3(4.9, STAGE_Y, -4.3);
const TIMPANI_FACING = Math.atan2(PODIUM.x - TIMPANIST.x, PODIUM.z + 0.4 - TIMPANIST.z);
export const TIMPANI = [
  { a: -0.95, r: 0.42 },
  { a: -0.32, r: 0.38 },
  { a: 0.32, r: 0.35 },
  { a: 0.95, r: 0.32 },
].map(({ a, r }) => ({
  x: TIMPANIST.x + Math.sin(TIMPANI_FACING + a) * 0.98,
  z: TIMPANIST.z + Math.cos(TIMPANI_FACING + a) * 0.98,
  r,
}));
const DRUM_HEAD_Y = STAGE_Y + 0.84;

// ——— 乐器的姿态（角色局部坐标或胸腔坐标里的基） ———

/** 由位置、长轴（+z）、近似的上方向（+y）构造矩阵 */
function frame(origin, axis, up) {
  const z = new THREE.Vector3(...axis).normalize();
  const x = new THREE.Vector3(...up).cross(z).normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...origin);
}

const POSES = {
  // 小提琴：演奏时在胸腔坐标里（原点在脖子根部），夹在左肩、琴头指向左前方
  violinPlay: frame([0.06, -0.02, 0.075], [0.55, 0.02, 0.83], [-0.35, 0.93, 0.1]),
  violinSeated: frame([0.14, 0.6, 0.3], [0, 1, 0.12], [-0.3, 0, 1]),
  violinStanding: frame([0.27, 0.4, 0.14], [0, 1, 0.1], [0, 0, 1]),
  bowSeated: frame([-0.17, 0.58, 0.3], [0, 1, 0.1], [0, -0.1, 1]),
  bowStanding: frame([-0.26, 0.86, 0.1], [0, -1, 0.12], [0, 0.12, 1]),
  // 大提琴：琴尾柱点地，琴身夹在两膝之间向后靠
  celloPlay: frame([0, 0.16, 0.52], [0, 0.93, -0.37], [0, 0.37, 0.93]),
  celloStanding: frame([0.36, 0.02, 0.22], [0, 1, -0.04], [0, 0.04, 1]),
  bassPlay: frame([0.04, 0.08, 0.46], [0, 0.96, -0.27], [0, 0.27, 0.96]),
  bassStanding: frame([0.4, 0.02, 0.25], [0, 1, -0.04], [0, 0.04, 1]),
  // 合唱谱夹：捧在胸前、页面朝向脸；放下时拿在身侧
  folderUp: frame([0, 1.12, 0.32], [0, 0.6, -0.8], [0, 0.8, 0.6]),
  folderDown: frame([0.25, 0.8, 0.06], [0, 0.2, -1], [0, 1, 0.2]),
};

const _a = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
const _b = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
/** 两个变换之间插值：位置线性、旋转球面插值 */
function blend(out, a, b, k) {
  a.decompose(_a.p, _a.q, _a.s);
  b.decompose(_b.p, _b.q, _b.s);
  return out.compose(_a.p.lerp(_b.p, k), _a.q.slerp(_b.q, k), _a.s.lerp(_b.s, k));
}

// ——— 乐手 ———

const STRINGS = ['violin1', 'violin2', 'viola', 'cello', 'bass'];

/** 声部 → 演员表里的角色类型 */
const ROLE_OF = { violin1: 'strings', violin2: 'strings', viola: 'strings', cello: 'strings', bass: 'strings', choir: 'choir', timpani: 'timpani', organ: 'organ', ...WIND_ROLES };

/** 后排烘焙：声部类别和各自需要的姿势（按顺序匹配第一个满足条件的） */
const BAKE_KIND = { violin1: 'violin', violin2: 'violin', viola: 'viola', cello: 'cello', bass: 'bass', choir: 'choir', ...WIND_BAKE_KIND };
const STRING_POSES = [
  { name: 'sitPlay', sit: 1, raise: 1, test: (m) => m.sit > 0.5 && m.raise > 0.5 },
  { name: 'sitRest', sit: 1, raise: 0, test: (m) => m.sit > 0.5 },
  { name: 'stand', sit: 0, raise: 0, test: () => true },
];
const BAKE_POSES = {
  violin: STRING_POSES,
  viola: STRING_POSES,
  cello: STRING_POSES,
  bass: STRING_POSES,
  choir: [
    { name: 'sing', sit: 0, raise: 1, test: (m) => m.raise > 0.5 },
    { name: 'stand', sit: 0, raise: 0, test: () => true },
  ],
  // 木管、圆号、钢琴：同样是 演奏 / 坐着放下 / 站立
  ...Object.fromEntries(Object.values(WIND_BAKE_KIND).map((kind) => [kind, STRING_POSES])),
};
const BOWED_SMALL = ['violin1', 'violin2', 'viola'];

/** 握法：手指三节的弯曲（弧度）和拇指 */
const GRIP = {
  neck: { curl: [0.75, 0.95, 0.6], thumb: 0.35 }, // 按弦：手指弯过指板
  bow: { curl: [0.45, 0.6, 0.35], thumb: 0.5 }, // 握弓：手指搭在弓杆上
  mallet: { curl: [0.9, 1.1, 0.7], thumb: 0.45 }, // 握槌：半握拳
  folder: { curl: [0.45, 0.6, 0.4], thumb: 0.25 }, // 捏谱夹：手指绕到背面
};

export class Orchestra {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '乐团';
    this.rand = seededRandom(42);
    this.time = 0;
    this.onDrumImpact = null;
    this.tmp = {
      m: new THREE.Matrix4(), m2: new THREE.Matrix4(), m3: new THREE.Matrix4(),
      v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
      q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1), zero: new THREE.Matrix4().makeScale(0, 0, 0),
      turn: new THREE.Matrix4(), e: new THREE.Euler(), chest: new THREE.Matrix4(),
    };

    this.writeInstrument = (name, slot, matrix) => this.parts[name].setMatrixAt(slot, matrix);
    this.musicians = this.#createMusicians();
    this.#buildBodies();
    this.#buildProps();
    this.#buildInstruments();
    this.winds = new WindPlayers(this.musicians);
  }

  #createMusicians() {
    const r = this.rand;
    const list = [];
    const faceConductor = (x, z) => Math.atan2(PODIUM.x - x, PODIUM.z + 0.4 - z);
    const base = (spec) => ({
      elevation: 0,
      seatHeight: 0.46,
      ...spec,
      walk: 0,
      present: false,
      visible: false,
      pos: spec.entry.clone(),
      sit: 0,
      sitTarget: 0,
      raise: 0,
      raiseTarget: 0,
      bow: 0,
      bowTarget: 0,
      lean: 0,
      walkPhase: r() * 6,
      // 个体差异：动作幅度 ±15%、快慢、相位、反应时间
      amp: range(r, 0.85, 1.15),
      rate: range(r, 0.85, 1.15),
      phase: r() * Math.PI * 2,
      stroke: 0,
      strokePhase: r() * 2,
      headYaw: 0,
      headTarget: 0,
      pageTurn: -1,
      hasMusic: false,
    });

    for (const s of stringSeats()) {
      list.push(base({
        ...s,
        seated: true,
        seatHeight: s.section === 'bass' ? 0.7 : 0.46,
        seat: new THREE.Vector3(s.x, STAGE_Y, s.z),
        yaw: faceConductor(s.x, s.z),
        entry: WINGS.left,
        depth: 1 - s.arc * 0.12, // 后排动作更小
        front: s.arc <= 1,
        look: createLook(r),
      }));
    }
    for (const s of choirSpots()) {
      list.push(base({
        ...s,
        seated: false,
        seat: new THREE.Vector3(s.x, STAGE_Y + s.elevation, s.z),
        yaw: faceConductor(s.x, s.z) * 0.6,
        entry: WINGS.right,
        depth: 1 - s.row * 0.15,
        front: false,
        look: createLook(r, { gown: true }),
      }));
    }
    list.push(base({
      section: 'timpani',
      seated: false,
      seat: TIMPANIST.clone(),
      yaw: TIMPANI_FACING,
      entry: WINGS.right,
      depth: 1,
      front: true,
      look: createLook(r, { gender: 'man' }),
    }));
    // 管风琴控制台侧向摆放：琴手面朝舞台左侧，观众看到侧面和亮着的琴键
    list.push(base({
      section: 'organ',
      seated: true,
      seatHeight: 0.5,
      seat: new THREE.Vector3(ORGAN_CONSOLE.x + 0.9, STAGE_Y, ORGAN_CONSOLE.z),
      yaw: -Math.PI / 2,
      entry: WINGS.right,
      depth: 1,
      front: true,
      look: createLook(r),
    }));
    // 木管、圆号、钢琴（winds.js）
    list.push(...windMusicians(base, r));

    const slots = { violin: 0, cello: 0, bow: 0, folder: 0 };
    list.forEach((m, i) => {
      m.index = i;
      m.rig = new Rig(m.look.scale);
      // 每位乐手在各个乐器实例化网格里的固定位置（后排隔帧更新时不会错位）
      m.slot = {};
      if (BOWED_SMALL.includes(m.section)) m.slot.violin = slots.violin++;
      if (m.section === 'cello' || m.section === 'bass') m.slot.cello = slots.cello++;
      if (STRINGS.includes(m.section)) m.slot.bow = slots.bow++;
      if (m.section === 'choir') m.slot.folder = slots.folder++;
      assignWindSlots(m, slots);
    });
    this.concertmasterIndex = list.findIndex((m) => m.section === 'violin1');
    this.timpanist = list.find((m) => m.section === 'timpani');
    this.timpanist.hits = [];
    this.timpanist.lift = [0, 0];
    return list;
  }

  #buildBodies() {
    this.crowd = new Crowd();
    for (const m of this.musicians) {
      if (m.front) {
        m.skinned = buildSkinnedBody(m.rig, m.look);
        m.rig.root.visible = false;
        this.group.add(m.rig.root);
      } else {
        this.crowd.add(m, m.look);
      }
    }
    this.crowd.build();
    this.group.add(this.crowd.group);
  }

  /** 椅子、谱架、合唱台阶、定音鼓、管风琴控制台 */
  #buildProps() {
    const seated = this.musicians.filter((m) => m.seated && m.section !== 'organ' && !m.ownSeat);
    const leg = (x, z) => new THREE.CylinderGeometry(0.012, 0.012, 0.46, 6).translate(x, 0.23, z);
    const chairGeo = mergeGeometries([
      new THREE.BoxGeometry(0.44, 0.05, 0.42).translate(0, 0.46, 0),
      new THREE.BoxGeometry(0.42, 0.34, 0.03).rotateX(-0.12).translate(0, 0.72, -0.21),
      leg(-0.19, 0.17), leg(0.19, 0.17), leg(-0.19, -0.17), leg(0.19, -0.17),
    ]);
    const stoolGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16).translate(0, 0.7, 0),
      leg(-0.12, 0.1).scale(1, 1.52, 1), leg(0.12, 0.1).scale(1, 1.52, 1), leg(0, -0.14).scale(1, 1.52, 1),
    ]);
    const standGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.01, 0.012, 1.0, 6).translate(0, 0.5, 0),
      new THREE.BoxGeometry(0.5, 0.34, 0.015).rotateX(-0.45).translate(0, 1.08, 0.02),
      ...[0, 1, 2].map((k) => new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4).translate(0, -0.14, 0)
        .rotateZ(0.9).rotateY((k * Math.PI * 2) / 3).translate(0, 0.15, 0)),
    ]);
    const bass = seated.filter((m) => m.section === 'bass');
    const chairs = new THREE.InstancedMesh(chairGeo, mat.chair, seated.length - bass.length);
    const stools = new THREE.InstancedMesh(stoolGeo, mat.chair, bass.length);
    const stands = new THREE.InstancedMesh(standGeo, mat.stand, seated.length);
    this.sheets = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.29), mat.paper, seated.length);
    this.pages = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.21, 0.29).translate(0.105, 0, 0), mat.paper, seated.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    this.standOf = new Map();
    let ci = 0;
    let bi = 0;
    seated.forEach((m, i) => {
      q.setFromAxisAngle(up, m.yaw);
      m4.compose(m.seat, q, one);
      if (m.section === 'bass') stools.setMatrixAt(bi++, m4);
      else chairs.setMatrixAt(ci++, m4);
      const fwd = new THREE.Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw));
      const standPos = m.seat.clone().addScaledVector(fwd, m.standDist ?? (m.section === 'cello' || m.section === 'bass' ? 1.15 : 0.85));
      m4.compose(standPos, q, one);
      stands.setMatrixAt(i, m4);
      this.standOf.set(m.index, { i, pos: standPos, quat: q.clone() });
    });
    for (const mesh of [chairs, stools, stands]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.group.add(chairs, stools, stands, this.sheets, this.pages);

    // 合唱台阶
    const risers = [];
    for (let row = 0; row < 3; row++) {
      const h = 0.3 * (row + 1);
      risers.push(new THREE.BoxGeometry(8.2, h, 1.0).translate(6.8, STAGE_Y + h / 2, -8.0 - row * 1.0));
    }
    const riserMesh = new THREE.Mesh(mergeGeometries(risers), mat.riser);
    riserMesh.receiveShadow = true;
    this.group.add(riserMesh);

    // 定音鼓：铜鼓身 + 镀铬鼓圈和调音螺杆 + 鼓皮 + 三脚支架 + 踏板
    this.drumHeads = [];
    const kettle = new THREE.LatheGeometry(
      Array.from({ length: 14 }, (_, i) => {
        const k = i / 13;
        return new THREE.Vector2(Math.sin(k * Math.PI * 0.5) * 1.0 + 0.001, -Math.cos(k * Math.PI * 0.5) * 0.85);
      }),
      40,
    );
    for (const d of TIMPANI) {
      const g = new THREE.Group();
      g.position.set(d.x, DRUM_HEAD_Y, d.z);
      const body = new THREE.Mesh(kettle, mat.copper);
      body.scale.setScalar(d.r);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(d.r * 1.03, 0.014, 8, 48).rotateX(Math.PI / 2), mat.chrome);
      const lugs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), mat.chrome, 6);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        lugs.setMatrixAt(k, new THREE.Matrix4().makeTranslation(Math.cos(a) * d.r * 1.04, -0.06, Math.sin(a) * d.r * 1.04));
      }
      const head = new THREE.Mesh(new THREE.CircleGeometry(d.r * 1.02, 40).rotateX(-Math.PI / 2), mat.drumHead.clone());
      head.position.y = 0.005;
      const legs = new THREE.Mesh(mergeGeometries([0, 1, 2].map((k) => new THREE.CylinderGeometry(0.014, 0.014, 0.6, 6)
        .translate(0, -0.3, 0).rotateZ(0.22).rotateY((k * Math.PI * 2) / 3))), mat.stand);
      legs.position.y = -d.r * 0.6;
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.26).translate(0, -0.82, d.r + 0.05), mat.stand);
      for (const mesh of [body, hoop, head, legs, pedal]) mesh.castShadow = true;
      g.add(body, hoop, lugs, head, legs, pedal);
      this.group.add(g);
      this.drumHeads.push({ mesh: head, flash: 0, wobble: 0, world: new THREE.Vector3(d.x, DRUM_HEAD_Y, d.z) });
    }

    // 管风琴控制台：侧向摆放，三层手键盘朝向舞台右侧（琴手坐在右边面朝左），两侧是音栓
    const c = ORGAN_CONSOLE;
    const consoleGroup = new THREE.Group();
    consoleGroup.position.set(c.x, STAGE_Y, c.z);
    const cabinet = new THREE.Mesh(mergeGeometries([
      new THREE.BoxGeometry(0.7, 1.35, 1.9).translate(-0.25, 0.675, 0),
      new THREE.BoxGeometry(0.45, 0.14, 2.05).translate(-0.18, 1.42, 0),
      new THREE.BoxGeometry(0.5, 0.6, 0.12).translate(0.12, 1.05, 0.88),
      new THREE.BoxGeometry(0.5, 0.6, 0.12).translate(0.12, 1.05, -0.88),
    ]), mat.console);
    const manuals = new THREE.Mesh(mergeGeometries([0, 1, 2].map((k) => {
      const g = new THREE.BoxGeometry(0.16, 0.025, 1.5);
      return g.translate(0.44 - k * 0.09, 0.78 + k * 0.1, 0);
    })), mat.keys);
    // 音栓：两侧成排的小圆钮
    const stops = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8).rotateZ(Math.PI / 2), mat.keys, 48);
    let si = 0;
    for (const side of [-1, 1]) {
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 4; col++) {
          stops.setMatrixAt(si++, new THREE.Matrix4().makeTranslation(0.19, 0.84 + row * 0.07, side * (0.83 + col * 0.035) - side * 0.03));
        }
      }
    }
    const pedals = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1.5).translate(0.45, 0.03, 0), mat.console);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 1.3).translate(0.95, 0.25, 0), mat.console);
    // 谱架上方的小台灯：暖光，会被 bloom 晕开
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.5).translate(0.05, 1.52, 0), mat.lamp);
    // 台灯照在琴键上（约 0.5 米）的照度是主光的三成：够看清琴键，又不会让键盘像灯管一样发亮
    const lampLight = new THREE.PointLight(0xffb870, candela(0.3 * LUX.key, 0.5, 0xffb870), 2.2, 2);
    lampLight.position.set(0.25, 1.35, 0);
    for (const mesh of [cabinet, manuals, pedals, bench]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    consoleGroup.add(cabinet, manuals, stops, pedals, bench, lamp, lampLight);
    this.group.add(consoleGroup);

    // 木管、圆号的台阶，两架钢琴和琴凳
    buildWindProps(this.group);
  }

  #buildInstruments() {
    const count = (sections) => this.musicians.filter((m) => sections.includes(m.section)).length;
    const make = (geo, material, n) => {
      const mesh = new THREE.InstancedMesh(geo, material, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.parts = {
      violin: make(violinGeometry(), varnish, count(BOWED_SMALL)),
      cello: make(celloGeometry(), varnish, count(['cello', 'bass'])),
      bow: make(bowGeometry(), accessory, count(STRINGS)),
      folder: make(folderGeometry(), accessory, count(['choir'])),
      mallet: make(malletGeometry(), accessory, 2),
      ...windParts(this.musicians, make),
    };
  }

  // ——— 真实模型 ———

  /**
   * 换成写实人物模型（cast.js 加载的演员表）。
   * 前排：每人一个带完整骨骼的模型，IK 驱动；后排：同一人物同一姿势只烘焙一次，做成 InstancedMesh。
   */
  useCast(cast) {
    if (this.crowd) {
      this.group.remove(this.crowd.group);
      this.crowd = null;
    }
    const counters = {};
    for (const m of this.musicians) {
      if (m.front && m.rig?.root.parent) this.group.remove(m.rig.root);
      const role = ROLE_OF[m.section];
      counters[role] = (counters[role] ?? -1) + 1;
      m.character = pickCharacter(cast, role, m.look.gender, counters[role]);
      if (m.front) {
        m.rig = new ModelRig(m.character, m.look.scale, cast.clips[m.seated ? 'sitIdle' : 'standIdle']);
        m.rig.root.visible = m.present;
        this.group.add(m.rig.root);
      } else {
        m.baked = true;
        m.rig = null;
      }
    }
    this.#buildBaked();
  }

  /** 后排：按（人物, 声部类别）分组，每组烘焙几个姿势 */
  #buildBaked() {
    this.bakedGroups = new Map();
    for (const m of this.musicians.filter((x) => x.baked)) {
      const kind = BAKE_KIND[m.section];
      const key = `${m.character.file}|${kind}`;
      if (!this.bakedGroups.has(key)) this.bakedGroups.set(key, { character: m.character, kind, members: [] });
      const g = this.bakedGroups.get(key);
      m.bakedGroup = g;
      m.bakedIndex = g.members.length;
      g.members.push(m);
    }
    for (const g of this.bakedGroups.values()) {
      g.poses = {};
      for (const pose of BAKE_POSES[g.kind]) {
        const sample = g.members[0];
        const rig = new ModelRig(g.character, 1);
        const fake = {
          ...sample, rig, pos: new THREE.Vector3(), yaw: 0, walk: 1, seat: new THREE.Vector3(), entry: new THREE.Vector3(),
          sit: pose.sit, raise: pose.raise, lean: pose.raise * pose.sit * 0.1, bow: 0, stroke: 0, headYaw: 0, keepUpper: false,
        };
        this.#poseMusician(fake, 0, { playing: false, intensity: 0 });
        const instruments = {};
        this.#placeInstrument(fake, 0, { playing: false, intensity: 0 }, (name, slot, mat) => { instruments[name] = mat.clone(); });
        const meshes = bakePose(rig).map(({ geometry, material }) => {
          const mesh = new THREE.InstancedMesh(geometry, material, g.members.length);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          this.group.add(mesh);
          return mesh;
        });
        g.poses[pose.name] = { meshes, instruments };
      }
    }
  }

  /** 后排乐手每帧：选姿势，整体做轻微的摆动和鞠躬；乐器跟着同一个变换 */
  #updateBaked(m, t) {
    const { m: R, m2, v, q, s, zero } = this.tmp;
    const g = m.bakedGroup;
    const walking = m.walk > 0 && m.walk < 1;
    const pose = BAKE_POSES[g.kind].find((p) => p.test(m))?.name ?? BAKE_POSES[g.kind][0].name;
    if (m.present) {
      const yaw = walking ? Math.atan2(m.seat.x - m.entry.x, m.seat.z - m.entry.z) : m.yaw;
      const bob = walking ? Math.abs(Math.sin(t * 7 + m.phase)) * 0.03 : 0;
      q.setFromAxisAngle(v.set(0, 1, 0), yaw);
      R.compose(v.copy(m.pos).setY(m.pos.y + bob), q, s.setScalar(m.look.scale));
      // 绕髋部前倾（演奏时的律动、鞠躬）
      const pivot = m.sit > 0.5 ? 0.55 : 0.95;
      m2.makeTranslation(0, pivot, 0).multiply(this.tmp.m3.makeRotationX(m.lean * 0.6 + m.bow * 0.7)).multiply(this.tmp.turn.makeTranslation(0, -pivot, 0));
      R.multiply(m2);
    }
    for (const [name, p] of Object.entries(g.poses)) {
      const on = m.present && name === pose;
      for (const mesh of p.meshes) {
        mesh.setMatrixAt(m.bakedIndex, on ? R : zero);
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (on) {
        for (const [inst, local] of Object.entries(p.instruments)) {
          if (m.slot[inst] !== undefined) this.parts[inst].setMatrixAt(m.slot[inst], m2.multiplyMatrices(R, local));
        }
      }
    }
    if (!m.present) this.#hideInstrument(m);
  }

  // ——— 对外接口：导演调用 ———

  /** 乐手陆续从侧台走上来就位（大体上远处的先走），全部到位后 resolve */
  walkOn(timeline, { spread, speed }, signal) {
    const order = this.musicians
      .map((m) => ({ m, key: m.entry.distanceTo(m.seat) + range(this.rand, 0, 3) }))
      .sort((a, b) => b.key - a.key)
      .map((o) => o.m);
    const jobs = order.map((m, i) => {
      const delay = (i / order.length) * spread + range(this.rand, 0, 0.4);
      const dist = m.entry.distanceTo(m.seat);
      const duration = dist / (speed * range(this.rand, 0.85, 1.1));
      return timeline.animate(duration, (k) => {
        m.present = true;
        m.walk = k;
        m.pos.lerpVectors(m.entry, m.seat, k);
        if (k >= 1) {
          m.sitTarget = m.seated ? 1 : 0;
          m.hasMusic = true;
        }
      }, { delay, ease: (k) => k, signal });
    });
    return Promise.all(jobs);
  }

  /** 跳过入场时直接就位 */
  snapSeated() {
    for (const m of this.musicians) {
      m.present = true;
      m.walk = 1;
      m.pos.copy(m.seat);
      m.sit = m.sitTarget = m.seated ? 1 : 0;
      m.hasMusic = true;
    }
  }

  get concertmaster() {
    return this.musicians[this.concertmasterIndex];
  }

  standConcertmaster(standing) {
    this.concertmaster.sitTarget = standing ? 0 : 1;
  }

  /** 调音：弦乐把乐器架起来，弓子短促地来回；木管、圆号也举起乐器吹长音 */
  setTuning(on) {
    this.tuning = on;
    for (const m of this.musicians) if (STRINGS.includes(m.section) || WIND_SECTIONS.includes(m.section)) m.raiseTarget = on ? 1 : 0;
  }

  /** 演奏准备：弦乐架琴、合唱举起谱夹、鼓手举槌、管风琴手把手放上键盘 */
  setReady(on) {
    for (const m of this.musicians) m.raiseTarget = on ? 1 : 0;
  }

  /** 起立（终场）。sections 为空表示全体 */
  standUp(sections = null) {
    for (const m of this.musicians) if (!sections || sections.includes(m.section)) m.sitTarget = 0;
  }

  /** 鞠躬，duration 秒后直起 */
  async bowAll(timeline, duration, sections = null, signal) {
    const group = this.musicians.filter((m) => !sections || sections.includes(m.section));
    for (const m of group) m.bowTarget = 1;
    try {
      await timeline.wait(duration * 0.5, signal);
    } finally {
      for (const m of group) m.bowTarget = 0;
    }
  }

  /** 翻谱：随机挑几个人 */
  turnPages(count = 4) {
    const seated = this.musicians.filter((m) => this.standOf.has(m.index));
    for (let i = 0; i < count; i++) {
      const m = seated[Math.floor(this.rand() * seated.length)];
      if (m.pageTurn < 0) m.pageTurn = 0;
    }
  }

  /** 定音鼓：lead 秒后击中（先抬槌再落下） */
  drumHit(lead = 0.18, strength = 1) {
    const t = this.timpanist;
    t.hits.push({ start: this.time, at: this.time + Math.max(0.12, lead), strength, hand: t.hits.length % 2, drum: 1 + (t.hits.length % 2) });
  }

  // ——— 每帧 ———

  update(dt, perf) {
    this.time += dt;
    const t = this.time;
    const { intensity, playing } = perf;
    this.#updateDrums(dt);
    this.winds.update(dt, perf, this.tuning);

    this.frame = (this.frame ?? 0) + 1;
    for (const m of this.musicians) {
      m.sit = damp(m.sit, m.sitTarget, 5, dt);
      m.raise = damp(m.raise, m.raiseTarget, 4 * m.rate, dt);
      m.bow = damp(m.bow, m.bowTarget, 4, dt);

      // 演奏：弓速随强度变化，缓冲时（playing=false）冻结
      const bowing = m.raise > 0.5 && (playing || this.tuning);
      const k = this.tuning ? 0.35 : intensity * m.depth;
      if (bowing) {
        m.strokePhase += dt * (0.35 + 1.1 * k) * m.rate;
        const x = m.strokePhase % 2;
        const tri = x < 1 ? x * 2 - 1 : 3 - x * 2; // 匀速拉弓，到头换向
        m.stroke = Math.sin((tri * Math.PI) / 2) * (0.35 + 0.65 * k) * m.amp;
      }
      const sway = playing ? Math.sin(t * (0.6 + intensity) * m.rate + m.phase) * (0.03 + 0.07 * intensity) * m.amp * m.depth : 0;
      m.lean = damp(m.lean, sway + (m.section === 'choir' ? 0 : 0.1 * m.raise * m.sit), 3, dt);

      if (m.pageTurn >= 0) {
        m.pageTurn += dt * 1.4;
        if (m.pageTurn >= 1) m.pageTurn = -1;
      }
      if (!playing && m.present && this.rand() < dt * 0.05) m.headTarget = range(this.rand, -0.6, 0.6);
      if (playing) m.headTarget = 0;
      m.headYaw = damp(m.headYaw, m.headTarget, 2, dt);

      m.visible = m.present;
      if (m.rig && m.front) m.rig.root.visible = m.present;
      if (m.baked) {
        this.#updateBaked(m, t);
        continue;
      }
      if (!m.present) {
        this.#hideInstrument(m);
        continue;
      }
      if (m.walk > 0 && m.walk < 1) m.walkPhase += dt * 7.5;
      // 真实模型的上身动作捕捉（坐着的人用坐姿动作，站着的用站姿动作）
      m.keepUpper = m.rig.animate ? m.rig.animate(dt) && (m.seated ? m.sit > 0.6 : m.sit < 0.4) : false;
      // 后排（实例化、离得远）隔帧更新姿态，省一半 CPU；走路时每帧都更新
      const walking = m.walk > 0 && m.walk < 1;
      if (!m.front && !walking && (m.index + this.frame) % 2 === 1 && m.posed) continue;
      m.posed = true;
      this.#poseMusician(m, t, perf);
      this.#placeInstrument(m, t, perf);
    }
    this.crowd?.update();
    this.#writePages();
    for (const p of Object.values(this.parts)) p.instanceMatrix.needsUpdate = true;
  }

  #poseMusician(m, t, perf) {
    if (this.winds.owns(m)) return this.winds.pose(m, t, perf);
    const rig = m.rig;
    const walking = m.walk > 0 && m.walk < 1;
    let yaw = m.yaw;
    if (walking) yaw = Math.atan2(m.seat.x - m.entry.x, m.seat.z - m.entry.z);
    rig.root.position.copy(m.pos);
    rig.root.rotation.set(0, yaw, 0);
    const choir = m.section === 'choir';
    poseBody(rig, {
      sit: m.sit,
      seat: m.seatHeight,
      lean: m.lean + (m.section === 'organ' ? 0.18 : 0),
      bow: m.bow,
      headYaw: m.headYaw + (m.section === 'violin1' || m.section === 'violin2' || m.section === 'viola' ? 0.25 * m.raise : 0),
      headPitch: choir ? 0.25 * m.raise : 0.12 * m.raise,
      headRoll: BOWED_SMALL.includes(m.section) ? -0.25 * m.raise : 0,
      walk: walking ? 1 : 0,
      phase: m.walkPhase,
      breathe: t * (choir ? 1.6 : 1.1) + m.phase,
      breatheAmp: choir && perf.playing ? 0.02 + 0.03 * perf.intensity : 0.01,
      keepUpper: m.keepUpper,
    });
  }

  #hideInstrument(m) {
    const { zero } = this.tmp;
    const P = this.parts;
    for (const [name, slot] of Object.entries(m.slot)) P[name].setMatrixAt(slot, zero);
    if (m.section === 'timpani') {
      P.mallet.setMatrixAt(0, zero);
      P.mallet.setMatrixAt(1, zero);
    }
  }

  /**
   * 乐器位置：放下（站/坐两种）和演奏位置之间按 raise 插值；
   * 双手的 IK 目标由乐器位置推出来，所以手永远握在琴颈、弓根上。
   */
  #placeInstrument(m, t, perf, write = this.writeInstrument) {
    if (this.winds.owns(m)) return this.winds.place(m, t, perf, write);
    const rig = m.rig;
    const { m: M, m2, m3, v, v2, v3, v4 } = this.tmp;
    const root = rig.root.matrixWorld;
    const toW = (local, out) => out.multiplyMatrices(root, local);
    const col = (mat, i, out) => out.setFromMatrixColumn(mat, i).normalize();

    if (STRINGS.includes(m.section)) {
      const small = BOWED_SMALL.includes(m.section);
      const bass = m.section === 'bass';
      // —— 琴 ——
      if (small) {
        blend(m2, POSES.violinStanding, POSES.violinSeated, m.sit);
        toW(m2, m3);
        M.multiplyMatrices(chestFrame(rig, this.tmp.chest), POSES.violinPlay);
        blend(M, m3, M, m.raise);
        if (m.section === 'viola') M.scale(v.setScalar(1.12));
      } else {
        blend(m2, bass ? POSES.bassStanding : POSES.celloStanding, bass ? POSES.bassPlay : POSES.celloPlay, m.sit);
        toW(m2, M);
        if (bass) M.scale(v.setScalar(1.38));
      }
      write(small ? 'violin' : 'cello', small ? m.slot.violin : m.slot.cello, M);
      const scaleK = small ? (m.section === 'viola' ? 1.12 : 1) : bass ? 1.38 : 1;
      const pts = small ? VIOLIN_POINTS : null;
      const neckLocal = small ? pts.neck : v.copy(VIOLIN_POINTS.neck).multiply(CELLO_SCALE);
      const bridgeLocal = small ? pts.bridge : v2.copy(VIOLIN_POINTS.bridge).multiply(CELLO_SCALE);
      const neckW = v3.copy(neckLocal).applyMatrix4(M);
      const bridgeW = v4.copy(bridgeLocal).applyMatrix4(M);
      const instUp = col(M, 1, new THREE.Vector3());
      const instX = col(M, 0, new THREE.Vector3());
      const sideX = instX.clone(); // 琴颈的侧向（左手掌心朝这边）
      // —— 弓 ——（演奏：弓毛压在琴马处，弓尖指向演奏者左边；放下：竖着拿在右手）
      const tipDir = small ? instX : instX.negate();
      const contact = small ? 0.1 + 0.28 * (1 + m.stroke) : 0.12 + 0.19 * (1 + m.stroke);
      const bowPlay = m2;
      {
        const z = tipDir;
        const y = instUp;
        const x = new THREE.Vector3().crossVectors(y, z).normalize();
        const origin = v.copy(bridgeW).addScaledVector(y, -BOW.hairY).addScaledVector(z, -contact);
        bowPlay.makeBasis(x, y.clone().crossVectors(z, x), z).setPosition(origin);
      }
      blend(m3, POSES.bowStanding, POSES.bowSeated, m.sit);
      const bowRest = toW(m3, new THREE.Matrix4());
      const bowM = blend(new THREE.Matrix4(), bowRest, bowPlay, m.raise);
      write('bow', m.slot.bow, bowM);

      // —— 双手 ——
      // 左手：掌心贴着琴颈侧面，手指朝琴面方向伸出、再弯过指板按弦（虎口托着琴颈）
      const neckSide = small ? 0.028 : 0.045;
      const leftCenter = neckW.clone().addScaledVector(sideX, -neckSide * scaleK).addScaledVector(instUp, -0.035 * scaleK);
      gripArm(rig, 'Left', leftCenter, instUp, sideX,
        toWorld(rig, 0.4, lerp(0.8, 0.9, m.raise), lerp(-0.1, 0.1, m.raise)).clone(), GRIP.neck);
      // 右手：掌心朝下压在弓根上方，手指朝外侧搭过弓杆
      const bx = col(bowM, 0, new THREE.Vector3());
      const by = col(bowM, 1, new THREE.Vector3());
      const bz = col(bowM, 2, new THREE.Vector3());
      const frog = new THREE.Vector3().setFromMatrixPosition(bowM);
      const rightCenter = frog.addScaledVector(by, 0.032).addScaledVector(bx, 0.018).addScaledVector(bz, 0.03);
      const fingers = bx.clone().multiplyScalar(-0.75).addScaledVector(by, -0.5);
      gripArm(rig, 'Right', rightCenter, fingers, by.negate(),
        toWorld(rig, -0.65, 0.95, lerp(-0.3, -0.05, m.raise)).clone(), GRIP.bow);
      return;
    }

    if (m.section === 'choir') {
      blend(M, POSES.folderDown, POSES.folderUp, m.raise);
      toW(M, m2);
      write('folder', m.slot.folder, m2);
      // 双手捏住谱夹两侧：掌心朝谱夹中间，拇指在正面，手指绕到背面。
      // 谱夹局部 +x 指向演唱者的右边，所以左手抓 −x 一侧、右手抓 +x 一侧
      const fx = col(m2, 0, v2);
      const behind = col(m2, 2, v3).negate();
      const hold = (side, edge, pole) => {
        const center = v.set(edge, -0.02, 0.03).applyMatrix4(m2).clone();
        gripArm(rig, side, center, behind, fx.clone().multiplyScalar(-Math.sign(edge)), pole, GRIP.folder);
      };
      if (m.raise > 0.3) {
        hold('Left', -0.155, toWorld(rig, 0.45, 0.9, -0.2).clone());
        hold('Right', 0.155, toWorld(rig, -0.45, 0.9, -0.2).clone());
      } else {
        // 放下时左手在身侧拿着谱夹，捏靠近大腿的那一边
        restArms(rig, 0);
        hold('Left', 0.155, toWorld(rig, 0.5, 1.0, -0.3).clone());
      }
      return;
    }

    if (m.section === 'timpani') {
      const tp = m;
      for (const hand of [0, 1]) {
        const sx = hand ? 1 : -1;
        const lift = tp.lift[hand];
        const handPos = toWorld(rig, sx * 0.2, lerp(0.85, 1.02 + lift * 0.28, m.raise), lerp(0.1, 0.34, m.raise)).clone();
        const drum = this.drumHeads[hand ? 2 : 1].world;
        const dir = v.subVectors(drum, handPos).normalize();
        dir.lerp(v2.set(0, 1, 0), lift * 0.85).normalize();
        if (m.raise < 0.5) dir.set(0, -1, 0.3).normalize();
        const z = dir;
        const x = v3.set(0, 1, 0).cross(z).normalize();
        const y = v4.crossVectors(z, x);
        M.makeBasis(x, y, z).setPosition(handPos);
        write('mallet', hand, M);
        // 槌杆斜穿过掌心、从虎口伸出去：掌心朝下，手指横着握住槌杆
        const palm = y.clone().negate();
        const fingers = hand ? z.clone().cross(palm) : palm.clone().cross(z);
        const center = handPos.clone().addScaledVector(z, 0.07).addScaledVector(y, 0.022);
        gripArm(rig, hand ? 'Left' : 'Right', center, fingers, palm, toWorld(rig, sx * 0.6, 0.9, -0.2).clone(), GRIP.mallet);
      }
      return;
    }

    if (m.section === 'organ') {
      // 双手在三层键盘上移动：强度越大动作越大
      const k = perf.playing ? perf.intensity : 0;
      for (const [side, sx] of [['Left', 1], ['Right', -1]]) {
        const tier = Math.floor((Math.sin(t * 0.7 + sx) * 0.5 + 0.5) * 2.99) * m.raise;
        const reach = sx * (0.18 + Math.sin(t * (1.2 + k * 2) + sx * 1.7) * 0.07 * (0.3 + k));
        const target = toWorld(rig, lerp(sx * 0.15, reach, m.raise), lerp(0.6, 0.8 + tier * 0.1 + 0.03, m.raise), lerp(0.3, 0.47 + tier * 0.08, m.raise)).clone();
        poseArm(rig, side, target, toWorld(rig, sx * 0.5, 0.7, -0.2).clone());
      }
    }
  }

  #updateDrums(dt) {
    const tp = this.timpanist;
    tp.lift = [0, 0];
    tp.hits = tp.hits.filter((h) => {
      const now = this.time;
      if (now < h.at) {
        // 抬槌：从出发到击打前逐渐举高，最后一刻落下
        const k = clamp01((now - h.start) / Math.max(0.01, h.at - h.start));
        tp.lift[h.hand] = Math.max(tp.lift[h.hand], smoothstep(0, 0.6, k) * (1 - smoothstep(0.75, 1, k)) * h.strength);
        return true;
      }
      if (!h.landed) {
        h.landed = true;
        const d = this.drumHeads[h.drum];
        d.flash = h.strength;
        d.wobble = h.strength;
        this.onDrumImpact?.(h.strength);
      }
      return now < h.at + 0.3;
    });
    for (const d of this.drumHeads) {
      d.flash = damp(d.flash, 0, 6, dt);
      d.wobble = damp(d.wobble, 0, 5, dt);
      d.mesh.material.emissiveIntensity = d.flash * 0.5;
      d.mesh.position.y = 0.005 + Math.sin(this.time * 90) * d.wobble * 0.006;
    }
  }

  /** 谱架上的乐谱：落座后出现；翻谱时一页纸绕书脊转过去 */
  #writePages() {
    const { m: M, m2: local, q, e, v, s, zero, turn } = this.tmp;
    for (const m of this.musicians) {
      const stand = this.standOf.get(m.index);
      if (!stand) continue;
      if (!m.hasMusic) {
        this.sheets.setMatrixAt(stand.i, zero);
        this.pages.setMatrixAt(stand.i, zero);
        continue;
      }
      local.compose(stand.pos, stand.quat, s.set(1, 1, 1));
      M.makeRotationX(-0.45).setPosition(0, 1.085, 0.035);
      M.premultiply(local);
      this.sheets.setMatrixAt(stand.i, M);
      if (m.pageTurn >= 0) {
        e.set(-0.45, 0, 0);
        q.setFromEuler(e);
        const lift = Math.sin(m.pageTurn * Math.PI) * 0.12;
        M.compose(v.set(0, 1.085, 0.05 + lift * 0.3), q, s.set(1, 1, 1));
        M.multiply(turn.makeRotationY(-m.pageTurn * Math.PI)).premultiply(local);
        this.pages.setMatrixAt(stand.i, M);
      } else {
        this.pages.setMatrixAt(stand.i, zero);
      }
    }
    this.sheets.instanceMatrix.needsUpdate = true;
    this.pages.instanceMatrix.needsUpdate = true;
  }
}
