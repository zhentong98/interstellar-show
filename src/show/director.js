// 导演：整场演出的状态机。按下"入场"之后全程自动：
//
//   开演前 preshow ─ 入场（镜头滑到座位、乐手上台）→ 调音 → 观众席熄灯 → 指挥上台
//   逐首 song ───── 举棒 → 静止 → 巨幕亮起、播放 → 结束前 0.5 秒切走 → 收住
//   换场 intermission ─ 掌声 → 放下乐器翻谱、咳嗽、低语 → 字幕牌、Gargantua、运镜 → 预加载下一段
//   终场 finale ─── 寂静 → 掌声爆发、观众起立 → 鞠躬、示意各声部 → 下台再返场 → 灯亮
//   收尾 closing ── 节目单背面
//
// 每个环节是一个"段"（segment），段内所有等待和动画共用一个 AbortSignal。
// 观众按"下一首"会中止当前段：动画跳到终点，再由该段的收尾函数把舞台摆到正确状态。

import { ceremony as C } from '../cues/ceremony.js';
import { cuesFor } from '../cues/index.js';
import { CueRunner } from './cueRunner.js';
import { PlaybackClock } from '../video/clock.js';
import { SkipSignal, isSkip, background } from '../core/timeline.js';
import { range, seededRandom } from '../core/math.js';
import { PODIUM, PODIUM_HEIGHT, STAGE_Y, WINGS } from '../stage/layout.js';
import { Vector3 } from 'three';

const PHASE_LABELS = {
  preshow: '开演前',
  song: (i, song) => `第 ${i + 1} 首 · ${song.title}`,
  intermission: '换场',
  finale: '谢幕',
  closing: '散场',
};

export class Director {
  constructor({ world, player, audio, ui }) {
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.ui = ui;
    this.tl = world.timeline;
    this.rand = seededRandom(1107);
    this.ctrl = null;
    this.ending = false;
    this.phase = 'idle';
    this.index = -1;
    this.preloads = new Map();
    this.sounds = new Set(); // 正在进行的掌声，结束演出时统一停掉
    this.clock = null; // 当前曲目的播放时钟（调试面板读取）
    this.runner = null;
  }

  // ——— 外部控制（底部控制条） ———

  /** 跳到下一首（当前环节立即收尾） */
  skip() {
    this.ctrl?.abort();
  }

  /** 结束演出，直接到节目单背面 */
  end() {
    this.ending = true;
    this.ctrl?.abort();
  }

  get statusText() {
    const label = PHASE_LABELS[this.phase];
    if (typeof label === 'function') return label(this.index, this.setlist[this.index]);
    return label ?? '';
  }

  // ——— 主流程 ———

  async run(setlist) {
    this.setlist = setlist;
    this.results = setlist.map(() => ({ peak: 0, played: false, error: null }));
    this.#preload(0);

    await this.#segment('preshow', -1, (s) => this.#preShow(s), () => this.#snapPreShow());
    for (let i = 0; i < setlist.length && !this.ending; i++) {
      await this.#segment('song', i, (s) => this.#performSong(i, s), () => this.#abortSong(i));
      if (this.ending || i === setlist.length - 1) break;
      await this.#segment('intermission', i, (s) => this.#intermission(i, s), () => this.#snapIntermission(i));
    }
    if (!this.ending) await this.#segment('finale', -1, (s) => this.#finale(s), () => this.#snapFinale());
    await this.#closing();
  }

  async #segment(phase, index, body, onSkip) {
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.phase = phase;
    this.index = index;
    this.ui.setStatus(this.statusText);
    try {
      await body(ctrl.signal);
    } catch (err) {
      if (!isSkip(err)) throw err;
      onSkip?.();
    }
  }

  // ——— 1~3. 开演前 ———

  async #preShow(signal) {
    const { world, audio, tl } = this;
    const E = C.entrance;
    world.house.setAll(1);
    world.stageLights.setLevel(E.stageLevel);
    world.stageLights.setBeams(E.beams);
    world.stageLights.setMood('preshow');
    world.screen.snap({ curtain: 1, card: 1, gargantua: 0 });
    audio.setMurmur(E.murmur, 3);

    // 入场：镜头从大厅后方滑到第 8 排，同时乐手陆续上台落座
    world.rig.placeAt('entrance');
    await Promise.all([
      world.rig.fly('entrance', E.cameraGlide, tl, signal),
      world.orchestra.walkOn(tl, { spread: E.walkOnSpread, speed: E.walkSpeed }, signal),
    ]);
    world.orchestra.turnPages(12);
    this.#pageTurnSounds(6, E.settle, signal);
    await tl.wait(E.settle, signal);

    // 调音：首席起立，双簧管给 A，全团跟上
    const T = C.tuning;
    audio.setMurmur(E.murmur * 0.55, 2);
    world.orchestra.standConcertmaster(true);
    await tl.wait(T.standUp, signal);
    audio.tuneOboe(T.oboe);
    await tl.wait(T.oboeSolo, signal);
    world.orchestra.setTuning(true);
    audio.tuneTutti(T.tutti);
    await tl.wait(T.tutti, signal);
    world.orchestra.setTuning(false);
    world.orchestra.standConcertmaster(false);
    await tl.wait(T.sitDown, signal);

    // 观众席灯光从后往前逐排熄灭，交谈声渐弱，巨幕标题卡淡出
    const H = C.houseDown;
    audio.setMurmur(0, H.murmurFade);
    world.screen.set({ card: 0 }, H.cardFade);
    world.stageLights.setLevel(H.stageLevel);
    world.stageLights.setBeams(H.beams);
    await world.house.fadeRows(0, { from: 'back', stagger: H.rowStagger, fade: H.rowFade }, tl, signal);
    await tl.wait(H.hold, signal);

    // 指挥上台：全场鼓掌，与首席握手，走上指挥台，向观众鞠躬，转身面向乐团
    const K = C.conductor;
    this.#applause({ strength: K.applause, duration: K.applauseDuration });
    world.stageLights.setFollow(true);
    const cm = world.orchestra.concertmaster;
    const nearCm = new Vector3(cm.seat.x + 0.75, STAGE_Y, cm.seat.z + 0.45);
    world.conductor.place(WINGS.left, Math.PI / 2);
    await world.conductor.walk([new Vector3(-6, STAGE_Y, -0.7), nearCm], K.walkOn, tl, signal);
    world.conductor.faceTowards(cm.seat);
    world.orchestra.standConcertmaster(true);
    world.conductor.setPose('handshake');
    await tl.wait(K.handshake, signal);
    world.conductor.setPose('rest');
    world.orchestra.standConcertmaster(false);
    await world.conductor.walk([PODIUM.clone()], K.toPodium, tl, signal);
    world.conductor.face('audience');
    await tl.wait(K.turn, signal);
    await world.conductor.bowOnce(K.bow, tl, signal);
    world.conductor.face('orchestra');
    world.stageLights.setFollow(false);
    await tl.wait(K.turn, signal);
  }

  /** 跳过开演前：所有人直接就位、熄灯 */
  #snapPreShow() {
    const { world, audio } = this;
    world.orchestra.snapSeated();
    world.orchestra.setTuning(false);
    world.orchestra.standConcertmaster(false);
    world.house.setAll(0);
    world.stageLights.setLevel(C.houseDown.stageLevel);
    world.stageLights.setBeams(C.houseDown.beams);
    world.stageLights.setFollow(false);
    world.screen.snap({ curtain: 1, card: 0 });
    world.conductor.place(PODIUM.clone().setY(STAGE_Y + PODIUM_HEIGHT), 'orchestra');
    world.conductor.setPose('rest');
    world.rig.snapToSeat();
    audio.setMurmur(0, 0.5);
    this.#stopSounds(0.8);
  }

  // ——— 每一首 ———

  #preload(i) {
    if (i >= this.setlist.length) return null;
    if (!this.preloads.has(i)) {
      const song = this.setlist[i];
      this.preloads.set(i, this.player.preload(song.youtubeId));
    }
    return this.preloads.get(i);
  }

  async #performSong(i, signal) {
    const { world, audio, tl } = this;
    const S = C.song;

    // 巨幕从黑洞过渡回到黑幕，灯光到演出亮度，乐手举起乐器，指挥举棒
    world.screen.set({ gargantua: 0, card: 0, curtain: 1 }, S.screenToBlack);
    world.stageLights.setScreenGlow(0);
    audio.setDrone(0, S.screenToBlack);
    world.stageLights.setLevel(S.stageLevel);
    world.stageLights.setBeams(S.beams);
    world.stageLights.setMood(this.setlist[i].mood);
    world.orchestra.setReady(true);
    world.conductor.face('orchestra');
    world.conductor.setPose('ready');

    // 等预加载（最多 preloadTimeout 秒），然后全场静止约 2 秒
    const loaded = await Promise.race([
      this.#preload(i),
      tl.wait(S.preloadTimeout, signal).then(() => ({ ok: true, slow: true })),
    ]);
    if (signal.aborted) throw new SkipSignal();
    if (!loaded.ok) {
      await this.#unavailable(i, loaded.error, signal);
      return;
    }
    await tl.wait(S.stillness, signal);

    const outcome = await this.#playClip(i, signal);
    if (outcome === 'error') {
      await this.#unavailable(i, this.player.error, signal);
      return;
    }
    this.results[i].played = true;

    // 片段结束：最后一首时指挥双手停在空中，交给终场；否则收住、停一拍、放下指挥棒
    if (i === this.setlist.length - 1) {
      world.conductor.setPose('wideHold');
      return;
    }
    world.conductor.setPose('hold');
    await tl.wait(S.holdAfterEnd, signal);
    world.conductor.setPose('rest');
    world.orchestra.setReady(false);
    await tl.wait(S.lowerBaton, signal);
  }

  /**
   * 播放一段，直到结束前 0.5 秒切走。每帧：
   * 播放时钟插值 → cue 驱动乐团 → 检查缓冲/异常（幕布盖住）→ 检查自动播放是否被拦截。
   * @returns {Promise<'done'|'error'>}
   */
  #playClip(i, signal) {
    const { world, player, ui, tl } = this;
    const S = C.song;
    const runner = new CueRunner(cuesFor(this.setlist[i].slug));
    const clock = new PlaybackClock(player);
    this.clock = clock;
    this.runner = runner;
    player.play();

    return new Promise((resolve, reject) => {
      let revealed = false;
      let cutting = false;
      let blockedPrompt = false;
      let stuckPrompt = false;
      let mutedSince = null;
      let lastUnmute = 0;
      let soundPrompt = false;

      const cleanup = () => {
        off();
        signal.removeEventListener('abort', onAbort);
        ui.clearPrompt();
        player.setInteractive(false);
        world.setPerformance(null);
      };
      const onAbort = () => {
        cleanup();
        reject(new SkipSignal());
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const off = world.onFrame((dt) => {
        clock.update();
        if (player.error) {
          cleanup();
          resolve('error');
          return;
        }

        // 自动播放被拦截：提示观众点一下（点银幕或任意处都可以）
        if (clock.blocked && !blockedPrompt) {
          blockedPrompt = true;
          player.setInteractive(true);
          ui.prompt('浏览器拦截了自动播放，点击画面继续演出', () => {
            player.play();
            clock.markRequested();
          });
        }

        // 卡住太久（多半是插播广告，前端无法检测或跳过）：不能让演出永远停在这里。
        // 拉开幕布、让银幕可以点击（观众能按广告的"跳过"），点空白处则直接跳到下一首
        if (!stuckPrompt && !blockedPrompt && !cutting && clock.waiting > S.stuckPrompt) {
          stuckPrompt = true;
          player.setInteractive(true);
          world.screen.set({ curtain: 0 }, S.revealFade);
          ui.prompt('片段迟迟没有继续（可能在插播广告）：可以直接操作银幕，或点击空白处跳到下一首', () => this.skip());
        }
        if (clock.advancing && (blockedPrompt || stuckPrompt)) {
          blockedPrompt = false;
          stuckPrompt = false;
          player.setInteractive(false);
          ui.clearPrompt();
        }

        // 有画面但被静音（部分浏览器的策略）：先自己解除（每半秒试一次），不行再请观众点一下
        const now = performance.now();
        if (clock.advancing && player.isMuted()) {
          mutedSince ??= now;
          if (now - lastUnmute > 500) {
            lastUnmute = now;
            player.unMute();
          }
          if (!soundPrompt && now - mutedSince > 1500) {
            soundPrompt = true;
            ui.prompt('点击任意处开启声音', () => player.unMute());
          }
        } else {
          mutedSince = null;
          if (soundPrompt && !player.isMuted()) {
            soundPrompt = false;
            ui.clearPrompt();
          }
        }

        // 画面真正开始走：巨幕亮起，指挥下拍
        if (!revealed && clock.advancing) {
          revealed = true;
          world.screen.set({ curtain: 0 }, S.revealFade);
          world.caption.hide();
          world.conductor.setPose('conduct');
          world.stageLights.setScreenGlow(1, 0xa8c4ff);
        }

        // 缓冲过久、画面卡住、广告：幕布盖住，乐团等待
        if (revealed && !cutting && !stuckPrompt) {
          world.screen.set({ curtain: clock.abnormal ? 1 : 0 }, clock.abnormal ? S.coverFade : S.revealFade);
        }

        const perf = runner.update(clock.time, dt, clock.advancing);
        this.results[i].peak = Math.max(this.results[i].peak, perf.intensity);
        world.setPerformance(perf);

        // 结束前 0.5 秒切走：幕布落下、音量渐出，再暂停，不让 YouTube 的结束画面露出来
        const nearEnd = clock.duration > 1 && clock.time >= clock.duration - S.cutBeforeEnd;
        if (!cutting && ((revealed && nearEnd) || clock.state === 'ended')) {
          cutting = true;
          ui.clearPrompt();
          world.screen.set({ curtain: 1 }, S.cutFade);
          world.stageLights.setScreenGlow(0);
          tl.animate(S.cutFade, (k) => player.setVolume(100 * (1 - k)), { ease: (k) => k })
            .then(() => {
              // 渐出期间观众按了"下一首"：onAbort 已经收尾，这里不能再暂停（下一段可能已开始预加载）
              if (signal.aborted) return;
              player.pause();
              cleanup();
              resolve('done');
            });
        }
      });
    });
  }

  /** 被"下一首"打断：立即切走当前片段 */
  #abortSong(i) {
    const { world, player } = this;
    world.screen.set({ curtain: 1 }, 0.3);
    world.stageLights.setScreenGlow(0);
    player.pause();
    world.setPerformance(null);
    world.conductor.setPose('rest');
    world.orchestra.setReady(false);
    this.results[i].played ||= this.clock?.started ?? false;
  }

  /** 片段无法播放：字幕牌提示，跳过这一首 */
  async #unavailable(i, reason, signal) {
    const { world, tl } = this;
    this.results[i].error = reason || '片段无法播放';
    world.caption.showMessage('本段片段暂时无法播放', this.setlist[i].title, reason || '');
    world.conductor.setPose('rest');
    world.orchestra.setReady(false);
    await tl.wait(C.song.unavailableHold, signal);
  }

  // ——— 4. 曲间换场 ———

  async #intermission(i, signal) {
    const { world, audio, tl } = this;
    const I = C.intermission;
    const next = this.setlist[i + 1];
    const peak = this.results[i].played ? this.results[i].peak : 0.3;

    // 换场一开始就预加载下一段（幕布/黑洞盖着巨幕，静音缓冲看不到也听不到）
    this.#preload(i + 1);

    // 掌声：强度和长度都跟上一首的峰值走
    const applauseLength = I.applauseBase + I.applauseExtra * peak;
    this.#applause({ strength: I.applauseMin + (1 - I.applauseMin) * peak, duration: applauseLength });
    world.stageLights.setLevel(I.stageLevel);
    world.stageLights.setBeams(I.beams);
    world.stageLights.setMood(next.mood);
    world.orchestra.setReady(false);

    // 精彩的一首之后，指挥转身向观众致意
    if (peak >= I.acknowledgeAbove) {
      background((async () => {
        await tl.wait(0.8, signal);
        world.conductor.face('audience');
        await tl.wait(0.9, signal);
        await world.conductor.bowOnce(1.6, tl, signal, 0.45);
        world.conductor.face('orchestra');
      })());
    }

    // 巨幕换成 Gargantua，字幕牌亮出下一首，镜头自由移动一圈
    background(tl.wait(I.gargantuaAt, signal).then(() => {
      world.screen.set({ gargantua: 1 }, I.gargantuaFade);
      world.stageLights.setScreenGlow(0.8, 0xffb070);
      audio.setDrone(I.drone, I.gargantuaFade);
    }));
    background(tl.wait(I.captionAt, signal).then(() => world.caption.showSong(next, i + 1, this.setlist.length)));
    background(tl.wait(I.cameraAt, signal).then(() => (
      world.rig.fly(i % 2 === 0 ? 'sweepLeft' : 'sweepRight', I.cameraDuration, tl, signal)
    )));

    // 掌声落下后：翻谱、零星咳嗽、观众低声交流
    background(tl.wait(applauseLength * 0.7, signal).then(() => {
      audio.setMurmur(I.murmur, 2);
      world.orchestra.turnPages(10);
    }));
    this.#pageTurnSounds(I.pageTurns, I.total * 0.6, signal, applauseLength * 0.6);
    const coughs = Math.round(range(this.rand, I.coughs[0], I.coughs[1] + 0.99));
    for (let k = 0; k < coughs; k++) {
      const at = range(this.rand, applauseLength, I.total - 3);
      background(tl.wait(at, signal).then(() => audio.cough()));
    }

    await tl.wait(I.total - 2, signal);
    audio.setMurmur(0, 1.8);
    await tl.wait(2, signal);
  }

  #snapIntermission(i) {
    const { world, audio } = this;
    this.#stopSounds(0.8);
    audio.setMurmur(0, 0.5);
    world.rig.snapToSeat();
    world.conductor.face('orchestra');
    world.screen.snap({ gargantua: 1 });
    world.caption.showSong(this.setlist[i + 1], i + 1, this.setlist.length);
  }

  // ——— 5. 终场谢幕 ———

  async #finale(signal) {
    const { world, tl } = this;
    const F = C.finale;

    // 最后一段结束：指挥双手停在空中，几秒寂静
    world.conductor.setPose('wideHold');
    await tl.wait(F.silence, signal);

    // 掌声爆发，观众陆续起立，镜头缓缓推近
    this.#applause({ strength: 1, duration: F.applauseDuration, attack: 0.25, release: F.applauseFade });
    world.stageLights.setLevel(F.stageLevel);
    world.stageLights.setBeams(F.beams);
    world.stageLights.setMood('epic');
    world.stageLights.setFollow(true);
    world.audience.standUp(F.audienceStagger);
    background(world.rig.fly('finale', F.cameraDuration, tl, signal));
    world.conductor.setPose('rest');
    world.orchestra.setReady(false);
    await tl.wait(F.lower, signal);

    // 指挥转身鞠躬
    world.conductor.face('audience');
    await tl.wait(F.turn, signal);
    await world.conductor.bowOnce(F.bow, tl, signal);

    // 示意各声部起立致意：弦乐（指挥的右手边）→ 合唱 → 定音鼓和管风琴
    world.conductor.setPose('gestureRight');
    world.orchestra.standUp(['violin1', 'violin2', 'viola', 'cello', 'bass']);
    await tl.wait(F.sectionGap, signal);
    world.conductor.setPose('gestureLeft');
    background(world.orchestra.bowAll(tl, 1.6, ['choir'], signal));
    await tl.wait(F.sectionGap, signal);
    world.conductor.setPose('gestureUp');
    world.orchestra.standUp(['timpani', 'organ']);
    await tl.wait(F.sectionGap, signal);

    // 全体一起鞠躬
    world.conductor.setPose('rest');
    world.orchestra.standUp();
    await Promise.all([
      world.conductor.bowOnce(F.bow, tl, signal),
      world.orchestra.bowAll(tl, F.bow, null, signal),
    ]);

    // 指挥下台，再上台返场鞠躬一次
    await world.conductor.walk([new Vector3(-6, STAGE_Y, -0.6), WINGS.left], F.exitWalk, tl, signal);
    await tl.wait(F.offstage, signal);
    await world.conductor.walk([new Vector3(-6, STAGE_Y, -0.6), new Vector3(0, STAGE_Y, -0.7)], F.returnWalk, tl, signal);
    world.conductor.face('audience');
    await tl.wait(F.turn, signal);
    await world.conductor.bowOnce(F.bow, tl, signal);

    // 观众席灯光从前往后渐亮，掌声渐弱
    this.#stopSounds(F.applauseFade);
    await world.house.fadeRows(1, { from: 'front', stagger: F.houseUp / 30, fade: F.houseUp * 0.5 }, tl, signal);
    world.stageLights.setFollow(false);
    await tl.wait(F.backPageDelay, signal);
  }

  #snapFinale() {
    const { world } = this;
    world.house.setAll(1);
    world.audience.standUp(0);
    world.orchestra.standUp();
    world.rig.snapToSeat();
    this.#stopSounds(1);
  }

  // ——— 散场 ———

  async #closing() {
    const { world, audio, player } = this;
    this.phase = 'closing';
    this.ui.setStatus(this.statusText);
    world.setPerformance(null);
    player.pause();
    world.screen.set({ curtain: 1, gargantua: 0 }, 0.5);
    this.#stopSounds(this.ending ? 1 : 3);
    audio.fadeAll(this.ending ? 1 : 3);
    this.ui.showBackPage(this.setlist, this.results);
  }

  // ——— 声音小工具 ———

  #applause(options) {
    const handle = this.audio.applause(options);
    this.sounds.add(handle);
    this.tl.wait(options.duration).then(() => this.sounds.delete(handle));
    return handle;
  }

  #stopSounds(fade) {
    for (const s of this.sounds) s.stop(fade);
    this.sounds.clear();
  }

  #pageTurnSounds(count, within, signal, after = 0) {
    for (let k = 0; k < count; k++) {
      background(this.tl.wait(after + this.rand() * within, signal).then(() => this.audio.pageTurn()));
    }
  }
}
