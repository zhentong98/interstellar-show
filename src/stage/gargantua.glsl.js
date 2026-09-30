// 巨幕覆盖层的片元着色器。
//
// 这一层和 YouTube iframe 完全重合，用 NoBlending 直接写入颜色和 alpha：
//   alpha = 0 → WebGL 画布在这里"挖洞"，露出下面 CSS3D 层里的视频
//   alpha = 1 → 盖住视频
// 从下到上叠三层（预乘 alpha 的 over 合成）：
//   幕布（极暗的丝绒）→ 标题卡（Canvas 贴图）→ 黑洞 Gargantua（自绘的引力透镜）
//
// Gargantua 是原创的近似画法：黑洞阴影 + 光子环 + 倾斜的吸积盘主像
// + 被弯折到阴影上下方的盘背面光环 + 被透镜扭曲的星空。

export const screenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const screenFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uAspect;
uniform float uCurtain;
uniform float uCard;
uniform float uGargantua;
uniform sampler2D tCard;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

vec3 stars(vec2 p) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 3; l++) {
    float scale = 55.0 + float(l) * 65.0;
    vec2 g = p * scale;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(id + float(l) * 17.0);
    if (h > 0.96) {
      vec2 off = vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5;
      float d = length(f - off * 0.6);
      float b = smoothstep(0.09, 0.0, d) * (h - 0.96) / 0.04;
      col += b * mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.88, 0.72), hash(id + 3.0));
    }
  }
  return col;
}

vec3 gargantua(vec2 uv, float t) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  // 极缓慢地推近，让画面一直在"活"
  p *= 1.0 - 0.02 * sin(t * 0.05);
  float r = length(p);
  float rs = 0.16; // 阴影半径
  float ang = atan(p.y, p.x);

  // 背景星空：按点透镜公式 β = θ - θE²/θ 采样，靠近黑洞的星光被拉成弧
  float rE = rs * 1.35;
  vec2 src = p * (1.0 - (rE * rE) / max(r * r, 1e-4));
  vec3 col = stars(src + vec2(t * 0.002, 0.0)) * 0.9;

  // 吸积盘主像：倾斜的薄盘，在屏幕上是一条水平的亮带
  float tilt = 0.11;
  vec2 d = vec2(p.x, p.y / tilt);
  float dr = length(d);
  float swirl = fbm(vec2(dr * 16.0 - t * 0.35, atan(d.y, d.x) * 2.5 + t * 0.12));
  float diskMask = smoothstep(rs * 1.2, rs * 1.65, dr) * smoothstep(1.05, 0.4, dr);
  float disk = diskMask * (0.35 + 0.95 * swirl) * exp(-(dr - rs * 1.6) * 2.4);
  // 盘的远侧被阴影挡住，近侧从阴影前方横穿
  disk *= (r < rs * 1.02 && p.y > 0.0) ? 0.0 : 1.0;

  // 盘背面被引力弯折到阴影上下方，形成拱形光环：顶部最厚最亮，底部次之，两侧最薄
  float s = abs(sin(ang));
  float top = p.y > 0.0 ? 1.0 : 0.65;
  float halo = smoothstep(rs * 1.05, rs * 1.16, r)
             * exp(-max(r - rs * 1.16, 0.0) / (0.018 + 0.1 * pow(s, 1.5) * top))
             * (0.45 + 0.9 * fbm(vec2(r * 22.0 - t * 0.3, ang * 3.0)))
             * (0.5 + 0.6 * s * top);

  // 光子环
  float ring = exp(-pow((r - rs * 1.04) / 0.0035, 2.0)) * 1.1
             + exp(-pow((r - rs * 1.04) / 0.018, 2.0)) * 0.22;

  float shadow = smoothstep(rs * 0.97, rs * 1.01, r);
  vec3 warm = vec3(1.0, 0.58, 0.26);
  vec3 hot = vec3(1.0, 0.9, 0.72);
  vec3 lum = mix(warm, hot, clamp(disk * 0.7, 0.0, 1.0)) * disk * 1.7
           + mix(warm, hot, 0.45) * halo * 1.3
           + hot * ring;
  col = col * shadow + lum;
  return 1.0 - exp(-col * 1.25); // 简单的曝光曲线，高光不会硬切
}

vec3 velvet(vec2 uv) {
  // 极暗的丝绒幕布，带一点竖向褶皱
  float folds = 0.6 + 0.4 * sin(uv.x * 95.0 + sin(uv.x * 13.0) * 2.0);
  return vec3(0.016, 0.011, 0.011) * folds;
}

void main() {
  // 预乘 alpha 的 over 合成，从视频（透明）往上叠
  vec4 outc = vec4(0.0);
  float c = uCurtain;
  outc = vec4(velvet(vUv) * c, c) + outc * (1.0 - c);
  if (uCard > 0.001) {
    vec3 card = texture2D(tCard, vUv).rgb;
    outc = vec4(card * uCard, uCard) + outc * (1.0 - uCard);
  }
  if (uGargantua > 0.001) {
    vec3 g = gargantua(vUv, uTime);
    outc = vec4(g * uGargantua, uGargantua) + outc * (1.0 - uGargantua);
  }
  gl_FragColor = outc;
}
`;
