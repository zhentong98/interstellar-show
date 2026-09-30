// 薄雾中的体积光和浮尘。
//
// 光束：开口圆锥 + 加法混合的着色器。烟雾里看到的光柱亮度正比于视线穿过光锥的那一段长度，
// 所以着色器按视线和光锥的解析交点算出这段路径（而不是按表面朝向估一个"厚度"），
// 再乘上沿光束的衰减、截面的柔边和缓慢流动的三维噪声。
//
// 光锥是封闭的（带底面），伸到舞台面以下的部分在顶点着色器里沿母线压回舞台面上，
// 于是锥体的"背面"正好是视线离开光雾的地方：锥面，或者光斑所在的那块地板。
// 只画背面（出口点），并照常做深度测试：
//   - 出口点前面没有东西 → 整段路径都在镜头和背景之间，完整画出
//   - 出口点被乐手、乐器挡住（人站在光里）→ 这一像素不画
// 于是站在光柱里的人和乐器不会被自己身后那半截光柱盖住；镜头钻进光锥里时也只是均匀的一层薄雾，
// 不会像旧做法那样把离镜头最近的锥面画成一大团白光。
//
// 真实场馆会严格控制银幕上的溢光，所以光束经过"巨幕在屏幕上的投影区域"时会淡出（uMask），
// 电影画面始终干净；幕布落下或换场时，光束才完整地扫过银幕前方。
//
// 浮尘：几千个粒子，只有落在光束里的才会被照亮（在顶点着色器里逐个光束判断）；
// 离镜头太近的粒子是失焦的大光斑，淡出不画。

import * as THREE from 'three';
import { STAGE_Y } from './layout.js';

const NOISE = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                 mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                 mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const SCREEN_MASK = /* glsl */ `
uniform vec4 uScreenRect; // 巨幕在 NDC 里的范围：xy = 左下，zw = 右上
uniform float uMask;
uniform vec2 uResolution;
float screenMask() {
  vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
  vec2 lo = smoothstep(uScreenRect.xy - 0.03, uScreenRect.xy + 0.02, ndc);
  vec2 hi = 1.0 - smoothstep(uScreenRect.zw - 0.02, uScreenRect.zw + 0.03, ndc);
  return 1.0 - uMask * lo.x * lo.y * hi.x * hi.y;
}
`;

/** 所有光束和浮尘共用的"巨幕遮罩"参数，每帧由 World 更新 */
export const screenMaskUniforms = {
  uScreenRect: { value: new THREE.Vector4(-2, -2, -2, -2) },
  uMask: { value: 1 },
  uResolution: { value: new THREE.Vector2(1, 1) },
};

const beamVertex = /* glsl */ `
uniform vec3 uApex;
uniform float uFloor;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  // 伸到舞台面以下的顶点沿着过顶点的直线（锥面母线 / 轴线）拉回舞台面
  if (w.y < uFloor && uApex.y > uFloor) w.xyz = uApex + (w.xyz - uApex) * ((uFloor - uApex.y) / (w.y - uApex.y));
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform vec3 uApex;    // 光锥的几何顶点（灯口往后一点，锥面在灯口处半径 0.06 米）
uniform vec3 uAxis;    // 光束方向（单位向量）
uniform float uTan;    // 半张角的正切
uniform float uStart;  // 灯口到顶点的距离
uniform float uLength; // 光束长度（从灯口量起）
uniform float uFalloff;
varying vec3 vWorld;
${NOISE}
${SCREEN_MASK}
void main() {
  // 这个片元在光锥的背面（锥面、末端截面或压到地板上的底面），就是视线离开光雾的出口点
  vec3 toFrag = vWorld - cameraPosition;
  float tExit = length(toFrag);
  vec3 rd = toFrag / tExit;
  // 入口：镜头在光锥里就从镜头算起；否则取视线与锥面 (h² = cos²·|p - 顶点|²) 的交点里
  // 在出口之前、落在正向锥体上的最后一个；从末端截面外面进来时取截面
  vec3 co = cameraPosition - uApex;
  float c2 = 1.0 / (1.0 + uTan * uTan); // 半张角余弦的平方
  float dv = dot(rd, uAxis);
  float cv = dot(co, uAxis);
  float qa = dv * dv - c2;
  float qb = 2.0 * (dv * cv - dot(rd, co) * c2);
  float qc = cv * cv - dot(co, co) * c2;
  float hEnd = uStart + uLength;
  float tIn = (qc > 0.0 && cv > 0.0 && cv < hEnd) ? 0.0 : -1.0;
  float before = tExit - 0.05; // 锥面是 40 边形近似的，出口本身对应的那个根要排除掉
  float disc = qb * qb - 4.0 * qa * qc;
  if (disc > 0.0 && abs(qa) > 1e-6) {
    float s = sqrt(disc);
    float r1 = (-qb - s) / (2.0 * qa);
    float r2 = (-qb + s) / (2.0 * qa);
    if (r1 < before && cv + r1 * dv > 0.0) tIn = max(tIn, r1);
    if (r2 < before && cv + r2 * dv > 0.0) tIn = max(tIn, r2);
  }
  if (dv < 0.0) {
    float tCap = (hEnd - cv) / dv;
    if (tCap < before) tIn = max(tIn, tCap);
  }
  // 找不到入口：擦着锥面边缘的视线，这段路径可以忽略
  if (tIn < 0.0) tIn = tExit;
  float seg = tExit - min(tIn, tExit);

  // 用路径中点估计这段光的亮度：沿光束的位置、离轴的远近
  vec3 mid = cameraPosition + rd * (0.5 * (tIn + tExit));
  float h = max(dot(mid - uApex, uAxis), 1e-3);
  float radius = h * uTan;
  float q = length(mid - uApex - uAxis * h) / radius;
  float along = clamp((h - uStart) / uLength, 0.0, 1.0);
  float fall = smoothstep(0.0, 0.05, along) * pow(1.0 - along, uFalloff);
  // 以"垂直穿过光束中心"为 1 的相对厚度；顺着光束看进去时路径很长，柔性封顶
  float thick = seg / (2.0 * radius);
  thick /= 1.0 + 0.35 * max(thick - 1.0, 0.0);
  float core = 1.0 - smoothstep(0.35, 1.0, q);
  float haze = 0.45 + 0.55 * noise3(mid * 0.55 + vec3(0.0, uTime * 0.07, uTime * 0.04));
  // 系数 2：与旧版正反两面各画一次的中心亮度保持一致
  float a = 2.0 * uIntensity * thick * core * fall * haze * screenMask();
  gl_FragColor = vec4(uColor * a, a * 0.35);
}
`;

const LIP = 0.06; // 灯口处的光束半径（米）

/** 一束体积光：从 from 射向 to，半张角 angle（弧度）；falloff 越大，光柱沿长度消散得越快；floor 以下是舞台面 */
export class Beam {
  constructor({ from, to, angle, color = 0xffd8b0, length = null, falloff = 1.4, floor = STAGE_Y }) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = length ?? dir.length() * 1.05;
    const tan = Math.tan(angle);
    this.uniforms = {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uApex: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, -1, 0) },
      uTan: { value: tan },
      uStart: { value: LIP / tan },
      uLength: { value: len },
      uFalloff: { value: falloff },
      uFloor: { value: floor + 0.01 }, // 比地板高 1 厘米，免得和地板争深度
      ...screenMaskUniforms,
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
      side: THREE.BackSide,
    });
    const r = LIP + tan * len;
    // 封闭的锥体：末端截面（压到地板上就是光斑）也是视线离开光雾的出口
    const geo = new THREE.CylinderGeometry(LIP, r, len, 40, 1, false).translate(0, -len / 2, 0);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.position.copy(from);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.from = from.clone();
    this.angle = angle;
    this.aim(to);
  }

  aim(to) {
    this.dir = new THREE.Vector3().subVectors(to, this.from).normalize();
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.dir);
    this.uniforms.uAxis.value.copy(this.dir);
    this.uniforms.uApex.value.copy(this.from).addScaledVector(this.dir, -this.uniforms.uStart.value);
  }

  set intensity(v) {
    this.uniforms.uIntensity.value = v;
    this.mesh.visible = v > 0.002;
  }

  get intensity() {
    return this.uniforms.uIntensity.value;
  }
}

const MAX_BEAMS = 12;

const dustVertex = /* glsl */ `
uniform float uTime;
uniform float uPixel;
uniform vec3 uBeamFrom[${MAX_BEAMS}];
uniform vec3 uBeamDir[${MAX_BEAMS}];
uniform float uBeamCos[${MAX_BEAMS}];
uniform float uBeamIntensity[${MAX_BEAMS}];
uniform vec3 uBeamColor[${MAX_BEAMS}];
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
attribute float aSeed;
varying vec3 vColor;
void main() {
  // 缓慢飘动，出了范围从另一边绕回来
  vec3 drift = vec3(sin(uTime * 0.07 + aSeed * 6.0) * 0.4, uTime * (0.02 + aSeed * 0.03), cos(uTime * 0.05 + aSeed * 9.0) * 0.4);
  vec3 p = uBoxMin + mod(position - uBoxMin + drift, uBoxSize);
  vec3 light = vec3(0.0);
  for (int i = 0; i < ${MAX_BEAMS}; i++) {
    vec3 d = p - uBeamFrom[i];
    float c = dot(normalize(d), uBeamDir[i]);
    float inside = smoothstep(uBeamCos[i], mix(uBeamCos[i], 1.0, 0.25), c);
    light += uBeamColor[i] * inside * uBeamIntensity[i] / (1.0 + 0.004 * dot(d, d));
  }
  float twinkle = 0.6 + 0.4 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 40.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // 贴着镜头的粒子是失焦的大光斑（特写机位里尤其明显），淡出
  vColor = light * twinkle * smoothstep(0.8, 2.5, -mv.z);
  gl_PointSize = uPixel * (0.6 + aSeed) / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const dustFragment = /* glsl */ `
varying vec3 vColor;
${SCREEN_MASK}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c)) * screenMask();
  vec3 col = vColor * a;
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)) * 0.5);
}
`;

/** 浮尘：只在光束里发亮 */
export class Dust {
  constructor({ count = 3000, min = new THREE.Vector3(-12, 0.6, -12), max = new THREE.Vector3(12, 15, 8) } = {}) {
    const size = new THREE.Vector3().subVectors(max, min);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = min.x + Math.random() * size.x;
      pos[i * 3 + 1] = min.y + Math.random() * size.y;
      pos[i * 3 + 2] = min.z + Math.random() * size.z;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uPixel: { value: 60 },
      uBeamFrom: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector3()) },
      uBeamDir: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector3(0, -1, 0)) },
      uBeamCos: { value: new Array(MAX_BEAMS).fill(1) },
      uBeamIntensity: { value: new Array(MAX_BEAMS).fill(0) },
      uBeamColor: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Color()) },
      uBoxMin: { value: min },
      uBoxSize: { value: size },
      ...screenMaskUniforms,
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
  }

  /** 把最重要的几束光交给浮尘着色器 */
  setBeams(beams) {
    const u = this.uniforms;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const b = beams[i];
      u.uBeamIntensity.value[i] = b ? b.intensity * 1.6 : 0;
      if (!b) continue;
      u.uBeamFrom.value[i].copy(b.from);
      u.uBeamDir.value[i].copy(b.dir);
      u.uBeamCos.value[i] = Math.cos(b.angle);
      u.uBeamColor.value[i].copy(b.uniforms.uColor.value);
    }
  }

  update(dt, pixelScale) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uPixel.value = pixelScale;
  }
}
