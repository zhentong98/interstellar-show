// 节目单（选歌页）：黑洞 Gargantua 作主视觉，左边是片名和"入场"，右边是今晚曲目。
// 观众勾选想听的片段（默认全选），按原顺序组成本场曲目。"入场"的点击同时用来解锁有声播放。
// 宽屏一屏内放下全部内容；窄屏时"入场"固定在屏幕底部，不用滚动就能点到。

import { createProgrammeSky } from './programmeSky.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function sourceLine(song) {
  const tag = song.official ? '' : ' <em class="unofficial">非官方上传</em>';
  return `片段来源：${escapeHtml(song.channel)}${tag}`;
}

export function renderProgramme(root, songs, { onEnter }) {
  const rows = songs.map((song, i) => `
    <li>
      <label class="pg-song">
        <input type="checkbox" value="${escapeHtml(song.slug)}" checked>
        <span class="pg-numeral" aria-hidden="true">${ROMAN[i] ?? i + 1}</span>
        <span class="pg-song-text">
          <span class="pg-song-title">${escapeHtml(song.title)}</span>
          <span class="pg-song-scene">${escapeHtml(song.scene)}</span>
          <span class="pg-song-source">${sourceLine(song)}</span>
        </span>
        <span class="pg-mark" aria-hidden="true"></span>
      </label>
    </li>`).join('');

  root.innerHTML = `
    <div class="pg-sky" aria-hidden="true"></div>
    <div class="pg-layout">
      <header class="pg-hero">
        <h1 class="pg-title">Interstellar</h1>
        <p class="pg-subtitle">星际穿越　电影交响音乐会</p>
        <p class="pg-credit">汉斯·季默 配乐　　克里斯托弗·诺兰 导演</p>
      </header>
      <section class="pg-setlist" aria-labelledby="pg-setlist-title">
        <h2 id="pg-setlist-title">今晚曲目 <span class="pg-count"></span></h2>
        <ol>${rows}</ol>
        <p class="pg-ensemble">管风琴、弦乐四十人、合唱三十人、定音鼓四架，一位指挥</p>
      </section>
      <div class="pg-enter">
        <button type="button" class="enter">入场</button>
        <p class="enter-note"></p>
      </div>
      <p class="pg-fineprint">非官方粉丝作品。巨幕片段通过 YouTube 嵌入播放，影片与配乐的版权归原权利人所有；现场的掌声、交谈与调音均为原创合成音效。</p>
    </div>`;

  const sky = createProgrammeSky(root.querySelector('.pg-sky'));
  const button = root.querySelector('.enter');
  const note = root.querySelector('.enter-note');
  const count = root.querySelector('.pg-count');
  const defaultNote = matchMedia('(pointer: coarse)').matches
    ? '演出全程自动进行。点屏幕底部，可以换镜头、跳到下一首或结束演出。'
    : '演出全程自动进行。鼠标移到屏幕底部，可以换镜头、全屏、跳到下一首或结束演出。';
  const boxes = [...root.querySelectorAll('input[type="checkbox"]')];
  const selected = () => songs.filter((s) => boxes.find((b) => b.value === s.slug)?.checked);

  let busy = null;
  const refresh = () => {
    const n = selected().length;
    count.textContent = `已选 ${n} 首`;
    button.disabled = n === 0 || !!busy;
    note.textContent = busy ?? (n === 0 ? '请至少勾选一首。' : defaultNote);
  };
  boxes.forEach((b) => b.addEventListener('change', refresh));
  button.addEventListener('click', () => {
    const setlist = selected();
    if (setlist.length) onEnter(setlist);
  });
  refresh();

  return {
    /** 舞台还没准备好时禁用入场按钮，显示提示；传 null 恢复 */
    setBusy(text) {
      busy = text;
      refresh();
    },
    /** 入场：镜头像是坠入黑洞，节目单淡出，然后销毁黑洞画布 */
    leave(duration) {
      root.style.setProperty('--leave', `${duration}s`);
      root.classList.add('leaving');
      setTimeout(() => {
        root.hidden = true;
        sky.dispose();
      }, duration * 1000);
    },
  };
}
