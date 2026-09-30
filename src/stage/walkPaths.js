// 走位：乐手从侧台沿过道走到自己的位置，像真的乐团那样按声部、按排鱼贯而入。
//
// 全部按每位乐手的 entry（从哪一侧上台）、seat（位置）和舞台上实际摆着的道具通用地计算，不写死座位，
// 以后加了新的声部、换了座位布局也能用：
//
//   1. 栅格：舞台划成 8 厘米的格子。椅子、谱架、定音鼓、管风琴台、合唱台阶、指挥台
//      按各自真实的位置、朝向和尺寸，连同人体半径一起标成障碍；再算出每一格离最近障碍有多远。
//   2. 站位：坐着演奏的人先走到"椅子和谱架之间"那条窄道上、自己椅子的正前方，转身坐下；
//      前方不通（比如管风琴的琴凳）就从侧面或后面坐进去。站着的人直接走到自己的位置。
//      站在合唱台阶上的人从台阶靠近入口的那一端上去，沿着自己那一层走到位置。
//   3. 路线：每个入口做一次 Dijkstra（离障碍太近的格子代价更高，人会走在过道中间），
//      每位乐手从站位沿场倒推回入口，再拉直、倒圆角。
//   4. 先后：谁的路线要从别人的站位前经过，谁就先走（同一排里往里坐的先进场）；
//      然后逐个安排出发时间：和已经安排好的人在任何时刻都保持距离，也不从已经到位的人身前穿过。
//
// 算出来的结果是：几列人从两侧入口鱼贯而入，分头走进各排，从里往外依次落座；合唱团一层一层从台阶一端上去。

import * as THREE from 'three';
import { seededRandom, range } from '../core/math.js';
import { STAGE, HALL, STAGE_Y } from './layout.js';

const CELL = 0.08; // 栅格边长（米）
const PAD_SMALL = 0.12; // 椅子、谱架这类小道具外扩的半径：窄道里稍微侧身就能过去
const PAD_LARGE = 0.22; // 台阶、定音鼓、管风琴台、指挥台
const SMALL_AREA = 0.6; // 占地小于这个面积（平方米）算小道具
const COMFORT = 0.55; // 离障碍这么近以内，每走一步都有额外代价，人会走在过道中间
const COMFORT_COST = 2.5;
const EDGE = 0.4; // 离台口边缘至少这么远
const WALL = HALL.halfWidth - 0.35; // 侧墙
const DOOR_SPREAD = 3.6; // 入口的宽度：入口位置前后各这么多米（相当于侧台的几扇门）
const DOOR_BIAS = 0.08; // 离入口本身每远一米多一点代价：大多数人从入口附近出来
const GAP_WALK = 0.58; // 两个走动的人之间至少隔开这么远（一列人前后的间距）
const GAP_STILL = 0.45; // 走动的人和已经到位的人之间
const STEP = 0.1; // 排时间表的时间步长（秒）
const ACCEL = 0.35; // 到位前放慢停下的时间（秒）；从侧门出来时已经是正常步速
const CLIMB = 0.75; // 上台阶的那段路（米）

/** 到位之后：转身面向乐团，再坐下（秒） */
export const TURN_TIME = 0.45;
export const SIT_TIME = 0.55;

/**
 * 步态：走得越快步子越大（poseBody 的 walk 取大于 1 的值就是加大步幅，基准步长约 0.44 米）。
 * 相位按走过的距离推进；比"脚完全不打滑"的步频慢两成，看起来不像小碎步。
 * @returns {{ amount: number, phasePerMeter: number }}
 */
export function walkStride(speed) {
  const amount = Math.min(1.45, Math.max(0.85, speed / 1.2));
  return { amount, phasePerMeter: (0.8 * Math.PI) / (0.44 * amount) };
}

/** 角度的指数趋近，走最短的方向 */
export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

/** 两个角度之间插值，走最短的方向 */
export function lerpAngle(a, b, k) {
  return a + wrapAngle(b - a) * k;
}

function wrapAngle(d) {
  d %= Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ——— 栅格 ———

class Grid {
  constructor() {
    this.x0 = -HALL.halfWidth;
    this.z0 = STAGE.back;
    this.nx = Math.ceil((HALL.halfWidth * 2) / CELL);
    this.nz = Math.ceil((STAGE.front - STAGE.back) / CELL);
    const n = this.nx * this.nz;
    this.blocked = new Uint8Array(n);
    this.clear = new Float32Array(n);
    // 舞台边界：侧墙、台口边缘、后墙
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.cx(ix);
        const z = this.cz(iz);
        // 侧墙那一边是侧台入口，只是走不过去，不算"离障碍太近"（记成 2，算离障碍距离时忽略）
        if (Math.abs(x) > WALL) this.blocked[this.idx(ix, iz)] = 2;
        else if (z > STAGE.front - EDGE || z < STAGE.back + 0.4) this.blocked[this.idx(ix, iz)] = 1;
      }
    }
  }

  idx(ix, iz) {
    return iz * this.nx + ix;
  }

  cx(ix) {
    return this.x0 + (ix + 0.5) * CELL;
  }

  cz(iz) {
    return this.z0 + (iz + 0.5) * CELL;
  }

  ix(x) {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / CELL)));
  }

  iz(z) {
    return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.z0) / CELL)));
  }

  at(x, z) {
    return this.idx(this.ix(x), this.iz(z));
  }

  free(x, z) {
    return !this.blocked[this.at(x, z)];
  }

  /** 把一个道具的占地（凸四边形）外扩 pad 后标成障碍 */
  stamp({ pts, pad }) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    for (let iz = this.iz(minZ - pad); iz <= this.iz(maxZ + pad); iz++) {
      for (let ix = this.ix(minX - pad); ix <= this.ix(maxX + pad); ix++) {
        if (distToConvex(pts, this.cx(ix), this.cz(iz)) <= pad) this.blocked[this.idx(ix, iz)] = 1;
      }
    }
  }

  /** 每格到最近障碍的距离（两遍倒角距离变换） */
  computeClearance() {
    const { nx, nz, clear, blocked } = this;
    const a = CELL;
    const b = CELL * Math.SQRT2;
    for (let i = 0; i < clear.length; i++) clear[i] = blocked[i] === 1 ? 0 : 1e9;
    const relax = (i, j, w) => {
      if (clear[j] + w < clear[i]) clear[i] = clear[j] + w;
    };
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = this.idx(ix, iz);
        if (ix > 0) relax(i, i - 1, a);
        if (iz > 0) {
          relax(i, i - nx, a);
          if (ix > 0) relax(i, i - nx - 1, b);
          if (ix < nx - 1) relax(i, i - nx + 1, b);
        }
      }
    }
    for (let iz = nz - 1; iz >= 0; iz--) {
      for (let ix = nx - 1; ix >= 0; ix--) {
        const i = this.idx(ix, iz);
        if (ix < nx - 1) relax(i, i + 1, a);
        if (iz < nz - 1) {
          relax(i, i + nx, a);
          if (ix < nx - 1) relax(i, i + nx + 1, b);
          if (ix > 0) relax(i, i + nx - 1, b);
        }
      }
    }
  }

  /** 每格每走一米的代价：离障碍太近的格子更贵，人会走在过道中间 */
  computeCost() {
    this.cost = new Float32Array(this.clear.length);
    for (let i = 0; i < this.clear.length; i++) {
      const pen = Math.max(0, 1 - this.clear[i] / COMFORT);
      this.cost[i] = 1 + COMFORT_COST * pen * pen;
    }
  }

  /** a → b 的直线是否畅通，并且沿途离障碍都不小于 minClear */
  los(ax, az, bx, bz, minClear = 0) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      const i = this.at(ax + (bx - ax) * t, az + (bz - az) * t);
      if (this.blocked[i] || this.clear[i] < minClear) return false;
    }
    return true;
  }
}

function distToConvex(pts, x, z) {
  let inside = true;
  let best = Infinity;
  let sign = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const cross = ex * (z - a.z) - ez * (x - a.x);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) inside = false;
    }
    const len2 = ex * ex + ez * ez || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2));
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return inside ? 0 : best;
}

/**
 * 道具的占地：每个网格（实例化网格的每个实例）取包围盒底面四个角，按世界矩阵换算到地面上。
 * 太矮（地板上的东西）或太高（头顶上方）的不算障碍。
 */
function footprints(objects) {
  const out = [];
  const m = new THREE.Matrix4();
  const im = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const root of objects) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      const count = o.isInstancedMesh ? o.count : 1;
      for (let i = 0; i < count; i++) {
        if (o.isInstancedMesh) {
          o.getMatrixAt(i, im);
          m.multiplyMatrices(o.matrixWorld, im);
        } else {
          m.copy(o.matrixWorld);
        }
        let minY = Infinity;
        let maxY = -Infinity;
        for (const y of [bb.min.y, bb.max.y]) {
          for (const x of [bb.min.x, bb.max.x]) {
            for (const z of [bb.min.z, bb.max.z]) {
              p.set(x, y, z).applyMatrix4(m);
              minY = Math.min(minY, p.y);
              maxY = Math.max(maxY, p.y);
            }
          }
        }
        if (maxY < STAGE_Y + 0.12 || minY > STAGE_Y + 2.1) continue;
        const pts = [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.max.x, bb.max.z], [bb.min.x, bb.max.z]]
          .map(([x, z]) => {
            p.set(x, bb.min.y, z).applyMatrix4(m);
            return { x: p.x, z: p.z };
          });
        const area = Math.abs((pts[1].x - pts[0].x) * (pts[3].z - pts[0].z) - (pts[1].z - pts[0].z) * (pts[3].x - pts[0].x));
        if (area < 1e-5) continue; // 缩放为 0 的实例（藏起来的）
        out.push({ pts, pad: area < SMALL_AREA ? PAD_SMALL : PAD_LARGE });
      }
    });
  }
  return out;
}

// ——— 最短路 ———

/** 小顶堆（按代价）：定长数组，满了就扩容；同一格子可以重复插入，取出时由调用方跳过过期项 */
class Heap {
  constructor(capacity) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
    this.topKey = 0;
  }

  push(key, val) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const vals = new Int32Array(this.size * 2);
      keys.set(this.keys);
      vals.set(this.vals);
      this.keys = keys;
      this.vals = vals;
    }
    const { keys, vals } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      vals[i] = vals[parent];
      i = parent;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** 取出代价最小的一项，代价放在 topKey */
  pop() {
    const { keys, vals } = this;
    const top = vals[0];
    this.topKey = keys[0];
    const n = --this.size;
    const lastK = keys[n];
    const lastV = vals[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= lastK) break;
      keys[i] = keys[c];
      vals[i] = vals[c];
      i = c;
    }
    keys[i] = lastK;
    vals[i] = lastV;
    return top;
  }
}

/** 从一个入口出发的代价场：sources 是入口处的格子（带初始代价） */
function dijkstra(grid, sources) {
  const { nx, nz, blocked, cost } = grid;
  const n = nx * nz;
  // 代价用双精度：和堆里的键一致，否则舍入误差会让同一格子反复入堆
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap(n);
  for (const { i, cost: c } of sources) {
    if (c < dist[i]) {
      dist[i] = c;
      heap.push(c, i);
    }
  }
  const DIAG = CELL * Math.SQRT2;
  while (heap.size) {
    const i = heap.pop();
    const d = dist[i];
    if (heap.topKey > d) continue; // 过期项
    const ix = i % nx;
    const iz = (i - ix) / nx;
    for (let dz = -1; dz <= 1; dz++) {
      const jz = iz + dz;
      if (jz < 0 || jz >= nz) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = ix + dx;
        if (jx < 0 || jx >= nx) continue;
        const j = jz * nx + jx;
        if (blocked[j]) continue;
        // 斜着走不能擦过障碍的角
        if (dx && dz && (blocked[iz * nx + jx] || blocked[jz * nx + ix])) continue;
        const nd = d + (dx && dz ? DIAG : CELL) * cost[j];
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = i;
          heap.push(nd, j);
        }
      }
    }
  }
  return { dist, prev };
}

// ——— 路线 ———

/** 一条折线路线（带高度，上台阶时 y 会变），按走过的距离取位置和朝向 */
export class WalkPath {
  /** @param {{x:number, y:number, z:number}[]} points */
  constructor(points) {
    this.points = points;
    this.cum = [0];
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1];
      const b = points[k];
      this.cum.push(this.cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  #segment(s) {
    const { cum } = this;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** 走过 s 米时的位置 */
  at(s, out = new THREE.Vector3()) {
    const pts = this.points;
    if (pts.length === 1 || s <= 0) return out.set(pts[0].x, pts[0].y, pts[0].z);
    if (s >= this.length) {
      const p = pts[pts.length - 1];
      return out.set(p.x, p.y, p.z);
    }
    const k = this.#segment(s);
    const a = pts[k];
    const b = pts[k + 1];
    const len = this.cum[k + 1] - this.cum[k];
    const f = len > 0 ? (s - this.cum[k]) / len : 0;
    return out.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
  }

  /** 走过 s 米处的前进方向（绕 y 轴的角度，和乐手的 yaw 同一约定） */
  heading(s) {
    const pts = this.points;
    if (pts.length < 2) return 0;
    const k = Math.min(pts.length - 2, this.#segment(Math.min(s, this.length - 1e-6)));
    const a = pts[k];
    const b = pts[k + 1];
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** 路线离某一点最近的距离，以及最近处走过了多少米 */
  closest(x, z) {
    let best = Infinity;
    let at = 0;
    const pts = this.points;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2)) : 0;
      const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
      if (d < best) {
        best = d;
        at = this.cum[k] + t * Math.sqrt(len2);
      }
    }
    return { dist: best, at };
  }
}

/** 按格子链倒推出来的路线：拉直（不比原路线更贴近障碍）、再给拐角倒一点圆角 */
function smoothCells(grid, cells, y) {
  const pts = cells.map((i) => {
    const ix = i % grid.nx;
    return { x: grid.cx(ix), z: grid.cz((i - ix) / grid.nx), c: grid.clear[i] };
  });
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, y, z: p.z }));
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    let minC = Math.min(pts[i].c, pts[j].c);
    while (j + 1 < pts.length) {
      const c = Math.min(minC, pts[j + 1].c);
      if (!grid.los(pts[i].x, pts[i].z, pts[j + 1].x, pts[j + 1].z, Math.min(0.3, c * 0.9))) break;
      minC = c;
      j++;
    }
    out.push(pts[j]);
    i = j;
  }
  // 倒圆角：拐角处各退回一小段，连成一条短斜线（短斜线仍然畅通才替换）
  const round = [out[0]];
  for (let k = 1; k < out.length - 1; k++) {
    const a = out[k - 1];
    const p = out[k];
    const b = out[k + 1];
    const la = Math.hypot(p.x - a.x, p.z - a.z);
    const lb = Math.hypot(b.x - p.x, b.z - p.z);
    const d = Math.min(0.4, la * 0.4, lb * 0.4);
    const p1 = { x: p.x + ((a.x - p.x) / la) * d, z: p.z + ((a.z - p.z) / la) * d };
    const p2 = { x: p.x + ((b.x - p.x) / lb) * d, z: p.z + ((b.z - p.z) / lb) * d };
    const mid = { x: (p1.x + p2.x) / 4 + p.x / 2, z: (p1.z + p2.z) / 4 + p.z / 2 };
    if (d > 0.05 && grid.los(p1.x, p1.z, mid.x, mid.z) && grid.los(mid.x, mid.z, p2.x, p2.z)) {
      round.push(p1, mid, p2);
    } else {
      round.push(p);
    }
  }
  round.push(out[out.length - 1]);
  return round.map((p) => ({ x: p.x, y, z: p.z }));
}

// ——— 规划器 ———

/**
 * @param {object} options
 *   musicians   乐手列表（需要 entry、seat、yaw、seated）
 *   obstacles   道具（Object3D 列表：椅子、谱架、定音鼓、管风琴台、合唱台阶、指挥台……）
 *   speed       平均步速（米/秒）
 *   seed        个体差异的随机种子
 */
export function planWalkOn({ musicians, obstacles, speed = 1.4, seed = 5 }) {
  const t0 = performance.now();
  const rand = seededRandom(seed);
  const grid = new Grid();
  for (const fp of footprints(obstacles)) grid.stamp(fp);
  grid.computeClearance();
  grid.computeCost();
  const fields = new Map();

  /** 某个入口的代价场（同一个入口的人共用） */
  const fieldFor = (entry) => {
    const key = `${entry.x.toFixed(2)},${entry.z.toFixed(2)}`;
    if (!fields.has(key)) {
      // 入口在侧墙一边：沿侧墙前后 DOOR_SPREAD 米都可以出来；越靠近入口本身代价越低
      const sources = [];
      const side = Math.abs(entry.x) > Math.abs(entry.z - STAGE.back) ? 'x' : 'z';
      for (let d = -DOOR_SPREAD; d <= DOOR_SPREAD; d += CELL) {
        const x = side === 'x' ? entry.x : entry.x + d;
        const z = side === 'x' ? entry.z + d : entry.z;
        const i = grid.at(x, z);
        if (!grid.blocked[i]) sources.push({ i, cost: Math.abs(d) * DOOR_BIAS });
      }
      fields.set(key, { entry, side, ...dijkstra(grid, sources) });
    }
    return fields.get(key);
  };

  /** 格子链：从入口走到 (x, z) 附近最近的可达格子 */
  const cellsTo = (field, x, z) => {
    let start = grid.at(x, z);
    if (!Number.isFinite(field.dist[start])) {
      // 目标点被障碍的外扩边吃掉了一点：找附近最近的可达格子
      let best = Infinity;
      const r = Math.ceil(0.35 / CELL);
      const ix0 = grid.ix(x);
      const iz0 = grid.iz(z);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const ix = ix0 + dx;
          const iz = iz0 + dz;
          if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) continue;
          const i = grid.idx(ix, iz);
          const d = Math.hypot(dx, dz);
          if (Number.isFinite(field.dist[i]) && d < best) {
            best = d;
            start = i;
          }
        }
      }
      if (!Number.isFinite(best)) return null;
    }
    const cells = [];
    for (let i = start; i >= 0; i = field.prev[i]) cells.push(i);
    return cells.reverse();
  };

  /**
   * 从哪个入口上台：默认是自己的 entry；另一侧的入口明显更近时走另一侧
   * （例如坐在弦乐各排靠舞台中央那一头的人，从右侧入口穿过舞台中央进来更近），两侧同时进场，不挤在一条过道里。
   */
  const doors = [...new Map(musicians.map((o) => [`${o.entry.x.toFixed(2)},${o.entry.z.toFixed(2)}`, o.entry])).values()];
  const doorFor = (m, x, z) => {
    const i = grid.at(x, z);
    let best = m.entry;
    let bestCost = fieldFor(m.entry).dist[i];
    for (const door of doors) {
      const cost = fieldFor(door).dist[i] * 1.05 + 1;
      if (cost < bestCost) {
        best = door;
        bestCost = cost;
      }
    }
    return best;
  };

  /** 从入口走到 (x, z)：返回地面上的折线点（第一个点在侧墙边，看起来是从侧门走出来的） */
  const floorRoute = (entry, x, z) => {
    const field = fieldFor(entry);
    const cells = cellsTo(field, x, z);
    if (!cells) return null;
    const pts = smoothCells(grid, cells, STAGE_Y);
    const first = pts[0];
    if (field.side === 'x') pts.unshift({ x: Math.sign(entry.x) * (HALL.halfWidth - 0.25), y: STAGE_Y, z: first.z });
    pts.push({ x, y: STAGE_Y, z });
    return pts;
  };

  // —— 每个人的站位和路线 ——
  const walkers = [];
  for (const m of musicians) {
    const fwd = { x: Math.sin(m.yaw), z: Math.cos(m.yaw) };
    const right = { x: fwd.z, z: -fwd.x };
    const elevated = m.seat.y > STAGE_Y + 0.05;
    let stand;
    let pts = null;
    if (elevated) {
      // 台阶上的位置：同一层、同一排的人连成一条线，从靠近入口的那一端上台阶
      const row = musicians.filter((o) => Math.abs(o.seat.y - m.seat.y) < 0.05 && Math.abs(o.seat.z - m.seat.z) < 0.3);
      let a = row[0];
      let b = row[0];
      let span = -1;
      for (const p of row) {
        for (const q of row) {
          const d = p.seat.distanceTo(q.seat);
          if (d > span) {
            span = d;
            a = p;
            b = q;
          }
        }
      }
      if (a.seat.distanceTo(m.entry) > b.seat.distanceTo(m.entry)) [a, b] = [b, a];
      const u = span > 0.01
        ? new THREE.Vector3().subVectors(a.seat, b.seat).setY(0).normalize()
        : new THREE.Vector3().subVectors(m.entry, m.seat).setY(0).normalize();
      // 从这一端往外走，直到离开台阶（走出障碍区）：那里是上台阶的地方
      const probe = a.seat.clone();
      let edge = null;
      for (let k = 0; k < 80; k++) {
        probe.addScaledVector(u, 0.05);
        if (grid.free(probe.x, probe.z) && grid.clear[grid.at(probe.x, probe.z)] > 0.12) {
          edge = probe.clone();
          break;
        }
      }
      stand = m.seat.clone();
      if (edge) {
        const floor = floorRoute(doorFor(m, edge.x, edge.z), edge.x, edge.z);
        if (floor) {
          // 地面走到台阶端头 → 上台阶（CLIMB 米内升到这一层的高度）→ 沿这一层走到位置
          const climbEnd = edge.clone().addScaledVector(u, -CLIMB);
          const along = climbEnd.distanceTo(m.seat.clone().setY(edge.y));
          pts = floor;
          if (u.dot(new THREE.Vector3().subVectors(m.seat, climbEnd).setY(0)) < 0 && along > 0.05) {
            pts.push({ x: climbEnd.x, y: m.seat.y, z: climbEnd.z });
          } else {
            // 自己就站在端头附近：直接上去
            pts[pts.length - 1].y = STAGE_Y;
          }
          pts.push({ x: m.seat.x, y: m.seat.y, z: m.seat.z });
        }
      }
    } else {
      // 坐着的：先试椅子正前方（椅子和谱架之间），不通就试侧面、后面；站着的就是自己的位置
      const tries = m.seated ? [[0.45, 0], [0.55, 0], [0.36, 0], [0, 0.55], [0, -0.55], [-0.5, 0], [-0.65, 0]] : [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
      for (const [f, r] of tries) {
        const x = m.seat.x + fwd.x * f + right.x * r;
        const z = m.seat.z + fwd.z * f + right.z * r;
        if (grid.free(x, z)) {
          stand = new THREE.Vector3(x, STAGE_Y, z);
          break;
        }
      }
      stand ??= m.seat.clone().setY(STAGE_Y).addScaledVector(new THREE.Vector3(fwd.x, 0, fwd.z), m.seated ? 0.45 : 0);
      pts = floorRoute(doorFor(m, stand.x, stand.z), stand.x, stand.z);
    }
    if (!pts) {
      // 实在找不到路（不应该发生）：退回直线，至少不会卡住演出
      console.warn('走位：找不到路线，改走直线', m.section, m.index);
      stand ??= m.seat.clone();
      pts = [{ x: m.entry.x, y: STAGE_Y, z: m.entry.z }, { x: stand.x, y: stand.y, z: stand.z }];
    }
    const path = new WalkPath(pts);
    // 步速差异很小：一列人前后跟着走，快的人会被慢的人挡住
    const v = speed * range(rand, 0.97, 1.03);
    walkers.push({
      m, stand, v, path,
      phase: rand() * Math.PI * 2,
      jitter: rand() * 0.3,
    });
  }

  schedule(walkers);
  const end = Math.max(...walkers.map((w) => w.arrive + TURN_TIME + (w.m.seated ? SIT_TIME : 0)));
  const plan = {
    walkers,
    grid, // 调试用：可以画出障碍和路线
    duration: end,
    elapsed: performance.now() - t0, // 规划耗时（毫秒），调试用
    /** 通用寻路（指挥上台用）：从 from 所在一侧的入口走到 to，返回折线点 */
    route(from, to) {
      const pts = floorRoute(from, to.x, to.z);
      return pts ? pts.map((p) => new THREE.Vector3(p.x, STAGE_Y, p.z)) : [to.clone()];
    },
  };
  return plan;
}

/** 走了 t 秒时走过的距离：从侧门出来时已经是正常步速，到位前放慢停下 */
export function distanceAt(w, t) {
  const { v, duration } = w;
  const L = w.path.length;
  if (t <= 0) return 0;
  if (t >= duration) return L;
  if (t > duration - ACCEL) return Math.max(0, L - (v * (duration - t) ** 2) / (2 * ACCEL));
  return Math.min(L, v * t);
}

/** 走到距离 s 大约需要多少秒（排时间表用） */
const timeTo = (w, s) => s / w.v;

/** 以 STEP 为间隔预先算好走路途中的位置（排时间表时比对用） */
function sampleTrack(w) {
  w.duration = w.path.length / w.v + ACCEL / 2;
  w.K = Math.ceil(w.duration / STEP);
  w.track = new Float32Array((w.K + 1) * 2);
  const p = new THREE.Vector3();
  for (let k = 0; k <= w.K; k++) {
    w.path.at(distanceAt(w, k * STEP), p);
    w.track[k * 2] = p.x;
    w.track[k * 2 + 1] = p.z;
  }
  const xs = w.path.points.map((q) => q.x);
  const zs = w.path.points.map((q) => q.z);
  w.box = { minX: Math.min(...xs) - 0.7, maxX: Math.max(...xs) + 0.7, minZ: Math.min(...zs) - 0.7, maxZ: Math.max(...zs) + 0.7 };
}

/**
 * 排时间表：先定先后（谁要从谁的站位前经过），再按顺序给每个人找最早的、不和任何人冲突的出发时间；
 * 然后倒着再排一遍，每个人尽量晚出发，大家差不多同时就位。
 * 写回 w.start / w.arrive（秒，从第一个人出发算起）。
 */
function schedule(walkers) {
  const n = walkers.length;
  const still = (a, b) => Math.min(GAP_STILL, 0.85 * Math.hypot(a.stand.x - b.stand.x, a.stand.z - b.stand.z));
  for (const w of walkers) {
    sampleTrack(w);
    w.after = []; // 必须等这些人从自己站位前走过去之后才能到位
    w.indeg = 0;
    w.next = [];
  }
  const overlap = (a, b) => a.box.minX < b.box.maxX && b.box.minX < a.box.maxX && a.box.minZ < b.box.maxZ && b.box.minZ < a.box.maxZ;

  // 先后：i 的路线经过 j 的站位 → i 先走
  for (const i of walkers) {
    for (const j of walkers) {
      if (i === j || !overlap(i, j)) continue;
      const hit = i.path.closest(j.stand.x, j.stand.z);
      if (hit.dist < still(i, j) && hit.at < i.path.length - 0.2) {
        j.after.push({ w: i, at: hit.at });
        i.next.push(j);
        j.indeg++;
      }
    }
  }
  const order = [];
  const ready = walkers.filter((w) => w.indeg === 0);
  const done = new Set();
  while (order.length < n) {
    let pick;
    if (ready.length) {
      // 走得远的先出发
      ready.sort((a, b) => b.duration - a.duration);
      pick = ready.shift();
    } else {
      // 互相挡路（不应该出现）：挑剩下里面被挡得最少的，打破循环
      pick = walkers.filter((w) => !done.has(w)).sort((a, b) => a.indeg - b.indeg)[0];
    }
    if (done.has(pick)) continue;
    done.add(pick);
    order.push(pick);
    for (const j of pick.next) {
      j.indeg--;
      if (j.indeg === 0 && !done.has(j)) ready.push(j);
    }
  }

  const placed = [];
  for (const w of order) {
    const near = placed.filter((o) => overlap(o, w));
    // 最早出发时间：前面要经过自己站位的人都过去之后才到位
    let lb = w.jitter;
    for (const { w: p, at } of w.after) {
      if (p.start !== undefined) lb = Math.max(lb, p.start + timeTo(p, at) + 0.25 - w.duration);
    }
    let g = Math.max(0, Math.ceil(lb / STEP));
    // 等了很久还是冲突（多半是两个人互相要从对方站位前经过）：只避开走动的人，不再管已经到位的人
    for (let tries = 0; tries < 900 && conflict(w, g, near, still, tries < 60); tries++) g++;
    w.g0 = g;
    w.start = g * STEP;
    w.arrive = w.start + w.duration;
    placed.push(w);
  }

  // 第二遍（倒着排）：在不冲突、不改变先后的前提下，每个人尽量晚一点出发，大家差不多同时到位。
  // 这样人少、路短的声部（比如合唱团）不会早早就位，而是和弦乐一起在开场这段时间里进场
  const end = Math.max(...walkers.map((w) => w.arrive));
  for (const w of order.slice().reverse()) {
    let ub = end - w.duration;
    for (const j of w.next) {
      const hit = j.after.find((x) => x.w === w);
      ub = Math.min(ub, j.start + j.duration - timeTo(w, hit.at) - 0.25);
    }
    const near = walkers.filter((o) => o !== w && overlap(o, w));
    for (let g = Math.floor(ub / STEP); g > w.g0; g--) {
      if (!conflict(w, g, near, still)) {
        w.g0 = g;
        w.start = g * STEP;
        w.arrive = w.start + w.duration;
        break;
      }
    }
  }
  // 从第一个人出发算起
  const first = Math.min(...walkers.map((w) => w.start));
  for (const w of walkers) {
    w.start -= first;
    w.arrive -= first;
  }
}

/** w 在第 g 步出发，会不会和已经排好的人撞上（strict 为 false 时只避开走动的人） */
function conflict(w, g, others, still, strict = true) {
  const tw = w.track;
  const sx = w.stand.x;
  const sz = w.stand.z;
  for (const o of others) {
    const to = o.track;
    const lim = still(w, o);
    // w 走路途中
    for (let k = Math.max(0, o.g0 - g); k <= w.K; k++) {
      const x = tw[k * 2];
      const z = tw[k * 2 + 1];
      const ko = g + k - o.g0;
      if (ko <= o.K) {
        if (Math.hypot(x - to[ko * 2], z - to[ko * 2 + 1]) < GAP_WALK) return true;
      } else if (strict && Math.hypot(x - o.stand.x, z - o.stand.z) < lim) {
        return true;
      }
    }
    if (!strict) continue;
    // w 到位之后，o 还在走：不能从 w 身前穿过
    for (let ko = Math.max(0, g + w.K + 1 - o.g0); ko <= o.K; ko++) {
      if (Math.hypot(sx - to[ko * 2], sz - to[ko * 2 + 1]) < lim) return true;
    }
  }
  return false;
}
