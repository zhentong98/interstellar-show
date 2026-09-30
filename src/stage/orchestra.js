// 乐团：约 40 人弦乐（左侧四道弧）、30 人合唱（右后方台阶）、4 架定音鼓（右前方）、管风琴手（中央控制台）。
//
// 每位乐手都有一副按 Mixamo 命名的骨骼（humans/rig.js），用 IK 摆姿势；每一帧手该到哪由 humans/playing.js 的"分谱"给出：
//   - 弦乐按声部统一弓法：弓毛贴在琴马和指板之间的弦上，右手追着弓根走，左手握琴颈换把、揉弦
//   - 合唱团双手捧着谱夹，随乐句呼吸、偶尔抬头看指挥；鼓手按拍单击、滚奏、重击前抬槌；管风琴手按拍换和弦
// 渲染分两种：
//   - 完整骨骼（弦乐全部、合唱团第一排、定音鼓手、管风琴手）：SkinnedMesh；离镜头远的后两道弧和合唱团隔帧更新
//   - 烘焙（合唱团后两排；没有写实模型时的程序化后排）：同一人物同一姿势只烘焙一次，做成 InstancedMesh
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
import { BowSection, updateLeftHand, updateGlance, TimpaniPart, OrganPart } from './humans/playing.js';
import { ModelRig } from './humans/modelRig.js';
import { pickCharacter } from './humans/cast.js';
import { bakePose } from './humans/bake.js';
import {
  violinGeometry, celloGeometry, bowGeometry, folderGeometry, malletGeometry,
  VIOLIN_POINTS, CELLO_SCALE, BOW, varnish, accessory,
} from './instruments.js';
import { organKeys } from './textures.js';
import { LUX, candela, whiteMaterial } from './lightBudget.js';
import { planWalkOn, distanceAt, dampAngle, lerpAngle, walkStride, TURN_TIME, SIT_TIME } from './walkPaths.js';

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
// 相邻两面鼓的鼓圈留几厘米空隙（原来的角度让鼓圈互相压住），两侧的大鼓、小鼓绕到鼓手身侧，和真实的弧形摆法一样
export const TIMPANI = [
  { a: -1.3, r: 0.42 },
  { a: -0.44, r: 0.38 },
  { a: 0.4, r: 0.35 },
  { a: 1.22, r: 0.32 },
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
  // 小提琴：演奏时在胸腔坐标里（原点在脖子根部）。琴背搁在左锁骨上、腮托在下巴左下方，
  // 琴头指向左前方并微微上扬，面板向右倾约 33°（弓毛才能贴着弦、右臂自然下垂）
  violinPlay: frame([0.07, -0.035, 0.05], [0.68, 0.16, 0.72], [-0.55, 0.83, 0.05]),
  violinSeated: frame([0.14, 0.6, 0.3], [0, 1, 0.12], [-0.3, 0, 1]),
  violinStanding: frame([0.27, 0.4, 0.14], [0, 1, 0.1], [0, 0, 1]),
  bowSeated: frame([-0.17, 0.58, 0.3], [0, 1, 0.1], [0, -0.1, 1]),
  bowStanding: frame([-0.26, 0.86, 0.1], [0, -1, 0.12], [0, 0.12, 1]),
  // 大提琴：尾柱在身前 0.6 米处点地，琴身夹在两膝之间向后靠约 26°，
  // 琴颈从左耳旁边经过（不挡脸），面板稍微转向右边，方便右手运弓
  celloPlay: frame([0.078, 0.24, 0.45], [0.13, 0.9, -0.435], [-0.15, 0.43, 0.89]),
  celloStanding: frame([0.36, 0.02, 0.22], [0, 1, -0.04], [0, 0.04, 1]),
  // 低音提琴：坐高凳，琴几乎竖直（约 14°），靠在左腿内侧，琴颈在头的左边
  bassPlay: frame([0.13, 0.28, 0.36], [0.08, 0.97, -0.23], [-0.25, 0.25, 0.93]),
  bassStanding: frame([0.4, 0.02, 0.25], [0, 1, -0.04], [0, 0.04, 1]),
  // 合唱谱夹：捧在胸前、页面朝向脸（胸腔坐标，随呼吸和身体前倾一起动）；放下时拿在身侧
  folderUp: frame([0, -0.26, 0.3], [0, 0.6, -0.8], [0, 0.8, 0.6]),
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

/** 坐着演奏的人起立时往前迈多远（米）：站在椅子前沿和谱架之间 */
const STAND_STEP = 0.4;

/** 声部 → 演员表里的角色类型 */
const ROLE_OF = { violin1: 'strings', violin2: 'strings', viola: 'strings', cello: 'strings', bass: 'strings', choir: 'choir', timpani: 'timpani', organ: 'organ' };

/** 后排烘焙：声部类别和各自需要的姿势（按顺序匹配第一个满足条件的） */
const BAKE_KIND = { violin1: 'violin', violin2: 'violin', viola: 'viola', cello: 'cello', bass: 'bass', choir: 'choir' };
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
};
const BOWED_SMALL = ['violin1', 'violin2', 'viola'];

/**
 * 握法：手指三节的弯曲（弧度）和拇指。
 * mitten：女性扫描模型四指共用一条指骨链（像连指手套），四指只能一起弯，单独给一个更克制的倍数，
 * 免得按弦时整只手攥成拳头、握弓时手指像一块板。
 */
const GRIP = {
  neck: { curl: [0.75, 0.95, 0.6], thumb: 0.35, mitten: 1 }, // 按弦：手指弯过指板
  bow: { curl: [0.45, 0.6, 0.35], thumb: 0.5, mitten: 0.8, fingers: [0.9, 1, 1.05, 0.6] }, // 握弓：手指搭在弓杆上，小指立在弓杆上
  mallet: { curl: [0.9, 1.1, 0.7], thumb: 0.45, mitten: 0.85, fingers: [0.8, 1, 1.05, 1.1] }, // 握槌：拇指和食指捏住，后三指松松包着
  folder: { curl: [0.45, 0.6, 0.4], thumb: 0.25, mitten: 0.75 }, // 捏谱夹：手指绕到背面
  keys: { curl: [0.35, 0.55, 0.3], thumb: 0.2, mitten: 0.6 }, // 管风琴：手指弯成弧形放在键上
};

/** 各乐器的尺寸倍数（相对小提琴的几何体）和按弦、运弓的参数，单位都是小提琴几何体里的米 */
const BASS_SCALE = 1.32;
const STRING_X = 0.0149; // 最外侧两根弦离中线的距离
const STRING_TOP = 0.0672; // 弦的上沿（弓毛贴在这里）
const NECK_Z = [0.505, 0.42]; // 左手从第一把位到高把位，琴颈上的位置
const VIBRATO = { violin: 0.0045, cello: 0.0038 }; // 揉弦幅度（大提琴几何体放大 2.1 倍后约 8 毫米）

/** 烘焙姿势、还没开始拉的时候：弓在中段、左手在第一把位 */
const REST_BOW = { u: 0.5, vel: 0, down: true };
const REST_LEFT = { pos: 0.2, vib: 0, fingers: [1, 1, 1, 1] };

/** 管风琴手用了和定音鼓手不同的起始人物，免得两个最显眼的独奏位置是同一张脸 */
const CAST_START = { organ: 1 };

export class Orchestra {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '乐团';
    this.rand = seededRandom(42);
    this.time = 0;
    this.onDrumImpact = null;
    // 全团共用的拍子和各部分的"分谱"（弓法、定音鼓、管风琴），见 humans/playing.js
    this.beat = 0;
    this.prevBeat = 0;
    this.bowing = Object.fromEntries(STRINGS.map((name, i) => [name, new BowSection(name, seededRandom(7 + i))]));
    this.timpaniPart = new TimpaniPart();
    this.timpaniPart.onContact = (drum, strength, heavy) => this.#drumContact(drum, strength, heavy);
    this.organPart = new OrganPart(seededRandom(11));
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
        front: true, // 弦乐全部完整骨骼：大提琴、中提琴机位里的人也要真的在拉
        halfRate: s.arc >= 2, // 后两道弧离镜头远，隔帧更新姿态
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
        front: s.row === 0, // 第一排完整骨骼（呼吸、抬头看指挥），后两排烘焙
        halfRate: true,
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
    });
    this.concertmasterIndex = list.findIndex((m) => m.section === 'violin1');
    this.timpanist = list.find((m) => m.section === 'timpani');
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
    const seated = this.musicians.filter((m) => m.seated && m.section !== 'organ');
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
      const standPos = m.seat.clone().addScaledVector(fwd, m.section === 'cello' || m.section === 'bass' ? 1.15 : 0.85);
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
      this.drumHeads.push({ mesh: head, flash: 0, wobble: 0, r: d.r, world: new THREE.Vector3(d.x, DRUM_HEAD_Y, d.z) });
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
      counters[role] = (counters[role] ?? (CAST_START[role] ?? 0) - 1) + 1;
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
      const yaw = m.facing ?? m.yaw;
      const bob = walking ? Math.abs(Math.sin(m.walkPhase)) * 0.03 : 0;
      q.setFromAxisAngle(v.set(0, 1, 0), yaw);
      R.compose(v.copy(m.pos).setY(m.pos.y + bob), q, s.setScalar(m.look.scale));
      // 绕髋部前倾（演奏时的律动、鞠躬）
      const pivot = m.sit > 0.5 ? 0.55 : 0.95;
      m2.makeTranslation(0, pivot, 0).multiply(this.tmp.m3.makeRotationX(m.lean * 0.6 + m.bow * 0.7)).multiply(this.tmp.turn.makeTranslation(0, -pivot, 0));
      R.multiply(m2);
    }
    for (const [name, p] of Object.entries(g.poses)) {
      const on = m.present && name === pose;
      if (on) p.used = true;
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

  // ——— 上台 ———

  /**
   * 规划上台的走位：每个人的路线和出发时间（算法见 walkPaths.js），算一次缓存起来。
   * @param {object} [options]
   *   speed  平均步速（米/秒）
   *   avoid  乐团以外也要绕开的道具（例如指挥台）
   * @returns {{ duration: number, route: Function }} duration：从第一个人出场到最后一个人坐好的秒数
   */
  planWalkOn({ speed = 1.4, avoid = [] } = {}) {
    if (!this.walkPlan) {
      this.group.updateMatrixWorld(true);
      this.walkPlan = planWalkOn({ musicians: this.musicians, obstacles: [...this.#props(), ...avoid], speed });
    }
    return this.walkPlan;
  }

  /** 舞台上的道具：乐团组里除了人、乐器、乐谱以外的东西（椅子、谱架、台阶、定音鼓、管风琴台……） */
  #props() {
    const skip = new Set([this.sheets, this.pages, this.crowd?.group, ...Object.values(this.parts)]);
    for (const m of this.musicians) if (m.rig?.root) skip.add(m.rig.root);
    for (const g of this.bakedGroups?.values() ?? []) {
      for (const p of Object.values(g.poses)) for (const mesh of p.meshes) skip.add(mesh);
    }
    return this.group.children.filter((o) => !skip.has(o) && !o.isLight);
  }

  /**
   * 乐手从两侧入口鱼贯而入，沿过道走进各排，从里往外依次转身落座；合唱团一层一层从台阶一端上去。
   * lead：开场这一刻已经走了多少秒（最早出场的几位这时已经在台上了）。全部就位后 resolve。
   */
  walkOn(timeline, { lead = 0, speed, avoid } = {}, signal) {
    const plan = this.planWalkOn({ speed, avoid });
    const span = Math.max(0.01, plan.duration - lead);
    let last = lead;
    for (const w of plan.walkers) {
      w.m.present = false;
      w.m.walk = 0;
      w.seated = false;
    }
    return timeline.animate(span, (k) => {
      const t = lead + k * span;
      const dt = Math.max(0, t - last);
      last = t;
      for (const w of plan.walkers) this.#stepWalker(w, t, dt);
    }, { ease: (k) => k, signal });
  }

  /** 一位乐手在上台时间表第 t 秒的状态：还没出场 / 走路 / 到位转身 / 坐下 */
  #stepWalker(w, t, dt) {
    const m = w.m;
    if (t < w.start) {
      m.present = false;
      m.walk = 0;
      return;
    }
    m.present = true;
    const walked = t - w.start;
    if (walked < w.duration) {
      const s = distanceAt(w, walked);
      w.path.at(s, m.pos);
      // 朝向看前方一小段路，拐弯时提前转身、平滑地转过去
      const ahead = w.path.heading(s + 0.3);
      m.facing = m.walk > 0 && m.walk < 1 ? dampAngle(m.facing, ahead, 9, dt) : ahead;
      m.walk = 0.5;
      w.gait ??= walkStride(w.v);
      m.stride = w.gait.amount;
      m.walkPhase = w.phase + s * w.gait.phasePerMeter;
      w.arriveYaw = m.facing;
      w.arrivePhase = m.walkPhase;
      return;
    }
    const u = walked - w.duration;
    if (u < TURN_TIME) {
      // 到位：原地转身面向指挥（坐着的人背对椅子），脚下跟着挪一两步
      m.pos.copy(w.stand);
      const f = u / TURN_TIME;
      m.facing = lerpAngle(w.arriveYaw ?? m.yaw, m.yaw, f * f * (3 - 2 * f));
      m.walk = 0.5;
      m.walkPhase = (w.arrivePhase ?? 0) + f * Math.PI;
      return;
    }
    m.facing = m.yaw;
    m.walk = 1;
    m.hasMusic = true;
    if (m.seated) {
      // 坐下：从椅子前面退到椅子上（退回去的动作由 update 里的"起立前迈一步"平滑完成）
      m.sitTarget = 1;
      if (this.standOf.has(m.index)) {
        if (!w.seated) {
          w.seated = true;
          m.step = 1;
        }
      } else {
        // 没有椅子的（管风琴的琴凳）：从站位直接挪到座位上
        const f = Math.min(1, (u - TURN_TIME) / SIT_TIME);
        m.pos.lerpVectors(w.stand, m.seat, 1 - (1 - f) * (1 - f));
      }
    } else {
      m.pos.copy(m.seat);
    }
  }

  /** 跳过入场时直接就位 */
  snapSeated() {
    for (const m of this.musicians) {
      m.present = true;
      m.walk = 1;
      m.pos.copy(m.seat);
      m.facing = m.yaw;
      m.step = 0;
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

  /** 有椅子的人站起来之后站在哪里（椅子前面一步），没有椅子的就是座位本身 */
  standingSpot(m) {
    const d = this.standOf.has(m.index) && m.seated ? STAND_STEP : 0;
    return new THREE.Vector3(m.seat.x + Math.sin(m.yaw) * d, m.seat.y, m.seat.z + Math.cos(m.yaw) * d);
  }

  /** 调音：弦乐把乐器架起来，弓子短促地来回 */
  setTuning(on) {
    this.tuning = on;
    for (const m of this.musicians) if (STRINGS.includes(m.section)) m.raiseTarget = on ? 1 : 0;
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

  /** 定音鼓：lead 秒后重击。cue 表的重击已经按 nextHit 提前抬好槌，这里只确认落下的时刻和力度 */
  drumHit(lead = 0.18, strength = 1) {
    this.timpaniPart.hit(Math.max(0.12, lead), strength);
  }

  // ——— 每帧 ———

  update(dt, perf) {
    this.time += dt;
    const t = this.time;
    const { intensity, playing } = perf;
    // 全团共用的拍子：弓法、定音鼓、管风琴、身体随乐句的起伏都跟着它走；缓冲时（playing=false）停住
    this.prevBeat = this.beat;
    if (playing) this.beat += (dt * (perf.bpm ?? 72)) / 60;
    const bowing = playing || this.tuning;
    for (const sec of Object.values(this.bowing)) sec.update(dt, intensity, perf.bpm ?? 72, bowing, this.tuning);
    this.organPart.update(dt, perf, this.beat);
    this.#updateDrums(dt, perf);

    this.frame = (this.frame ?? 0) + 1;
    const bakedPoses = this.bakedGroups ? [...this.bakedGroups.values()].flatMap((g) => Object.values(g.poses)) : [];
    for (const p of bakedPoses) p.used = false;
    for (const m of this.musicians) {
      m.sit = damp(m.sit, m.sitTarget, 5, dt);
      m.raise = damp(m.raise, m.raiseTarget, 4 * m.rate, dt);
      m.bow = damp(m.bow, m.bowTarget, 4, dt);
      // 有椅子的人起立时（首席调音、握手，谢幕）往前迈一小步，站在椅子和谱架之间，不和椅子重叠；坐下时退回去
      if (m.walk >= 1 && m.seated && this.standOf.has(m.index)) {
        m.step = damp(m.step ?? 0, m.sitTarget < 0.5 ? 1 : 0, 6, dt);
        const d = STAND_STEP * m.step;
        m.pos.set(m.seat.x + Math.sin(m.yaw) * d, m.seat.y, m.seat.z + Math.cos(m.yaw) * d);
      }

      // 弦乐：从声部的弓法里取自己的弓段位置（每人差一点点时间和弓长），左手换把、揉弦、按指
      const sec = this.bowing[m.section];
      if (sec) {
        this.#traits(m);
        sec.sample(m, (m.bowNow ??= {}));
        m.velLag = damp(m.velLag ?? 0, m.bowNow.vel, 9, dt); // 手腕比弓慢半拍：换弓时手指先"甩"过去
        updateLeftHand(m, sec, dt, t, bowing && m.raise > 0.5);
      }
      // 身体随乐句起伏：同一段音乐大家一起呼吸（8 拍一个来回），每人相位、幅度略有不同
      const phrase = Math.sin((this.beat / 8) * Math.PI * 2 + m.phase * 0.3);
      const sway = playing ? phrase * (0.02 + 0.06 * intensity) * m.amp * m.depth : 0;
      m.lean = damp(m.lean, sway + (m.section === 'choir' ? 0 : 0.1 * m.raise * m.sit), 3, dt);
      m.phrase = phrase;
      updateGlance(m, dt, playing && m.raise > 0.5, this.rand);

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
      // 走路的步伐相位由上台的时间表按走过的距离推进（walkOn）
      // 真实模型的上身动作捕捉（坐着的人用坐姿动作，站着的用站姿动作）
      // 演奏时（raise）收掉大部分待机动作：待机坐姿是放松的弯腰驼背，乐手演奏时坐得直，只留一成多的活气
      m.keepUpper = m.rig.animate && m.rig.animate(dt) && (m.seated ? m.sit > 0.6 : m.sit < 0.4) ? 1 - 0.85 * m.raise : 0;
      // 后排（实例化、离得远）隔帧更新姿态，省一半 CPU；走路时每帧都更新
      const walking = m.walk > 0 && m.walk < 1;
      if ((!m.front || m.halfRate) && !walking && (m.index + this.frame) % 2 === 1 && m.posed) continue;
      m.posed = true;
      this.#poseMusician(m, t, perf);
      this.#placeInstrument(m, t, perf);
      // 程序化人群（没有演员表时）直接读骨骼的世界矩阵，IK 不再逐次刷新整棵骨骼树，这里统一刷新一次
      if (!m.front) m.rig.root.updateMatrixWorld(true);
    }
    // 烘焙姿势里没人用的那一套整个隐藏：否则每个后排的人每种姿势都要画一遍（缩成一点也照样处理全部顶点）
    for (const p of bakedPoses) for (const mesh of p.meshes) mesh.visible = p.used;
    this.crowd?.update();
    this.#writePages();
    for (const p of Object.values(this.parts)) p.instanceMatrix.needsUpdate = true;
  }

  #poseMusician(m, t, perf) {
    const rig = m.rig;
    const walking = m.walk > 0 && m.walk < 1;
    const yaw = m.facing ?? m.yaw; // 走路时朝着前进方向（walkOn 写入）
    rig.root.position.copy(m.pos);
    rig.root.rotation.set(0, yaw, 0);
    const choir = m.section === 'choir';
    const small = BOWED_SMALL.includes(m.section);
    const low = m.section === 'cello' || m.section === 'bass';
    const k = perf.playing ? perf.intensity : 0;
    const raise = m.raise;
    const glance = m.glance ?? 0;
    const body = {
      sit: m.sit,
      seat: m.seatHeight,
      lean: m.lean,
      bow: m.bow,
      headYaw: m.headYaw,
      headPitch: 0.12 * raise,
      walk: walking ? m.stride ?? 1 : 0,
      phase: m.walkPhase,
      breathe: t * 1.1 + m.phase,
      breatheAmp: 0.01,
      keepUpper: m.keepUpper,
    };
    if (small) {
      // 小提琴、中提琴：头歪向左边夹住琴；上身随弓微微转动（拉到弓尖时转向右边）、随乐句左右晃；
      // 偶尔抬眼看指挥（琴夹在下巴下，头只能动一点）
      const u = m.bowNow?.u ?? 0.5;
      body.twist = -0.07 * (u - 0.5) * raise * m.sit;
      body.roll = 0.035 * (m.phrase ?? 0) * k * m.amp * raise;
      body.headYaw += 0.25 * raise * (1 - 0.3 * glance);
      body.headPitch = (0.14 - 0.08 * glance) * raise;
      body.headRoll = -0.25 * raise;
    } else if (low) {
      // 大提琴、低音提琴：两膝分开夹琴，身体向琴靠，头稍微偏右从琴颈旁边看谱和指挥
      body.spread = (m.section === 'cello' ? 0.13 : 0.1) * raise;
      body.lean += 0.06 * raise * m.sit;
      body.twist = 0.05 * ((m.bowNow?.u ?? 0.5) - 0.5) * raise * m.sit;
      body.roll = 0.03 * (m.phrase ?? 0) * k * m.amp * raise;
      body.headYaw += -0.14 * raise * (1 - glance);
      body.headPitch = (0.14 - 0.14 * glance) * raise;
    } else if (choir) {
      // 合唱：低头看谱，每句开头快速吸气（胸口抬起、肩膀微耸），然后慢慢呼出；偶尔抬头看指挥
      const full = Math.atan2(PODIUM.x - m.seat.x, PODIUM.z + 0.4 - m.seat.z);
      const singing = perf.playing && raise > 0.5;
      const b = (((this.beat + m.phase * 0.05) / 4) % 1 + 1) % 1;
      const breath = singing ? (b < 0.14 ? smoothstep(0, 0.14, b) : 1 - smoothstep(0.14, 1, b)) : 0.5 + 0.5 * Math.sin(t * 1.4 + m.phase);
      body.breathe = Math.PI / 2;
      body.breatheAmp = -(singing ? 0.035 + 0.025 * k : 0.012) * breath;
      body.shrug = (singing ? 0.05 : 0.015) * breath;
      body.headPitch = (0.28 - 0.26 * glance) * raise;
      body.headYaw += (full - m.yaw) * glance;
      body.roll = 0.02 * (m.phrase ?? 0) * k * m.amp;
    } else if (m.section === 'timpani') {
      // 定音鼓：看着鼓面，打得越重身体越往前压
      body.lean += this.timpaniPart.lean * raise;
      body.headPitch = (0.32 - 0.2 * glance) * raise;
    } else if (m.section === 'organ') {
      // 管风琴：身体前倾看谱，脚在踏板上踩低音
      body.lean += 0.18;
      body.headPitch = 0.1 + 0.08 * raise;
      body.feet = this.organPart.feet;
      body.roll = 0.03 * (m.phrase ?? 0) * k;
    }
    poseBody(rig, body);
  }

  /** 每位弦乐手的个人习惯：比声部慢多少、弓用得长短、把位和揉弦的差异 */
  #traits(m) {
    if (m.bowLag !== undefined) return;
    const r = this.rand;
    m.bowLag = range(r, -0.035, 0.035);
    m.bowReach = range(r, 0.88, 1.1);
    m.posBias = range(r, -0.06, 0.06);
    m.vibRate = range(r, 5.2, 6.6);
    m.vibAmp = range(r, 0.7, 1.15);
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
    const rig = m.rig;
    const { m: M, m2, m3, v, v2, v3, v4 } = this.tmp;
    const A = (this.tmpAxes ??= {
      ax: new THREE.Vector3(), ay: new THREE.Vector3(), az: new THREE.Vector3(),
      bx: new THREE.Vector3(), by: new THREE.Vector3(), bz: new THREE.Vector3(),
      d: new THREE.Vector3(), n: new THREE.Vector3(), f: new THREE.Vector3(), p: new THREE.Vector3(),
      q: new THREE.Quaternion(), bowRest: new THREE.Matrix4(), bow: new THREE.Matrix4(),
    });
    const root = rig.root.matrixWorld;
    const toW = (local, out) => out.multiplyMatrices(root, local);
    const col = (mat, i, out) => out.setFromMatrixColumn(mat, i).normalize();
    const local = (x, y, z, out) => out.set(x, y, z).applyQuaternion(rig.root.quaternion);

    if (STRINGS.includes(m.section)) {
      const small = BOWED_SMALL.includes(m.section);
      const bass = m.section === 'bass';
      const viola = m.section === 'viola';
      // —— 琴 ——
      if (small) {
        blend(m2, POSES.violinStanding, POSES.violinSeated, m.sit);
        toW(m2, m3);
        M.multiplyMatrices(this.#holdFrame(rig, 0.45), POSES.violinPlay);
        blend(M, m3, M, m.raise);
        if (viola) M.scale(v.setScalar(1.12));
      } else {
        blend(m2, bass ? POSES.bassStanding : POSES.celloStanding, bass ? POSES.bassPlay : POSES.celloPlay, m.sit);
        toW(m2, M);
        if (bass) M.scale(v.setScalar(BASS_SCALE));
      }
      write(small ? 'violin' : 'cello', small ? m.slot.violin : m.slot.cello, M);
      const scaleK = small ? (viola ? 1.12 : 1) : bass ? BASS_SCALE : 1;
      // 小提琴几何体里的点 → 这件乐器的世界坐标（大提琴、低音提琴的几何体是小提琴按 CELLO_SCALE 放大的）
      const S = small ? null : CELLO_SCALE;
      const inst = (x, y, z, out) => (S ? out.set(x * S.x, y * S.y, z * S.z) : out.set(x, y, z)).applyMatrix4(M);
      const ax = col(M, 0, A.ax);
      const ay = col(M, 1, A.ay);
      const k = perf.playing ? perf.intensity : 0.35;
      const b = m.bowNow ?? REST_BOW;
      const L = m.left ?? REST_LEFT;
      const sigma = this.bowing[m.section].string; // 正在拉哪根弦（0 最高 ~ 3 最低，换弦时是小数）

      // —— 弓 ——
      // 接触点：琴马和指板之间（越强越靠近琴马），横向落在正在拉的那根弦上。
      // 小提琴最低的弦在几何体 +x 一侧（演奏者左边）；大提琴面板朝前，最低的 C 弦在 −x 一侧（也是演奏者左边）
      const sx = small ? 1 : -1;
      const contact = inst(sx * STRING_X * (sigma / 1.5 - 1), STRING_TOP, 0.2 + lerp(0.042, 0.02, k), v3);
      // 弓垂直于琴弦；换弦就是绕琴的长轴转：拉低音弦时弓尖一侧放低、弓根（右手）抬高
      const th = (sigma - 1.5) * 0.17;
      const d = A.d.copy(ax).multiplyScalar(sx * Math.cos(th)).addScaledVector(ay, -Math.sin(th));
      const n = A.n.copy(ay).multiplyScalar(Math.cos(th)).addScaledVector(ax, sx * Math.sin(th));
      const along = lerp(0.06, 0.7, b.u); // 接触点离弓根多远
      const bowPlay = A.bow.makeBasis(v.crossVectors(n, d).normalize(), n, d)
        .setPosition(v4.copy(contact).addScaledVector(d, -along).addScaledVector(n, -BOW.hairY));
      blend(m3, POSES.bowStanding, POSES.bowSeated, m.sit);
      toW(m3, A.bowRest);
      const bowM = blend(m2, A.bowRest, bowPlay, m.raise);
      write('bow', m.slot.bow, bowM);

      // —— 左手 ——
      // 掌心贴着琴颈侧面，手指朝面板方向伸出、再弯过指板按弦；换把时沿琴颈滑动，长音时前后揉弦
      const neckZ = lerp(NECK_Z[0], NECK_Z[1], L.pos) + L.vib * (small ? VIBRATO.violin : VIBRATO.cello) * m.raise;
      const neckW = inst(0, 0.03, neckZ, v);
      const neckSide = small ? 0.028 : 0.045;
      const leftCenter = neckW.addScaledVector(ax, -neckSide * scaleK).addScaledVector(ay, -0.035 * scaleK).clone();
      const leftPole = small
        ? toWorld(rig, 0.18, lerp(1.15, 0.72, m.sit), lerp(0, 0.35, m.raise), v2) // 左肘在琴下方、胸前
        : toWorld(rig, 0.7, lerp(1.4, 1.02, m.sit), 0.05, v2); // 大提琴：左肘向外抬起
      gripArm(rig, 'Left', leftCenter, ay, ax, leftPole.clone(), { ...GRIP.neck, fingers: L.fingers });

      // —— 右手 ——
      // 掌心朝下搭在弓根上方，手指绕过弓杆。靠近弓根时手腕高、手指更竖，拉到弓尖时手腕放平；
      // 换弓的瞬间手腕比弓慢半拍，手指先被带着倒向另一边（velLag）
      const bx = col(bowM, 0, A.bx);
      const by = col(bowM, 1, A.by);
      const bz = col(bowM, 2, A.bz);
      const frog = v4.setFromMatrixPosition(bowM);
      const rightCenter = frog.addScaledVector(by, 0.032).addScaledVector(bx, 0.018).addScaledVector(bz, 0.03).clone();
      const beta = lerp(0.95, 0.45, b.u);
      const fingers = A.f.copy(bx).multiplyScalar(-Math.cos(beta)).addScaledVector(by, -Math.sin(beta));
      const palm = A.p.copy(bx).multiplyScalar(Math.sin(beta)).addScaledVector(by, -Math.cos(beta));
      const lag = A.q.setFromAxisAngle(by, 0.32 * THREE.MathUtils.clamp((m.velLag ?? 0) / 1.2, -1, 1) * m.raise);
      fingers.applyQuaternion(lag);
      palm.applyQuaternion(lag);
      const rightPole = small
        ? toWorld(rig, -0.72, lerp(1.25, 0.84, m.sit), -0.22, v2) // 右肘在身体右后方、略低于手
        : toWorld(rig, -0.78, lerp(1.2, 0.8, m.sit), -0.02, v2); // 大提琴：右肘在身体右侧、和手差不多高
      gripArm(rig, 'Right', rightCenter, fingers, palm, rightPole.clone(), GRIP.bow);
      return;
    }

    if (m.section === 'choir') {
      // 谱夹在胸腔坐标里（随呼吸、前倾一起动），放下时拿在身侧
      M.multiplyMatrices(this.#holdFrame(rig, 0.6), POSES.folderUp);
      toW(POSES.folderDown, m3);
      blend(m2, m3, M, m.raise);
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
      const part = this.timpaniPart;
      const up = v4.set(0, 1, 0);
      const rootPos = v.setFromMatrixPosition(root).clone();
      for (const hand of [0, 1]) {
        const sx = hand ? 1 : -1;
        const state = part.hands[hand];
        const drum = this.drumHeads[state.drum];
        // 击打点：离鼓手最近的鼓圈往里约 9 厘米
        const toDrum = A.d.subVectors(drum.world, rootPos).setY(0).normalize();
        const head = A.n.copy(drum.world).addScaledVector(toDrum, -(drum.r - 0.09)).addScaledVector(up, 0.028 + state.h);
        // 槌杆的俯仰跟着槌头高度走：贴近鼓面时槌头朝下，抬高时手腕翘起、槌头朝上（手腕和前臂一起发力）
        const pitch = lerp(-0.26, 0.6, smoothstep(0.05, 0.42, state.h));
        const dir = A.f.copy(toDrum).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
        // 放下时：槌垂在身体两侧
        const restGrip = toWorld(rig, sx * 0.2, 0.85, 0.1, v2);
        const restDir = local(0, -1, 0.3, A.p).normalize();
        const origin = v3.copy(head).addScaledVector(dir, -0.37).lerp(restGrip.addScaledVector(restDir, -0.07), 1 - m.raise);
        const z = A.bz.copy(dir).lerp(restDir, 1 - m.raise).normalize();
        const x = A.bx.crossVectors(up, z).normalize();
        const y = A.by.crossVectors(z, x);
        M.makeBasis(x, y, z).setPosition(origin);
        write('mallet', hand, M);
        // 槌杆斜穿过掌心、从虎口伸出去：掌心朝下，手指横着握住槌杆
        const palm = y.clone().negate();
        const fingers = hand ? z.clone().cross(palm) : palm.clone().cross(z);
        const center = origin.clone().addScaledVector(z, 0.07).addScaledVector(y, 0.022);
        gripArm(rig, hand ? 'Left' : 'Right', center, fingers, palm, toWorld(rig, sx * 0.6, 0.9, -0.2).clone(), GRIP.mallet);
      }
      return;
    }

    if (m.section === 'organ') {
      // 双手在某一层键盘上按和弦：手掌悬在键上，手指弯成弧形；换和弦时手横移、手腕一沉
      const part = this.organPart;
      const fwd = local(0, -0.3, 1, A.f).normalize();
      const down = local(0, -1, 0.15, A.p).normalize();
      for (const h of part.hands) {
        const sx = h.side === 'Left' ? 1 : -1;
        const tier = h.tier * m.raise;
        const target = toWorld(rig,
          lerp(sx * 0.15, h.x, m.raise),
          lerp(0.62, 0.825 + tier * 0.1 - h.press * 0.012, m.raise),
          lerp(0.3, 0.44 + tier * 0.088, m.raise), v).clone();
        gripArm(rig, h.side, target, fwd, down, toWorld(rig, sx * 0.5, 0.7, -0.2).clone(), { ...GRIP.keys, fingers: h.fingers });
      }
    }
  }

  /**
   * 手持乐器（小提琴、谱夹）用的坐标系：原点跟着胸口（脖子根部）走，朝向只跟上身转动的一部分（follow），
   * 其余保持角色本身的朝向。上身前倾、随乐句晃动时琴头不会跟着一起栽下去。
   */
  #holdFrame(rig, follow) {
    const f = chestFrame(rig, this.tmp.chest);
    const h = (this.tmpHold ??= { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() });
    f.decompose(h.p, h.q, h.s);
    h.q.slerp(rig.root.quaternion, 1 - follow);
    return f.compose(h.p, h.q, h.s);
  }

  #updateDrums(dt, perf) {
    this.timpaniPart.update(dt, perf, this.beat, this.prevBeat);
    for (const d of this.drumHeads) {
      d.flash = damp(d.flash, 0, 6, dt);
      d.wobble = damp(d.wobble, 0, 5, dt);
      d.mesh.material.emissiveIntensity = d.flash * 0.5;
      d.mesh.position.y = 0.005 + Math.sin(this.time * 90) * d.wobble * 0.006;
    }
  }

  /** 槌头触鼓：鼓皮震动；只有 cue 表的重击才闪光、震镜头 */
  #drumContact(drum, strength, heavy) {
    const d = this.drumHeads[drum];
    d.wobble = Math.max(d.wobble, heavy ? strength : strength * 0.35);
    if (heavy) {
      d.flash = Math.max(d.flash, strength);
      this.onDrumImpact?.(strength);
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
