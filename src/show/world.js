// 场景总装和渲染循环。
//
// 两个渲染器共用同一台相机：
//   CSS3DRenderer（底层）只放巨幕上的 YouTube iframe
//   WebGLRenderer（上层，透明画布）画整个音乐厅，巨幕位置由覆盖层"挖洞"

import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Timeline } from '../core/timeline.js';
import { buildHall } from '../stage/hall.js';
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
    this.gl.toneMappingExposure = 1;
    this.gl.setClearColor(0x000000, 1);
    root.append(this.css.domElement, this.gl.domElement);

    this.scene = new THREE.Scene();
    this.cssScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);

    // 环境反射：程序生成的房间环境（里程碑 2 换成 HDRI）
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // —— 场景 ——
    const hall = buildHall();
    this.scene.add(hall.group);
    this.house = new HouseLights(hall.lamps);
    this.scene.add(this.house.hemi);
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
    this.orchestra.onDrumImpact = (strength) => this.rig.addShake(0.12 * strength);
    this.stageLights.followSubject = this.conductor.body.position;

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
    this.rig.fitToAspect(w / h);
    if (this.rig.mode === 'seat') this.rig.snapToSeat();
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
        this.rig.addShake(0.06 * ev.strength);
      } else if (ev.type === 'shake') {
        this.rig.addShake(0.3 * ev.strength);
      } else if (ev.type === 'drumHit') {
        this.orchestra.drumHit(ev.lead, ev.strength);
      }
    }
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
    // 环境反射跟着场内整体亮度走，暗场时金属音管不会莫名发亮
    this.scene.environmentIntensity = 0.03 + 0.14 * Math.max(this.house.average, this.stageLights.level * 0.5);

    this.gl.render(this.scene, this.camera);
    this.css.render(this.cssScene, this.camera);
    // 一次性事件只在这一帧有效
    if (this.perf.events.length) this.perf = { ...this.perf, events: [] };
  }
}
