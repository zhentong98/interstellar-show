// 曲目 slug → cue 表

import cornfieldChase from './cornfield-chase.js';
import wormhole from './wormhole.js';
import mountains from './mountains.js';
import noTimeForCaution from './no-time-for-caution.js';
import stay from './stay.js';

const cues = {
  'cornfield-chase': cornfieldChase,
  wormhole,
  mountains,
  'no-time-for-caution': noTimeForCaution,
  stay,
};

/** 取某首曲目的 cue 表；没有的话给一个平稳的默认值，演出照样能跑 */
export function cuesFor(slug) {
  return cues[slug] ?? [{ t: 0, name: '默认', intensity: 0.5, bpm: 70 }];
}
