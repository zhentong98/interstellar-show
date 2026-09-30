// 程序化贴图：全部用 Canvas 现场生成，不依赖外部图片（没有授权问题，也不增加下载体积）。
// 木纹（乐器的枫木/云杉）、舞台地板、墙面木板、琴键。

import * as THREE from 'three';
import { seededRandom } from '../core/math.js';
import { whiteMaterial } from './lightBudget.js';

/** 平滑的二维值噪声，周期为 period，可无缝平铺 */
function valueNoise(rand, period) {
  const grid = Array.from({ length: period * period }, () => rand());
  const at = (x, y) => grid[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
}

function canvasTexture(size, draw, { srgb = true, repeat = [1, 1] } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 木纹：沿 y 方向的年轮线，被噪声扭曲；flame 控制横向"虎纹"（小提琴背板的枫木火焰纹）。
 * base / dark 是 [r, g, b]（0~255）。
 */
function woodPixels(ctx, size, { base, dark, rings = 26, warp = 3.5, flame = 0, seed = 1 }) {
  const rand = seededRandom(seed);
  const n1 = valueNoise(rand, 8);
  const n2 = valueNoise(rand, 32);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const w = n1(u * 8, v * 8) * warp + n2(u * 32, v * 32) * 0.35;
      let g = 0.5 + 0.5 * Math.sin((u * rings + w) * Math.PI * 2);
      g = Math.pow(g, 3);
      const fl = flame ? 0.5 + 0.5 * Math.sin((v * 40 + n1(u * 8, v * 8) * 4) * Math.PI) : 0.5;
      const k = Math.min(1, g * 0.7 + (fl - 0.5) * flame + n2(u * 32 + 7, v * 32) * 0.15);
      const i = (y * size + x) * 4;
      img.data[i] = base[0] + (dark[0] - base[0]) * k;
      img.data[i + 1] = base[1] + (dark[1] - base[1]) * k;
      img.data[i + 2] = base[2] + (dark[2] - base[2]) * k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

/** 小提琴类乐器的漆面木纹（红棕色、带火焰纹） */
export const instrumentWood = () => cached('instrument', () => canvasTexture(256, (ctx, s) => woodPixels(ctx, s, {
  base: [178, 74, 24], dark: [92, 30, 8], rings: 18, warp: 2.5, flame: 0.45, seed: 11,
}), { repeat: [4, 4] }));

/** 舞台地板：蜂蜜色长条木板，每块板色调略有不同，板缝暗线 */
export const stageFloor = () => cached('floor', () => canvasTexture(512, (ctx, s) => {
  woodPixels(ctx, s, { base: [120, 78, 44], dark: [70, 42, 22], rings: 40, warp: 2, seed: 5 });
  const rand = seededRandom(17);
  const planks = 8;
  for (let p = 0; p < planks; p++) {
    const x = (p / planks) * s;
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,220,180'},${0.05 + rand() * 0.07})`;
    ctx.fillRect(x, 0, s / planks, s);
    ctx.fillStyle = 'rgba(20,10,4,0.8)';
    ctx.fillRect(x, 0, 1.5, s);
    // 板的接缝错开
    const joint = rand() * s;
    ctx.fillRect(x, joint, s / planks, 1.5);
  }
}, { repeat: [6, 6] }));

/** 墙面：深色胡桃木 */
export const wallWood = () => cached('wall', () => canvasTexture(256, (ctx, s) => woodPixels(ctx, s, {
  base: [98, 62, 38], dark: [52, 30, 18], rings: 14, warp: 4, seed: 23,
}), { repeat: [1, 6] }));

/** 管风琴控制台的琴键：白键 + 黑键，沿贴图 x 方向排列 */
export const organKeys = () => cached('keys', () => canvasTexture(512, (ctx, s) => {
  ctx.fillStyle = `#${whiteMaterial(0xefe8d8).getHexString()}`; // 象牙白键，反照率按白色材质上限
  ctx.fillRect(0, 0, s, s);
  const white = 30;
  const w = s / white;
  ctx.fillStyle = '#6d6558';
  for (let i = 0; i <= white; i++) ctx.fillRect(i * w - 0.5, 0, 1, s);
  ctx.fillStyle = '#141210';
  const pattern = [1, 1, 0, 1, 1, 1, 0];
  for (let i = 0; i < white - 1; i++) {
    if (pattern[i % 7]) ctx.fillRect((i + 1) * w - w * 0.3, 0, w * 0.6, s * 0.6);
  }
}, { srgb: true }));

/** 音管的发光渐变：底部亮、往上渐暗（配合底部打上来的光） */
export const pipeGlow = () => cached('pipeGlow', () => canvasTexture(64, (ctx, s) => {
  const g = ctx.createLinearGradient(0, s, 0, 0);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, '#8a8a8a');
  g.addColorStop(0.7, '#1c1c1c');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}, { srgb: false }));
