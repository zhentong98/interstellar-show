// 节目单（选歌页）：纸质质感、衬线字体。观众勾选想听的片段（默认全选），按原顺序组成本场曲目。
// "入场"按钮的点击同时用来进入全屏、解锁有声播放。

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function sourceLine(song) {
  const tag = song.official ? '' : ' <em class="unofficial">非官方上传</em>';
  return `片段来源：${escapeHtml(song.channel)}${tag}`;
}

export function renderProgramme(root, songs, { onEnter }) {
  const items = songs.map((song, i) => `
    <li class="song">
      <label>
        <input type="checkbox" value="${escapeHtml(song.slug)}" checked>
        <span class="tick" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 12.5 9.5 18 20 5.5"/></svg>
        </span>
        <span class="numeral">${ROMAN[i] ?? i + 1}</span>
        <span class="song-text">
          <span class="song-title">${escapeHtml(song.title)}</span>
          <span class="song-scene">${escapeHtml(song.scene)}</span>
          <span class="song-source">${sourceLine(song)}</span>
        </span>
      </label>
    </li>`).join('');

  root.innerHTML = `
    <article class="paper programme-card" aria-labelledby="programme-title">
      <header class="programme-head">
        <p class="kicker">电影交响音乐会 · Live to Picture</p>
        <h1 id="programme-title" class="display">Interstellar</h1>
        <p class="subtitle">星 际 穿 越</p>
        <p class="credit">配乐　汉斯·季默　　导演　克里斯托弗·诺兰</p>
      </header>
      <div class="ornament" aria-hidden="true"><span></span>✦<span></span></div>
      <section class="setlist">
        <h2>今晚曲目</h2>
        <p class="section-note">勾选想听的片段，按下列顺序演出</p>
        <ol>${items}</ol>
      </section>
      <section class="ensemble">
        <h2>演出编制</h2>
        <p>管风琴　弦乐四十人　合唱三十人　定音鼓四架　指挥</p>
      </section>
      <footer class="programme-foot">
        <button type="button" class="enter">入场</button>
        <p class="enter-note">入场后进入全屏，演出全程自动进行，无需任何操作。<br>需要时把鼠标移到屏幕底部，可以跳到下一首或结束演出。</p>
        <p class="fineprint">非官方粉丝作品。巨幕片段通过 YouTube 嵌入播放，影片与配乐的版权归原权利人所有；现场的掌声、交谈与调音均为原创合成音效。</p>
      </footer>
    </article>`;

  const button = root.querySelector('.enter');
  const note = root.querySelector('.enter-note');
  const defaultNote = note.innerHTML;
  const boxes = [...root.querySelectorAll('input[type="checkbox"]')];
  const selected = () => songs.filter((s) => boxes.find((b) => b.value === s.slug)?.checked);

  let busy = null;
  const refresh = () => {
    const n = selected().length;
    button.disabled = n === 0 || !!busy;
    note.innerHTML = busy ?? (n === 0 ? '请至少勾选一首。' : defaultNote);
  };
  boxes.forEach((b) => b.addEventListener('change', refresh));
  button.addEventListener('click', () => {
    const setlist = selected();
    if (setlist.length) onEnter(setlist);
  });

  return {
    /** 舞台还没准备好时禁用入场按钮，显示提示；传 null 恢复 */
    setBusy(text) {
      busy = text;
      refresh();
    },
    /** 节目单放下：纸张下沉淡出 */
    leave(duration) {
      root.style.setProperty('--leave', `${duration}s`);
      root.classList.add('leaving');
      setTimeout(() => {
        root.hidden = true;
      }, duration * 1000);
    },
  };
}
