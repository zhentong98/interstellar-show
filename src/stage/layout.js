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
/** 从坐到站，身体升高多少：观众起立和座位视角"跟着站起来"共用 */
export const STAND_LIFT = 0.41;

/**
 * 木管：弦乐右侧、指挥正前方偏右的两排弧形台阶，以指挥台为圆心、面向指挥。标准坐法：前排长笛在左、双簧管在右，
 * 后排单簧管在长笛后面、大管在双簧管后面，两位首席挨在中间。每个声部两人（双管编制），
 * 是原声 6 长笛 / 4 双簧管 / 6 单簧管 / 4 大管的缩编。
 * 这块地方被几个固定机位夹住（cameraRig.js 的 SHOTS），改之前先核对：
 *   - 指挥机位在 (1.2, 2.6, -5.0) 朝观众拍：x < 1.7 的前排座位要在 z < -5.35，乐手和乐器才不会进画面
 *   - 管风琴机位在 (2.7, 2.5, -7.0)，画面左沿贴着 z ≈ -7.1：后排台阶的后沿不能再往后
 *   - 合唱机位在 (2.0, 3.3, -4.8)，画面左下角：后排最右一人不超过 x ≈ 2.3
 *   - 前排最右一人和定音鼓之间要留出入场的过道（walkPaths.js 按道具的包围盒绕行）
 * 方位角 from/to 以指挥台为圆心（度，90° 是指挥正前方，越小越靠右）。
 */
export const WOODWINDS = {
  rows: [
    { r: 4.3, from: 81, to: 55.5, riser: 0.15, standDist: 0.75, sections: ['flute', 'flute', 'oboe', 'oboe'] },
    { r: 5.3, from: 86.5, to: 64, riser: 0.4, standDist: 0.6, sections: ['clarinet', 'clarinet', 'bassoon', 'bassoon'] },
  ],
  /** 两层弧形台阶：r0/r1 内外半径，from/to 方位角，h 高度 */
  risers: [
    { r0: 3.3, r1: 4.6, from: 88, to: 50, h: 0.15 },
    { r0: 4.6, r1: 5.5, from: 90, to: 60, h: 0.4 },
  ],
};

/**
 * 圆号：原声几乎不用铜管（只有首席圆号和终曲里的几支圆号），这里放四支。
 * 坐在大提琴后面的一层台阶上（不少乐团把圆号放在左后方），不占木管和管风琴的位置；
 * 方位角不小于 122°，管风琴机位的画面左沿才不会拍到圆号手。
 */
export const HORNS = {
  row: { r: 6.7, from: 122, to: 146, riser: 0.45, standDist: 0.55 },
  riser: { r0: 6.0, r1: 7.3, from: 118, to: 150, h: 0.45 },
};

/**
 * 钢琴：原声用了四架，这里放两架三角钢琴，在第一小提琴后方的左后角（管弦乐里钢琴、钢片琴的常见位置）。
 * 琴尾大致指向指挥，打开的琴盖朝向观众。pianist 是琴凳中心，yaw 是琴手面朝的方向。
 */
export const PIANOS = [
  { pianist: new Vector3(-10.0, STAGE_Y, -6.3), yaw: 1.15 },
  { pianist: new Vector3(-10.6, STAGE_Y, -8.4), yaw: 1.15 },
];
