// 薄雾中的体积光和浮尘。
//
// 光束：开口圆锥 + 加法混合的着色器。亮度沿光束长度衰减，边缘按视角柔化，
// 再叠一层缓慢流动的三维噪声，看起来像光打在舞台烟雾上。
// 真实场馆会严格控制银幕上的溢光，所以光束经过"巨幕在屏幕上的投影区域"时会淡出（uMask），
// 电影画面始终干净；幕布落下或换场时，光束才完整地扫过银幕前方。
//
// 浮尘：几千个粒子，只有落在光束里的才会被照亮（在顶点着色器里逐个光束判断）。

import * as THREE from 'three';

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
uniform float uLength;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAlong;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vAlong = -position.y / uLength;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAlong;
${NOISE}
${SCREEN_MASK}
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vNormalW), viewDir));
  float edge = pow(facing, 2.2);
  float along = clamp(vAlong, 0.0, 1.0);
  float fall = smoothstep(0.0, 0.05, along) * pow(1.0 - along, 1.4);
  float haze = 0.45 + 0.55 * noise3(vWorld * 0.55 + vec3(0.0, uTime * 0.07, uTime * 0.04));
  float a = uIntensity * edge * fall * haze * screenMask();
  gl_FragColor = vec4(uColor * a, a * 0.35);
}
`;

/** 一束体积光：从 from 射向 to，半张角 angle（弧度） */
export class Beam {
  constructor({ from, to, angle, color = 0xffd8b0, length = null }) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = length ?? dir.length() * 1.05;
    this.uniforms = {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uLength: { value: len },
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
      side: THREE.DoubleSide,
    });
    const r = Math.tan(angle) * len;
    const geo = new THREE.CylinderGeometry(0.06, r, len, 40, 1, true).translate(0, -len / 2, 0);
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
  vColor = light * twinkle;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
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
