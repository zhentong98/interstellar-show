// 池座观众：座椅 + 上半身、脖子、头和各式发型（与乐手共用同一套人体部件几何体）。
// 相邻两排错开半个座位，所以第 8 排正中的视线从前排两个人之间穿过。
//
// - 观众席灯光按排控制每个人的亮度（"逐排熄灭"），灯暗后只剩被巨幕和舞台照出的后脑勺剪影
// - 靠近镜头的几排偶尔有人低头看节目单、侧身和邻座说话
// - 终场时观众陆续起立鼓掌

import * as THREE from 'three';
import { damp, seededRandom, range } from '../core/math.js';
import { SEATING, VIEW_ROW, STAND_LIFT, rowZ, rowFloorY } from './layout.js';
import { Rig } from './humans/rig.js';
import { poseBody } from './humans/pose.js';
import { createLook, bodyParts, bustGeometry, bodyMaterial } from './humans/body.js';

const CLOTHES = [0x141414, 0x1b1d24, 0x2e241d, 0x3a3a40, 0x4a2a2e, 0x23302f, 0x5a5048, 0x6b1f24, 0x1f2a44];
const SEAT = 0x5a1018;

export class Audience {
  /** @param {import('./houseLights.js').HouseLights} house */
  constructor(house) {
    this.house = house;
    this.group = new THREE.Group();
    this.group.name = '观众';
    this.rand = seededRandom(7);
    this.time = 0;
    this.people = [];
    this.seats = [];
    this.#template();
    this.#layout();
    this.#build();
    this.lastLevels = new Float32Array(SEATING.rows + 1).fill(-1);
    this.nextFidget = 2;
  }

  /** 用一副坐着的骨骼求出胸、脖子、头相对座位的矩阵，所有观众共用 */
  #template() {
    const rig = new Rig(1);
    poseBody(rig, { sit: 1 });
    // aimBone 不再逐根刷新世界矩阵，直接读 matrixWorld 之前要先整体刷新一次，否则拿到的是站立的静止姿态
    rig.root.updateMatrixWorld(true);
    this.tpl = {};
    for (const name of ['Spine2', 'Neck', 'Head']) this.tpl[name] = rig.bones[name].matrixWorld.clone();
  }

  #layout() {
    const r = this.rand;
    const { rows, seatPitch, halfWidth, aisles, aisleWidth } = SEATING;
    for (let row = 1; row <= rows; row++) {
      const offset = row % 2 === VIEW_ROW % 2 ? 0 : seatPitch / 2;
      const n = Math.floor(halfWidth / seatPitch);
      for (let k = -n; k <= n; k++) {
        const x = k * seatPitch + offset;
        if (Math.abs(x) > halfWidth) continue;
        if (aisles.some((a) => Math.abs(x - a) < aisleWidth / 2 + 0.2)) continue;
        const seat = { row, x, z: rowZ(row), floor: rowFloorY(row) };
        this.seats.push(seat);
        const isViewer = row === VIEW_ROW && Math.abs(x) < 0.01;
        const fill = Math.abs(x) < 5 && row < VIEW_ROW ? 0.97 : 0.86;
        if (isViewer || r() > fill) continue;
        const look = createLook(r);
        this.people.push({
          ...seat,
          look,
          clothes: new THREE.Color(CLOTHES[Math.floor(r() * CLOTHES.length)]),
          stand: 0,
          standAt: Infinity,
          headPitch: 0,
          headYaw: 0,
          roll: 0,
          fidget: null,
          phase: r() * Math.PI * 2,
          lean: range(r, -0.04, 0.04),
        });
      }
    }
  }

  #build() {
    const make = (geo, count) => {
      const mesh = new THREE.InstancedMesh(geo, bodyMaterial, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    // 按部件分组：上半身、脖子、头、各种发型
    const groups = new Map();
    const add = (key, geo, bone, person, tint) => {
      if (!groups.has(key)) groups.set(key, { geo, items: [] });
      groups.get(key).items.push({ person, bone, tint });
    };
    for (const p of this.people) {
      add('bust', bustGeometry(), 'Spine2', p, 'clothes');
      for (const part of bodyParts(p.look)) {
        if (part.bone === 'Neck' && part.key === 'neck') add('neck', part.geo, 'Neck', p, 'skin');
        if (part.bone === 'Head') add(part.key, part.geo, 'Head', p, part.tint);
      }
    }
    this.parts = [...groups.values()].map((g) => ({ ...g, mesh: make(g.geo, g.items.length) }));

    // 座椅：靠背 + 坐垫，静态
    const seatGeo = new THREE.BoxGeometry(0.5, 0.56, 0.08).translate(0, 0.68, 0.3);
    const cushion = new THREE.BoxGeometry(0.48, 0.1, 0.44).translate(0, 0.43, 0.06);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    this.seatBacks = new THREE.InstancedMesh(seatGeo, seatMat, this.seats.length);
    this.cushions = new THREE.InstancedMesh(cushion, seatMat, this.seats.length);
    const m = new THREE.Matrix4();
    this.seats.forEach((s, i) => {
      m.makeTranslation(s.x, s.floor, s.z);
      this.seatBacks.setMatrixAt(i, m);
      this.cushions.setMatrixAt(i, m);
    });
    this.group.add(this.seatBacks, this.cushions);
    this.tmp = { base: new THREE.Matrix4(), m: new THREE.Matrix4(), r: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() };
  }

  /** 终场：观众陆续起立。前排先站，后排跟上 */
  standUp(stagger) {
    for (const p of this.people) {
      const bias = (p.row - 1) / SEATING.rows;
      p.standAt = this.time + stagger * (0.15 + 0.6 * bias + 0.4 * this.rand());
    }
    this.clapping = true;
  }

  sitDown() {
    for (const p of this.people) p.standAt = Infinity;
    this.clapping = false;
  }

  update(dt) {
    this.time += dt;
    this.#maybeFidget();
    const t = this.time;
    const { base, m, r, q, e, v, s } = this.tmp;

    for (const p of this.people) {
      p.stand = damp(p.stand, t >= p.standAt ? 1 : 0, 2.5, dt);
      let pitch = 0;
      let yaw = 0;
      let roll = 0;
      if (p.fidget) {
        const f = p.fidget;
        const k = (t - f.start) / f.duration;
        if (k >= 1) p.fidget = null;
        else {
          const env = Math.sin(Math.PI * Math.min(1, k)) ** 0.5;
          if (f.kind === 'look-down') pitch = 0.5 * env;
          else if (f.kind === 'talk') {
            yaw = f.dir * 0.75 * env;
            roll = f.dir * 0.06 * env;
          } else if (f.kind === 'shift') roll = f.dir * 0.09 * env;
        }
      }
      p.headPitch = damp(p.headPitch, pitch, 4, dt);
      p.headYaw = damp(p.headYaw, yaw, 4, dt);
      p.roll = damp(p.roll, roll, 3, dt);
      // 起立后随掌声轻轻起伏
      const clap = this.clapping && p.stand > 0.5 ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.008 : 0;
      q.setFromAxisAngle(v.set(0, 1, 0), Math.PI); // 面朝舞台（-z）
      base.compose(v.set(p.x, p.floor + p.stand * STAND_LIFT + clap, p.z + 0.05), q, s.setScalar(p.look.scale));
      e.set(p.lean, 0, p.roll);
      r.makeRotationFromEuler(e);
      p.mChest = (p.mChest ?? new THREE.Matrix4()).multiplyMatrices(base, r).multiply(this.tpl.Spine2);
      p.mNeck = (p.mNeck ?? new THREE.Matrix4()).multiplyMatrices(base, r).multiply(this.tpl.Neck);
      e.set(p.headPitch, p.headYaw, p.roll * 1.5);
      p.mHead = (p.mHead ?? new THREE.Matrix4()).multiplyMatrices(base, r).multiply(this.tpl.Head).multiply(m.makeRotationFromEuler(e));
    }
    for (const { mesh, items } of this.parts) {
      items.forEach((it, i) => {
        const p = it.person;
        mesh.setMatrixAt(i, it.bone === 'Spine2' ? p.mChest : it.bone === 'Neck' ? p.mNeck : p.mHead);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.#applyHouseLight();
  }

  #maybeFidget() {
    if (this.time < this.nextFidget) return;
    this.nextFidget = this.time + range(this.rand, 1.2, 3.5);
    const near = this.people.filter((p) => p.row < VIEW_ROW && p.row >= VIEW_ROW - 5 && Math.abs(p.x) < 5 && !p.fidget);
    if (!near.length) return;
    const p = near[Math.floor(this.rand() * near.length)];
    const kinds = ['look-down', 'talk', 'shift'];
    p.fidget = {
      kind: kinds[Math.floor(this.rand() * kinds.length)],
      start: this.time,
      duration: range(this.rand, 1.8, 4.5),
      dir: this.rand() < 0.5 ? -1 : 1,
    };
  }

  /** 按排把观众席灯光的亮度乘到每个人的颜色上 */
  #applyHouseLight() {
    const levels = this.house.levels;
    let changed = false;
    for (let row = 1; row <= SEATING.rows; row++) {
      if (Math.abs(levels[row] - this.lastLevels[row]) > 0.002) {
        changed = true;
        this.lastLevels[row] = levels[row];
      }
    }
    if (!changed) return;
    const c = this.tmp.c;
    const k = (row) => 0.25 + 0.75 * levels[row];
    for (const { mesh, items } of this.parts) {
      items.forEach((it, i) => {
        const p = it.person;
        const base = it.tint === 'clothes' ? p.clothes : it.tint === 'hair' ? p.look.hairColor : p.look.skin;
        mesh.setColorAt(i, c.copy(base).multiplyScalar(k(p.row)));
      });
      mesh.instanceColor.needsUpdate = true;
    }
    const seatColor = new THREE.Color(SEAT);
    this.seats.forEach((s, i) => {
      c.copy(seatColor).multiplyScalar(k(s.row));
      this.seatBacks.setColorAt(i, c);
      this.cushions.setColorAt(i, c);
    });
    this.seatBacks.instanceColor.needsUpdate = true;
    this.cushions.instanceColor.needsUpdate = true;
  }
}
