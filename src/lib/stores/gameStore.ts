import { writable, derived, get } from 'svelte/store';
import type {
  GameState, GameConfig, GamePhase, PlayerId, Die, DieFace,
} from '$lib/game/types';
import { DEFAULT_CONFIG } from '$lib/game/types';
import { createDice, rollDice, isBust, isHotDice, resetDiceForHotDice, keepDice, evaluateSelection } from '$lib/game/dice';
import { getSpecialDice } from '$lib/game/diceRegistry';
import { sendMessage, onMessage, leaveRoom } from '$lib/network/trystero';
import { createCommitment, verifyCommitment, generateSeed } from '$lib/network/commitReveal';
import type { GameMessage, RpsChoice } from '$lib/network/protocol';

// ─────────────────────────────────────────────
//  应用级视图状态（非游戏逻辑状态）
// ─────────────────────────────────────────────

export type AppView = 'lobby' | 'rps' | 'dice_selection' | 'game';
export const appView = writable<AppView>('lobby');

// ─────────────────────────────────────────────
//  角色身份
// ─────────────────────────────────────────────

export const myRole = writable<PlayerId>('host');
export const myName = writable('玩家');
export const opponentName = writable('对手');

// ─────────────────────────────────────────────
//  骰子选择阶段状态
// ─────────────────────────────────────────────

export type RpsPurpose = 'game_start' | 'draft_order';
export const rpsPurpose = writable<RpsPurpose>('game_start');

export type DiceSelectionInfo = {
  myPicks: string[];
  opponentPicks: string[];
  myConfirmed: boolean;
  opponentConfirmed: boolean;
  /** 轮抓模式: 当前轮到谁抓 */
  draftTurn: PlayerId | null;
  /** 轮抓模式: 可抓池（特殊骰子ID数组） */
  draftPool: string[];
};

function createInitialSelection(): DiceSelectionInfo {
  return {
    myPicks: [],
    opponentPicks: [],
    myConfirmed: false,
    opponentConfirmed: false,
    draftTurn: null,
    draftPool: [],
  };
}

export const diceSelection = writable<DiceSelectionInfo>(createInitialSelection());

// ─────────────────────────────────────────────
//  游戏状态 Store
// ─────────────────────────────────────────────

function createInitialState(config: GameConfig = DEFAULT_CONFIG): GameState {
  return {
    phase: 'lobby',
    config,
    players: [
      { id: 'host', name: '房主', totalScore: 0, turnScore: 0 },
      { id: 'guest', name: '客人', totalScore: 0, turnScore: 0 },
    ],
    currentPlayerIndex: 0,
    dice: createDice(),
    turnScore: 0,
    rollCount: 0,
    winner: null,
    hostDice: [],
    guestDice: [],
  };
}

/** 获取当前行动玩家的特殊骰子选择列表 */
function getCurrentPlayerDice(state: GameState): string[] {
  return state.currentPlayerIndex === 0 ? state.hostDice : state.guestDice;
}

export const gameState = writable<GameState>(createInitialState());

// ── 派生状态（方便 UI 订阅） ──────────────────────
export const currentPlayer = derived(gameState, $s => $s.players[$s.currentPlayerIndex]);
export const isMyTurn = derived(
  [gameState, myRole],
  ([$s, $role]) => $s.players[$s.currentPlayerIndex].id === $role
);
export const phase = derived(gameState, $s => $s.phase);

// ─────────────────────────────────────────────
//  骰子选中状态（UI 层 — 尚未 keep）
// ─────────────────────────────────────────────

export const selectedDieIds = writable<number[]>([]);

/**
 * 是否需要掷骰才能继续。
 * true  = 必须掷骰（回合开始 / 刚锁定骰子后 / Hot Dice 后）
 * false = 刚掷完骰，必须先选择并锁定骰子
 */
export const awaitingRoll = writable(true);

/** 锁定骰子时的飘字动画触发信号 {value: 加分值, key: 时间戳唯一键} */
export const floatingScore = writable<{ value: number; key: number } | null>(null);

/** 粒子庆祝等级 0=无 1=小(百分以上) 2=中(五百以上) 3=大(千分以上) */
export const celebrationLevel = writable<0 | 1 | 2 | 3>(0);

// ─────────────────────────────────────────────
//  旁白系统 —— 中世纪酒馆居民旁述
// ─────────────────────────────────────────────

const COMMENTARY_LINES: Record<string, string[]> = {
  bust: [
    '哎……骰子翻了脸，从不讲情面的。',
    '爆掉了，下次再来就是，骰子不讲理的。',
    '哦，一把好牌就这样散了。',
    '手头这么热，居然还是翻了——太贪了！',
    '哜呀！全爆！此路不通，下回再试。',
    '哈！这就叫一分贪念，百分皆空！',
    '哎哟，这把输得好惨……',
    '什么运气嘛，骰子完全不听话。',
  ],
  hot_dice: [
    '六枚全拿下！命运之轮还在转！',
    '满盘！莫不是今天骰子开了窍？',
    '哗——全收了！赶紧继续！',
    '不得了！今晚这手气简直通了天！',
    '全拿！全拿！老天都在帮忙啊！',
    '满盘收场！这把骰子今晚活了！',
  ],
  score_500: [
    '这样还要继续骰吗！稳了啊！',
    '够买好几壶好酒了，可还不打算停？',
    '五百了，账已经厚实了不少……',
    '现在收手也很漂亮了，要不要止步？',
  ],
  score_1000: [
    '整个酒馆都安静了，这分数……',
    '一千了！这是要把庄家也赢走的节奏！',
    '好家伙！酒馆掉了一地下巴！',
    '一千分！今晚最大的手笔，就是这位！',
    '我的老天……这位是真正的行家！',
    '一千！我这辈子没见过这么高的分——',
  ],
  bank_1000: [
    '一大笔！账上又多了厚厚一沓！',
    '酒馆里今晚最亮的那颗星，就是这一位！',
    '落袋为安！大气！老手中的老手！',
    '真是好手！我算是开了眼了！',
    '哗！赢了个痛快！',
    '拿了就走，干脆利落！',
  ],
  bank_500: [
    '利落！拿了就走，高手之道。',
    '落袋为安，果然是老手。',
    '懂得收手，也是一种本事。',
  ],
  straight: [
    '一个顺子！酒馆里的人都停了筷子！',
    '六连！这骰子今晚开了窍！',
    '天！顺子！这是什么神仙手气！',
    '顺子！顺子出来了！今晚要横扫全场啊！',
    '完整的顺子！我见过这种的，极少极少！',
  ],
};

// 酒馆背景闲聊 —— 与游戏事件无关的环境人声
const IDLE_LINES: Array<{ text: string; speaker: string }> = [
  { speaker: '老酒鬼',   text: '再来一壶！这杯根本不够润喉的。' },
  { speaker: '旅人',     text: '外头的风雨还没停……我的靴子要烂透了。' },
  { speaker: '小二',     text: '喂，要续杯吗？不续杯就别霸着桌子！' },
  { speaker: '铁匠',     text: '明天还要早起打铁，再喝就坏事了……' },
  { speaker: '游吟诗人', text: '这局，倒值得编进我的曲子里。' },
  { speaker: '酒馆常客', text: '骰子这东西，靠的是命，不是本事。' },
  { speaker: '大肚商人', text: '赢也好输也好，反正我只来看热闹的。' },
  { speaker: '老农',     text: '唉，今年庄稼不如去年……拿酒消愁吧。' },
  { speaker: '路人甲',   text: '这酒馆的炉火不够旺，冻手冻脚的。' },
  { speaker: '神秘人',   text: '……（又灌下一口）' },
  { speaker: '酒馆老板', text: '喝酒喝酒，骰子的事我可管不着。' },
  { speaker: '士兵甲',   text: '昨晚城墙巡逻，冷得要命——今晚要补回来。' },
  { speaker: '老酒鬼',   text: '我年轻那会儿，一晚上能赢三头驴……' },
  { speaker: '旅人',     text: '有人知道今晚几更了吗？' },
  { speaker: '赌徒',     text: '（低声）下一局……下一局肯定赢……' },
  { speaker: '游吟诗人', text: '烛光摇曳，最适合讲故事了。' },
  { speaker: '小二',     text: '上菜了——哦，拿错桌子了，稍等！' },
  { speaker: '酒馆常客', text: '我这把椅子坐了二十年，没什么惊得倒我的。' },
  { speaker: '老酒鬼',   text: '哎，这酒越喝越没意思……再来一壶！' },
  { speaker: '赌徒',     text: '骰子里头有鬼，我一直这么觉得。' },
  { speaker: '路人甲',   text: '听说隔壁桌昨晚赢了一头驴。' },
  { speaker: '神秘人',   text: '（把帽檐压低了一点）' },
  { speaker: '铁匠',     text: '这种天气，铁锤舞起来都不得劲儿……' },
];

const SPEAKERS = ['路人甲', '老酒鬼', '旅人', '小二', '酒馆常客'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const commentary = writable<{
  text: string;
  speaker: string;
  key: number;
  duration?: number;
} | null>(null);

// 旁白序列号，保证每条消息 key 全局唯一
let commentarySeq = 0;

/**
 * 触发事件旁白。
 * count > 1 时模拟"众人同时惊呼"——台词错开 450ms 依次出现，
 * 且每条由不同说话人说出，营造此起彼伏的层次感。
 */
export function triggerCommentary(event: string, count = 1) {
  const lines = COMMENTARY_LINES[event];
  if (!lines || lines.length === 0) return;

  // 打乱台词和说话人，保证同一批次不重复
  const shuffledLines = [...lines].sort(() => Math.random() - 0.5);
  const shuffledSpeakers = [...SPEAKERS].sort(() => Math.random() - 0.5);
  const actual = Math.min(count, shuffledLines.length);
  const STAGGER_MS = [0, 450, 900];

  for (let i = 0; i < actual; i++) {
    const key = ++commentarySeq;
    setTimeout(() => {
      commentary.set({
        text: shuffledLines[i],
        speaker: shuffledSpeakers[i % shuffledSpeakers.length],
        key,
      });
    }, STAGGER_MS[i] ?? i * 450);
  }
}

// ─────────────────────────────────────────────
//  闲聊系统 —— 酒馆背景人声（与游戏事件无关）
// ─────────────────────────────────────────────

let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** 开始酒馆环境旁白（GameBoard mount 时调用） */
export function startIdleCommentary() {
  if (idleTimer !== null) return; // 防止重复启动
  scheduleNextIdle();
}

/** 停止酒馆环境旁白（GameBoard destroy 时调用） */
export function stopIdleCommentary() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleNextIdle() {
  // 每隔 15–35 秒随机触发一句闲聊
  const delay = 15000 + Math.random() * 20000;
  idleTimer = setTimeout(() => {
    const line = pickRandom(IDLE_LINES);
    commentary.set({
      text: line.text,
      speaker: line.speaker,
      key: ++commentarySeq,
      duration: 4000, // 闲聊比事件旁白稍短
    });
    scheduleNextIdle();
  }, delay);
}

export function toggleDieSelection(id: number) {
  selectedDieIds.update(ids =>
    ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
  );
}

export const selectionScore = derived(
  [gameState, selectedDieIds],
  ([$s, $ids]) => {
    if ($ids.length === 0) return { valid: false, score: 0 };
    return evaluateSelection($s.dice, $ids);
  }
);

// ─────────────────────────────────────────────
//  消息状态提示（用于 UI Toast）
// ─────────────────────────────────────────────

export const statusMessage = writable('');

function showStatus(msg: string, durationMs = 2000) {
  statusMessage.set(msg);
  setTimeout(() => statusMessage.set(''), durationMs);
}

// ─────────────────────────────────────────────
//  游戏流程操作
// ─────────────────────────────────────────────

/** 房主发起游戏，广播配置 */
export function startGame(config: GameConfig) {
  const state = createInitialState(config);
  sendMessage({ type: 'game_start', config });

  if (config.specialDiceCount === 0) {
    // 不使用特殊骰子：跳过选骰，直接猜拳决定先后手
    gameState.set(state);
    rpsPurpose.set('game_start');
    appView.set('rps');
  } else if (config.selectionMode === 'draft') {
    // 轮抓模式：先猜拳决定抓取顺序
    state.phase = 'draft_rps';
    gameState.set(state);
    rpsPurpose.set('draft_order');
    appView.set('rps');
  } else {
    // 自由选择模式：进入骰子选择界面
    state.phase = 'dice_selection';
    gameState.set(state);
    diceSelection.set(createInitialSelection());
    appView.set('dice_selection');
  }
}

/** 掷骰（含 commit-reveal 流程） */
let isRollingInProgress = false;
export async function performRoll() {
  if (isRollingInProgress) return;
  const $state = get(gameState);
  if ($state.phase !== 'selecting' && $state.phase !== 'lobby' && $state.phase !== 'hot_dice') return;

  isRollingInProgress = true;
  try {
    const seed = generateSeed();
    const { commitment, nonce } = await createCommitment(seed.toString());

    console.log(`[Farkle] performRoll: seed=${seed}, phase=${get(gameState).phase}, turnScore=${get(gameState).turnScore}`);

    // Phase 1: 发送承诺
    sendMessage({ type: 'roll_commit', commitment });

    // 简化流程：对于 MVP，直接发送揭示（完整实现需等对手确认）
    sendMessage({ type: 'roll_reveal', seed, nonce });

    // 本地掷骰
    executeRoll(seed);
  } finally {
    isRollingInProgress = false;
  }
}

/** 执行掷骰逻辑（本地 + 对手侧共用） */
export function executeRoll(seed: number) {
  const beforeState = get(gameState);
  const keptBefore = beforeState.dice.filter(d => d.kept).length;
  const activeBefore = beforeState.dice.filter(d => d.active && !d.kept).length;
  console.log(`[Farkle] executeRoll: seed=${seed}, 已锁定=${keptBefore}, 待掷=${activeBefore}, phase=${beforeState.phase}`);

  gameState.update($s => {
    const newDice = rollDice($s.dice, seed);
    const bust = isBust(newDice);

    console.log(`[Farkle] executeRoll完成: bust=${bust}, rollCount=${$s.rollCount + 1}`);
    return {
      ...$s,
      dice: newDice,
      phase: bust ? 'bust' : 'rolling',
      rollCount: $s.rollCount + 1,
    };
  });

  selectedDieIds.set([]);
}

/** 动画结束后调用：从 rolling → selecting 或处理 bust */
export function onRollAnimationDone() {
  gameState.update($s => {
    if ($s.phase === 'rolling') {
      return { ...$s, phase: 'selecting' };
    }
    return $s;
  });

  const $s = get(gameState);
  console.log(`[Farkle] onRollAnimationDone: phase=${$s.phase}, turnScore=${$s.turnScore}`);
  if ($s.phase === 'selecting') {
    // 安全防护：二次检查是否为爆点（防止 executeRoll 漏判）
    if (isBust($s.dice)) {
      console.warn('[Farkle] onRollAnimationDone: 二次爆点检测触发！');
      gameState.update(s => ({ ...s, phase: 'bust' as GamePhase }));
      showStatus('爆点！本回合得分清零！', 1500);
      setTimeout(() => triggerCommentary('bust', 2), 200);
      setTimeout(() => endTurn(true), 1500);
    } else {
      // 掷骰完成，现在必须选择骰子
      awaitingRoll.set(false);
    }
  } else if ($s.phase === 'bust') {
    showStatus('爆点！本回合得分清零！', 1500);
    setTimeout(() => triggerCommentary('bust', 2), 200);
    setTimeout(() => endTurn(true), 1500);
  }
}

/** 确认选中的骰子，锁定计分 */
export function confirmSelection() {
  const $ids = get(selectedDieIds);
  const $state = get(gameState);

  if ($ids.length === 0) return;
  if (get(awaitingRoll)) {
    showStatus('请先掷骰子！');
    return;
  }

  const { valid, score } = evaluateSelection($state.dice, $ids);
  if (!valid) {
    showStatus('无效的骰子选择！');
    return;
  }

  // 触发飘字动画
  if (score > 0) floatingScore.set({ value: score, key: Date.now() });

  // 触发旁白：顺子（三人同时惊呼）
  if (score === 1500) {
    setTimeout(() => triggerCommentary('straight', 3), 200);
  }

  const newTurnScoreAfter = $state.turnScore + score;
  console.log(`[Farkle] confirmSelection: ids=${JSON.stringify($ids)}, +${score}, turnScore: ${$state.turnScore} → ${newTurnScoreAfter}`);

  // 广播选择
  sendMessage({ type: 'select_dice', dieIds: $ids, turnScore: newTurnScoreAfter });

  const prevTurnScore = $state.turnScore;

  gameState.update($s => {
    const updated = keepDice($s, $ids);

    // 检测 Hot Dice
    if (isHotDice(updated.dice)) {
      console.log('[Farkle] 本地满盘(Hot Dice)！进入 hot_dice 阶段');
      return { ...updated, phase: 'hot_dice' };
    }

    return { ...updated, phase: 'selecting' };
  });

  selectedDieIds.set([]);
  // 锁定完成后，必须掷骰或结算，不能再选择
  awaitingRoll.set(true);

  // Hot Dice 提示
  const newState = get(gameState);
  if (newState.phase === 'hot_dice') {
    showStatus('满盘！可重新掷全部 6 枚骰子！', 2000);
    setTimeout(() => triggerCommentary('hot_dice', 3), 300);
  } else {
    // 旁白：分数里程碑（只触发一次）
    const newTurn = newState.turnScore;
    if (score !== 1500) {
      if (prevTurnScore < 1000 && newTurn >= 1000) {
        setTimeout(() => triggerCommentary('score_1000', 2), 400);
      } else if (prevTurnScore < 500 && newTurn >= 500) {
        setTimeout(() => triggerCommentary('score_500'), 400);
      }
    }
  }
}

/** Hot Dice 后重取全部骰子 */
export function handleHotDice() {
  const $s = get(gameState);
  console.log(`[Farkle] handleHotDice: turnScore=${$s.turnScore}, 准备重置所有骰子并重投`);
  gameState.update($s => ({
    ...$s,
    dice: resetDiceForHotDice($s.dice),
    phase: 'selecting',
  }));
  awaitingRoll.set(true);
}

// ─────────────────────────────────────────────
//  骰子选择阶段操作
// ─────────────────────────────────────────────

/** 自由模式：确认骰子选择 */
export function confirmDiceSelection(picks: string[]) {
  const $role = get(myRole);

  // 保存到本地游戏状态
  gameState.update($s => ({
    ...$s,
    ...($role === 'host' ? { hostDice: picks } : { guestDice: picks }),
  }));

  diceSelection.update(ds => ({ ...ds, myPicks: picks, myConfirmed: true }));
  sendMessage({ type: 'dice_confirm', diceIds: picks });

  // 检查双方是否都已确认
  const $ds = get(diceSelection);
  if ($ds.opponentConfirmed) {
    transitionToDiceSelectionRps();
  } else {
    showStatus('等待对手选择骰子…');
  }
}

/** 双方都选完 → 进入猜拳决定先后手 */
function transitionToDiceSelectionRps() {
  gameState.update($s => ({ ...$s, phase: 'rps' as GamePhase }));
  rpsPurpose.set('game_start');
  appView.set('rps');
  resetRpsState();
}

/** 轮抓模式：抓取一枚骰子 */
export function makeDraftPick(diceId: string) {
  const $role = get(myRole);
  const $ds = get(diceSelection);

  if ($ds.draftTurn !== $role) return; // 不是你的回合

  sendMessage({ type: 'draft_pick', diceId });
  applyDraftPick(diceId, $role);
}

/** 应用一次轮抓（本地/网络共用） */
function applyDraftPick(diceId: string, picker: PlayerId) {
  const $role = get(myRole);
  const isMine = picker === $role;
  const $state = get(gameState);
  const maxPicks = $state.config.specialDiceCount;

  diceSelection.update(ds => {
    const newPicks = isMine
      ? [...ds.myPicks, diceId]
      : [...ds.opponentPicks, diceId];
    const newPool = ds.draftPool.filter((id, idx) => {
      // 移除第一个匹配的（支持同名骰子多枚）
      if (id === diceId) {
        ds.draftPool[idx] = ''; // 标记
        return false;
      }
      return true;
    });

    const myP = isMine ? newPicks : ds.myPicks;
    const opP = isMine ? ds.opponentPicks : newPicks;

    // 确定下一个抓取者
    const allDone = myP.length >= maxPicks && opP.length >= maxPicks;
    const nextTurn: PlayerId | null = allDone
      ? null
      : picker === 'host' ? 'guest' : 'host';

    return {
      ...ds,
      myPicks: myP,
      opponentPicks: opP,
      draftPool: newPool,
      draftTurn: nextTurn,
    };
  });

  // 保存到游戏状态
  const $ds = get(diceSelection);
  gameState.update($s => ({
    ...$s,
    ...($role === 'host'
      ? { hostDice: $ds.myPicks, guestDice: $ds.opponentPicks }
      : { hostDice: $ds.opponentPicks, guestDice: $ds.myPicks }),
  }));

  // 检查是否全部选完
  if ($ds.myPicks.length >= maxPicks && $ds.opponentPicks.length >= maxPicks) {
    showStatus('骰子选择完毕！');
    setTimeout(() => transitionToDiceSelectionRps(), 1000);
  }
}

/** 轮抓开始：初始化抓取池和顺序 */
function startDraft(firstPicker: PlayerId) {
  const pool = getSpecialDice().map(d => d.id);
  diceSelection.set({
    ...createInitialSelection(),
    draftTurn: firstPicker,
    draftPool: pool,
  });
  gameState.update($s => ({ ...$s, phase: 'dice_selection' as GamePhase }));
  appView.set('dice_selection');
}

/** 重置猜拳状态以复用 */
function resetRpsState() {
  rpsState.set({ step: 'choosing' });
  myRpsCommitment = null;
  theirRpsCommitment = null;
}

/** 结算（Bank）：将回合分加入总分，切换回合 */
export function bankScore() {
  const $initial = get(gameState);
  const bankedAmount = $initial.turnScore;

  console.log(`[Farkle] bankScore: 玩家${$initial.players[$initial.currentPlayerIndex].id} 结算 ${bankedAmount}分`);
  sendMessage({ type: 'bank_score' });

  gameState.update($s => {
    const player = $s.players[$s.currentPlayerIndex];
    const newTotal = player.totalScore + $s.turnScore;

    const newPlayers = [...$s.players] as [typeof $s.players[0], typeof $s.players[1]];
    newPlayers[$s.currentPlayerIndex] = {
      ...player,
      totalScore: newTotal,
      turnScore: 0,
    };

    // 检测胜利
    if (newTotal >= $s.config.targetScore) {
      return {
        ...$s,
        players: newPlayers,
        phase: 'game_over' as GamePhase,
        winner: player.id,
        turnScore: 0,
      };
    }

    // 切换回合
    const nextIndex = ($s.currentPlayerIndex === 0 ? 1 : 0) as 0 | 1;
    const nextPlayerDice = nextIndex === 0 ? $s.hostDice : $s.guestDice;
    return {
      ...$s,
      players: newPlayers,
      currentPlayerIndex: nextIndex,
      dice: createDice(nextPlayerDice),
      turnScore: 0,
      rollCount: 0,
      phase: 'selecting' as GamePhase,
    };
  });

  selectedDieIds.set([]);
  awaitingRoll.set(true);

  const $s = get(gameState);
  if ($s.phase === 'game_over') {
    showStatus(`${$s.winner === 'host' ? '房主' : '客人'} 获胜！`, 5000);
    // 勝利必然是大展示
    setTimeout(() => celebrationLevel.set(3), 300);
  } else {
    // 结算旁白
    if (bankedAmount >= 1000) {
      setTimeout(() => triggerCommentary('bank_1000', 2), 300);
      setTimeout(() => celebrationLevel.set(3), 150);
    } else if (bankedAmount >= 500) {
      setTimeout(() => triggerCommentary('bank_500'), 300);
      setTimeout(() => celebrationLevel.set(2), 150);
    } else if (bankedAmount >= 100) {
      setTimeout(() => celebrationLevel.set(1), 150);
    }
  }
}

/** 结束回合（爆点或放弃），不加分 */
export function endTurn(isBustTurn = false) {
  const $s = get(gameState);
  console.log(`[Farkle] endTurn: isBust=${isBustTurn}, 当前玩家=${$s.players[$s.currentPlayerIndex].id}, phase=${$s.phase}`);
  if (!isBustTurn) {
    sendMessage({ type: 'end_turn' });
  }

  gameState.update($s => {
    const nextIndex = ($s.currentPlayerIndex === 0 ? 1 : 0) as 0 | 1;
    const nextPlayerDice = nextIndex === 0 ? $s.hostDice : $s.guestDice;
    return {
      ...$s,
      currentPlayerIndex: nextIndex,
      dice: createDice(nextPlayerDice),
      turnScore: 0,
      rollCount: 0,
      phase: 'selecting' as GamePhase,
    };
  });

  selectedDieIds.set([]);
  awaitingRoll.set(true);
}

// ─────────────────────────────────────────────
//  对局结束 / 重玩
// ─────────────────────────────────────────────

/**
 * 内部：将所有状态重置并返回大厅。
 * 被 rematchLobby()（主动）和 rematch_lobby 消息处理（被动）共用。
 */
function _resetToLobby() {
  stopIdleCommentary();
  leaveRoom();
  gameState.set(createInitialState());
  diceSelection.set(createInitialSelection());
  selectedDieIds.set([]);
  awaitingRoll.set(true);
  celebrationLevel.set(0);
  rpsState.set({ step: 'choosing' });
  myRpsCommitment = null;
  theirRpsCommitment = null;
  isRollingInProgress = false;
  appView.set('lobby');
}

/**
 * 房主调用：广播返回大厅指令，双方同步重置。
 * 客人端收到 rematch_lobby 消息后会自动调用 _resetToLobby()。
 */
export function rematchLobby() {
  sendMessage({ type: 'rematch_lobby' });
  // 延迟 150ms 确保消息在断开连接前已发出
  setTimeout(() => _resetToLobby(), 150);
}

// ─────────────────────────────────────────────
//  猜拳状态
// ─────────────────────────────────────────────

export type RpsState =
  | { step: 'choosing' }
  | { step: 'waiting'; myChoice: RpsChoice }
  | { step: 'result'; myChoice: RpsChoice; theirChoice: RpsChoice; winner: 'me' | 'them' | 'draw' };

export const rpsState = writable<RpsState>({ step: 'choosing' });

let myRpsCommitment: { commitment: string; nonce: string } | null = null;
let theirRpsCommitment: string | null = null;

export async function submitRpsChoice(choice: RpsChoice) {
  const { commitment, nonce } = await createCommitment(choice);
  myRpsCommitment = { commitment, nonce };

  sendMessage({ type: 'rps_commit', commitment });
  rpsState.set({ step: 'waiting', myChoice: choice });

  // 如果对手已经发过承诺，双方互相揭示
  if (theirRpsCommitment) {
    sendMessage({ type: 'rps_reveal', choice, nonce });
  }
}

function resolveRps(mine: RpsChoice, theirs: RpsChoice): 'me' | 'them' | 'draw' {
  if (mine === theirs) return 'draw';
  if (
    (mine === 'rock' && theirs === 'scissors') ||
    (mine === 'scissors' && theirs === 'paper') ||
    (mine === 'paper' && theirs === 'rock')
  ) return 'me';
  return 'them';
}

// ─────────────────────────────────────────────
//  网络消息处理器
// ─────────────────────────────────────────────

export function initMessageHandler(): () => void {
  return onMessage((msg: GameMessage, _peerId: string) => {
    switch (msg.type) {
      // ── 握手 ──
      case 'player_hello':
        opponentName.set(msg.name);
        const $myName = get(myName);
        sendMessage({ type: 'player_ack', hostName: $myName });
        break;

      case 'player_ack':
        opponentName.set(msg.hostName);
        break;

      // ── 游戏开始 ──
      case 'game_start': {
        const state = createInitialState(msg.config);
        if (msg.config.specialDiceCount === 0) {
          // 不使用特殊骰子：跳过选骰，直接猜拳
          gameState.set(state);
          rpsPurpose.set('game_start');
          appView.set('rps');
        } else if (msg.config.selectionMode === 'draft') {
          state.phase = 'draft_rps';
          gameState.set(state);
          rpsPurpose.set('draft_order');
          appView.set('rps');
        } else {
          state.phase = 'dice_selection';
          gameState.set(state);
          diceSelection.set(createInitialSelection());
          appView.set('dice_selection');
        }
        break;
      }

      // ── 猜拳 ──
      case 'rps_commit':
        theirRpsCommitment = msg.commitment;
        // 如果我已经选择了，立即揭示
        if (myRpsCommitment) {
          const $rps = get(rpsState);
          if ($rps.step === 'waiting') {
            sendMessage({ type: 'rps_reveal', choice: $rps.myChoice, nonce: myRpsCommitment.nonce });
          }
        }
        break;

      case 'rps_reveal': {
        const $rps = get(rpsState);
        if ($rps.step !== 'waiting') break;

        // 验证承诺
        if (theirRpsCommitment) {
          verifyCommitment(theirRpsCommitment, msg.choice, msg.nonce).then(valid => {
            if (!valid) {
              showStatus('对手猜拳验证失败！可能作弊！', 3000);
              return;
            }

            const winner = resolveRps($rps.myChoice, msg.choice);
            rpsState.set({ step: 'result', myChoice: $rps.myChoice, theirChoice: msg.choice, winner });

            // 根据结果决定先手/抓取顺序
            setTimeout(() => {
              if (winner === 'draw') {
                resetRpsState();
                showStatus('平局！再来一次！', 1500);
              } else {
                const purpose = get(rpsPurpose);
                if (purpose === 'draft_order') {
                  // 轮抓猜拳结束 → 进入轮抓
                  const firstPicker: PlayerId = winner === 'me' ? get(myRole) : (get(myRole) === 'host' ? 'guest' : 'host');
                  resetRpsState();
                  startDraft(firstPicker);
                } else {
                  // 正常猜拳 → 进入游戏
                  const firstIndex = (winner === 'me'
                    ? (get(myRole) === 'host' ? 0 : 1)
                    : (get(myRole) === 'host' ? 1 : 0)) as 0 | 1;
                  gameState.update($s => {
                    const firstPlayerDice = firstIndex === 0 ? $s.hostDice : $s.guestDice;
                    return {
                      ...$s,
                      phase: 'selecting',
                      currentPlayerIndex: firstIndex,
                      dice: createDice(firstPlayerDice),
                    };
                  });
                  appView.set('game');
                  resetRpsState();
                }
              }
            }, 2000);
          });
        }
        break;
      }

      // ── 掷骰 ──
      case 'roll_commit':
        // MVP: 收到承诺后即等待 reveal
        break;

      case 'roll_reveal': {
        const $preRoll = get(gameState);
        console.log(`[Farkle P2P] roll_reveal 收到: seed=${msg.seed}, 当前phase=${$preRoll.phase}, 已锁定=${$preRoll.dice.filter(d => d.kept).length}枚`);
        executeRoll(msg.seed);
        break;
      }

      // ── 回合操作 ──
      case 'select_dice': {
        // 对手锁定骰子 — 更新本地状态，并用发送方的 turnScore 强同步积分
        const $preSel = get(gameState);
        console.log(`[Farkle P2P] select_dice 收到: dieIds=${JSON.stringify(msg.dieIds)}, 权威turnScore=${msg.turnScore}, 本地turnScore=${$preSel.turnScore}`);

        gameState.update($s => {
          const updated = keepDice($s, msg.dieIds);
          // 用发送方的 turnScore 作为权威值，防止双端计算偏差
          const synced = { ...updated, turnScore: msg.turnScore };

          // ─── 满盘(Hot Dice)修复 ─────────────────────────────────
          // 对手将全部 6 枚骰子锁定后，本地骰子也必须重置为未锁定状态。
          // 若不重置，下一条 roll_reveal 会在「已全部 kept」的骰子上调用
          // rollDice()，导致无骰子可掷、isBust([]) 误判为爆点，引发
          // 回合顺序错乱与双端积分不同步。
          if (isHotDice(updated.dice)) {
            console.log('[Farkle P2P] 检测到对手满盘(Hot Dice)！重置骰子，等待对手重投');
            return { ...synced, dice: resetDiceForHotDice(updated.dice), phase: 'hot_dice' as GamePhase };
          }

          return synced;
        });
        break;
      }

      case 'bank_score':
        // 对手结算
        gameState.update($s => {
          const player = $s.players[$s.currentPlayerIndex];
          const newTotal = player.totalScore + $s.turnScore;
          const newPlayers = [...$s.players] as [typeof $s.players[0], typeof $s.players[1]];
          newPlayers[$s.currentPlayerIndex] = { ...player, totalScore: newTotal, turnScore: 0 };

          if (newTotal >= $s.config.targetScore) {
            return { ...$s, players: newPlayers, phase: 'game_over' as GamePhase, winner: player.id, turnScore: 0 };
          }

          const nextIndex = ($s.currentPlayerIndex === 0 ? 1 : 0) as 0 | 1;
          const nextPlayerDice = nextIndex === 0 ? $s.hostDice : $s.guestDice;
          return { ...$s, players: newPlayers, currentPlayerIndex: nextIndex, dice: createDice(nextPlayerDice), turnScore: 0, rollCount: 0, phase: 'selecting' as GamePhase };
        });
        selectedDieIds.set([]);
        awaitingRoll.set(true);
        break;

      case 'end_turn':
        gameState.update($s => {
          const nextIndex = ($s.currentPlayerIndex === 0 ? 1 : 0) as 0 | 1;
          const nextPlayerDice = nextIndex === 0 ? $s.hostDice : $s.guestDice;
          return { ...$s, currentPlayerIndex: nextIndex, dice: createDice(nextPlayerDice), turnScore: 0, rollCount: 0, phase: 'selecting' as GamePhase };
        });
        selectedDieIds.set([]);
        awaitingRoll.set(true);
        break;

      // ── 骰子选择 ──
      case 'dice_confirm': {
        // 对手确认了自由模式选择
        const opRole: PlayerId = get(myRole) === 'host' ? 'guest' : 'host';
        gameState.update($s => ({
          ...$s,
          ...(opRole === 'host' ? { hostDice: msg.diceIds } : { guestDice: msg.diceIds }),
        }));
        diceSelection.update(ds => ({ ...ds, opponentPicks: msg.diceIds, opponentConfirmed: true }));
        const $dsSel = get(diceSelection);
        if ($dsSel.myConfirmed) {
          transitionToDiceSelectionRps();
        } else {
          showStatus('对手已选好骰子，请尽快选择！');
        }
        break;
      }

      case 'draft_pick': {
        // 对手在轮抓中选了一枚骰子
        const opponentRole: PlayerId = get(myRole) === 'host' ? 'guest' : 'host';
        applyDraftPick(msg.diceId, opponentRole);
        break;
      }

      case 'rematch_lobby':
        // 房主已广播返回大厅，客人端同步重置
        _resetToLobby();
        break;
    }
  });
}
