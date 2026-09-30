// 池座观众（里程碑 1：几何体占位）：座椅靠背 + 肩膀 + 头。
// 相邻两排错开半个座位，所以第 8 排正中的视线从前排两个人之间穿过。
//
// - 观众席灯光按排控制每个人的亮度（"逐排熄灭"），灯暗后只剩被巨幕和舞台照出的剪影
// - 靠近镜头的几排偶尔有人低头看节目单、侧身和邻座说话
// - 终场时观众陆续起立

import * as THREE from 'three';
import { damp, seededRandom, range } from '../core/math.js';
import { SEATING, VIEW_ROW, rowZ, rowFloorY } from './layout.js';

const HAIR = [0x17120f, 0x241a14, 0x35261b, 0x4d3d30, 0x7d766e, 0x8f6f45, 0x0f0f10];
const CLOTHES = [0x141414, 0x1b1d24, 0x2a211b, 0x34343a, 0x3b2427, 0x23282a];
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
    this.#layout();
    this.#build();
    this.lastLevels = new Float32Array(SEATING.rows + 1).fill(-1);
    this.nextFidget = 2;
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
        // 靠近视线的前几排坐得更满，后排和边上偶有空位
        const fill = Math.abs(x) < 5 && row < VIEW_ROW ? 0.97 : 0.86;
        if (isViewer || r() > fill) continue;
        this.people.push({
          ...seat,
          scale: range(r, 0.92, 1.08),
          hair: new THREE.Color(HAIR[Math.floor(r() * HAIR.length)]),
          clothes: new THREE.Color(CLOTHES[Math.floor(r() * CLOTHES.length)]),
          skin: new THREE.Color().setHSL(range(r, 0.05, 0.08), range(r, 0.3, 0.45), range(r, 0.25, 0.55)),
          bald: r() < 0.08,
          stand: 0,
          standAt: Infinity,
          headPitch: 0,
          headYaw: 0,
          roll: 0,
          fidget: null,
          phase: r() * Math.PI * 2,
        });
      }
    }
  }

  #build() {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const make = (geo, count) => {
      const mesh = new THREE.InstancedMesh(geo, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    const n = this.people.length;
    this.heads = make(new THREE.SphereGeometry(1, 16, 12), n);
    this.shoulders = make(new THREE.SphereGeometry(1, 14, 10), n);
    this.torsos = make(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), n);

    // 座椅：靠背 + 坐垫，静态
    const seatGeo = new THREE.BoxGeometry(0.5, 0.56, 0.08).translate(0, 0.68, 0.3);
    const cushion = new THREE.BoxGeometry(0.48, 0.1, 0.44).translate(0, 0.43, 0.06);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    this.seatBacks = new THREE.InstancedMesh(seatGeo, seatMat, this.seats.length);
    this.cushions = new THREE.InstancedMesh(cushion, seatMat, this.seats.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color(SEAT);
    this.seats.forEach((s, i) => {
      m.makeTranslation(s.x, s.floor, s.z);
      this.seatBacks.setMatrixAt(i, m);
      this.cushions.setMatrixAt(i, m);
      this.seatBacks.setColorAt(i, c);
      this.cushions.setColorAt(i, c);
    });
    this.group.add(this.seatBacks, this.cushions);

    this.people.forEach((p, i) => {
      this.heads.setColorAt(i, p.bald ? p.skin : p.hair);
      this.shoulders.setColorAt(i, p.clothes);
      this.torsos.setColorAt(i, p.clothes);
    });
    this.tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() };
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

  setClapping(on) {
    this.clapping = on;
  }

  update(dt) {
    this.time += dt;
    this.#maybeFidget();
    const { m, q, e, v, s } = this.tmp;
    const t = this.time;

    this.people.forEach((p, i) => {
      p.stand = damp(p.stand, t >= p.standAt ? 1 : 0, 2.5, dt);
      // 小动作：低头看节目单、侧身和邻座说话
      let pitch = 0;
      let yaw = 0;
      let roll = 0;
      if (p.fidget) {
        const f = p.fidget;
        const k = (t - f.start) / f.duration;
        if (k >= 1) p.fidget = null;
        else {
          const env = Math.sin(Math.PI * Math.min(1, k)) ** 0.5;
          if (f.kind === 'look-down') pitch = 0.45 * env;
          else if (f.kind === 'talk') {
            yaw = f.dir * 0.7 * env;
            roll = f.dir * 0.08 * env;
          } else if (f.kind === 'shift') roll = f.dir * 0.1 * env;
        }
      }
      p.headPitch = damp(p.headPitch, pitch, 4, dt);
      p.headYaw = damp(p.headYaw, yaw, 4, dt);
      p.roll = damp(p.roll, roll, 3, dt);

      const lift = p.stand * 0.52 + (this.clapping && p.stand > 0.5 ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.008 : 0);
      const base = p.floor + lift;
      const sc = p.scale;
      // 肩膀
      e.set(0, 0, p.roll);
      q.setFromEuler(e);
      m.compose(v.set(p.x, base + 0.93 * sc, p.z + 0.1), q, s.set(0.22 * sc, 0.12 * sc, 0.13 * sc));
      this.shoulders.setMatrixAt(i, m);
      // 躯干（站起来时才露出座椅靠背）
      m.compose(v.set(p.x, base + 0.62 * sc, p.z + 0.12), q, s.set(sc, sc, 0.8 * sc));
      this.torsos.setMatrixAt(i, m);
      // 头：绕脖子转动
      e.set(p.headPitch, p.headYaw, p.roll * 1.5);
      q.setFromEuler(e);
      m.compose(v.set(p.x + p.roll * 0.2, base + 1.15 * sc, p.z + 0.08), q, s.set(0.095 * sc, 0.115 * sc, 0.105 * sc));
      this.heads.setMatrixAt(i, m);
    });
    this.heads.instanceMatrix.needsUpdate = true;
    this.shoulders.instanceMatrix.needsUpdate = true;
    this.torsos.instanceMatrix.needsUpdate = true;
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
    const k = (row) => 0.2 + 0.8 * levels[row];
    this.people.forEach((p, i) => {
      const f = k(p.row);
      this.heads.setColorAt(i, c.copy(p.bald ? p.skin : p.hair).multiplyScalar(f));
      this.shoulders.setColorAt(i, c.copy(p.clothes).multiplyScalar(f));
      this.torsos.setColorAt(i, c.copy(p.clothes).multiplyScalar(f));
    });
    const seatColor = new THREE.Color(SEAT);
    this.seats.forEach((s, i) => {
      c.copy(seatColor).multiplyScalar(k(s.row));
      this.seatBacks.setColorAt(i, c);
      this.cushions.setColorAt(i, c);
    });
    for (const mesh of [this.heads, this.shoulders, this.torsos, this.seatBacks, this.cushions]) {
      mesh.instanceColor.needsUpdate = true;
    }
  }
}
