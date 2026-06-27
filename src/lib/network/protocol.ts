import type { GameConfig, GameState, PlayerId } from '../game/types';

// ─────────────────────────────────────────────
//  P2P 消息协议
//  所有通过 Trystero DataChannel 传输的消息类型
// ─────────────────────────────────────────────

/** 协议版本号。握手时校验，不匹配则提示刷新页面。 */
export const PROTOCOL_VERSION = 2;

export type RpsChoice = 'rock' | 'paper' | 'scissors';

export type GameMessage =
  // ── 猜拳阶段 ──────────────────────────────────
  /** 阶段一：发送 SHA-256(choice+nonce) 承诺 */
  | { type: 'rps_commit'; commitment: string }
  /** 阶段二：揭示猜拳选择和 nonce */
  | { type: 'rps_reveal'; choice: RpsChoice; nonce: string }

  // ── 游戏准备 ──────────────────────────────────
  /** 房主广播游戏配置，触发游戏开始 */
  | { type: 'game_start'; config: GameConfig; gameId: string }

  // ── 掷骰阶段（每次掷骰） ───────────────────────
  /** 阶段一：掷骰方发送 SHA-256(seed+nonce) 承诺 */
  | { type: 'roll_commit'; commitment: string }
  /** 阶段二：揭示种子，双方用相同 LCG 算法还原骰子值 */
  | { type: 'roll_reveal'; seed: number; nonce: string }

  // ── 回合操作 ──────────────────────────────────
  /** 当前玩家选中骰子后广播（对手实时看到） */
  | { type: 'select_dice'; dieIds: number[]; turnScore: number }
  /**
   * 结算本回合，将 turnScore 计入总分，切换回合。
   * amount/newTotal 为权威值，接收方直接使用，不依赖本地 turnScore。
   */
  | { type: 'bank_score'; amount: number; newTotal: number }
  /**
   * 回合结束（爆点或主动放弃），不加分。
   * 即使是 bust（由 roll_reveal 触发），也发送此消息以确保对方同步。
   */
  | { type: 'end_turn'; reason: 'bust' | 'fold'; finalTurnScore: number }

  // ── 骰子选择阶段 ──────────────────────────────
  /** 自由模式：确认选择的特殊骰子 */
  | { type: 'dice_confirm'; diceIds: string[] }
  /** 轮抓模式：选取一枚骰子 */
  | { type: 'draft_pick'; diceId: string }

  // ── 连接握手 ──────────────────────────────────
  /** 加入方接入后发送，携带自己的显示名和协议版本 */
  | { type: 'player_hello'; name: string; protocolVersion: number }
  /** 房主回应，确认双方身份和协议版本 */
  | { type: 'player_ack'; hostName: string; protocolVersion: number }

  // ── 对局结束操作 ──────────────────────────────
  /** 房主广播：双方均返回主界面，断开本局连接 */
  | { type: 'rematch_lobby' }

  // ── 断线重连 ──────────────────────────────────
  /**
   * 断线方重连后，房主立即发送完整游戏状态快照供其恢复。
   * yourRole: 通知对方它的身份（防止 host/guest 混淆）
   */
  | { type: 'game_state_sync'; state: GameState; yourRole: PlayerId; awaitingRoll: boolean }

  // ── 状态同步请求 ──────────────────────────────
  /** 重连方主动请求完整游戏状态同步 */
  | { type: 'request_state_sync' }

  // ── 心跳与可靠性（由 reliableChannel 内部管理，不对外暴露） ──
