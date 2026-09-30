// 舞台灯光：壮观感的主要来源。
//
//   分区顶光   弦乐、合唱、定音鼓、管风琴各一盏追光（弦乐、合唱投射阴影），带体积光束
//   侧光吊杆   舞台两侧三层窄光，贴着舞台面横扫过乐团（低于银幕下沿，不会碰到电影画面）
//   音管墙底光 管风琴音管墙底部往上打的光柱，配合音管本身的发光渐变；高潮时整面墙亮起来
//   指挥追光   从观众席后方控制室打过来的一道长光柱，入场和谢幕时最醒目
//   逆光       巨幕下方打向乐团，勾出人物轮廓
//   银幕反光   电影画面映在舞台和前排观众身上的冷光；黑洞过渡时变暖
//   白光爆闪   高潮时全场一闪
//
// 颜色随曲目基调（songs.js 的 mood）变化；亮度随演奏强度起伏。
// 光束经过银幕区域时自动淡出（atmosphere.js），真实场馆会严格控制银幕溢光。

import * as THREE from 'three';
import { damp } from '../core/math.js';
import { STAGE_Y, SCREEN, PODIUM, ORGAN_CONSOLE, HALL } from './layout.js';
import { Beam, Dust } from './atmosphere.js';

const WARM = 0xffd2a6;
const v = (x, y, z) => new THREE.Vector3(x, y, z);

/** 各基调的配色：侧光、音管底光 */
const MOODS = {
  preshow: { boom: 0xffb77a, pipe: 0xffc890 },
  calm: { boom: 0x6fa3ff, pipe: 0xa9c2ff },
  rising: { boom: 0xffad63, pipe: 0xffcf95 },
  tense: { boom: 0x3f6dff, pipe: 0xb5c8ff },
  epic: { boom: 0xfff0da, pipe: 0xffd8a0 },
  farewell: { boom: 0xff9a74, pipe: 0xffc3a3 },
};

function spot({ color = WARM, intensity, angle, penumbra = 0.6, position, target, shadow = false }) {
  const light = new THREE.SpotLight(color, intensity, 0, angle, penumbra, 2);
  light.position.copy(position);
  light.target.position.copy(target);
  light.baseIntensity = intensity;
  if (shadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.02;
    light.shadow.camera.near = 4;
    light.shadow.camera.far = 40;
  }
  return light;
}

export class StageLights {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '舞台灯光';
    this.beams = [];

    // —— 分区顶光 ——
    this.sections = [
      { light: spot({ intensity: 2400, angle: 0.44, position: v(-7, 14, 3), target: v(-3.2, STAGE_Y, -3.8), shadow: true }), beam: 0.22 },
      { light: spot({ intensity: 1200, angle: 0.36, position: v(-2.5, 14.5, 0.5), target: v(-1.8, STAGE_Y, -6) }), beam: 0.16 },
      { light: spot({ intensity: 2000, angle: 0.34, position: v(8, 15, -1), target: v(6.8, STAGE_Y + 1, -9), shadow: true }), beam: 0.2 },
      { light: spot({ intensity: 1300, angle: 0.25, position: v(7.5, 13, 2.5), target: v(4.9, STAGE_Y, -3.6) }), beam: 0.22 },
      { light: spot({ intensity: 1000, angle: 0.26, position: v(2.5, 13, -2), target: ORGAN_CONSOLE.clone() }), beam: 0.2 },
    ];
    for (const s of this.sections) {
      s.beamObj = new Beam({ from: s.light.position, to: s.light.target.position, angle: s.light.angle * 0.75 });
    }

    // —— 侧光吊杆：舞台两侧各三层 ——
    this.booms = [];
    for (const side of [-1, 1]) {
      for (const [k, h] of [0.9, 1.9, 2.9].entries()) {
        const from = v(side * (HALL.halfWidth - 1.6), STAGE_Y + h, -3.2 - k * 2.2);
        const to = v(-side * 3, STAGE_Y + h * 0.55, -4.5 - k * 1.5);
        this.booms.push({ beamObj: new Beam({ from, to, angle: 0.085, length: 17 }), from, to, side, k, phase: k * 1.7 + side });
      }
    }
    this.boomLights = [-1, 1].map((side) => spot({
      intensity: 700, angle: 0.55, penumbra: 0.8,
      position: v(side * (HALL.halfWidth - 1.6), STAGE_Y + 2, -5), target: v(-side * 2, STAGE_Y + 1, -5.5),
    }));

    // —— 音管墙底光 ——
    this.uplights = [];
    const pipeZ = SCREEN.center.z + 0.2;
    for (const side of [-1, 1]) {
      for (const x of [SCREEN.width / 2 + 1.1, SCREEN.width / 2 + 2.3, SCREEN.width / 2 + 3.4]) {
        const from = v(side * x, 5.35, pipeZ + 0.35);
        this.uplights.push({ beamObj: new Beam({ from, to: v(side * x, 20, pipeZ + 0.1), angle: 0.07 }) });
      }
    }
    this.pipeLights = [-1, 1].map((side) => spot({
      intensity: 900, angle: 0.5, penumbra: 0.7,
      position: v(side * (SCREEN.width / 2 + 2.2), 5.4, pipeZ + 1.6), target: v(side * (SCREEN.width / 2 + 2.2), 16, pipeZ),
    }));

    // —— 指挥追光：从观众席后方的控制室打过来 ——
    this.follow = spot({ color: 0xfff1de, intensity: 11000, angle: 0.045, penumbra: 0.5, position: v(0, 15, 27), target: PODIUM.clone(), shadow: true });
    this.followBeam = new Beam({ from: this.follow.position, to: PODIUM.clone().setY(STAGE_Y), angle: 0.04, color: 0xfff1de });

    // —— 逆光、银幕反光、爆闪 ——
    // 放得够高，它在光亮地板上的镜面反射落在台口之外，不会正对观众形成一块刺眼的反光
    this.rim = spot({ color: 0xcfe0ff, intensity: 420, angle: 0.55, penumbra: 0.9, position: v(0, 8, -12.4), target: v(0, STAGE_Y + 1.2, -4) });
    this.screenGlow = spot({ color: 0xa8c4ff, intensity: 160, angle: 1.1, penumbra: 1, position: SCREEN.center.clone().setZ(SCREEN.center.z + 0.3), target: v(0, 0, 10) });
    this.flashLight = new THREE.PointLight(0xffffff, 0, 0, 2);
    this.flashLight.position.set(0, 9, -4);

    const lights = [...this.sections.map((s) => s.light), ...this.boomLights, ...this.pipeLights, this.follow, this.rim, this.screenGlow];
    for (const l of lights) this.group.add(l, l.target);
    this.group.add(this.flashLight);
    for (const b of this.allBeams()) this.group.add(b.mesh);
    this.#buildFixtures();

    // 浮尘只在光束里发亮
    this.dust = new Dust();
    this.group.add(this.dust.points);

    // 状态
    this.level = 0;
    this.levelTarget = 0;
    this.beamLevel = 0;
    this.beamTarget = 0;
    this.followLevel = 0;
    this.followTarget = 0;
    this.glow = 0;
    this.glowTarget = 0;
    this.glowColor = new THREE.Color(0xa8c4ff);
    this.flash = 0;
    this.followSubject = null;
    this.pipeGlow = 0; // 读给音管材质
    this.time = 0;
    this.boomColor = new THREE.Color(MOODS.preshow.boom);
    this.pipeColor = new THREE.Color(MOODS.preshow.pipe);
    this.moodBoom = new THREE.Color(MOODS.preshow.boom);
    this.moodPipe = new THREE.Color(MOODS.preshow.pipe);
  }

  allBeams() {
    return [...this.sections.map((s) => s.beamObj), ...this.booms.map((b) => b.beamObj), ...this.uplights.map((u) => u.beamObj), this.followBeam];
  }

  /** 看得见的灯具：侧光吊杆和音管底光的灯头（镜片会被 bloom 晕开） */
  #buildFixtures() {
    const housing = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.6 });
    this.lensMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const body = new THREE.CylinderGeometry(0.11, 0.13, 0.3, 14).rotateX(Math.PI / 2);
    const lens = new THREE.CircleGeometry(0.09, 16);
    const place = (from, dir) => {
      const q = new THREE.Quaternion().setFromUnitVectors(v(0, 0, 1), dir);
      const h = new THREE.Mesh(body, housing);
      h.position.copy(from).addScaledVector(dir, -0.16);
      h.quaternion.copy(q);
      const l = new THREE.Mesh(lens, this.lensMaterial);
      l.position.copy(from).addScaledVector(dir, 0.0);
      l.quaternion.copy(q);
      this.group.add(h, l);
    };
    for (const b of this.booms) place(b.from, b.beamObj.dir);
    for (const u of this.uplights) place(u.beamObj.from, u.beamObj.dir);
    // 吊杆立柱
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 4.2, 8);
    for (const side of [-1, 1]) {
      for (const k of [0, 1, 2]) {
        const p = new THREE.Mesh(poleGeo, housing);
        p.position.set(side * (HALL.halfWidth - 1.6), STAGE_Y + 2.1, -3.2 - k * 2.2);
        this.group.add(p);
      }
    }
  }

  /** 舞台整体亮度：开演前工作光约 0.45，演奏时 1，换场时转暗 */
  setLevel(level) {
    this.levelTarget = level;
  }

  /** 体积光束的整体强度 */
  setBeams(level) {
    this.beamTarget = level;
  }

  /** 按曲目基调换色：calm / rising / tense / epic / farewell */
  setMood(mood) {
    const m = MOODS[mood] ?? MOODS.preshow;
    this.moodBoom.set(m.boom);
    this.moodPipe.set(m.pipe);
  }

  setFollow(on, subject = null) {
    this.followTarget = on ? 1 : 0;
    if (subject) this.followSubject = subject;
  }

  /** 巨幕反射光：放电影时偏冷，黑洞过渡时偏暖 */
  setScreenGlow(level, color = 0xa8c4ff) {
    this.glowTarget = level;
    this.glowColor.set(color);
  }

  triggerFlash(strength = 1) {
    this.flash = Math.max(this.flash, strength);
  }

  update(dt, perf) {
    this.time += dt;
    const t = this.time;
    this.level = damp(this.level, this.levelTarget, 1.6, dt);
    this.beamLevel = damp(this.beamLevel, this.beamTarget, 1.2, dt);
    this.followLevel = damp(this.followLevel, this.followTarget, 2, dt);
    this.glow = damp(this.glow, this.glowTarget, 2, dt);
    this.flash = damp(this.flash, 0, 5, dt);
    this.boomColor.lerp(this.moodBoom, Math.min(1, dt * 0.8));
    this.pipeColor.lerp(this.moodPipe, Math.min(1, dt * 0.8));

    // 演奏时随强度起伏；没在演时保持一个中等的"呼吸"
    const k = perf.playing ? perf.intensity : 0.35;
    const drive = perf.playing ? 0.8 + 0.5 * k : 1;
    const flash = this.flash;

    for (const s of this.sections) {
      s.light.intensity = s.light.baseIntensity * (this.level * drive + flash * 1.5);
      s.beamObj.intensity = s.beam * this.beamLevel * (0.5 + 0.7 * k) + flash * 0.5;
      s.beamObj.uniforms.uTime.value = t;
    }

    // 侧光：随强度加亮，并缓慢摆动
    for (const b of this.booms) {
      const sway = Math.sin(t * 0.23 + b.phase) * (0.8 + 1.8 * k);
      b.beamObj.aim(v(b.to.x, b.to.y + Math.sin(t * 0.17 + b.phase) * 0.3, b.to.z + sway));
      b.beamObj.uniforms.uColor.value.copy(this.boomColor);
      b.beamObj.intensity = this.beamLevel * (0.12 + 0.55 * k) * (1 - 0.15 * b.k) + flash * 0.8;
      b.beamObj.uniforms.uTime.value = t;
    }
    for (const l of this.boomLights) {
      l.color.copy(this.boomColor);
      l.intensity = l.baseIntensity * this.beamLevel * (0.3 + 0.9 * k) + flash * 1200;
    }

    // 音管墙：底光光柱 + 音管自发光
    this.pipeGlow = this.beamLevel * (0.15 + 0.85 * k * k) + flash * 2.5;
    for (const u of this.uplights) {
      u.beamObj.uniforms.uColor.value.copy(this.pipeColor);
      u.beamObj.intensity = this.beamLevel * (0.1 + 0.5 * k) + flash * 0.6;
      u.beamObj.uniforms.uTime.value = t;
    }
    for (const l of this.pipeLights) {
      l.color.copy(this.pipeColor);
      l.intensity = l.baseIntensity * (this.beamLevel * (0.35 + 0.8 * k) + flash * 2);
    }
    this.lensMaterial.color.copy(this.boomColor).multiplyScalar(0.4 + 3 * this.beamLevel * (0.3 + k) + flash * 4);

    // 指挥追光
    if (this.followSubject) {
      this.follow.target.position.lerp(this.followSubject, Math.min(1, dt * 6));
      this.followBeam.aim(this.follow.target.position);
    }
    this.follow.intensity = this.follow.baseIntensity * this.followLevel;
    this.followBeam.intensity = 0.5 * this.followLevel;
    this.followBeam.uniforms.uTime.value = t;

    this.rim.intensity = this.rim.baseIntensity * this.level * (0.6 + 0.8 * k);
    this.screenGlow.intensity = this.screenGlow.baseIntensity * this.glow;
    this.screenGlow.color.copy(this.glowColor);
    this.flashLight.intensity = flash * 3200;

    // 浮尘跟着最亮的几束光
    const lit = this.allBeams().filter((b) => b.intensity > 0.01).sort((a, b) => b.intensity - a.intensity);
    this.dust.setBeams(lit.slice(0, 12));
  }
}
