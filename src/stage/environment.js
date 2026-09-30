// 环境光照（反射用）：默认用程序生成的"音乐厅"环境——
// 暗色的厅堂、两侧暖色壁灯、舞台上方一排亮灯、正前方一块冷色的巨幕。
// 如果本地放了 HDRI（public/hdri/concert_hall.hdr，例如 Poly Haven 的 CC0 音乐厅全景图），优先使用它。
//
// 两张环境图的绝对亮度毫无关系（HDRI 的平均辐照度约是程序环境的 25 倍），
// 所以每张图都记下自己的平均辐照度（scene.userData.envIrradiance）。
// World 用"想要多少环境光照度"除以它来设置 scene.environmentIntensity，换图时整体亮度不会跳变。

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const HDRI_URL = `${import.meta.env.BASE_URL}hdri/concert_hall.hdr`;

/** 程序环境的平均辐照度（各方向辐照度的平均 = π × 按立体角平均的辐亮度），实测 */
const PROCEDURAL_IRRADIANCE = 0.081;

function hdr(r, g, b) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
}

/** 程序生成的音乐厅环境 */
function proceduralHall(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(32, 22, 50), new THREE.MeshBasicMaterial({ color: 0x0b0806, side: THREE.BackSide })));
  // 两侧墙上的暖色壁灯
  for (const side of [-1, 1]) {
    for (let z = -18; z <= 20; z += 4) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), hdr(4, 2.6, 1.4));
      lamp.position.set(side * 15.5, 4, z);
      scene.add(lamp);
    }
    // 大片的木墙反光
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), hdr(0.12, 0.07, 0.04));
    wall.position.set(side * 15.9, 8, 0);
    wall.rotation.y = -side * Math.PI / 2;
    scene.add(wall);
  }
  // 舞台上方的一排灯
  for (let x = -10; x <= 10; x += 2.5) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), hdr(3, 2.4, 1.8));
    light.position.set(x, 10.8, -6);
    scene.add(light);
  }
  // 巨幕：冷色、大面积、偏暗
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), hdr(0.25, 0.32, 0.45));
  screen.position.set(0, 8, -24.5);
  scene.add(screen);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return tex;
}

/** 等距柱状 HDR 的平均辐照度：π × 按立体角加权的平均辐亮度（隔行隔列采样就够准） */
function equirectIrradiance(tex) {
  const { data, width, height } = tex.image;
  const stride = data.length / (width * height);
  const read = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (x) => x;
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < height; y += 2) {
    const w = Math.sin(((y + 0.5) / height) * Math.PI);
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * stride;
      sum += w * (0.2126 * read(data[i]) + 0.7152 * read(data[i + 1]) + 0.0722 * read(data[i + 2]));
      weight += w;
    }
  }
  return (Math.PI * sum) / weight;
}

export function buildEnvironment(renderer, scene) {
  scene.environment = proceduralHall(renderer);
  scene.userData.envIrradiance = PROCEDURAL_IRRADIANCE;
  // 有本地 HDRI 就换上（先用 HEAD 探测，避免 404 报错）。
  // Vite 开发服务器不认识 .hdr，Content-Type 是空的；只要不是找不到文件时回退的 HTML 页面就算存在。
  fetch(HDRI_URL, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return;
      new HDRLoader().load(HDRI_URL, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const irradiance = equirectIrradiance(tex);
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        scene.userData.envIrradiance = irradiance;
        pmrem.dispose();
        tex.dispose();
      });
    })
    .catch(() => {});
}
