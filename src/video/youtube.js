// 巨幕上的 YouTube 播放器（IFrame Player API）。
//
// 沉浸感处理：
//   - 播放器参数去掉控件、相关视频、键盘、注释卡片，iframe 本身不接收鼠标
//   - 预加载：静音播放到真正拿到数据后暂停并回到 0 秒，保证指挥举棒后立即开始
//   - 结束前切走、缓冲/广告时盖幕布，由 Director + PlaybackClock 负责

const API_URL = 'https://www.youtube.com/iframe_api';
const STATES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
const ERRORS = {
  2: '视频参数无效',
  5: '播放器无法播放该视频',
  100: '视频不存在或已设为私享',
  101: '上传者不允许嵌入播放',
  150: '上传者不允许嵌入播放',
};

let apiPromise = null;

function loadApi(timeoutMs) {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const timer = setTimeout(() => reject(new Error('YouTube 播放器加载超时')), timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('无法连接 YouTube'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export class YouTubeScreenPlayer {
  /** @param {HTMLElement} host 巨幕上的 DOM 容器（CSS3D 对象） */
  constructor(host) {
    this.host = host;
    this.player = null;
    this.error = null; // 当前视频的错误信息
    this.ready = this.#create();
    this.ready.catch(() => {}); // 失败由调用方处理，这里只防止未处理的拒绝
  }

  async #create() {
    const YT = await loadApi(15000);
    const mount = document.createElement('div');
    this.host.appendChild(mount);
    await new Promise((resolve) => {
      this.player = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          disablekb: 1,
          playsinline: 1,
          iv_load_policy: 3,
          fs: 0,
          cc_load_policy: 0,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => resolve(),
          onError: (e) => {
            this.error = ERRORS[e.data] ?? `播放器错误 ${e.data}`;
          },
        },
      });
    });
    const iframe = this.host.querySelector('iframe');
    if (iframe) {
      iframe.setAttribute('tabindex', '-1');
      iframe.style.pointerEvents = 'inherit';
    }
    return this;
  }

  /**
   * 预加载：静音开始播放，拿到画面数据后暂停并回到 0 秒。
   * （cueVideoById 只加载封面、不缓冲视频，所以用静音播放来真正缓冲；这时巨幕被幕布或黑洞盖着，看不到也听不到）
   * 第一段在"入场"点击时就开始预加载，入场仪式期间缓冲完毕。
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async preload(videoId) {
    try {
      await this.ready;
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const p = this.player;
    this.error = null;
    this.videoId = videoId;
    p.mute();
    p.loadVideoById({ videoId, startSeconds: 0 });

    return new Promise((resolve) => {
      const started = performance.now();
      const poll = setInterval(() => {
        if (this.videoId !== videoId) return finish({ ok: false, error: '已切换到其他视频' });
        if (this.error) return finish({ ok: false, error: this.error });
        if (p.getPlayerState() === 1 && p.getCurrentTime() > 0.2) {
          p.pauseVideo();
          p.seekTo(0, true);
          return finish({ ok: true });
        }
        // 超时（比如插播广告）不算失败，开演时照常尝试播放
        if (performance.now() - started > 12000) finish({ ok: true, slow: true });
      }, 100);
      const finish = (result) => {
        clearInterval(poll);
        resolve(result);
      };
    });
  }

  play() {
    const p = this.player;
    if (!p) return;
    p.unMute();
    p.setVolume(100);
    p.playVideo();
  }

  pause() {
    this.player?.pauseVideo();
  }

  setVolume(v) {
    this.player?.setVolume(Math.round(v));
  }

  unMute() {
    this.player?.unMute();
  }

  isMuted() {
    return this.player?.isMuted?.() ?? false;
  }

  getTime() {
    return this.player?.getCurrentTime?.() ?? 0;
  }

  getDuration() {
    return this.player?.getDuration?.() ?? 0;
  }

  getState() {
    if (!this.player?.getPlayerState) return 'unstarted';
    return STATES[this.player.getPlayerState()] ?? 'unstarted';
  }

  /** 自动播放被拦截时，让观众可以直接点到 iframe */
  setInteractive(on) {
    this.host.style.pointerEvents = on ? 'auto' : 'none';
  }
}
