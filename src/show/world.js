// 场景总装和渲染循环。
//
// 两个渲染器共用同一台相机：
//   CSS3DRenderer（底层）只放巨幕上的 YouTube iframe
//   WebGLRenderer（上层，透明画布）画整个音乐厅，巨幕位置由覆盖层"挖洞"

import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { Timeline } from '../core/timeline.js';
import { PostFX } from './post.js';
import { buildHall, materials as hallMaterials } from '../stage/hall.js';
import { buildEnvironment } from '../stage/environment.js';
import { screenMaskUniforms } from '../stage/atmosphere.js';
import { SCREEN } from '../stage/layout.js';
import { HouseLights } from '../stage/houseLights.js';
import { StageLights } from '../stage/stageLights.js';
import { GiantScreen } from '../stage/screen.js';
import { CaptionBoard } from '../stage/captionBoard.js';
import { Orchestra } from '../stage/orchestra.js';
import { Conductor } from '../stage/conductor.js';
import { Audience } from '../stage/audience.js';
import { CameraRig } from '../stage/cameraRig.js';

export const IDLE_PERFORMANCE = Object.freeze({ playing: false, intensity: 0, bpm: 72, cueName: '', events: [] });

export class World {
  constructor(root) {
    this.root = root;
    this.timeline = new Timeline();
    this.frameCallbacks = new Set();
    this.perf = IDLE_PERFORMANCE;
    this.running = false;

    // —— 渲染器 ——
    this.css = new CSS3DRenderer();
    this.css.domElement.className = 'layer-css';
    this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.gl.domElement.className = 'layer-gl';
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.setClearColor(0x000000, 1);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    root.append(this.css.domElement, this.gl.domElement);

    this.scene = new THREE.Scene();
    this.cssScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);

    // 环境反射：程序生成的音乐厅环境；放了本地 HDRI 就自动换上
    buildEnvironment(this.gl, this.scene);
    // 舞台烟雾：很淡的指数雾，让远处的音管墙和光柱有空气感
    this.scene.fog = new THREE.FogExp2(0x0c0907, 0.011);

    // —— 场景 ——
    const hall = buildHall();
    this.scene.add(hall.group);
    this.house = new HouseLights(hall.lamps);
    this.scene.add(this.house.hemi);
    for (const l of this.house.washes) this.scene.add(l, l.target);
    this.stageLights = new StageLights();
    this.scene.add(this.stageLights.group);
    this.screen = new GiantScreen();
    this.scene.add(this.screen.overlay);
    this.cssScene.add(this.screen.cssObject);
    this.caption = new CaptionBoard();
    this.scene.add(this.caption.group);
    this.orchestra = new Orchestra();
    this.scene.add(this.orchestra.group);
    this.conductor = new Conductor();
    this.scene.add(this.conductor.group);
    this.audience = new Audience(this.house);
    this.scene.add(this.audience.group);
    this.rig = new CameraRig(this.camera);
    this.orchestra.onDrumImpact = (strength) => {
      this.rig.addShake(0.12 * strength);
      this.post.kick(0.15 * strength);
    };
    this.stageLights.followSubject = this.conductor.body.position;
    this.post = new PostFX(this.gl, this.scene, this.camera);
    this.screenCorners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => new THREE.Vector3(
      SCREEN.center.x + (sx * SCREEN.width) / 2, SCREEN.center.y + (sy * SCREEN.height) / 2, SCREEN.center.z)));
    this.tmpV = new THREE.Vector3();

    this.#resize();
    window.addEventListener('resize', () => this.#resize());
    // 先渲染一次 CSS3D 层，让 iframe 的容器进入文档，播放器才能创建
    this.css.render(this.cssScene, this.camera);
  }

  #resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h);
    this.css.setSize(w, h);
    this.post?.setSize(w, h);
    this.rig.fitToAspect(w / h);
    if (this.rig.mode === 'seat') this.rig.snapToSeat();
  }

  /** 换成写实人物模型（演员表加载完成后调用，必须在演出开始前） */
  useCast(cast) {
    this.orchestra.useCast(cast);
    this.conductor.useCast(cast);
    this.stageLights.followSubject = this.conductor.body.position;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.#frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  /** 每帧回调（导演用来盯播放进度），返回取消函数 */
  onFrame(callback) {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  /** 设置当前的演奏数据，并分发一次性事件 */
  setPerformance(perf) {
    this.perf = perf ?? IDLE_PERFORMANCE;
    for (const ev of this.perf.events) {
      if (ev.type === 'flash') {
        this.stageLights.triggerFlash(ev.strength);
        this.post.kick(0.9 * ev.strength);
        this.rig.addShake(0.06 * ev.strength);
      } else if (ev.type === 'shake') {
        this.rig.addShake(0.3 * ev.strength);
      } else if (ev.type === 'drumHit') {
        this.orchestra.drumHit(ev.lead, ev.strength);
      }
    }
  }

  /**
   * 巨幕在屏幕上的投影范围，给光束和浮尘做遮罩：电影画面露出来时，光束不能盖在画面上。
   * 幕布完全落下（换场、开演前）时解除遮罩，光束可以完整扫过银幕前方。
   */
  #updateScreenMask() {
    const rect = screenMaskUniforms.uScreenRect.value.set(9, 9, -9, -9);
    for (const c of this.screenCorners) {
      const p = this.tmpV.copy(c).project(this.camera);
      rect.x = Math.min(rect.x, p.x);
      rect.y = Math.min(rect.y, p.y);
      rect.z = Math.max(rect.z, p.x);
      rect.w = Math.max(rect.w, p.y);
    }
    const { curtain, card, gargantua } = this.screen.layers;
    // 电影露出来（幕布拉开）→ 完全遮住光束；黑洞过渡时也收一半，免得冲淡黑洞
    const filmVisible = 1 - Math.max(curtain.value, card.value, gargantua.value);
    screenMaskUniforms.uMask.value = Math.min(1, filmVisible * 1.5 + gargantua.value * 0.6 + card.value * 0.4);
    this.gl.getDrawingBufferSize(screenMaskUniforms.uResolution.value);
  }

  #frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.timeline.update(dt);
    for (const cb of this.frameCallbacks) cb(dt);

    const perf = this.perf;
    this.house.update();
    this.stageLights.update(dt, perf);
    this.screen.update(dt);
    this.caption.update(dt);
    this.orchestra.update(dt, perf);
    this.conductor.update(dt, perf);
    this.audience.update(dt);
    this.rig.update(dt);
    this.#updateScreenMask();
    // 音管自发光（底光打上去的效果）
    hallMaterials.pipeMetal.emissive.copy(this.stageLights.pipeColor);
    hallMaterials.pipeMetal.emissiveIntensity = this.stageLights.pipeGlow * 1.4;
    // 环境反射跟着场内整体亮度走，暗场时金属音管不会莫名发亮
    this.scene.environmentIntensity = 0.04 + 0.2 * Math.max(this.house.average, this.stageLights.level * 0.5);
    this.stageLights.dust.update(dt, this.gl.getPixelRatio() * window.innerHeight * 0.06);

    this.post.render(dt);
    this.css.render(this.cssScene, this.camera);
    // 一次性事件只在这一帧有效
    if (this.perf.events.length) this.perf = { ...this.perf, events: [] };
  }
}
