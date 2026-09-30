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
  if (!isFullscreen()) return;
  const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
  try {
    exit?.call(document)?.catch?.(() => {});
  } catch {
    // 忽略
  }
}

export function isFullscreen() {
  return !!(document.fullscreenElement ?? document.webkitFullscreenElement);
}

/** 页面能不能全屏（iPhone Safari 不行） */
export function canFullscreen() {
  const el = document.documentElement;
  return !!(el.requestFullscreen ?? el.webkitRequestFullscreen);
}

export function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}

/** 演出中隐藏鼠标；控制条或提示出现时再显示 */
export function setCursorHidden(hidden) {
  document.documentElement.classList.toggle('cursor-hidden', hidden);
}
