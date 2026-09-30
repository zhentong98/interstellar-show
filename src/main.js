// 入口：节目单 → 按下"入场" → 导演接管，全程自动演出 → 节目单背面
//
// 调试参数：
//   ?mock[=秒]      用模拟播放器代替 YouTube（离线开发、自动化测试）
//   ?mockstall=秒   模拟播放器在该时间点缓冲 3 秒
//   ?debug          显示当前环节、播放时间和 cue
//   ?speed=4        仪式环节加速（不影响视频本身）

import './style.css';
import { songs } from './songs.js';
import { World } from './show/world.js';
import { Director } from './show/director.js';
import { ShowAudio } from './audio/sfx.js';
import { YouTubeScreenPlayer } from './video/youtube.js';
import { MockScreenPlayer } from './video/mockPlayer.js';
import { renderProgramme } from './ui/programme.js';
import { renderBackPage } from './ui/backPage.js';
import { ShowControls } from './ui/controls.js';
import { DebugHud } from './ui/debugHud.js';
import { enterFullscreen, exitFullscreen } from './ui/fullscreen.js';
import { ceremony } from './cues/ceremony.js';
import { loadCast } from './stage/humans/cast.js';

const params = new URLSearchParams(window.location.search);

const world = new World(document.getElementById('show'));
world.timeline.speed = Math.max(0.1, Number(params.get('speed')) || 1);
world.screen.drawTitleCard();

// Claude Artifact 预览版（VITE_PREVIEW_MOCK=1 构建）：页面拿不到网址参数，也不能嵌入 YouTube，默认用模拟播放器
if (import.meta.env.VITE_PREVIEW_MOCK === '1' && !params.has('mock')) params.set('mock', '90');

// 播放器在节目单阶段就开始加载，入场时已经就绪
const player = params.has('mock')
  ? new MockScreenPlayer(world.screen.host, {
    duration: Number(params.get('mock')) || 40,
    stallAt: params.has('mockstall') ? Number(params.get('mockstall')) : null,
  })
  : new YouTubeScreenPlayer(world.screen.host);

const audio = new ShowAudio();
const controls = new ShowControls(document.getElementById('controls'));

const programme = renderProgramme(document.getElementById('programme'), songs, { onEnter: enter });

// 写实人物模型（public/models/cast.json）：加载完再允许入场；没有的话直接用程序化人体
programme.setBusy('正在布置舞台…');
loadCast()
  .then((cast) => {
    if (cast) world.useCast(cast);
  })
  .catch((err) => console.warn('人物模型加载失败，使用程序化人体', err))
  .finally(() => programme.setBusy(null));

function enter(setlist) {
  // 以下几步必须在点击事件的同步调用栈里完成：全屏、解锁 Web Audio、开始静音预载第一段
  enterFullscreen();
  audio.unlock();

  const director = new Director({
    world,
    player,
    audio,
    ui: {
      setStatus: (text) => controls.setStatus(text),
      prompt: (text, onClick) => controls.prompt(text, onClick),
      clearPrompt: () => controls.clearPrompt(),
      showBackPage: (list, results) => {
        controls.detach();
        exitFullscreen();
        renderBackPage(document.getElementById('backpage'), list, results);
        // 背面盖住之后停止渲染，省电
        setTimeout(() => world.stop(), 2500);
      },
    },
  });
  if (params.has('debug')) new DebugHud(director, world);
  window.__show = { director, world, player }; // 方便在控制台里调试

  director.run(setlist).catch((err) => {
    console.error('演出出错：', err);
    controls.detach();
    renderBackPage(document.getElementById('backpage'), setlist, director.results ?? setlist.map(() => ({})));
  });
  controls.attach(director, world.rig);
  world.start();
  programme.leave(ceremony.entrance.programmeExit);
}
