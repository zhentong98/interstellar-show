// 全屏与鼠标指针

export function enterFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
  try {
    request?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  } catch {
    // iPhone Safari 不支持页面全屏，忽略即可
  }
}

export function exitFullscreen() {
  if (!(document.fullscreenElement ?? document.webkitFullscreenElement)) return;
  const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
  try {
    exit?.call(document)?.catch?.(() => {});
  } catch {
    // 忽略
  }
}

/** 演出中隐藏鼠标；控制条或提示出现时再显示 */
export function setCursorHidden(hidden) {
  document.documentElement.classList.toggle('cursor-hidden', hidden);
}
