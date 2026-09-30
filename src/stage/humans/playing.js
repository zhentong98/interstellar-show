// 演奏动作的"分谱"：只算每一帧手该到哪、弓走到哪、槌抬多高，不管人物模型和骨骼。
//
//   - 弦乐：同一声部共用一套弓法（上下弓一致、一起换弦、一起换把），每人再有一点时间和幅度差；
//           运弓是"匀速拉、到头快速换向"的梯形速度，强度决定一弓几拍、用多长的弓、弓段在哪里
//   - 定音鼓：待击时槌头悬在鼓面上；中等强度按拍单击；强段滚奏（两手交替、手腕发力）；
//           cue 表的重击提前按 nextHit 抬槌，drumHit 到点落下
//   - 管风琴：和弦按拍换，手在键盘上横移、偶尔换一层键盘，手指有起有落，脚踩踏板
//
// 输入只有 perf（playing / intensity / bpm / nextHit）和时间；缓冲时（playing=false）全部停在原处。

import { damp, clamp, clamp01, lerp, smoothstep, range } from '../../core/math.js';

const TAU = Math.PI * 2;

// ——— 运弓 ———

/**
 * 各声部的弓法：按强度从低到高，[强度下限, 一弓几拍, 用多长的弓（整根弓 = 1）, 弓段中心（0 弓根 ~ 1 弓尖）]。
 * 安静时长弓慢拉、多在弓的中上段；越激烈弓越短越快、越靠弓根；
 * 第二小提琴和中提琴在最强处改成震音（弓尖附近极短极快的来回）。
 */
const BOWINGS = {
  violin1: [[0, 2, 0.62, 0.55], [0.32, 1, 0.5, 0.5], [0.72, 0.5, 0.32, 0.42]],
  violin2: [[0, 2, 0.56, 0.55], [0.3, 1, 0.46, 0.5], [0.62, 0.5, 0.3, 0.45], [0.9, 0.125, 0.09, 0.66]],
  viola: [[0, 2, 0.56, 0.52], [0.3, 1, 0.46, 0.48], [0.62, 0.5, 0.3, 0.44], [0.9, 0.125, 0.09, 0.64]],
  cello: [[0, 2, 0.7, 0.5], [0.4, 1, 0.56, 0.45], [0.8, 1, 0.72, 0.38]],
  bass: [[0, 4, 0.62, 0.45], [0.5, 2, 0.6, 0.4]],
};
const TUNING = [0, 2, 0.45, 0.5];

/** 梯形速度的一弓：0~1 的进度 f → 0~1 的位移；r 是两端加速、减速各占的比例 */
function stroke(f, r) {
  const v = 1 / (1 - r);
  if (f < r) return (v * f * f) / (2 * r);
  if (f > 1 - r) return 1 - (v * (1 - f) ** 2) / (2 * r);
  return v * (f - r / 2);
}
function strokeRate(f, r) {
  const v = 1 / (1 - r);
  if (f < r) return (v * f) / r;
  if (f > 1 - r) return (v * (1 - f)) / r;
  return v;
}

/** 一个弦乐声部共用的弓法状态 */
export class BowSection {
  constructor(name, rand) {
    this.name = name;
    this.rand = rand;
    this.table = BOWINGS[name] ?? BOWINGS.violin1;
    this.phase = 0; // 第几弓（整数部分）和这一弓走了多少（小数部分）；偶数是下弓
    this.rate = 0.4; // 每秒几弓
    this.len = 0.5;
    this.center = 0.5;
    this.ramp = 0.14;
    this.tremolo = 0;
    this.string = 1.5; // 0 最高的弦 ~ 3 最低的弦
    this.stringTarget = 1.5;
    this.position = 0.2; // 左手把位：0 第一把位 ~ 1 高把位
    this.positionTarget = 0.2;
    this.vibrato = 0.5;
    this.last = 0;
  }

  /** @param {number} k 强度；active 是否在拉（演奏或调音）；tuning 调音时的慢弓 */
  update(dt, k, bpm, active, tuning) {
    const row = tuning ? TUNING : this.table.reduce((hit, r) => (k >= r[0] ? r : hit), this.table[0]);
    const [, beats, len, center] = row;
    const tempo = tuning ? 60 : bpm;
    if (!active) return;
    this.rate = damp(this.rate, tempo / 60 / beats, 3, dt);
    this.len = damp(this.len, len, 2.5, dt);
    this.center = damp(this.center, center, 2, dt);
    this.tremolo = damp(this.tremolo, beats < 0.25 ? 1 : 0, 3, dt);
    // 短弓的换向占比更大（跳弓、分弓），长弓几乎全程匀速
    this.ramp = lerp(0.12, 0.3, clamp01((this.rate - 0.6) / 2));
    // 越激烈揉弦越少（快速的分弓来不及揉），安静的长音揉得最多
    this.vibrato = damp(this.vibrato, beats >= 1 && !tuning ? lerp(1, 0.55, k) : 0.15, 2, dt);
    this.phase += this.rate * dt;

    // 每换一弓，整个声部按一定概率一起换弦、换把（震音时不换，只在长一点的弓上换）
    const n = Math.floor(this.phase);
    if (n !== this.last) {
      this.last = n;
      const r = this.rand;
      if (this.rate < 3 && r() < (tuning ? 0.5 : 0.3)) {
        this.stringTarget = clamp(Math.round(this.stringTarget) + (r() < 0.5 ? -1 : 1), 0, 3);
      }
      if (!tuning && this.rate < 3 && r() < 0.16) this.positionTarget = r() < 0.55 ? range(r, 0, 0.35) : range(r, 0.35, 1);
    }
    this.string = damp(this.string, this.stringTarget, 9, dt);
  }

  /**
   * 某位乐手此刻的弓段位置和速度。
   * @param {object} m  乐手：bowLag（慢半拍多少弓，±几个百分点）、bowReach（弓长的个人差异）
   * @returns {{ u: number, vel: number, down: boolean }} u：接触点在弓上的位置（0 弓根 ~ 1 弓尖）；vel：每秒走多少根弓
   */
  sample(m, out = {}) {
    const phi = this.phase - m.bowLag;
    const n = Math.floor(phi);
    const f = phi - n;
    const down = (n & 1) === 0;
    const len = this.len * m.bowReach;
    const p = stroke(f, this.ramp);
    out.u = clamp(this.center + len * (down ? p - 0.5 : 0.5 - p), 0.03, 0.97);
    out.vel = (down ? 1 : -1) * strokeRate(f, this.ramp) * len * this.rate;
    out.down = down;
    return out;
  }
}

// ——— 左手：换把、揉弦、手指起落 ———

/** 0~1 的确定性伪随机（同一个输入永远得到同一个数） */
const hash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * 每位弦乐手左手的状态：跟着声部换把（稍有先后），长音揉弦，手指按音符起落。
 * 返回值写在 m.left 上：pos 把位（0~1），vib 揉弦位移（-1~1，乘以各乐器的幅度），fingers 四指各自的弯曲倍数。
 */
export function updateLeftHand(m, sec, dt, t, active) {
  const L = (m.left ??= { pos: sec.position, vib: 0, amount: 0, fingers: [1, 1, 1, 1], note: 0, down: 2 });
  if (!active) return L;
  // 换把：大约 0.15 秒滑过去，每个人反应有一点差别
  L.pos = damp(L.pos, clamp01(sec.position + m.posBias), 11 * m.rate, dt);
  L.amount = damp(L.amount, sec.vibrato * m.vibAmp, 3, dt);
  L.vib = Math.sin(TAU * m.vibRate * t + m.phase) * L.amount;
  // 按音：弓每走半弓左右换一个音，按下 1~4 个手指
  const note = Math.floor(sec.phase * (sec.rate > 2 ? 0.5 : 2) + m.phase);
  if (note !== L.note) {
    L.note = note;
    L.down = 1 + Math.floor(hash(note * 31 + m.index) * 4);
  }
  for (let f = 0; f < 4; f++) L.fingers[f] = damp(L.fingers[f], f < L.down ? 1 : 0.35, 22, dt);
  return L;
}

// ——— 目光：偶尔抬头看指挥 ———

/** m.glance 0~1：看谱 → 抬头看指挥。active 时每隔几秒看一次，每次一两秒 */
export function updateGlance(m, dt, active, rand) {
  m.glanceWait ??= range(rand, 2, 9);
  m.glanceHold ??= 0;
  if (active) {
    if (m.glanceHold > 0) m.glanceHold -= dt;
    else if ((m.glanceWait -= dt) <= 0) {
      m.glanceHold = range(rand, 0.8, 2.2);
      m.glanceWait = range(rand, 4, 12);
    }
  }
  m.glance = damp(m.glance ?? 0, active && m.glanceHold > 0 ? 1 : 0, 4, dt);
  return m.glance;
}

// ——— 定音鼓 ———

const REST = 0.085; // 待击时槌头离鼓面的高度（米）
const PREP = 0.9; // 重击提前多久开始抬槌（秒）

/** 按拍单击：x 是离击打还有几拍（负数 = 还没打），返回槌头高度 */
function beatStroke(x, H) {
  if (x < -0.6 || x > 0.5) return REST;
  if (x < -0.15) return lerp(REST, H, smoothstep(-0.6, -0.2, x));
  if (x < 0) {
    const k = (x + 0.15) / 0.15;
    return H * (1 - k * k); // 前臂带着手腕加速落下，触鼓时最快
  }
  return REST * smoothstep(0, 0.3, x);
}

/** 重击：left 是离击打还有几秒（负数 = 已经打过），prep 是抬槌总时长 */
function heavyStroke(left, prep, s) {
  const H = 0.2 + 0.26 * s;
  const fall = Math.min(0.13, prep * 0.4);
  if (left > fall) return lerp(REST, H, smoothstep(prep, Math.max(fall, prep * 0.35), left));
  if (left > 0) {
    const k = (fall - left) / fall;
    return H * (1 - k * k);
  }
  // 触鼓后弹起，再回到待击高度
  const x = -left;
  if (x < 0.22) return (REST + 0.07 * s) * Math.sin((x / 0.22) * Math.PI * 0.5);
  return lerp(REST + 0.07 * s, REST, smoothstep(0.22, 0.45, x));
}

/**
 * 定音鼓手的两只手：hand 0 右手（打右边的鼓）、1 左手。
 * 每帧给出槌头离鼓面的高度 h（米）、在哪面鼓、身体前倾量；触鼓时回调 onContact(drum, strength, heavy)。
 */
export class TimpaniPart {
  constructor() {
    this.hands = [{ h: REST, drum: 1 }, { h: REST, drum: 2 }];
    this.hits = []; // 重击：{ left, prep, strength, hands: [0] / [1] / [0, 1], landed }
    this.roll = 0; // 滚奏相位
    this.lean = 0;
    this.count = 0;
    this.onContact = null;
  }

  /** cue 表的 drumHit：lead 秒后击中。提前按 nextHit 抬起的槌就用这一下落下，否则现抬现打 */
  hit(lead, strength) {
    const match = this.hits.find((h) => Math.abs(h.left - lead) < 0.2);
    if (match) {
      if (!match.landed) match.strength = strength;
      return;
    }
    const prep = Math.max(0.2, lead);
    this.hits.push({ left: prep, prep, strength, hands: strength >= 0.85 ? [0, 1] : [this.count++ % 2], landed: false });
  }

  update(dt, perf, beat, prevBeat) {
    const { playing } = perf;
    const k = playing ? perf.intensity : 0;

    // 预读：离下一次重击不到 PREP 秒就开始抬槌（缓冲时不动）
    // （cue 表的重击力度通常 0.7～1，预读时还不知道具体多少，先按双手重击准备，drumHit 到了再更新力度）
    if (playing && perf.nextHit < PREP) {
      const match = this.hits.find((h) => Math.abs(h.left - perf.nextHit) < 0.25);
      if (!match) this.hits.push({ left: perf.nextHit, prep: perf.nextHit, strength: 1, hands: [0, 1], landed: false, cued: true });
      else if (!match.landed) match.left = perf.nextHit;
    }
    // 往回拖动或跳过时，预读出来但已经对不上的重击作废
    this.hits = this.hits.filter((h) => h.landed || !h.cued || !playing || Math.abs(h.left - perf.nextHit) < 0.35 || h.left < 0.05);

    const wRoll = smoothstep(0.8, 0.86, k);
    const wBeat = smoothstep(0.42, 0.5, k) * (1 - wRoll);
    if (playing) this.roll += dt * TAU * 6.4;
    const rollAmp = 0.035 + 0.05 * clamp01((k - 0.8) / 0.2);
    const H = 0.1 + 0.16 * k;

    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      // 按拍单击：右手在每小节第 1 拍打右边那面鼓，左手在第 3 拍打左边那面
      const offset = i === 0 ? 0 : 2;
      const b = 4 * Math.floor((beat + 0.6 - offset) / 4) + offset;
      const hb = beatStroke(beat - b, H);
      if (wBeat > 0.3 && prevBeat - b < 0 && beat - b >= 0) this.onContact?.(i ? 2 : 1, 0.3 + 0.4 * k, false);
      // 滚奏：两手交替，手腕发力的小幅度快速击打
      const ph = this.roll + i * Math.PI;
      const hr = rollAmp * (0.5 - 0.5 * Math.cos(ph));
      if (wRoll > 0.3 && playing && Math.floor((ph - TAU * 6.4 * dt) / TAU) !== Math.floor(ph / TAU)) this.onContact?.(i ? 2 : 1, 0.25, false);
      let h = REST * (1 - wBeat - wRoll) + hb * wBeat + hr * wRoll;
      // 重击盖过其他动作
      for (const hit of this.hits) {
        if (!hit.hands.includes(i)) continue;
        const w = smoothstep(hit.prep, hit.prep - 0.12, hit.left) * (1 - smoothstep(-0.3, -0.45, hit.left));
        h = lerp(h, heavyStroke(hit.left, hit.prep, hit.strength), w);
      }
      hand.h = h;
    }

    // 重击的倒计时（缓冲时暂停），到点触鼓
    for (const hit of this.hits) {
      if (playing || hit.landed) hit.left -= dt;
      if (!hit.landed && hit.left <= 0) {
        hit.landed = true;
        for (const i of hit.hands) this.onContact?.(i ? 2 : 1, hit.strength, true);
      }
    }
    this.hits = this.hits.filter((h) => h.left > -0.5);
    // 身体：打得越重越往前压，滚奏时稍微俯身
    const heavy = this.hits.reduce((a, h) => Math.max(a, h.left > 0 ? smoothstep(h.prep, 0, h.left) * h.strength : 0), 0);
    this.lean = damp(this.lean, 0.06 + 0.06 * wRoll + 0.04 * wBeat + 0.1 * heavy, 5, dt);
  }
}

// ——— 管风琴 ———

/**
 * 管风琴手：每只手在某一层键盘的某个位置按和弦，按拍换和弦（强的时候每拍都换），
 * 偶尔换一层键盘；手指按和弦起落；双脚在踏板上交替踩低音。
 */
export class OrganPart {
  constructor(rand) {
    this.rand = rand;
    // 角色局部坐标：+x 是琴手的左边。左手弹低音区（左边），右手弹高音区
    this.hands = [
      { side: 'Left', x: 0.2, xTarget: 0.2, tier: 0, tierTarget: 0, press: 0, fingers: [1, 1, 1, 1], down: [1, 0, 1, 0] },
      { side: 'Right', x: -0.2, xTarget: -0.2, tier: 1, tierTarget: 1, press: 0, fingers: [1, 1, 1, 1], down: [1, 1, 0, 1] },
    ];
    this.feet = { Left: [0, 0, 0], Right: [0, 0, 0] };
    this.chord = -1;
    this.pedal = -1;
    this.pedalFoot = 0;
  }

  update(dt, perf, beat) {
    const r = this.rand;
    const k = perf.playing ? perf.intensity : 0;
    const per = k > 0.65 ? 1 : 2;
    const chord = Math.floor(beat / per);
    if (perf.playing && chord !== this.chord) {
      this.chord = chord;
      for (const [i, h] of this.hands.entries()) {
        const sx = i === 0 ? 1 : -1;
        h.xTarget = sx * range(r, 0.06, 0.2 + 0.2 * k);
        if (r() < 0.18) h.tierTarget = Math.floor(r() * 3);
        if (k > 0.8) h.tierTarget = 0; // 全奏时双手都在最下层（主键盘）
        h.down = h.down.map(() => (r() < 0.45 + 0.4 * k ? 1 : 0));
        h.down[0] = 1;
        h.press = 1;
      }
    }
    for (const h of this.hands) {
      h.x = damp(h.x, h.xTarget, 14, dt);
      h.tier = damp(h.tier, h.tierTarget, 9, dt);
      h.press = damp(h.press, 0, 6, dt);
      for (let f = 0; f < 4; f++) h.fingers[f] = damp(h.fingers[f], h.down[f] ? 1 : 0.3, 18, dt);
    }
    // 踏板：强度中等以上，每两拍换一个低音，两脚交替
    const pedal = Math.floor(beat / 2);
    if (perf.playing && k > 0.35 && pedal !== this.pedal) {
      this.pedal = pedal;
      this.pedalFoot = 1 - this.pedalFoot;
      const foot = this.pedalFoot ? 'Left' : 'Right';
      this.feet[foot][0] = (this.pedalFoot ? 1 : -1) * range(r, 0, 0.18);
    }
    for (const [i, foot] of ['Left', 'Right'].entries()) {
      const active = perf.playing && k > 0.35 && this.pedalFoot === 1 - i;
      const f = this.feet[foot];
      // 正在踩的那只脚踩下去（脚掌放低 2 厘米），另一只稍微抬起
      f[1] = damp(f[1], active ? -0.015 : 0.02 * (k > 0.35 ? 1 : 0), 10, dt);
      if (!active) f[0] = damp(f[0], 0, 2, dt);
    }
  }
}
