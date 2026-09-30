// 巨幕：YouTube iframe 在 CSS3D 层，WebGL 层在同一位置放一块完全重合的覆盖平面。
//
// 渲染层次（见设计文档"巨幕的渲染层次"）：
//   - CSS3D 层在最底层，WebGL 画布叠在上面
//   - 覆盖平面用 NoBlending 写入 alpha = 0，在 WebGL 画面上"挖洞"露出视频
//   - 覆盖平面参与深度测试，站在银幕前的人物会正常遮住视频
//   - 同一块平面还负责画幕布、开场标题卡和黑洞 Gargantua 过渡

import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { SCREEN } from './layout.js';
import { screenVertex, screenFragment } from './gargantua.glsl.js';
import { clamp01 } from '../core/math.js';
import { fontsReady, drawSpaced, SERIF_LATIN, SERIF_CJK } from '../ui/fonts.js';

const PX_WIDTH = 1920; // iframe 的 CSS 像素宽度，决定 YouTube 选择的清晰度
const OVERSCAN = 1.006; // iframe 比挖洞区域略大一点，洞的边缘只会露出视频本身

export class GiantScreen {
  constructor() {
    // —— CSS3D：承载 iframe 的 DOM ——
    const pxHeight = Math.round((PX_WIDTH * SCREEN.height) / SCREEN.width);
    const host = document.createElement('div');
    host.className = 'screen-host';
    host.style.width = `${PX_WIDTH}px`;
    host.style.height = `${pxHeight}px`;
    this.cssObject = new CSS3DObject(host);
    host.style.pointerEvents = 'none'; // 观众不能点到视频（CSS3DObject 默认会设成 auto）
    this.cssObject.position.copy(SCREEN.center);
    this.cssObject.scale.setScalar((SCREEN.width * OVERSCAN) / PX_WIDTH);
    this.host = host;

    // —— WebGL：覆盖平面 ——
    this.cardCanvas = document.createElement('canvas');
    this.cardCanvas.width = 2048;
    this.cardCanvas.height = 1152;
    this.cardTexture = new THREE.CanvasTexture(this.cardCanvas);
    // 保持默认色彩空间：着色器直接输出贴图原值，和 Canvas 上看到的一致

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: SCREEN.width / SCREEN.height },
      uCurtain: { value: 1 },
      uCard: { value: 0 },
      uGargantua: { value: 0 },
      tCard: { value: this.cardTexture },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: screenVertex,
      fragmentShader: screenFragment,
      uniforms: this.uniforms,
      blending: THREE.NoBlending,
      transparent: false,
      depthWrite: true,
      toneMapped: false,
    });
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.width, SCREEN.height), material);
    this.overlay.position.copy(SCREEN.center);
    this.overlay.name = '巨幕覆盖层';

    // 三层的淡入淡出：{ value, from, to, start, duration }
    this.layers = {};
    for (const [name, value] of [['curtain', 1], ['card', 0], ['gargantua', 0]]) {
      this.layers[name] = { value, from: value, to: value, start: 0, duration: 0 };
    }
    this.clock = 0;
  }

  /**
   * 设置各层目标不透明度，seconds 秒内渐变。例如 set({ curtain: 0 }, 0.8) 拉开幕布。
   * 目标没变时不会重启渐变，所以可以每帧调用。
   */
  set(targets, seconds = 1) {
    for (const [name, to] of Object.entries(targets)) {
      const layer = this.layers[name];
      if (!layer || layer.to === to) continue;
      Object.assign(layer, { from: layer.value, to, start: this.clock, duration: Math.max(0.001, seconds) });
    }
  }

  /** 立即设置（跳过环节时用） */
  snap(targets) {
    for (const [name, v] of Object.entries(targets)) {
      Object.assign(this.layers[name], { value: v, from: v, to: v, duration: 0 });
    }
  }

  update(dt) {
    this.clock += dt;
    this.uniforms.uTime.value = this.clock;
    for (const [name, layer] of Object.entries(this.layers)) {
      if (layer.duration > 0) {
        const k = clamp01((this.clock - layer.start) / layer.duration);
        const e = k * k * (3 - 2 * k);
        layer.value = layer.from + (layer.to - layer.from) * e;
        if (k >= 1) layer.duration = 0;
      }
      this.uniforms[`u${name[0].toUpperCase()}${name.slice(1)}`].value = layer.value;
    }
  }

  /** 视频是否完全被盖住（用于判断能不能安全地预加载） */
  get covered() {
    const { curtain, card, gargantua } = this.layers;
    return Math.max(curtain.value, card.value, gargantua.value) >= 0.999;
  }

  /** 开演前巨幕上的标题卡 */
  async drawTitleCard() {
    await fontsReady();
    const ctx = this.cardCanvas.getContext('2d');
    const w = this.cardCanvas.width;
    const h = this.cardCanvas.height;
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
    bg.addColorStop(0, '#0d0b0a');
    bg.addColorStop(1, '#020202');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e9e1d2';
    ctx.font = `500 150px ${SERIF_LATIN}`;
    drawSpaced(ctx, 'INTERSTELLAR', w / 2, h * 0.47, 38);

    ctx.strokeStyle = 'rgba(201, 164, 106, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 260, h * 0.53);
    ctx.lineTo(w / 2 + 260, h * 0.53);
    ctx.stroke();

    ctx.fillStyle = '#c9b89a';
    ctx.font = `400 58px ${SERIF_CJK}`;
    drawSpaced(ctx, '星际穿越 · 电影交响音乐会', w / 2, h * 0.62, 10);
    ctx.fillStyle = 'rgba(201, 184, 154, 0.55)';
    ctx.font = `italic 400 44px ${SERIF_LATIN}`;
    ctx.fillText('Live to Picture', w / 2, h * 0.7);
    this.cardTexture.needsUpdate = true;
  }
}
