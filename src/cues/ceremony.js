// 整场演出的仪式节奏（单位：秒）。开演前的仪式约 30 秒（控制条的"跳过开场"可以直接开始第一首）。
// 曲目内部的节奏在 src/cues/<slug>.js；曲目之外的所有时间点都集中在这里，方便整体调速。

export const ceremony = {
  // 1. 入场：镜头从大厅后方滑到第 8 排，乐手陆续上台落座
  entrance: {
    programmeExit: 1, // 节目单放下的动画
    cameraGlide: 7.5, // 镜头滑到座位
    walkOnSpread: 4.5, // 乐手陆续出场的时间跨度（第一个到最后一个开始走）
    walkSpeed: 1.55, // 乐手步行速度（米/秒）
    settle: 1.2, // 全员落座后翻开谱子
    murmur: 0.8, // 满场低声交谈的音量
    stageLevel: 0.45, // 开演前舞台是工作光
    beams: 0.35, // 开演前的体积光束：淡淡的烟雾感
  },

  // 2. 调音：首席小提琴起立，双簧管给出 A，全团调音
  tuning: {
    standUp: 0.9,
    oboeSolo: 1.2, // 双簧管单独给 A 的时长，之后全团加入
    oboe: 3.2, // 双簧管 A 音总时长
    tutti: 3.6, // 全团调音
    sitDown: 1.1,
  },

  // 观众席灯光逐排熄灭，交谈声渐弱
  houseDown: {
    rowStagger: 0.08, // 相邻两排熄灯的间隔（从后往前）
    rowFade: 1,
    murmurFade: 2.5,
    cardFade: 2, // 巨幕上的标题卡淡出
    stageLevel: 0.8,
    beams: 0.7, // 熄灯后光束更显眼
    hold: 0.6,
  },

  // 3. 指挥上台：鼓掌、与首席握手、鞠躬、转身
  conductor: {
    applause: 0.6, // 掌声强度 0~1
    applauseDuration: 7.5,
    walkOn: 3.6,
    handshake: 1.2,
    toPodium: 1.2,
    turn: 0.8,
    bow: 1.7,
  },

  // 每一首：举棒、静止、开演、结束前切走
  song: {
    screenToBlack: 1.4, // 黑洞过渡淡出为黑幕
    stageLevel: 1,
    beams: 1,
    preloadTimeout: 14, // 最多等下一段缓冲这么久
    stillness: 1.5, // 指挥举棒后全场静止
    revealFade: 0.8, // 画面真正开始走时幕布拉开
    cutBeforeEnd: 0.5, // 片段结束前 0.5 秒切走，不让 YouTube 的相关视频露出来
    cutFade: 0.35,
    coverFade: 0.4, // 播放异常时幕布盖住
    stuckPrompt: 25, // 片段卡住（多半是插播广告）超过这么久，拉开幕布让观众自己处理，或点空白处跳过
    holdAfterEnd: 0.9, // 指挥收住后停顿一拍
    lowerBaton: 1.2,
    unavailableHold: 4, // 片段无法播放时，字幕牌提示停留
  },

  // 4. 曲间换场（总长约 15~25 秒）
  intermission: {
    total: 19,
    applauseMin: 0.45, // 掌声强度 = applauseMin + (1 - applauseMin) × 上一首峰值
    applauseBase: 4.5, // 掌声时长 = base + extra × 峰值
    applauseExtra: 5,
    acknowledgeAbove: 0.8, // 上一首峰值超过这个值，指挥转身致意
    stageLevel: 0.4, // 灯光转暗
    beams: 0.9, // 舞台灯转暗，但光束和音管墙依然亮着，配合黑洞
    gargantuaAt: 1.5,
    gargantuaFade: 2.5,
    drone: 0.5, // 黑洞过渡时的低频氛围
    captionAt: 3,
    cameraAt: 2.5,
    cameraDuration: 13,
    murmur: 0.35, // 掌声后观众低声交流
    coughs: [2, 3], // 零星咳嗽次数范围
    pageTurns: 6,
  },

  // 5. 终场谢幕
  finale: {
    silence: 3.5, // 指挥双手停在空中的寂静
    applauseDuration: 34,
    lower: 1.4,
    audienceStagger: 3.5, // 前排观众陆续起立的时间跨度
    stageLevel: 1.1,
    beams: 1.3, // 谢幕：全场光束最亮
    turn: 0.9,
    bow: 2.4,
    sectionGap: 2, // 示意各声部起立的间隔
    exitWalk: 4,
    offstage: 2.2,
    returnWalk: 3.6,
    cameraDuration: 22,
    houseUp: 5,
    applauseFade: 5,
    backPageDelay: 2.5,
  },
};
