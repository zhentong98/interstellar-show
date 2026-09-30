// 把摆好姿势的蒙皮模型"烘焙"成静态几何体（后排乐手用）：
// 同一个人物、同一个姿势只烘焙一次，然后做成 InstancedMesh，几十个后排乐手只需要几次绘制。

import * as THREE from 'three';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _blend = new THREE.Matrix4();
const _nm = new THREE.Matrix3();

/**
 * @param {import('./modelRig.js').ModelRig} rig 已经摆好姿势、root 在原点的模型
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[] }[]}
 */
export function bakePose(rig) {
  rig.root.updateMatrixWorld(true);
  const rootInv = rig.root.matrixWorld.clone().invert();
  return rig.meshes.map((mesh) => {
    const src = mesh.geometry;
    const pos = src.attributes.position;
    const nor = src.attributes.normal;
    const count = pos.count;
    const outPos = new Float32Array(count * 3);
    const outNor = new Float32Array(count * 3);
    // 网格局部 → root 局部
    const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);

    let boneMats = null;
    if (mesh.isSkinnedMesh) {
      mesh.skeleton.update();
      // 每根骨骼的蒙皮矩阵：bindMatrixInverse · bone.matrixWorld · boneInverse · bindMatrix
      boneMats = mesh.skeleton.bones.map((b, i) => new THREE.Matrix4()
        .multiplyMatrices(mesh.bindMatrixInverse, b.matrixWorld)
        .multiply(mesh.skeleton.boneInverses[i])
        .multiply(mesh.bindMatrix));
    }
    const si = src.attributes.skinIndex;
    const sw = src.attributes.skinWeight;
    for (let i = 0; i < count; i++) {
      _p.fromBufferAttribute(pos, i);
      if (nor) _n.fromBufferAttribute(nor, i);
      if (boneMats) {
        _blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          if (w === 0) continue;
          const e = boneMats[si.getComponent(i, k)].elements;
          const b = _blend.elements;
          for (let j = 0; j < 16; j++) b[j] += e[j] * w;
        }
        _m.multiplyMatrices(toRoot, _blend);
      } else {
        _m.copy(toRoot);
      }
      _p.applyMatrix4(_m);
      outPos[i * 3] = _p.x;
      outPos[i * 3 + 1] = _p.y;
      outPos[i * 3 + 2] = _p.z;
      if (nor) {
        _n.applyMatrix3(_nm.getNormalMatrix(_m)).normalize();
        outNor[i * 3] = _n.x;
        outNor[i * 3 + 1] = _n.y;
        outNor[i * 3 + 2] = _n.z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
    if (nor) geometry.setAttribute('normal', new THREE.BufferAttribute(outNor, 3));
    else geometry.computeVertexNormals();
    for (const name of ['uv', 'uv1', 'color']) {
      if (src.attributes[name]) geometry.setAttribute(name, src.attributes[name]);
    }
    if (src.index) geometry.setIndex(src.index);
    for (const g of src.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    geometry.computeBoundingSphere();
    return { geometry, material: mesh.material };
  });
}
