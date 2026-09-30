// 音乐厅空间布局（单位：米）。这里只放位置和尺寸；演出节奏全部在 src/cues/。
//
// 坐标约定：x 向观众的右手为正，y 向上，z 指向观众席。
// 舞台在 z < 0 一侧，台口边缘在 z = 0；池座从 z = 3.4 开始向后升起。

import { Vector3 } from 'three';

/** 舞台面高度（相对池座最前方的地面） */
export const STAGE_Y = 1.0;

export const STAGE = { halfWidth: 12.5, front: 0, back: -14.8 };

export const HALL = { halfWidth: 15.5, back: 31, height: 21 };

/**
 * 巨幕：16:9、宽 22 米（接近 IMAX 银幕），悬挂在乐团上方。
 * 从第 8 排看过去约占画面宽度的七成；下沿高于合唱团最后一排头顶在银幕上的投影，乐团不会挡住画面。
 */
export const SCREEN = (() => {
  const width = 22;
  const height = (width * 9) / 16;
  const bottom = 4.4;
  return { width, height, bottom, center: new Vector3(0, bottom + height / 2, -13.2) };
})();

/** 指挥台 */
export const PODIUM = new Vector3(0, STAGE_Y, -1.6);
export const PODIUM_HEIGHT = 0.25;

/** 管风琴控制台（舞台中央靠后） */
export const ORGAN_CONSOLE = new Vector3(0, STAGE_Y, -8.6);

/** 侧台入口：弦乐和指挥从左侧上台，合唱团、定音鼓和管风琴手从右侧上台 */
export const WINGS = {
  left: new Vector3(-13.8, STAGE_Y, -1.2),
  right: new Vector3(13.8, STAGE_Y, -6.8),
};

/** 池座：阶梯式升起，相邻两排错开半个座位，避免正前方的人挡住视线 */
export const SEATING = {
  rows: 20,
  firstRowZ: 3.4,
  rowSpacing: 0.92,
  rake: 0.16, // 每排升高：视线能越过前两排的头顶
  baseY: 0.12,
  seatPitch: 0.55,
  halfWidth: 13.4,
  aisles: [-4.4, 4.4], // 两条纵向过道中心
  aisleWidth: 1.1,
};

export const rowZ = (row) => SEATING.firstRowZ + (row - 1) * SEATING.rowSpacing;
export const rowFloorY = (row) => SEATING.baseY + (row - 1) * SEATING.rake;

/** 观众的座位：第 8 排正中 */
export const VIEW_ROW = 8;
export const SEAT_EYE = new Vector3(0, rowFloorY(VIEW_ROW) + 1.25, rowZ(VIEW_ROW));
