// 后处理：MSAA 半精度渲染目标 → Bloom → ACES 色调映射 + sRGB 输出。
//
// 巨幕的"挖洞"靠 alpha 通道：覆盖层在洞里写 alpha = 0。整条后处理链都保留 alpha：
//   - RenderPass 写入带 alpha 的 RGBA 渲染目标
//   - UnrealBloomPass 以预乘 alpha 叠加光晕：洞边上的光晕会自然地覆盖在视频边缘（真实场馆也是这样）
//   - OutputPass 只改颜色、不改 alpha
// 最终画面仍然在洞的位置透明，露出下面 CSS3D 层里的 YouTube 视频。

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from '../core/math.js';

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.62, 0.82);
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
