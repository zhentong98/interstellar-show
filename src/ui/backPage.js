// 节目单背面：散场后显示本场曲目、片段来源和素材致谢（读取仓库里的 CREDITS.md）

import creditsMarkdown from '../../CREDITS.md?raw';
import { sourceLine } from './programme.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 取 CREDITS.md 里第一张表格的数据行 */
function parseCredits(md) {
  const rows = md.split('\n').filter((l) => l.trim().startsWith('|'));
  return rows.slice(2).map((line) => line.split('|').slice(1, -1).map((c) => c.trim()));
}

export function renderBackPage(root, setlist, results) {
  const items = setlist.map((song, i) => {
    const r = results[i];
    const status = r.error ? `未能播放（${escapeHtml(r.error)}）` : r.played ? '' : '已跳过';
    return `
      <li>
        <span class="numeral">${ROMAN[i] ?? i + 1}</span>
        <span class="song-text">
          <span class="song-title">${escapeHtml(song.title)}${status ? `<em class="status">${status}</em>` : ''}</span>
          <span class="song-scene">${escapeHtml(song.scene)}</span>
          <span class="song-source">${sourceLine(song)} ·
            <a href="https://www.youtube.com/watch?v=${encodeURIComponent(song.youtubeId)}" target="_blank" rel="noopener">在 YouTube 观看</a>
          </span>
        </span>
      </li>`;
  }).join('');

  // CREDITS.md 的列：素材 | 作者 | 许可证 | 用途 | 来源；素材名链接到来源
  const header = ['素材', '作者', '许可证', '用途'];
  const creditRows = parseCredits(creditsMarkdown).map(([name, author, license, use, source = '']) => {
    const url = source.match(/\((https?:[^)]+)\)/)?.[1];
    const title = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>` : escapeHtml(name);
    return `<tr><td>${title}</td><td>${escapeHtml(author)}</td><td>${escapeHtml(license)}</td><td>${escapeHtml(use)}</td></tr>`;
  }).join('');

  root.innerHTML = `
    <article class="paper backpage-card">
      <p class="kicker">节目单 · 背面</p>
      <h2>本场曲目</h2>
      <ol class="played">${items}</ol>
      <h2>致谢</h2>
      <table class="credits">
        <thead><tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${creditRows}</tbody>
      </table>
      <p class="fineprint">巨幕片段来自 YouTube 嵌入播放，影片与配乐的版权归原权利人所有。现场的掌声、交谈、咳嗽与调音都是 Web Audio 原创合成，没有使用任何原声录音。</p>
      <button type="button" class="again">再看一场</button>
    </article>`;
  root.querySelector('.again').addEventListener('click', () => window.location.reload());
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('visible'));
}
