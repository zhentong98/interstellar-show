// 写实人物模型（演员表）：读取 public/models/cast.json，加载其中列出的角色和动作。
// 没有这个文件时返回 null，乐团继续用程序化的人体。
//
// cast.json 格式（示例见 docs/assets-to-download.md）：
// {
//   "characters": [
//     { "file": "man-suit-1.glb", "gender": "man", "roles": ["strings", "choir", "conductor"], "height": 1.78 },
//     { "file": "woman-dress-1.fbx", "gender": "woman", "roles": ["strings", "choir"] }
//   ],
//   "animations": { "sitIdle": "anims/sitting-idle.fbx", "standIdle": "anims/standing-idle.fbx" }
// }
// 支持 glTF/GLB（可用 Draco 或 Meshopt 压缩）和 Mixamo 直接下载的 FBX。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = `${import.meta.env.BASE_URL}models/`;

function loaders() {
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const gltf = new GLTFLoader();
  gltf.setDRACOLoader(draco);
  gltf.setMeshoptDecoder(MeshoptDecoder);
  return { gltf, fbx: new FBXLoader() };
}

async function loadFile(l, file) {
  const url = BASE + file;
  if (/\.fbx$/i.test(file)) {
    const obj = await l.fbx.loadAsync(url);
    return { scene: obj, animations: obj.animations };
  }
  const g = await l.gltf.loadAsync(url);
  return { scene: g.scene, animations: g.animations };
}

/**
 * 按材质名换成更写实的着色（scripts/make_cast.py 生成的模型用这些名字）：
 * 西装 / 长裙是带织物光泽的哑光黑，皮肤有细微的绒毛光泽，皮鞋是亮面清漆，头发有丝状高光。
 */
const REALISTIC = {
  suit: (m) => new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, roughness: 0.86, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x2a2a34) }),
  shirt: (m) => new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, roughness: 0.75, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) }),
  skin: (m) => new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, roughness: 0.52, sheen: 0.35, sheenRoughness: 0.35, sheenColor: new THREE.Color(0xff9a80), specularIntensity: 0.5 }),
  hair: (m) => new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, roughness: 0.55, sheen: 1, sheenRoughness: 0.3, sheenColor: m.color.clone().multiplyScalar(3) }),
  shoes: (m) => new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
  eye: (m) => new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, roughness: 0.1, clearcoat: 1 }),
};

/**
 * 统一材质：FBX 常见的 Phong 材质换成 PBR，头发等半透明贴图改成 alphaTest，
 * 避免大量半透明物体排序出错。
 */
function prepareMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const fix = (m) => {
      const realistic = REALISTIC[(m.name ?? '').replace(/\.\d+$/, '')];
      if (realistic) return realistic(m);
      let mat = m;
      if (!mat.isMeshStandardMaterial) {
        mat = new THREE.MeshStandardMaterial({
          name: m.name, color: m.color, map: m.map, normalMap: m.normalMap,
          alphaMap: m.alphaMap, transparent: m.transparent, opacity: m.opacity, side: m.side,
          roughness: 0.7, metalness: 0,
        });
      }
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      if (mat.transparent || mat.alphaMap) {
        mat.transparent = false;
        mat.alphaTest = 0.5;
        mat.side = THREE.DoubleSide;
      }
      return mat;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
}

/** 加载演员表；没有 cast.json 或加载失败时返回 null */
export async function loadCast() {
  let manifest;
  try {
    const res = await fetch(`${BASE}cast.json`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    manifest = await res.json();
  } catch {
    return null;
  }
  const l = loaders();
  const characters = [];
  for (const c of manifest.characters ?? []) {
    try {
      const { scene } = await loadFile(l, c.file);
      prepareMaterials(scene);
      characters.push({ ...c, source: scene, roles: c.roles ?? ['strings', 'choir', 'timpani', 'organ', 'conductor'] });
    } catch (err) {
      console.warn(`人物模型加载失败：${c.file}`, err);
    }
  }
  const clips = {};
  const animationFiles = { ...manifest.animations };
  // 本地动作不提交到公开仓库，仅在开发环境显式开启时加载。
  if (import.meta.env.DEV && import.meta.env.VITE_LOCAL_MIXAMO === '1') {
    Object.assign(animationFiles, {
      sitIdle: 'anims/sitting-idle.fbx',
      standIdle: 'anims/standing-idle.fbx',
    });
  }
  for (const [name, file] of Object.entries(animationFiles)) {
    try {
      const { animations } = await loadFile(l, file);
      if (animations?.[0]) clips[name] = animations[0];
    } catch (err) {
      console.warn(`动作加载失败：${file}`, err);
    }
  }
  if (!characters.length) return null;
  return { characters, clips };
}

/** 按角色类型和性别挑一个模型；同类里轮流用，避免一排人长得一样 */
export function pickCharacter(cast, role, gender, n) {
  let pool = cast.characters.filter((c) => c.roles.includes(role) && (!gender || c.gender === gender));
  if (!pool.length) pool = cast.characters.filter((c) => c.roles.includes(role));
  if (!pool.length) pool = cast.characters;
  return pool[n % pool.length];
}
