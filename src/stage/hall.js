// 音乐厅的静态结构：舞台、阶梯池座、墙面和吸声木条、楼座、巨幕黑色包边、管风琴音管墙、观众席灯具。
// 里程碑 1 用简单几何体和 PBR 材质搭出空间关系，里程碑 2 再换写实模型。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom, range } from '../core/math.js';
import {
  STAGE_Y, STAGE, HALL, SCREEN, SEATING, rowZ, rowFloorY,
} from './layout.js';

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export const materials = {
  wallWood: new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 0.62 }),
  finWood: new THREE.MeshStandardMaterial({ color: 0x8a6040, roughness: 0.5 }),
  stageFloor: new THREE.MeshStandardMaterial({ color: 0x2e2118, roughness: 0.62 }),
  stageFront: new THREE.MeshStandardMaterial({ color: 0x1c140f, roughness: 0.7 }),
  stallsFloor: new THREE.MeshStandardMaterial({ color: 0x3a2320, roughness: 0.95 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.9 }),
  velvet: new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 1 }),
  organCase: new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.5 }),
  pipeMetal: new THREE.MeshStandardMaterial({ color: 0xa9a9ae, metalness: 1, roughness: 0.38 }),
  pipeMouth: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
};

function mesh(geometry, material, { receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.receiveShadow = receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

function buildStage() {
  const w = HALL.halfWidth * 2;
  const depth = -STAGE.back;
  return [
    mesh(box(w, STAGE_Y, depth, 0, STAGE_Y / 2, STAGE.back / 2), materials.stageFloor),
    // 台口立面稍微内收，做出一道暗色的边
    mesh(box(STAGE.halfWidth * 2, STAGE_Y - 0.06, 0.04, 0, (STAGE_Y - 0.06) / 2, 0.02), materials.stageFront),
  ];
}

function buildStalls() {
  const parts = [];
  const w = HALL.halfWidth * 2;
  // 台前到第一排之间的平地
  parts.push(box(w, 0.02, SEATING.firstRowZ, 0, -0.01, SEATING.firstRowZ / 2 - 0.45));
  for (let row = 1; row <= SEATING.rows; row++) {
    const h = rowFloorY(row);
    const depth = row === SEATING.rows ? HALL.back - (rowZ(row) - SEATING.rowSpacing / 2) : SEATING.rowSpacing;
    const z0 = rowZ(row) - SEATING.rowSpacing / 2;
    parts.push(box(w, h, depth, 0, h / 2, z0 + depth / 2));
  }
  return [mesh(mergeGeometries(parts), materials.stallsFloor)];
}

function buildShell() {
  const length = HALL.back - STAGE.back;
  const zMid = (HALL.back + STAGE.back) / 2;
  const out = [];
  // 侧墙、后墙、舞台后墙（黑色）、天花
  for (const side of [-1, 1]) {
    out.push(mesh(box(0.3, HALL.height, length, side * (HALL.halfWidth + 0.15), HALL.height / 2, zMid), materials.wallWood));
  }
  out.push(mesh(box(HALL.halfWidth * 2, HALL.height, 0.3, 0, HALL.height / 2, HALL.back + 0.15), materials.wallWood));
  out.push(mesh(box(HALL.halfWidth * 2, HALL.height, 0.3, 0, HALL.height / 2, STAGE.back - 0.15), materials.velvet));
  out.push(mesh(box(HALL.halfWidth * 2, 0.3, length, 0, HALL.height + 0.15, zMid), materials.ceiling));

  // 侧墙竖向吸声木条
  const fins = [];
  for (let z = STAGE.back + 1; z < HALL.back - 0.5; z += 1.1) {
    for (const side of [-1, 1]) {
      fins.push(box(0.14, HALL.height - 2.5, 0.35, side * (HALL.halfWidth - 0.08), 1.25 + (HALL.height - 2.5) / 2, z));
    }
  }
  out.push(mesh(mergeGeometries(fins), materials.finWood));

  // 两侧楼座（第一层），只在入场和换场的运镜里看得到
  const balcony = [];
  for (const side of [-1, 1]) {
    const x = side * (HALL.halfWidth - 1.3);
    balcony.push(box(2.6, 0.35, HALL.back - 3, x, 6.2, (HALL.back + 3) / 2));
    balcony.push(box(0.15, 1.0, HALL.back - 3, x - side * 1.3, 6.85, (HALL.back + 3) / 2));
  }
  balcony.push(box(HALL.halfWidth * 2, 0.35, 5, 0, 6.2, HALL.back - 2.5));
  balcony.push(box(HALL.halfWidth * 2, 1.0, 0.15, 0, 6.85, HALL.back - 5));
  out.push(mesh(mergeGeometries(balcony), materials.wallWood));

  // 舞台上方的声学反射板
  const reflectors = [];
  const rand = seededRandom(5);
  for (let i = 0; i < 12; i++) {
    const g = new THREE.BoxGeometry(3.2, 0.12, 2.4);
    g.rotateX(range(rand, -0.25, -0.12));
    g.translate(((i % 4) - 1.5) * 4.2, 18.6 + range(rand, -0.3, 0.3), -11 + Math.floor(i / 4) * 4);
    reflectors.push(g);
  }
  out.push(mesh(mergeGeometries(reflectors), materials.finWood));
  return out;
}

/** 巨幕四周的黑色吸光幕布包边 */
function buildScreenMasking() {
  const { width, height, center } = SCREEN;
  const border = 0.45;
  const z = center.z + 0.01;
  const parts = [
    box(width + border * 2, border, 0.06, center.x, center.y + height / 2 + border / 2, z),
    box(width + border * 2, border, 0.06, center.x, center.y - height / 2 - border / 2, z),
    box(border, height, 0.06, center.x - width / 2 - border / 2, center.y, z),
    box(border, height, 0.06, center.x + width / 2 + border / 2, center.y, z),
  ];
  return [mesh(mergeGeometries(parts), materials.velvet)];
}

/**
 * 管风琴音管墙：巨幕两侧各一面，中间高两边低的"塔"形排列，前后两排错开。
 * 音管用 InstancedMesh，每根配一个深色的发音口。
 */
function buildOrganPipes() {
  const pipes = [];
  const rand = seededRandom(9);
  const inner = SCREEN.width / 2 + 0.75;
  const outer = HALL.halfWidth - 0.9;
  const baseY = 5.3;
  const zFront = SCREEN.center.z + 0.25;
  const perRow = 15;
  for (const side of [-1, 1]) {
    for (const [layer, dz, scale] of [
      [0, 0, 1],
      [1, -0.45, 0.78],
    ]) {
      for (let i = 0; i < perRow; i++) {
        const u = (i + (layer ? 0.5 : 0)) / (perRow - 1);
        const x = side * (inner + u * (outer - inner));
        const tower = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * (2 * u - 1)), 0.9);
        const h = (5 + 8 * tower) * scale + range(rand, -0.15, 0.15);
        const r = 0.05 + 0.008 * h;
        pipes.push({ x, y: baseY, z: zFront + dz, h, r });
      }
    }
  }

  const pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1).translate(0, 0.5, 0);
  const mouthGeo = new THREE.BoxGeometry(1, 1, 1);
  const pipeMesh = new THREE.InstancedMesh(pipeGeo, materials.pipeMetal, pipes.length);
  const mouthMesh = new THREE.InstancedMesh(mouthGeo, materials.pipeMouth, pipes.length);
  const m = new THREE.Matrix4();
  pipes.forEach((p, i) => {
    m.makeScale(p.r, p.h, p.r).setPosition(p.x, p.y, p.z);
    pipeMesh.setMatrixAt(i, m);
    m.makeScale(p.r * 1.3, p.r * 2.2, 0.02).setPosition(p.x, p.y + 0.35 + p.r * 2, p.z + p.r * 0.95);
    mouthMesh.setMatrixAt(i, m);
  });

  // 木质琴箱：音管下方的台座和两侧立柱
  const casing = [];
  for (const side of [-1, 1]) {
    const cx = side * (inner + outer) / 2;
    const w = outer - inner + 1.0;
    casing.push(box(w, baseY - STAGE_Y, 1.6, cx, STAGE_Y + (baseY - STAGE_Y) / 2, zFront - 0.3));
    casing.push(box(w + 0.3, 0.3, 1.8, cx, baseY + 0.15 - 0.3, zFront - 0.3));
    casing.push(box(0.4, 15, 1.8, side * (inner - 0.3), baseY + 7.5 - 0.3, zFront - 0.3));
  }
  return [pipeMesh, mouthMesh, mesh(mergeGeometries(casing), materials.organCase)];
}

/**
 * 观众席灯具：侧墙壁灯 + 天花筒灯，每盏灯记录它属于哪一排，
 * 由 HouseLights 按排调亮度（实现"逐排熄灭"）。
 */
function buildHouseLamps() {
  const lamps = [];
  for (let row = 1; row <= SEATING.rows; row += 2) {
    const z = rowZ(row);
    for (const side of [-1, 1]) lamps.push({ row, pos: [side * (HALL.halfWidth - 0.25), 4.2, z], size: [0.12, 0.34, 0.22] });
    for (const x of [-9, -3, 3, 9]) lamps.push({ row, pos: [x, HALL.height - 0.05, z], size: [0.4, 0.04, 0.4] });
  }
  // 楼座下沿的暖色灯带
  for (let z = 4; z < HALL.back - 1; z += 2.2) {
    const row = Math.max(1, Math.min(SEATING.rows, Math.round((z - SEATING.firstRowZ) / SEATING.rowSpacing) + 1));
    for (const side of [-1, 1]) lamps.push({ row, pos: [side * (HALL.halfWidth - 2.6), 5.98, z], size: [0.18, 0.04, 0.18] });
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const lampMesh = new THREE.InstancedMesh(geo, materials.lamp, lamps.length);
  const m = new THREE.Matrix4();
  const rowOf = new Int16Array(lamps.length);
  lamps.forEach((l, i) => {
    m.makeScale(...l.size).setPosition(...l.pos);
    lampMesh.setMatrixAt(i, m);
    lampMesh.setColorAt(i, new THREE.Color(0xffd6a0));
    rowOf[i] = l.row;
  });
  return { mesh: lampMesh, rowOf };
}

export function buildHall() {
  const group = new THREE.Group();
  group.name = '音乐厅';
  for (const part of [
    ...buildStage(),
    ...buildStalls(),
    ...buildShell(),
    ...buildScreenMasking(),
    ...buildOrganPipes(),
  ]) {
    group.add(part);
  }
  const lamps = buildHouseLamps();
  group.add(lamps.mesh);
  return { group, lamps };
}
