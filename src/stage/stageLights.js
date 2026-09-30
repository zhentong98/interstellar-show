// 舞台灯光（里程碑 1 的基础版）：分区追光 + 指挥追光 + 逆光 + 巨幕反射到舞台上的光。
// 所有灯都从高处陡峭地往下打，光锥不会扫到巨幕；巨幕本身是"挖洞"的覆盖层，不受光照影响。
// 里程碑 2 再加阴影、体积光、薄雾和 bloom。

import * as THREE from 'three';
import { damp } from '../core/math.js';
import { STAGE_Y, SCREEN, PODIUM, ORGAN_CONSOLE } from './layout.js';

const WARM = 0xffd2a6;

function spot({ color = WARM, intensity, angle, penumbra = 0.6, position, target, distance = 0 }) {
  const light = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
  light.position.copy(position);
  light.target.position.copy(target);
  light.baseIntensity = intensity;
  return light;
}

export class StageLights {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = '舞台灯光';
    const v = (x, y, z) => new THREE.Vector3(x, y, z);

    this.sections = [
      // 弦乐（左侧）
      spot({ intensity: 1800, angle: 0.5, position: v(-7, 14, 4), target: v(-3.2, STAGE_Y, -3.8) }),
      spot({ intensity: 900, angle: 0.45, position: v(-2, 14, 3), target: v(-1.5, STAGE_Y, -5.5) }),
      // 合唱（右后方）
      spot({ intensity: 1500, angle: 0.36, position: v(8, 15, 0), target: v(6.8, STAGE_Y + 1, -9) }),
      // 定音鼓（右前方）
      spot({ intensity: 900, angle: 0.28, position: v(7, 13, 3), target: v(4.8, STAGE_Y, -3.8) }),
      // 管风琴控制台
      spot({ intensity: 700, angle: 0.3, position: v(2, 13, -1), target: ORGAN_CONSOLE.clone() }),
    ];
    // 逆光：从巨幕下方的高处打向乐团，勾出人物轮廓
    this.rim = spot({ color: 0xcfe0ff, intensity: 200, angle: 0.5, penumbra: 0.9, position: v(0, 4.2, -12.6), target: v(0, STAGE_Y + 1.4, -2) });
    // 指挥追光：从观众席后方的控制室打过来，窄光束
    this.follow = spot({ color: 0xfff1de, intensity: 9000, angle: 0.05, penumbra: 0.5, position: v(0, 15, 27), target: PODIUM.clone() });
    // 巨幕画面反射到舞台和前排的光（冷色，很弱）
    this.screenGlow = spot({ color: 0xa8c4ff, intensity: 140, angle: 1.1, penumbra: 1, position: SCREEN.center.clone().setZ(SCREEN.center.z + 0.3), target: v(0, 0, 10) });
    // 高潮时的白光爆闪
    this.flashLight = new THREE.PointLight(0xffffff, 0, 0, 2);
    this.flashLight.position.set(0, 9, -4);

    for (const l of [...this.sections, this.rim, this.follow, this.screenGlow]) {
      this.group.add(l, l.target);
    }
    this.group.add(this.flashLight);

    this.level = 0;
    this.levelTarget = 0;
    this.followLevel = 0;
    this.followTarget = 0;
    this.glow = 0;
    this.glowTarget = 0;
    this.glowColor = new THREE.Color(0xa8c4ff);
    this.flash = 0;
    this.followSubject = null;
  }

  /** 舞台整体亮度：开演前工作光约 0.45，演奏时 1，换场时转暗 */
  setLevel(level) {
    this.levelTarget = level;
  }

  /** 指挥追光开关 */
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
    this.level = damp(this.level, this.levelTarget, 1.6, dt);
    this.followLevel = damp(this.followLevel, this.followTarget, 2, dt);
    this.glow = damp(this.glow, this.glowTarget, 2, dt);
    this.flash = damp(this.flash, 0, 7, dt);

    // 演奏时亮度随强度起伏
    const drive = perf.playing ? 0.85 + 0.35 * perf.intensity : 1;
    for (const l of this.sections) l.intensity = l.baseIntensity * this.level * drive;
    this.rim.intensity = this.rim.baseIntensity * this.level * (0.6 + 0.6 * perf.intensity);
    this.follow.intensity = this.follow.baseIntensity * this.followLevel;
    if (this.followSubject) {
      this.follow.target.position.lerp(this.followSubject, Math.min(1, dt * 6));
    }
    this.screenGlow.intensity = this.screenGlow.baseIntensity * this.glow;
    this.screenGlow.color.copy(this.glowColor);
    this.flashLight.intensity = this.flash * 2600;
  }
}
