// ─────────────────────────────────────────────
//  骰子
// ─────────────────────────────────────────────

/** 骰子面值：1-6 为普通点数，0 代表恶魔之首（百搭） */
export type DieFace = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 骰子类型 — 对应 diceRegistry 中的骰子定义 ID。
 * 例如 'NormalDie'、'DevilDie'、'ArankaDie' 等。
 */
export type DieType = string;

/** 单枚骰子状态 */
export interface Die {
  id: number;          // 唯一标识，0-5
  value: DieFace;      // 当前面值
  /** 骰子定义 ID（对应 diceRegistry 中的键名） */
  type: DieType;
  /** 已被玩家选中放在一旁（本回合锁定计分） */
  kept: boolean;
  /** 是否参与本次掷骰（Hot Dice 后全部重置为 true） */
  active: boolean;
}

// ─────────────────────────────────────────────
//  徽章（接口预留）
// ─────────────────────────────────────────────

export type BadgeId =
  | 'fortune'  // 好运徽章：每局允许重掷最多 2 枚骰子
  | 'might';   // 力量徽章：允许增加 1 枚额外骰子

export interface Badge {
  id: BadgeId;
  name: string;
  description: string;
  /** 徽章效果处理器，在规则层调用 */
  apply: (state: GameState) => GameState;
}

// ─────────────────────────────────────────────
//  游戏配置
// ─────────────────────────────────────────────

/** 选骰模式 */
export type SelectionMode = 'free' | 'draft';

export interface GameConfig {
  /** 胜利所需分数，默认 4000 */
  targetScore: number;
  /** 是否启用徽章系统 */
  badgesEnabled: boolean;
  /** 特殊骰子数量（0-3），0 = 不使用特殊骰子，直接全用普通骰子 */
  specialDiceCount: 0 | 1 | 2 | 3;
  /** 选骰模式：free=自由选择 draft=轮流抓取（specialDiceCount > 0 时有效） */
  selectionMode: SelectionMode;
  /** 启用的徽章列表 */
  activeBadges: BadgeId[];
}

export const DEFAULT_CONFIG: GameConfig = {
  targetScore: 4000,
  badgesEnabled: false,
  specialDiceCount: 2,
  selectionMode: 'free',
  activeBadges: [],
};

// ─────────────────────────────────────────────
//  玩家
// ─────────────────────────────────────────────

export type PlayerId = 'host' | 'guest';

export interface Player {
  id: PlayerId;
  name: string;
  totalScore: number;
  /** 本回合暂存分（尚未 bank） */
  turnScore: number;
}

// ─────────────────────────────────────────────
//  游戏阶段
// ─────────────────────────────────────────────

export type GamePhase =
  | 'lobby'           // 大厅：等待玩家加入
  | 'dice_selection'  // 骰子选择：双方选取特殊骰子
  | 'draft_rps'       // 轮抓猜拳：决定抓取顺序
  | 'rps'             // 猜拳：决定先手
  | 'rolling'         // 掷骰中（等待动画）
  | 'selecting'       // 玩家选择骰子
  | 'bust'            // 爆点动画
  | 'hot_dice'        // 满盘动画
  | 'turn_end'        // 回合结算
  | 'game_over';      // 游戏结束

// ─────────────────────────────────────────────
//  完整游戏状态
// ─────────────────────────────────────────────

export interface GameState {
  /** Unique id for one match, shared by both peers. Used to reject stale sync snapshots. */
  gameId: string;
  /** Monotonic version for authoritative state snapshots. */
  stateVersion: number;
  phase: GamePhase;
  config: GameConfig;
  players: [Player, Player];
  /** 当前行动玩家的 index (0 or 1) */
  currentPlayerIndex: 0 | 1;
  dice: Die[];
  /** 本回合累积分（含已 kept 骰子分值） */
  turnScore: number;
  /** 当前回合第几次掷骰（从 1 开始） */
  rollCount: number;
  /** 胜者（游戏结束后设置） */
  winner: PlayerId | null;
  /** 房主选择的骰子定义 ID 列表（特殊骰子） */
  hostDice: string[];
  /** 客人选择的骰子定义 ID 列表（特殊骰子） */
  guestDice: string[];
}
