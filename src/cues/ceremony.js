// 整场演出的仪式节奏（单位：秒）。开演前的仪式约 30 秒（控制条的"跳过开场"可以直接开始第一首）。
// 曲目内部的节奏在 src/cues/<slug>.js；曲目之外的所有时间点都集中在这里，方便整体调速。
//
// 开演前坐在座位上（或开着自动导播）时，镜头像音乐会转播一样跟着仪式切换（镜头定义在 cameraRig.js 的 OPENING）：
//   从后楼座推向舞台 → 台口横移看乐手落座 → 首席（双簧管）近景 → 全团调音 → 楼座大全景看熄灯
//   → 跟拍指挥上台 → 握手中景 → 鞠躬正面中景 → 退回第 8 排开演

export const ceremony = {
  // 1. 入场：乐手从两侧入口鱼贯而入，沿过道走进各排、从里往外依次落座，合唱团一层层走上台阶（走位见 walkPaths.js）
  entrance: {
    programmeExit: 1, // 节目单放下的动画
    walkOn: 10, // 开场后乐手还要走多久。上台的时间表更长：观众入座时乐手已经在陆续上台，开场这一刻只剩最后这段
    walkSpeed: 1.5, // 乐手步行速度（米/秒）
    establish: 5.5, // 镜头：从后楼座滑过池座推向舞台；之后切到台口横移，直到落座、翻开谱子
    settle: 0.8, // 全员落座后翻开谱子
    murmur: 0.8, // 满场低声交谈的音量
    stageLevel: 0.45, // 开演前舞台是工作光
    beams: 0.35, // 开演前的体积光束：淡淡的烟雾感
  },

  // 2. 调音：首席小提琴起立，双簧管给出 A，全团调音
  tuning: {
    standUp: 0.8, // 镜头：首席起立的中近景
    oboeSolo: 1.2, // 双簧管单独给 A 的时长，之后全团加入（乐团里有双簧管时镜头切过去，没有就继续拍首席）
    oboe: 3.2, // 双簧管 A 音总时长
    tutti: 3.1, // 全团调音（镜头：斜拍整个弦乐区）
    sitDown: 0.7,
  },

  // 观众席灯光逐排熄灭，交谈声渐弱（镜头：左侧楼座前沿的大全景）
  houseDown: {
    rowStagger: 0.06, // 相邻两排熄灯的间隔（从后往前）
    rowFade: 1,
    murmurFade: 2.2,
    cardFade: 2, // 巨幕上的标题卡淡出
    stageLevel: 0.8,
    beams: 0.7, // 熄灯后光束更显眼
    conductorAt: 0.6, // 熄灯开始后这么久，指挥出现在左侧入口，掌声响起
  },

  // 3. 指挥上台：鼓掌、与首席握手、走上指挥台、向观众鞠躬、转身
  conductor: {
    applause: 0.6, // 掌声强度 0~1
    applauseDuration: 11,
    walkOn: 7, // 从左侧入口走到首席身边（约 12 米，快步）
    overview: 1.6, // 指挥出场后，楼座大全景再停这么久，然后切到台口导轨跟拍
    handshake: 1.1, // 镜头：握手的中景，跟着他走上指挥台
    toPodium: 1.2,
    turn: 0.6,
    bow: 1.6, // 镜头：台前正面的中景
    toSeat: 1.5, // 镜头退回第 8 排座位（指挥同时转身面向乐团），然后开演
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
    viewerStand: 1.8, // 镜头所在的第 8 排跟着起立的时刻（和这一排观众差不多同时）
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
