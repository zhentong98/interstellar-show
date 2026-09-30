// 灯光预算：场景里照度、材质反照率、曝光、Bloom 门槛之间的统一约定。
//
// 单位是 three.js 的物理灯光单位：聚光灯 / 点光的 intensity 是坎德拉，
// 表面照度 E = I × cosθ / d²，漫反射表面的线性亮度 = 反照率 × E / π。
// 后处理先在线性亮度上做 Bloom（门槛 1.0，见 post.js），再乘 toneMappingExposure / 0.6 进 ACES。
//
// 约定：
//   - 灯按"打到目标处的照度"来定（candela() 换算，见 stageLights.js 的 spot({ lux })），
//     而不是直接写坎德拉：离得远的灯自动更亮，几盏灯叠在同一个区域时也能直接相加核对
//   - 演奏时一个区域的主光合计约 KEY（强度中等时），最强时再亮 30%
//   - 白色漫反射材质（白衬衫、乐谱、琴键、鼓皮）的线性反照率不超过 WHITE_ALBEDO
//   → 最亮的白布约 0.6 × 3.6 × 1.3 / π ≈ 0.9，低于 Bloom 门槛：
//     平时只有灯头、台灯、音管底光这些真正的光源会晕开，爆闪时整个舞台才一起发光
//   - 观众席亮灯时观众头顶的照度 HOUSE 比舞台主光低（开演前的真实场馆也是舞台最亮）

import * as THREE from 'three';

export const LUX = {
  /** 演奏时一个声部的主光（顶光合计） */
  key: 3.6,
  /** 观众席亮灯时，观众头顶高度的照度 */
  house: 2.2,
};

/** 白色漫反射材质的线性反照率上限（真实白布、纸张约 0.55～0.65） */
export const WHITE_ALBEDO = 0.6;

/** 颜色的相对亮度（线性） */
export function luminance(color) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** 白色材质的颜色：线性亮度超过 WHITE_ALBEDO 时按比例压到上限，色相不变 */
export function whiteMaterial(hex) {
  const c = new THREE.Color(hex);
  const l = luminance(c);
  return l > WHITE_ALBEDO ? c.multiplyScalar(WHITE_ALBEDO / l) : c;
}

/** 要在 distance 米外得到 lux 的照度，这种颜色的灯需要多少坎德拉 */
export function candela(lux, distance, color = 0xffffff) {
  return (lux * distance * distance) / luminance(color);
}
