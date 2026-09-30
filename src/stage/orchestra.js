// 乐团（里程碑 1：几何体占位）。
//
// 编制：约 40 人弦乐（左侧弧形）、30 人合唱（右后方台阶）、4 架定音鼓（右前方）、
// 管风琴手（中央控制台）。每个乐手是一组简单几何体：躯干、头、两条腿（大腿 + 小腿）、乐器、弓。
// 所有部件都用 InstancedMesh，每帧按乐手状态重算矩阵。
//
// 这里定好的是"布局 + 状态 + 对外接口"，里程碑 2 换成写实的骨骼模型时接口保持不变：
//   walkOn / concertmaster / setTuning / setReady / standUp / bowAll / turnPages / drumHit / update

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, clamp01, lerp, seededRandom, range, smoothstep } from '../core/math.js';
import { STAGE_Y, PODIUM, WINGS, ORGAN_CONSOLE } from './layout.js';

const HIP_STAND = 0.9;
const HIP_SIT = 0.5;
const THIGH = 0.44;
const SHOULDER = 0.58; // 髋到肩
const HEAD = 0.82; // 髋到头中心

const mat = {
  suit: new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.75 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb08468, roughness: 0.65 }),
  spruce: new THREE.MeshStandardMaterial({ color: 0x7a3b16, roughness: 0.35, metalness: 0.05 }),
  bow: new THREE.MeshStandardMaterial({ color: 0xd9cfb8, roughness: 0.5 }),
  folder: new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.55 }),
  chair: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }),
  stand: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9, side: THREE.DoubleSide }),
  copper: new THREE.MeshStandardMaterial({ color: 0xb8733f, metalness: 1, roughness: 0.28 }),
  drumHead: new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.7, emissive: 0xffe0b0, emissiveIntensity: 0 }),
  riser: new THREE.MeshStandardMaterial({ color: 0x1e1712, roughness: 0.7 }),
  console: new THREE.MeshStandardMaterial({ color: 0x3b2413, roughness: 0.4 }),
  keys: new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: 0.4 }),
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
  // 每道弧上的声部分配（从台口往里）
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
      const deg = lerp(arc.from, arc.to, arc.n === 1 ? 0 : i / (arc.n - 1));
      const th = THREE.MathUtils.degToRad(deg);
      const x = PODIUM.x + arc.r * Math.cos(th);
      const z = PODIUM.z - arc.r * Math.sin(th);
      seats.push({ section: plan[i], x, z, arc: a });
    }
  });
  return seats;
}

/** 合唱：右后方三层台阶，每层 10 人 */
function choirSpots() {
  const spots = [];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 10; i++) {
      spots.push({
        section: 'choir',
        x: 3.3 + i * 0.74 + (row % 2) * 0.37,
        z: -8.0 - row * 1.0,
        elevation: 0.3 * (row + 1),
        row,
      });
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

// ——— 乐手 ———

export class Orchestra {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '乐团';
    this.rand = seededRandom(42);
    this.time = 0;
    this.onDrumImpact = null;

    this.musicians = this.#createMusicians();
    this.#buildProps();
    this.#buildInstances();
  }

  #createMusicians() {
    const r = this.rand;
    const list = [];
    const faceConductor = (x, z) => Math.atan2(PODIUM.x - x, PODIUM.z + 0.4 - z);
    const base = (spec) => ({
      ...spec,
      elevation: spec.elevation ?? 0,
      walk: 0, // 0 = 还在侧台，1 = 到位
      present: false,
      pos: new THREE.Vector3(),
      yaw: spec.yaw,
      sit: spec.seated ? 0 : 0,
      sitTarget: 0,
      raise: 0,
      raiseTarget: 0,
      bow: 0,
      bowTarget: 0,
      lean: 0,
      // 个体差异：动作幅度 ±15%、节奏快慢、相位
      amp: range(r, 0.85, 1.15),
      rate: range(r, 0.85, 1.15),
      phase: r() * Math.PI * 2,
      stroke: 0,
      strokePhase: r() * 2,
      headTurn: 0,
      pageTurn: -1,
      hasMusic: false,
    });

    for (const s of stringSeats()) {
      list.push(base({
        ...s,
        seated: true,
        seat: new THREE.Vector3(s.x, STAGE_Y, s.z),
        yaw: faceConductor(s.x, s.z),
        entry: WINGS.left,
        depth: 1 - s.arc * 0.12, // 后排动作更小
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
      }));
    }
    list.push(base({
      section: 'timpani',
      seated: false,
      seat: TIMPANIST.clone(),
      yaw: TIMPANI_FACING,
      entry: WINGS.right,
      depth: 1,
    }));
    // 管风琴控制台侧向摆放：琴手面朝舞台左侧，观众看到侧面和亮着的琴键
    list.push(base({
      section: 'organ',
      seated: true,
      seat: new THREE.Vector3(ORGAN_CONSOLE.x + 0.95, STAGE_Y, ORGAN_CONSOLE.z),
      yaw: -Math.PI / 2,
      entry: WINGS.right,
      depth: 1,
    }));

    list.forEach((m, i) => {
      m.index = i;
      m.pos.copy(m.entry);
    });
    // 首席小提琴：第一道弧最靠台口的那位
    this.concertmasterIndex = list.findIndex((m) => m.section === 'violin1');
    this.timpanist = list.find((m) => m.section === 'timpani');
    this.timpanist.hits = [];
    return list;
  }

  /** 椅子、谱架、合唱台阶、定音鼓、管风琴控制台 */
  #buildProps() {
    const seated = this.musicians.filter((m) => m.seated && m.section !== 'organ');
    const chairGeo = mergeGeometries([
      new THREE.BoxGeometry(0.44, 0.05, 0.42).translate(0, 0.46, 0),
      new THREE.BoxGeometry(0.42, 0.45, 0.04).translate(0, 0.7, -0.2),
      new THREE.BoxGeometry(0.04, 0.46, 0.04).translate(-0.19, 0.23, 0.17),
      new THREE.BoxGeometry(0.04, 0.46, 0.04).translate(0.19, 0.23, 0.17),
      new THREE.BoxGeometry(0.04, 0.46, 0.04).translate(-0.19, 0.23, -0.17),
      new THREE.BoxGeometry(0.04, 0.46, 0.04).translate(0.19, 0.23, -0.17),
    ]);
    const standGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.012, 0.012, 1.0, 6).translate(0, 0.5, 0),
      new THREE.BoxGeometry(0.5, 0.34, 0.02).rotateX(-0.45).translate(0, 1.08, 0.02),
    ]);
    // 两人共用一个谱架：给每位乐手一个，放在身前
    const chairs = new THREE.InstancedMesh(chairGeo, mat.chair, seated.length);
    const stands = new THREE.InstancedMesh(standGeo, mat.stand, seated.length);
    this.sheets = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.29), mat.paper, seated.length);
    this.pages = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.21, 0.29).translate(0.105, 0, 0), mat.paper, seated.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    this.standOf = new Map();
    seated.forEach((m, i) => {
      q.setFromAxisAngle(up, m.yaw);
      m4.compose(m.seat, q, new THREE.Vector3(1, 1, 1));
      chairs.setMatrixAt(i, m4);
      const fwd = new THREE.Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw));
      const standPos = m.seat.clone().addScaledVector(fwd, m.section === 'cello' || m.section === 'bass' ? 1.05 : 0.8);
      m4.compose(standPos, q, new THREE.Vector3(1, 1, 1));
      stands.setMatrixAt(i, m4);
      this.standOf.set(m.index, { i, pos: standPos, quat: q.clone() });
    });
    chairs.instanceMatrix.needsUpdate = true;
    stands.instanceMatrix.needsUpdate = true;
    this.group.add(chairs, stands, this.sheets, this.pages);

    // 合唱台阶
    const risers = [];
    for (let row = 0; row < 3; row++) {
      const h = 0.3 * (row + 1);
      risers.push(new THREE.BoxGeometry(8.2, h, 1.0).translate(6.8, STAGE_Y + h / 2, -8.0 - row * 1.0));
    }
    const riserMesh = new THREE.Mesh(mergeGeometries(risers), mat.riser);
    this.group.add(riserMesh);

    // 定音鼓：铜鼓身 + 鼓皮 + 三脚支架
    this.drumHeads = [];
    const kettle = new THREE.LatheGeometry(
      Array.from({ length: 12 }, (_, i) => {
        const k = i / 11;
        return new THREE.Vector2(Math.sin(k * Math.PI * 0.5) * 1.0 + 0.001, -Math.cos(k * Math.PI * 0.5) * 0.85);
      }),
      32,
    );
    for (const d of TIMPANI) {
      const g = new THREE.Group();
      g.position.set(d.x, STAGE_Y + 0.82, d.z);
      const body = new THREE.Mesh(kettle, mat.copper);
      body.scale.setScalar(d.r);
      const head = new THREE.Mesh(new THREE.CircleGeometry(d.r * 1.02, 32).rotateX(-Math.PI / 2), mat.drumHead.clone());
      head.position.y = 0.005;
      const legs = new THREE.Mesh(
        mergeGeometries([0, 1, 2].map((k) => new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5)
          .translate(0, -0.3, 0).rotateZ(0.25)
          .rotateY((k * Math.PI * 2) / 3))),
        mat.stand,
      );
      legs.position.y = -d.r * 0.6;
      g.add(body, head, legs);
      this.group.add(g);
      this.drumHeads.push({ mesh: head, group: g, flash: 0, wobble: 0 });
    }

    // 管风琴控制台：侧向摆放，琴键朝向舞台右侧（琴手坐在右边面朝左）
    const c = ORGAN_CONSOLE;
    const consoleGroup = new THREE.Group();
    consoleGroup.position.set(c.x, STAGE_Y, c.z);
    const cabinet = new THREE.Mesh(
      mergeGeometries([
        new THREE.BoxGeometry(0.9, 1.35, 1.9).translate(-0.2, 0.675, 0),
        new THREE.BoxGeometry(0.5, 0.18, 2.1).translate(-0.15, 1.44, 0),
      ]),
      mat.console,
    );
    const manuals = new THREE.Mesh(
      mergeGeometries([0, 1, 2].map((k) => new THREE.BoxGeometry(0.2, 0.03, 1.5).translate(0.34 - k * 0.1, 0.78 + k * 0.1, 0))),
      mat.keys,
    );
    const pedals = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 1.6).translate(0.45, 0.03, 0), mat.console);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 1.3).translate(0.95, 0.25, 0), mat.console);
    consoleGroup.add(cabinet, manuals, pedals, bench);
    this.group.add(consoleGroup);
  }

  #buildInstances() {
    const n = this.musicians.length;
    const part = (geo, material, count = n) => {
      const mesh = new THREE.InstancedMesh(geo, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    const count = (sections) => this.musicians.filter((m) => sections.includes(m.section)).length;

    this.parts = {
      torso: part(new THREE.CapsuleGeometry(0.17, 0.38, 4, 12).translate(0, 0.36, 0), mat.suit),
      head: part(new THREE.SphereGeometry(0.105, 16, 12).scale(0.9, 1.1, 1), mat.skin),
      thigh: part(new THREE.BoxGeometry(0.14, THIGH, 0.15).translate(0, -THIGH / 2, 0), mat.suit, n * 2),
      shin: part(new THREE.BoxGeometry(0.12, 1, 0.13).translate(0, -0.5, 0), mat.suit, n * 2),
      violin: part(new THREE.BoxGeometry(0.2, 0.06, 0.4), mat.spruce, count(['violin1', 'violin2', 'viola'])),
      cello: part(mergeGeometries([
        new THREE.BoxGeometry(0.42, 0.72, 0.2),
        new THREE.BoxGeometry(0.06, 0.55, 0.06).translate(0, 0.62, 0),
      ]), mat.spruce, count(['cello', 'bass'])),
      bow: part(new THREE.BoxGeometry(0.012, 0.012, 0.7), mat.bow, count(['violin1', 'violin2', 'viola', 'cello', 'bass'])),
      folder: part(new THREE.BoxGeometry(0.3, 0.22, 0.02), mat.folder, count(['choir'])),
      mallet: part(mergeGeometries([
        new THREE.CylinderGeometry(0.008, 0.008, 0.38, 6).translate(0, 0.19, 0),
        new THREE.SphereGeometry(0.03, 8, 6).translate(0, 0.38, 0),
      ]), mat.bow, 2),
    };
    this.tmp = {
      m: new THREE.Matrix4(),
      root: new THREE.Matrix4(),
      hip: new THREE.Matrix4(),
      local: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      v: new THREE.Vector3(),
      s: new THREE.Vector3(),
      zero: new THREE.Matrix4().makeScale(0, 0, 0),
      turn: new THREE.Matrix4(),
    };
  }

  // ——— 对外接口：导演调用 ———

  /**
   * 乐手陆续从侧台走上来就位。spread 秒内依次出发，全部到位后 resolve。
   * 合唱团和弦乐同时从两侧上台；落座后打开谱子。
   */
  walkOn(timeline, { spread, speed }, signal) {
    // 大体上远处的先走（免得后来的人从已经坐下的人身上"穿过去"），再加一点随机
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

  /** 首席小提琴起立 / 坐下 */
  standConcertmaster(standing) {
    this.concertmaster.sitTarget = standing ? 0 : 1;
  }

  /** 调音：大家把乐器架起来，弓子短促地来回 */
  setTuning(on) {
    this.tuning = on;
    for (const m of this.musicians) {
      if (m.section !== 'choir' && m.section !== 'organ' && m.section !== 'timpani') m.raiseTarget = on ? 1 : 0;
    }
  }

  /** 演奏准备：弦乐架琴、合唱举起谱夹、鼓手举槌 */
  setReady(on) {
    for (const m of this.musicians) m.raiseTarget = on ? 1 : 0;
  }

  /** 起立（终场）。sections 为空表示全体 */
  standUp(sections = null) {
    for (const m of this.musicians) {
      if (!sections || sections.includes(m.section)) m.sitTarget = 0;
    }
  }

  /** 全体鞠躬（终场），duration 秒后直起 */
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
    t.hits.push({ start: this.time, at: this.time + Math.max(0.12, lead), strength, hand: t.hits.length % 2, drum: Math.floor(this.rand() * 4) });
  }

  // ——— 每帧 ———

  update(dt, perf) {
    this.time += dt;
    const { intensity, playing } = perf;
    const t = this.time;

    for (const m of this.musicians) {
      m.sit = damp(m.sit, m.sitTarget, 5, dt);
      m.raise = damp(m.raise, m.raiseTarget, 4 * m.rate, dt);
      m.bow = damp(m.bow, m.bowTarget, 4, dt);

      // 演奏动作：弓速随强度变化，缓冲时（playing=false）冻结
      const bowing = m.raise > 0.5 && (playing || this.tuning);
      const k = this.tuning ? 0.35 : intensity * m.depth;
      if (bowing) {
        m.strokePhase += dt * (0.35 + 1.1 * k) * m.rate;
        // 平滑的三角波：匀速拉弓，到头换向
        const x = m.strokePhase % 2;
        const tri = x < 1 ? x * 2 - 1 : 3 - x * 2;
        m.stroke = Math.sin((tri * Math.PI) / 2) * (0.3 + 0.7 * k) * m.amp;
      }
      const sway = playing ? Math.sin(t * (0.6 + intensity) * m.rate + m.phase) * (0.02 + 0.06 * intensity) * m.amp * m.depth : 0;
      m.lean = damp(m.lean, sway + (m.section === 'choir' ? 0 : 0.08 * m.raise), 3, dt);

      // 翻谱动画（0→1）
      if (m.pageTurn >= 0) {
        m.pageTurn += dt * 1.4;
        if (m.pageTurn >= 1) m.pageTurn = -1;
      }
      // 没演奏时偶尔转头
      if (!playing && m.present && this.rand() < dt * 0.05) m.headTarget = range(this.rand, -0.5, 0.5);
      if (playing) m.headTarget = 0;
      m.headTurn = damp(m.headTurn, m.headTarget ?? 0, 2, dt);
    }

    this.#updateDrums(dt);
    this.#writeInstances(t, perf);
  }

  #updateDrums(dt) {
    const tp = this.timpanist;
    tp.malletLift = [0, 0];
    tp.hits = tp.hits.filter((h) => {
      const now = this.time;
      if (now < h.at) {
        // 抬槌：从出发到击打前逐渐举高
        const k = clamp01((now - h.start) / Math.max(0.01, h.at - h.start));
        tp.malletLift[h.hand] = Math.max(tp.malletLift[h.hand], smoothstep(0, 0.6, k) * (1 - smoothstep(0.75, 1, k)) * h.strength);
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
      d.mesh.material.emissiveIntensity = d.flash * 0.6;
      d.mesh.position.y = 0.005 + Math.sin(this.time * 90) * d.wobble * 0.006;
    }
  }

  #writeInstances(t, perf) {
    const { m: M, root, hip, local, e, v, zero } = this.tmp;
    const P = this.parts;
    const idx = { violin: 0, cello: 0, bow: 0, folder: 0 };

    const setPart = (mesh, i, matrix) => mesh.setMatrixAt(i, matrix);

    this.musicians.forEach((m, i) => {
      if (!m.present) {
        for (const p of [P.torso, P.head]) setPart(p, i, zero);
        for (const leg of [0, 1]) {
          setPart(P.thigh, i * 2 + leg, zero);
          setPart(P.shin, i * 2 + leg, zero);
        }
        this.#hideInstrument(m, idx, zero);
        return;
      }
      const walking = m.walk > 0 && m.walk < 1;
      const bob = walking ? Math.abs(Math.sin(t * 7 + m.phase)) * 0.04 : 0;
      // 走路时朝向前进方向
      let yaw = m.yaw;
      if (walking) {
        v.subVectors(m.seat, m.entry);
        yaw = Math.atan2(v.x, v.z);
      }
      root.makeRotationY(yaw).setPosition(m.pos.x, m.pos.y + bob, m.pos.z);

      // 腿：髋部高度随坐/站插值，大腿从竖直转到水平
      const hipY = lerp(HIP_STAND, HIP_SIT, m.sit);
      const sitAngle = -m.sit * Math.PI * 0.5;
      for (const leg of [0, 1]) {
        const swing = walking ? Math.sin(t * 7 + m.phase + leg * Math.PI) * 0.45 : 0;
        const a = sitAngle + swing;
        local.makeRotationX(a).setPosition((leg ? 0.1 : -0.1), hipY, 0);
        M.multiplyMatrices(root, local);
        setPart(P.thigh, i * 2 + leg, M);
        // 膝盖位置
        const kneeY = hipY - THIGH * Math.cos(a);
        const kneeZ = -THIGH * Math.sin(a);
        local.makeScale(1, Math.max(0.01, kneeY), 1).setPosition((leg ? 0.1 : -0.1), kneeY, kneeZ);
        M.multiplyMatrices(root, local);
        setPart(P.shin, i * 2 + leg, M);
      }

      // 躯干：绕髋部前倾（演奏时的身体律动 + 鞠躬）
      const breathe = m.section === 'choir' && perf.playing ? 1 + Math.sin(t * 1.6 + m.phase) * 0.025 * (0.4 + perf.intensity) : 1;
      e.set(m.lean + m.bow * 0.9, 0, 0);
      hip.makeRotationFromEuler(e).setPosition(0, hipY, 0);
      hip.premultiply(root);
      local.makeScale(1, breathe, 1);
      M.multiplyMatrices(hip, local);
      setPart(P.torso, i, M);
      e.set(0.1 * m.raise, m.headTurn, 0);
      local.makeRotationFromEuler(e).setPosition(0, HEAD, 0.02);
      M.multiplyMatrices(hip, local);
      setPart(P.head, i, M);

      this.#writeInstrument(m, idx, hip);
    });

    // 定音鼓槌
    this.#writeMallets();
    this.#writePages();
    for (const p of Object.values(P)) p.instanceMatrix.needsUpdate = true;
  }

  #hideInstrument(m, idx, zero) {
    const P = this.parts;
    switch (m.section) {
      case 'violin1': case 'violin2': case 'viola':
        P.violin.setMatrixAt(idx.violin++, zero);
        P.bow.setMatrixAt(idx.bow++, zero);
        break;
      case 'cello': case 'bass':
        P.cello.setMatrixAt(idx.cello++, zero);
        P.bow.setMatrixAt(idx.bow++, zero);
        break;
      case 'choir':
        P.folder.setMatrixAt(idx.folder++, zero);
        break;
      default:
    }
  }

  /** 乐器姿态：raise=0 放在腿上 / 身侧，raise=1 演奏位置 */
  #writeInstrument(m, idx, hip) {
    const P = this.parts;
    const { m: M, local, q, e, v, s } = this.tmp;
    const k = m.raise;
    const place = (mesh, i, pos, euler, scale = 1) => {
      q.setFromEuler(euler);
      s.setScalar(scale);
      local.compose(pos, q, s);
      M.multiplyMatrices(hip, local);
      mesh.setMatrixAt(i, M);
    };

    switch (m.section) {
      case 'violin1':
      case 'violin2':
      case 'viola': {
        // 角色面朝 +z，左手在 +x、右手在 -x
        const scale = m.section === 'viola' ? 1.12 : 1;
        // 放下：竖在左腿上；架起：夹在左肩，琴身指向左前方（偏航 0.65）
        v.set(lerp(0.12, 0.1, k), lerp(0.2, SHOULDER - 0.02, k), lerp(0.28, 0.22, k));
        e.set(lerp(-1.3, 0.25, k), lerp(0, 0.65, k), lerp(0, -0.45, k));
        place(P.violin, idx.violin++, v, e, scale);
        // 弓：架起时垂直于琴身、压在琴马附近，沿自身方向来回
        const along = 0.1 + m.stroke * 0.25;
        v.set(lerp(-0.2, 0.13 - 0.8 * along, k), lerp(0.25, SHOULDER, k), lerp(0.2, 0.26 + 0.6 * along, k));
        e.set(lerp(-1.4, 0.1, k), lerp(0, 0.65 - Math.PI / 2, k), 0);
        place(P.bow, idx.bow++, v, e);
        break;
      }
      case 'cello':
      case 'bass': {
        const big = m.section === 'bass' ? 1.35 : 1;
        v.set(0, 0.1 * big, 0.42);
        e.set(-0.18, 0, 0);
        // 大提琴相对髋部：髋部坐着时 0.5 高，琴身中心在 0.55 左右
        place(P.cello, idx.cello++, v, e, big);
        v.set(lerp(-0.3, m.stroke * 0.25, k), lerp(-0.1, 0.02 * big, k), lerp(0.2, 0.55, k));
        e.set(lerp(-1.4, 0.05, k), lerp(0, Math.PI / 2, k), 0);
        place(P.bow, idx.bow++, v, e);
        break;
      }
      case 'choir': {
        v.set(lerp(0.24, 0, k), lerp(0.05, SHOULDER - 0.22, k), lerp(0.02, 0.3, k));
        e.set(lerp(0, -0.55, k), 0, 0);
        place(P.folder, idx.folder++, v, e);
        break;
      }
      default:
    }
  }

  #writeMallets() {
    const tp = this.timpanist;
    const { m: M, root, local, e, q, v, s, zero } = this.tmp;
    if (!tp.present) {
      this.parts.mallet.setMatrixAt(0, zero);
      this.parts.mallet.setMatrixAt(1, zero);
      return;
    }
    root.makeRotationY(tp.yaw).setPosition(tp.pos.x, tp.pos.y, tp.pos.z);
    for (const hand of [0, 1]) {
      const lift = tp.malletLift?.[hand] ?? 0;
      const ready = tp.raise;
      // 槌头朝前下方，落在鼓皮上；lift 把槌举起来
      v.set(hand ? 0.22 : -0.22, lerp(0.85, 1.02 + lift * 0.25, ready), lerp(0.1, 0.42, ready));
      e.set(lerp(0.2, 1.95 - lift * 1.5, ready), 0, hand ? -0.2 : 0.2);
      q.setFromEuler(e);
      local.compose(v, q, s.setScalar(1));
      M.multiplyMatrices(root, local);
      this.parts.mallet.setMatrixAt(hand, M);
    }
  }

  /** 谱架上的乐谱：落座后出现；翻谱时一页纸绕书脊转过去 */
  #writePages() {
    const { m: M, local, q, e, v, s, zero } = this.tmp;
    for (const m of this.musicians) {
      const stand = this.standOf.get(m.index);
      if (!stand) continue;
      if (!m.hasMusic) {
        this.sheets.setMatrixAt(stand.i, zero);
        this.pages.setMatrixAt(stand.i, zero);
        continue;
      }
      local.compose(stand.pos, stand.quat, s.setScalar(1));
      M.makeRotationX(-0.45).setPosition(0, 1.085, 0.035);
      M.premultiply(local);
      this.sheets.setMatrixAt(stand.i, M);
      if (m.pageTurn >= 0) {
        e.set(-0.45, 0, 0);
        q.setFromEuler(e);
        const lift = Math.sin(m.pageTurn * Math.PI) * 0.12;
        M.compose(v.set(0, 1.085, 0.05 + lift * 0.3), q, s.setScalar(1));
        M.multiply(this.tmp.turn.makeRotationY(-m.pageTurn * Math.PI)).premultiply(local);
        this.pages.setMatrixAt(stand.i, M);
      } else {
        this.pages.setMatrixAt(stand.i, zero);
      }
    }
    this.sheets.instanceMatrix.needsUpdate = true;
    this.pages.instanceMatrix.needsUpdate = true;
  }
}
