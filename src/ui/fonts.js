// Canvas 上绘制文字前要确保网页字体已经加载，否则会先画成系统默认字体

export const SERIF_LATIN = '"Cormorant Garamond", "EB Garamond", Georgia, serif';
export const SERIF_CJK = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", serif';
export const SERIF = `${SERIF_LATIN.replace(', serif', '')}, ${SERIF_CJK}`;

let loading = null;

/** 等待节目单和 Canvas 用到的字体（最多等 4 秒，失败就用后备字体） */
export function fontsReady() {
  if (loading) return loading;
  const wanted = [
    '600 80px "Cormorant Garamond"',
    'italic 500 60px "Cormorant Garamond"',
    '400 48px "Noto Serif SC"',
    '600 48px "Noto Serif SC"',
  ];
  const all = Promise.all(wanted.map((f) => document.fonts?.load(f, 'Interstellar 星际穿越').catch(() => null)));
  loading = Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
  return loading;
}

/** 字距加宽的文字（Canvas 2D 的 letterSpacing 兼容性不够好，手动排） */
export function drawSpaced(ctx, text, x, y, spacing) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = ctx.textAlign === 'center' ? x - total / 2 : x;
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.textAlign = align;
}
