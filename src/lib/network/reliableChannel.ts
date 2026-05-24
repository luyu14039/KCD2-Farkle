import type { GameMessage } from './protocol';

// ─────────────────────────────────────────────
//  可靠传输通道
//
//  在 Trystero DataChannel 之上提供：
//  1. 消息序列号 — 检测丢包
//  2. ping/pong 心跳 — 连接健康 + 状态校验
//  3. 关键消息 ack/重传 — bank_score / end_turn 兜底
//
//  DataChannel 已提供有序可靠传输（ordered: true）。
//  本层不重复实现通用可靠传输，只做兜底和监控。
// ─────────────────────────────────────────────

// ── 内部信封格式（对应用层透明） ─────────────────

interface Envelope {
  _s: number;
  _t?: 'ack' | 'ping' | 'pong';
  _r?: number;       // ack: 确认的 seq
  _h?: string;       // pong: 状态哈希
  _m?: GameMessage;  // 游戏消息体
}

// ── 配置 ────────────────────────────────────────

const CRITICAL_TYPES = new Set(['bank_score', 'end_turn', 'game_state_sync', 'request_state_sync']);
const ACK_TIMEOUT_MS = 3000;
const MAX_RETRIES = 5;
const PING_INTERVAL_MS = 8_000;

// ── 类型 ────────────────────────────────────────

type RawSender = (env: Envelope) => void;
type RawReceiver = (handler: (env: Envelope, peerId: string) => void) => () => void;
type AppHandler = (msg: GameMessage, peerId: string) => void;

interface ChannelConfig {
  sendRaw: RawSender;
  onRawMessage: RawReceiver;
  getStateHash: () => string;
  onStateMismatch: () => void;
}

interface PendingEntry {
  seq: number;
  msg: Envelope;
  retries: number;
  timer: ReturnType<typeof setTimeout>;
}

// ─────────────────────────────────────────────
//  工厂函数
// ─────────────────────────────────────────────

export function createReliableChannel(config: ChannelConfig) {
  const { sendRaw, onRawMessage, getStateHash, onStateMismatch } = config;

  // 状态
  let seqCounter = 0;
  let lastReceivedSeq = 0;
  const receivedSeqs = new Set<number>();      // 去重
  const pending = new Map<number, PendingEntry>(); // 待确认消息
  const appHandlers: AppHandler[] = [];

  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  // ── 发送 ───────────────────────────────────

  function nextSeq(): number {
    return ++seqCounter;
  }

  function send(msg: GameMessage): void {
    if (destroyed) return;

    const seq = nextSeq();
    const env: Envelope = { _s: seq, _m: msg };
    sendRaw(env);

    // 关键消息：加入待确认队列
    if (CRITICAL_TYPES.has(msg.type)) {
      addPending(seq, env);
    }
  }

  function addPending(seq: number, env: Envelope): void {
    const timer = setTimeout(() => retryOrDrop(seq), ACK_TIMEOUT_MS);
    pending.set(seq, { seq, msg: env, retries: 0, timer });
  }

  function retryOrDrop(seq: number): void {
    const entry = pending.get(seq);
    if (!entry) return;

    entry.retries++;
    if (entry.retries > MAX_RETRIES) {
      console.warn(`[Reliable] seq=${seq} 超过最大重试次数，丢弃`);
      pending.delete(seq);
      return;
    }

    console.log(`[Reliable] seq=${seq} 重传 (第${entry.retries}次)`);
    sendRaw(entry.msg);
    entry.timer = setTimeout(() => retryOrDrop(seq), ACK_TIMEOUT_MS);
  }

  function handleAck(refSeq: number): void {
    const entry = pending.get(refSeq);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(refSeq);
    }
  }

  // ── 接收 ───────────────────────────────────

  function handleEnvelope(env: Envelope, peerId: string): void {
    if (destroyed) return;

    const seq = env._s;

    // 1) 内部消息处理
    if (env._t === 'ack') {
      if (env._r !== undefined) handleAck(env._r);
      return;
    }

    if (env._t === 'ping') {
      // 回复 pong，携带本地状态哈希
      sendRaw({ _s: nextSeq(), _t: 'pong', _h: getStateHash() });
      return;
    }

    if (env._t === 'pong') {
      // 校验状态哈希
      const localHash = getStateHash();
      if (env._h && env._h !== localHash) {
        console.warn(`[Reliable] 状态哈希不匹配! 本地=${localHash} 远端=${env._h}`);
        onStateMismatch();
      }
      return;
    }

    // 2) 游戏消息：去重（但关键消息的 ACK 必须在去重之前回复，否则
    //    一次 ACK 丢失会导致发送方所有重传都收不到确认而被误丢弃）
    const isDuplicate = receivedSeqs.has(seq);
    if (!isDuplicate) {
      receivedSeqs.add(seq);

      // 序列号跳跃 → 可能丢包（仅新消息时检测）
      if (lastReceivedSeq > 0 && seq > lastReceivedSeq + 1) {
        console.warn(`[Reliable] 检测到丢包: lastSeq=${lastReceivedSeq} currentSeq=${seq} gap=${seq - lastReceivedSeq - 1}`);
      }
      if (seq > lastReceivedSeq) {
        lastReceivedSeq = seq;
      }

      // 清理旧序列号（防止 Set 无限增长）
      if (receivedSeqs.size > 1000) {
        const toRemove = Array.from(receivedSeqs).filter(s => s < seq - 500);
        toRemove.forEach(s => receivedSeqs.delete(s));
      }
    }

    // 3) 关键消息：自动确认（即使是重传也回复 ACK）
    if (env._m && CRITICAL_TYPES.has(env._m.type)) {
      sendRaw({ _s: nextSeq(), _t: 'ack', _r: seq });
    }

    if (isDuplicate) return;

    // 4) 分发给应用层
    if (env._m) {
      for (const handler of appHandlers) {
        try { handler(env._m, peerId); } catch (err) {
          console.error('[Reliable] handler 异常:', err);
        }
      }
    }
  }

  // ── 心跳 ───────────────────────────────────

  let heartbeatStarted = false;

  /** 启动心跳（应在连接建立后调用） */
  function startHeartbeat(): void {
    if (heartbeatStarted || destroyed) return;
    heartbeatStarted = true;

    pingTimer = setInterval(() => {
      if (destroyed) return;
      sendRaw({ _s: nextSeq(), _t: 'ping' });
    }, PING_INTERVAL_MS);
  }

  function stopPing(): void {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    heartbeatStarted = false;
  }

  // ── 订阅 ───────────────────────────────────

  const unsubRaw = onRawMessage(handleEnvelope);

  function onReceive(handler: AppHandler): () => void {
    appHandlers.push(handler);
    return () => {
      const idx = appHandlers.indexOf(handler);
      if (idx >= 0) appHandlers.splice(idx, 1);
    };
  }

  // ── 生命周期 ───────────────────────────────

  function destroy(): void {
    destroyed = true;
    stopPing();
    unsubRaw();
    // 清理待确认队列
    pending.forEach(entry => clearTimeout(entry.timer));
    pending.clear();
    appHandlers.length = 0;
  }

  return { send, onReceive, startHeartbeat, destroy };
}
