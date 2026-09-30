// 演出现场的原创音效：全部用 Web Audio 程序化合成，不使用任何录音，也不涉及原曲旋律。
// 包括：观众交谈、掌声、咳嗽、翻谱、乐团调音（A = 440Hz）、黑洞过渡的低频氛围。
//
// 掌声和交谈声是先用 JS 逐采样渲染成几秒的无缝循环缓冲，再循环播放；
// 调音、咳嗽、翻谱是实时的振荡器/噪声节点。所有声音都经过一个生成的音乐厅混响。

import { seededRandom, range } from '../core/math.js';

const A4 = 440;

// ——— 离线 DSP 工具 ———

/** RBJ 带通滤波器（逐采样） */
class Bandpass {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.reset();
  }
  set(freq, q) {
    const w = (2 * Math.PI * freq) / this.sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }
  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** 单极点低通，跑两遍让循环首尾的滤波器状态连续 */
function loopLowpass(data, sampleRate, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let y = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < data.length; i++) {
      y = (1 - a) * data[i] + a * y;
      if (pass === 1) data[i] = y;
    }
  }
}

function normalize(channels, peak) {
  let max = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i]));
  if (max === 0) return;
  const k = peak / max;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= k;
}

function toBuffer(ctx, channels) {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((data, i) => buffer.copyToChannel(data, i));
  return buffer;
}

/** 在当前值处截断后续自动化，之后可以接新的渐变 */
function holdParam(param, t) {
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(Math.max(0.0001, v), t);
  }
}

/** 等功率声像 */
const panGains = (pan) => [Math.sqrt(0.5 * (1 - pan)), Math.sqrt(0.5 * (1 + pan))];

/**
 * 掌声：上百个"拍手的人"，每人有自己的节奏、音色和远近。
 * 每一下拍手 = 一小段指数衰减的噪声经过带通共鸣（手掌的空腔）。
 * 写入时按缓冲长度取模，所以天然首尾无缝。
 */
function renderApplause(sampleRate, seconds, seed) {
  const len = Math.floor(sampleRate * seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const rand = seededRandom(seed);
  const bp = new Bandpass(sampleRate);

  for (let c = 0; c < 120; c++) {
    const near = rand() < 0.1;
    const gain = near ? range(rand, 0.45, 0.9) : range(rand, 0.06, 0.28);
    const [gl, gr] = panGains(range(rand, -1, 1));
    const period = 1 / range(rand, 3.2, 5.4);
    const freq = range(rand, 700, 2600);
    const q = range(rand, 1.1, 2.6);
    const tau = range(rand, 0.004, 0.009) * sampleRate;
    const decay = Math.exp(-1 / tau);
    const n = Math.floor(tau * 6);
    let t = rand() * period;
    while (t < seconds) {
      const start = Math.floor(t * sampleRate);
      const amp = gain * range(rand, 0.7, 1);
      bp.set(freq * range(rand, 0.94, 1.06), q).reset();
      let env = 1;
      for (let i = 0; i < n; i++) {
        const x = (rand() * 2 - 1) * env;
        const y = (bp.process(x) * 1.6 + x * 0.25) * amp;
        const idx = (start + i) % len;
        L[idx] += y * gl;
        R[idx] += y * gr;
        env *= decay;
      }
      t += period * range(rand, 0.9, 1.1);
    }
  }

  // 远处更多人的掌声：连成一片的沙沙声
  const bedL = new Float32Array(len);
  const bedR = new Float32Array(len);
  let am = 0.5;
  for (let i = 0; i < len; i++) {
    if (i % 64 === 0) am = 0.6 + 0.4 * rand();
    bedL[i] = (rand() * 2 - 1) * am;
    bedR[i] = (rand() * 2 - 1) * am;
  }
  loopLowpass(bedL, sampleRate, 3200);
  loopLowpass(bedR, sampleRate, 3200);
  for (let i = 0; i < len; i++) {
    L[i] += bedL[i] * 0.35;
    R[i] += bedR[i] * 0.35;
  }

  normalize([L, R], 0.85);
  return [L, R];
}

/**
 * 观众交谈：十几个"说话的人"，每人用声门脉冲 + 两个共振峰带通合成含糊的音节，
 * 音节长短、停顿随机，整体再做一次低通，像隔着一段距离听到的满场低语。
 */
function renderMurmur(sampleRate, seconds, seed) {
  const len = Math.floor(sampleRate * seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const rand = seededRandom(seed);
  const f1 = new Bandpass(sampleRate);
  const f2 = new Bandpass(sampleRate);

  for (let v = 0; v < 16; v++) {
    const f0 = range(rand, 95, 240);
    const gain = range(rand, 0.4, 1);
    const [gl, gr] = panGains(range(rand, -0.9, 0.9));
    let t = rand() * 0.6;
    let phase = 0;
    while (t < seconds) {
      if (rand() < 0.1) {
        t += range(rand, 0.3, 1.1); // 换气、听别人说
        continue;
      }
      const dur = range(rand, 0.08, 0.26);
      const n = Math.floor(dur * sampleRate);
      const start = Math.floor(t * sampleRate);
      const pitch = f0 * range(rand, 0.88, 1.15);
      const glide = range(rand, -0.12, 0.08);
      f1.set(range(rand, 300, 850), 4).reset();
      f2.set(range(rand, 900, 2300), 6).reset();
      const amp = gain * range(rand, 0.5, 1);
      for (let i = 0; i < n; i++) {
        const k = i / n;
        const env = Math.pow(Math.sin(Math.PI * k), 0.6);
        phase += (pitch * (1 + glide * k)) / sampleRate;
        phase -= Math.floor(phase);
        const excitation = (phase * 2 - 1) * 0.65 + (rand() * 2 - 1) * 0.35;
        const x = excitation * env;
        const y = (f1.process(x) + f2.process(x) * 0.6) * amp;
        const idx = (start + i) % len;
        L[idx] += y * gl;
        R[idx] += y * gr;
      }
      t += dur + range(rand, 0.01, 0.09);
    }
  }

  loopLowpass(L, sampleRate, 1900);
  loopLowpass(R, sampleRate, 1900);
  normalize([L, R], 0.8);
  return [L, R];
}

/** 音乐厅混响的脉冲响应：随时间变暗的指数衰减噪声，左右声道去相关 */
function renderImpulse(sampleRate, seconds, seed) {
  const len = Math.floor(sampleRate * seconds);
  const rand = seededRandom(seed);
  const pre = Math.floor(0.018 * sampleRate);
  const channels = [new Float32Array(len), new Float32Array(len)];
  for (const ch of channels) {
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp(-t / 0.42);
      // 衰减尾部越来越暗：低通系数随时间增大
      const a = 0.2 + 0.75 * Math.min(1, t / seconds);
      y = (1 - a) * (rand() * 2 - 1) + a * y;
      ch[i] = y * env;
    }
  }
  normalize(channels, 0.5);
  return channels;
}

// ——— 实时播放 ———

export class ShowAudio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.pendingMurmur = null;
    this.rand = seededRandom(20141107);
  }

  /** 必须在用户点击的同步调用栈里执行，才能解锁浏览器的有声播放 */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'playback' });
      this.#buildGraph();
      // 渲染素材放到下一轮事件循环，避免卡住点击后的第一帧
      setTimeout(() => this.#renderBuffers(), 30);
    }
    this.ctx.resume?.();
    // iOS Safari：在手势里播放一段静音缓冲才算真正解锁
    const src = this.ctx.createBufferSource();
    src.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    src.connect(this.ctx.destination);
    src.start();
  }

  get ready() {
    return !!this.ctx;
  }

  #buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.ratio.value = 4;
    this.master.connect(limiter).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = toBuffer(ctx, renderImpulse(ctx.sampleRate, 2.6, 7));
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(this.reverb).connect(this.master);

    this.noise = toBuffer(ctx, [
      Float32Array.from({ length: ctx.sampleRate }, () => Math.random() * 2 - 1),
    ]);
  }

  /** 从一个节点分出干声和混响，并做声像 */
  #route(node, { pan = 0, wet = 0.4, dry = 1 } = {}) {
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner);
    const d = ctx.createGain();
    d.gain.value = dry;
    const w = ctx.createGain();
    w.gain.value = wet;
    panner.connect(d).connect(this.dry);
    panner.connect(w).connect(this.wet);
    return panner;
  }

  #renderBuffers() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    this.buffers.murmur = toBuffer(ctx, renderMurmur(sr, 7, 11));
    if (this.pendingMurmur) this.setMurmur(...this.pendingMurmur);
    setTimeout(() => {
      this.buffers.applauseA = toBuffer(ctx, renderApplause(sr, 5, 21));
      this.buffers.applauseB = toBuffer(ctx, renderApplause(sr, 6, 34));
    }, 30);
  }

  // ——— 观众交谈 ———

  /** 满场低声交谈的音量（0~1），seconds 秒内渐变 */
  setMurmur(level, seconds = 2) {
    if (!this.ctx) return;
    if (!this.buffers.murmur) {
      this.pendingMurmur = [level, seconds];
      return;
    }
    this.pendingMurmur = null;
    const ctx = this.ctx;
    if (!this.murmurGain) {
      this.murmurGain = ctx.createGain();
      this.murmurGain.gain.value = 0;
      // 两个错开的循环，听起来人更多
      for (const [offset, pan, rate] of [
        [0, -0.35, 1],
        [3.1, 0.4, 0.97],
      ]) {
        const src = ctx.createBufferSource();
        src.buffer = this.buffers.murmur;
        src.loop = true;
        src.playbackRate.value = rate;
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(p).connect(this.murmurGain);
        src.start(0, offset);
      }
      this.#route(this.murmurGain, { wet: 0.7, dry: 0.6 });
    }
    const g = this.murmurGain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(level * 0.32, ctx.currentTime, Math.max(0.05, seconds / 3));
  }

  // ——— 掌声 ———

  /**
   * 一段掌声，强度 0~1 决定音量和明亮度。返回句柄，可提前 stop(淡出秒数)。
   */
  applause({ strength = 0.7, duration = 7, attack = 0.6, release = 3 } = {}) {
    const handle = { stop() {} };
    if (!this.ctx || !this.buffers.applauseA) return handle;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const peak = 0.22 + 0.5 * strength;

    const gain = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600 + 5000 * strength;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    const sustainEnd = Math.max(now + attack + 0.1, now + duration - release);
    gain.gain.linearRampToValueAtTime(peak * 0.8, sustainEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const sources = [this.buffers.applauseA, this.buffers.applauseB].map((buffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = range(this.rand, 0.96, 1.04);
      src.connect(tone);
      src.start(now, this.rand() * buffer.duration);
      src.stop(now + duration + 0.1);
      return src;
    });
    tone.connect(gain);
    this.#route(gain, { wet: 0.45, dry: 0.9 });

    handle.stop = (fade = 1.5) => {
      const t = ctx.currentTime;
      holdParam(gain.gain, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      for (const src of sources) {
        try {
          src.stop(t + fade + 0.05);
        } catch {
          // 已经停止
        }
      }
    };
    return handle;
  }

  // ——— 零星的现场声音 ———

  /** 一次咳嗽：两下短促的噪声爆发，带一点声带音高，远处、偏混响 */
  cough() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const r = this.rand;
    const out = ctx.createGain();
    out.gain.value = range(r, 0.12, 0.28);
    this.#route(out, { pan: range(r, -0.8, 0.8), wet: 0.9, dry: 0.5 });
    const bursts = r() < 0.6 ? 2 : 1;
    let t = ctx.currentTime + 0.02;
    for (let b = 0; b < bursts; b++) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = range(r, 450, 950);
      bp.Q.value = 0.9;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.001, t + range(r, 0.14, 0.22));
      noise.connect(bp).connect(env).connect(out);
      noise.start(t, r() * 0.5);
      noise.stop(t + 0.3);

      const voice = ctx.createOscillator();
      voice.type = 'sawtooth';
      const f = range(r, 170, 260);
      voice.frequency.setValueAtTime(f, t);
      voice.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.15);
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 700;
      formant.Q.value = 2;
      const venv = ctx.createGain();
      venv.gain.setValueAtTime(0.0001, t);
      venv.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      venv.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      voice.connect(formant).connect(venv).connect(out);
      voice.start(t);
      voice.stop(t + 0.2);
      t += range(r, 0.2, 0.32);
    }
  }

  /** 翻谱：一小段高频沙沙声（弦乐在舞台左侧，声像偏左） */
  pageTurn() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const r = this.rand;
    const t = ctx.currentTime + 0.01;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(2500, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + 0.3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(range(r, 0.04, 0.08), t + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    noise.connect(hp).connect(bp).connect(env);
    this.#route(env, { pan: range(r, -0.7, 0.1), wet: 0.5 });
    noise.start(t, r() * 0.5);
    noise.stop(t + 0.4);
  }

  // ——— 调音（A = 440Hz） ———

  /** 双簧管给出 A：鼻音较重的双簧片音色，稍后加入揉音 */
  tuneOboe(duration = 5) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const harmonics = [0, 0.55, 1, 0.85, 0.62, 0.46, 0.33, 0.22, 0.15, 0.1, 0.07, 0.05];
    const wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics));
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(A4 * 0.992, t);
    osc.frequency.setTargetAtTime(A4, t, 0.05);

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.1;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(2, t + 1.2);
    vibrato.connect(depth).connect(osc.frequency);

    const nasal = ctx.createBiquadFilter();
    nasal.type = 'peaking';
    nasal.frequency.value = 1350;
    nasal.Q.value = 1.4;
    nasal.gain.value = 6;
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 5200;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.16, t + 0.12);
    env.gain.setValueAtTime(0.16, t + duration - 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(nasal).connect(soft).connect(env);
    this.#route(env, { pan: 0.05, wet: 0.5 });
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + duration + 0.05);
    vibrato.stop(t + duration + 0.05);
  }

  /**
   * 全团调音：各声部先对 A，再拉五度空弦（D、G、E、C），音高从略偏开始慢慢校准。
   * 只是空弦和五度，没有旋律。弦乐在舞台左侧，声像整体偏左。
   */
  tuneTutti(duration = 7) {
    if (!this.ctx) return;
    const r = this.rand;
    const fifth = 3 / 2;
    const A3 = A4 / 2;
    const D4 = A4 / fifth;
    const G3 = D4 / fifth;
    const C3 = G3 / fifth;
    const E5 = A4 * fifth;
    // [频率, 起始, 声像范围]
    const plan = [
      [A4, 0, -0.5], [A3, 0.2, -0.3], [A4 * 2, 0.5, -0.6], [A4, 0.7, -0.4], [A3 / 2, 0.9, -0.1],
      [D4, 1.3, -0.5], [G3, 1.6, -0.4], [E5, 1.8, -0.7], [D4, 2.1, -0.3], [C3, 2.2, -0.1],
      [G3, 2.6, -0.2], [A3 / 2, 2.8, 0], [D4 / 2, 3.0, 0], [E5, 3.1, -0.6], [C3 / 2, 3.3, 0.05],
      [A4, 3.5, -0.5], [D4, 3.8, -0.4], [G3 / 2, 4.0, 0.1], [E5 / 2, 4.2, -0.3], [A4 * 2, 4.4, -0.6],
    ];
    const t0 = this.ctx.currentTime + 0.05;
    for (const [freq, at, pan] of plan) {
      const start = t0 + at * (duration / 7) + r() * 0.2;
      const end = t0 + duration - range(r, 0, 0.8);
      if (end - start < 0.8) continue;
      this.#stringVoice(freq, start, end, pan + range(r, -0.15, 0.15));
    }
  }

  #stringVoice(freq, start, end, pan) {
    const ctx = this.ctx;
    const r = this.rand;
    const out = ctx.createGain();
    const level = range(r, 0.025, 0.045);
    const attack = Math.min(range(r, 0.25, 0.6), (end - start) * 0.3);
    out.gain.setValueAtTime(0.0001, start);
    out.gain.exponentialRampToValueAtTime(level, start + attack);
    out.gain.setValueAtTime(level, Math.max(start + attack, end - 0.6));
    out.gain.exponentialRampToValueAtTime(0.0001, end);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = Math.min(6000, 1800 + freq * 2);
    lowpass.Q.value = 0.7;
    lowpass.connect(out);

    // 起始时音高略偏，先越过一点再校准，模拟拧弦轴
    const mistune = range(r, 18, 40) * (r() < 0.5 ? -1 : 1);
    for (const spread of [-5, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.setValueAtTime(mistune + spread, start);
      osc.detune.setTargetAtTime(-mistune * 0.3 + spread, start + 0.4, 0.25);
      osc.detune.setTargetAtTime(spread, start + range(r, 1.2, 2.2), 0.35);
      osc.connect(lowpass);
      osc.start(start);
      osc.stop(end + 0.05);
    }
    this.#route(out, { pan, wet: 0.6 });
  }

  // ——— 黑洞过渡的低频氛围（原创，仅低频嗡鸣） ———

  setDrone(level, seconds = 2) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.droneGain) {
      this.droneGain = ctx.createGain();
      this.droneGain.gain.value = 0;
      for (const [freq, g] of [
        [36, 0.5],
        [54, 0.22],
      ]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = freq;
        const og = ctx.createGain();
        og.gain.value = g;
        osc.connect(og).connect(this.droneGain);
        osc.start();
      }
      const rumble = ctx.createBufferSource();
      rumble.buffer = this.noise;
      rumble.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 110;
      const rg = ctx.createGain();
      rg.gain.value = 0.6;
      rumble.connect(lp).connect(rg).connect(this.droneGain);
      rumble.start();
      this.#route(this.droneGain, { wet: 0.3 });
    }
    const g = this.droneGain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(level * 0.35, ctx.currentTime, Math.max(0.05, seconds / 3));
  }

  /** 演出结束：所有持续的声音淡出 */
  fadeAll(seconds = 2) {
    this.setMurmur(0, seconds);
    this.setDrone(0, seconds);
  }
}
