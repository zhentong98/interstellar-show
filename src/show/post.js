// 后处理：MSAA 半精度渲染目标 → Bloom → ACES 色调映射 + sRGB 输出。
//
// 巨幕的"挖洞"靠 alpha 通道：覆盖层在洞里写 alpha = 0。整条后处理链都保留 alpha：
//   - RenderPass 写入带 alpha 的 RGBA 渲染目标
//   - UnrealBloomPass 以预乘 alpha 叠加光晕：洞边上的光晕会自然地覆盖在视频边缘（真实场馆也是这样）
//   - OutputPass 只改颜色、不改 alpha
// 最终画面仍然在洞的位置透明，露出下面 CSS3D 层里的 YouTube 视频。
//
// Bloom 只让"比门槛亮出来的那部分能量"发光（软膝减门槛），而不是 three.js 默认的
// "超过门槛就整个像素都进光晕"：灯头、音管底光、爆闪这类真正的光源照样晕开，
// 刚好擦过门槛的白衬衫、琴键只会有极淡的一点光晕，不会被晕成一团。
// 门槛是色调映射之前的线性亮度；灯光预算（stageLights.js）保证漫反射表面在演奏时低于门槛。

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from '../core/math.js';

const THRESHOLD = 1.0;
const KNEE = 0.2; // 门槛上下这么宽的范围里平滑过渡

/** 软膝减门槛的高通：输出 = 颜色 × (超出门槛的亮度 / 亮度) */
const softKneeHighPass = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float smoothWidth;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float v = luminance(texel.rgb);
  float soft = clamp(v - luminosityThreshold + smoothWidth, 0.0, 2.0 * smoothWidth);
  soft = soft * soft / (4.0 * smoothWidth + 1e-5);
  float excess = max(soft, v - luminosityThreshold);
  gl_FragColor = vec4(texel.rgb * (excess / max(v, 1e-5)), texel.a);
}
`;

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.62, THRESHOLD);
    this.bloom.materialHighPassFilter.fragmentShader = softKneeHighPass;
    this.bloom.materialHighPassFilter.needsUpdate = true;
    this.bloom.highPassUniforms.smoothWidth.value = KNEE;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.base = 0.55;
    this.boost = 0;
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  /** 高潮时光晕瞬间变强 */
  kick(amount) {
    this.boost = Math.max(this.boost, amount);
  }

  render(dt, extra = 0) {
    this.boost = damp(this.boost, 0, 3, dt);
    this.bloom.strength = this.base + extra + this.boost;
    this.composer.render(dt);
  }
}
