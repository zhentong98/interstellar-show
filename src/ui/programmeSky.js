// 节目单的主视觉：黑洞 Gargantua。
// 和换场时巨幕上的黑洞是同一套着色器（src/stage/gargantua.glsl.js），同样经过 Bloom 和 ACES。
// 单独一块低分辨率画布，最多 30 帧/秒，页面不可见时暂停；入场后销毁，不占演出时的显卡。

import * as THREE from 'three';
import { screenVertex, screenFragment } from '../stage/gargantua.glsl.js';
import { PostFX } from '../show/post.js';

const FRAME = 1 / 30;

/**
 * @param {HTMLElement} host 画布的容器（尺寸由 CSS 决定，黑洞画在它的正中）
 * @returns {{ dispose(): void }}
 */
export function createProgrammeSky(host) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch {
    // 没有 WebGL：节目单照样能用，只是没有黑洞
    return { dispose() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // 巨幕上的黑洞周围是暗场，这里整屏都是它：曝光和光晕都要比音乐厅里低得多，否则吸积盘会糊成一团白
  renderer.toneMappingExposure = 0.42;
  renderer.setClearColor(0x000000, 1);
  host.appendChild(renderer.domElement);

  const uniforms = {
    uTime: { value: 20 }, // 从有星光流动的时刻开始
    uAspect: { value: 1 },
    uCurtain: { value: 0 },
    uCard: { value: 0 },
    uGargantua: { value: 1 },
    tCard: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({ vertexShader: screenVertex, fragmentShader: screenFragment, uniforms, toneMapped: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const post = new PostFX(renderer, scene, camera);
  post.base = 0.3;

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    uniforms.uAspect.value = w / h;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let raf = 0;
  let last = performance.now();
  let pending = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    pending += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (pending < FRAME || document.hidden) return;
    uniforms.uTime.value += pending;
    post.render(pending);
    pending = 0;
  };
  raf = requestAnimationFrame(loop);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      post.composer.dispose();
      material.dispose();
      uniforms.tCard.value.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
