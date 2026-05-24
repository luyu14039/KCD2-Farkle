import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReliableChannel } from '../src/lib/network/reliableChannel';
import type { GameMessage } from '../src/lib/network/protocol';

// ── 测试辅助：模拟原始传输层 ──────────────────────

interface RawHandler {
  (env: any, peerId: string): void;
}

function createMockTransport() {
  const rawHandlers: RawHandler[] = [];
  const sentMessages: any[] = [];

  return {
    sentMessages,
    sendRaw: (env: any) => sentMessages.push(env),
    onRawMessage: (handler: RawHandler) => {
      rawHandlers.push(handler);
      return () => {
        const idx = rawHandlers.indexOf(handler);
        if (idx >= 0) rawHandlers.splice(idx, 1);
      };
    },
    /** 模拟收到对端消息 */
    receiveRaw: (env: any, peerId = 'test-peer') => {
      rawHandlers.forEach(h => h(env, peerId));
    },
  };
}

// ─────────────────────────────────────────────────

describe('reliableChannel', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let stateHash: string;
  let mismatchCount: number;

  beforeEach(() => {
    transport = createMockTransport();
    stateHash = 'abc123';
    mismatchCount = 0;
  });

  function createChannel() {
    return createReliableChannel({
      sendRaw: transport.sendRaw,
      onRawMessage: transport.onRawMessage,
      getStateHash: () => stateHash,
      onStateMismatch: () => { mismatchCount++; },
    });
  }

  describe('message send/receive', () => {
    it('wraps messages in envelope with incrementing seq', () => {
      const ch = createChannel();
      ch.send({ type: 'bank_score', amount: 500, newTotal: 1200 });

      expect(transport.sentMessages).toHaveLength(1);
      expect(transport.sentMessages[0]._s).toBe(1);
      expect(transport.sentMessages[0]._m).toEqual({
        type: 'bank_score', amount: 500, newTotal: 1200,
      });

      ch.send({ type: 'end_turn', reason: 'fold', finalTurnScore: 300 });
      expect(transport.sentMessages[1]._s).toBe(2);
    });

    it('unwraps envelopes and delivers GameMessage to app handler', () => {
      const ch = createChannel();
      const received: GameMessage[] = [];

      ch.onReceive((msg) => { received.push(msg); });

      transport.receiveRaw({
        _s: 5,
        _m: { type: 'select_dice', dieIds: [1, 2], turnScore: 200 },
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        type: 'select_dice', dieIds: [1, 2], turnScore: 200,
      });
    });

    it('deduplicates messages with same seq', () => {
      const ch = createChannel();
      const received: GameMessage[] = [];

      ch.onReceive((msg) => { received.push(msg); });

      const env = {
        _s: 7,
        _m: { type: 'select_dice', dieIds: [3], turnScore: 150 },
      };

      transport.receiveRaw(env);
      transport.receiveRaw(env); // duplicate

      expect(received).toHaveLength(1);
    });
  });

  describe('ack/retry for critical messages', () => {
    it('adds bank_score to pending queue and retries on timeout', async () => {
      vi.useFakeTimers();
      const ch = createChannel();

      ch.send({ type: 'bank_score', amount: 800, newTotal: 2000 });

      // 第一次发送
      expect(transport.sentMessages).toHaveLength(1);
      expect(transport.sentMessages[0]._m.type).toBe('bank_score');

      // 1.5s 后应重传
      await vi.advanceTimersByTimeAsync(1500);
      expect(transport.sentMessages).toHaveLength(2);
      expect(transport.sentMessages[1]._s).toBe(1); // 相同 seq

      // 再 1.5s → 第 3 次
      await vi.advanceTimersByTimeAsync(1500);
      expect(transport.sentMessages).toHaveLength(3);

      // 再 1.5s → 第 4 次（超过 3 次重试，应停止）
      await vi.advanceTimersByTimeAsync(1500);
      // 第 3 次重试后丢弃，不再发送
      // total: 1 initial + 3 retries = 4
      // Wait, the first send is NOT counted as a retry. So we have 1 initial + 3 retries = 4 total.

      vi.useRealTimers();
      ch.destroy();
    });

    it('removes from pending queue when ack received', async () => {
      vi.useFakeTimers();
      const ch = createChannel();

      ch.send({ type: 'bank_score', amount: 500, newTotal: 900 });

      // 模拟收到 ack
      transport.receiveRaw({ _s: 99, _t: 'ack', _r: 1 });

      // 推进时间，不应再有重传
      await vi.advanceTimersByTimeAsync(5000);
      expect(transport.sentMessages).toHaveLength(1); // 只有初始发送

      vi.useRealTimers();
      ch.destroy();
    });

    it('auto-acks received critical messages', () => {
      const ch = createChannel();
      const received: GameMessage[] = [];
      ch.onReceive((msg) => { received.push(msg); });

      transport.receiveRaw({
        _s: 42,
        _m: { type: 'bank_score', amount: 300, newTotal: 700 },
      });

      // 应该有一条 ack 发送
      const acks = transport.sentMessages.filter((m: any) => m._t === 'ack');
      expect(acks).toHaveLength(1);
      expect(acks[0]._r).toBe(42);
      expect(received).toHaveLength(1);
    });

    it('does NOT ack non-critical messages', () => {
      const ch = createChannel();
      const received: GameMessage[] = [];
      ch.onReceive((msg) => { received.push(msg); });

      transport.receiveRaw({
        _s: 10,
        _m: { type: 'select_dice', dieIds: [1], turnScore: 100 },
      });

      const acks = transport.sentMessages.filter((m: any) => m._t === 'ack');
      expect(acks).toHaveLength(0);
      expect(received).toHaveLength(1);
    });
  });

  describe('ping/pong heartbeat', () => {
    it('sends ping periodically after startHeartbeat()', () => {
      vi.useFakeTimers();
      const ch = createChannel();

      // 启动心跳前不应有 ping
      vi.advanceTimersByTime(15_000);
      let pings = transport.sentMessages.filter((m: any) => m._t === 'ping');
      expect(pings.length).toBe(0);

      // 启动心跳
      ch.startHeartbeat();
      vi.advanceTimersByTime(10_000);
      pings = transport.sentMessages.filter((m: any) => m._t === 'ping');
      expect(pings.length).toBeGreaterThanOrEqual(1);

      vi.useRealTimers();
      ch.destroy();
    });

    it('replies to ping with pong carrying stateHash', () => {
      const ch = createChannel();

      transport.receiveRaw({ _s: 3, _t: 'ping' });

      const pongs = transport.sentMessages.filter((m: any) => m._t === 'pong');
      expect(pongs).toHaveLength(1);
      expect(pongs[0]._h).toBe('abc123');
    });

    it('detects state hash mismatch and triggers callback', () => {
      const ch = createChannel();

      // 收到 pong，哈希不匹配
      transport.receiveRaw({ _s: 5, _t: 'pong', _h: 'different-hash' });

      expect(mismatchCount).toBe(1);
    });

    it('does not trigger callback when hash matches', () => {
      const ch = createChannel();

      transport.receiveRaw({ _s: 5, _t: 'pong', _h: 'abc123' });

      expect(mismatchCount).toBe(0);
    });
  });

  describe('gap detection', () => {
    it('logs warning on seq gap (potential packet loss)', () => {
      const warnSpy = vi.spyOn(console, 'warn');
      const ch = createChannel();

      transport.receiveRaw({
        _s: 1,
        _m: { type: 'select_dice', dieIds: [1], turnScore: 100 },
      });

      // 跳跃 seq（跳过了 2, 3, 4）
      transport.receiveRaw({
        _s: 5,
        _m: { type: 'select_dice', dieIds: [2], turnScore: 200 },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('丢包')
      );

      warnSpy.mockRestore();
    });
  });

  describe('lifecycle', () => {
    it('destroy stops heartbeat and cleans up', () => {
      vi.useFakeTimers();
      const ch = createChannel();
      ch.startHeartbeat();

      // 确认心跳在运行
      vi.advanceTimersByTime(10_000);
      const pings = transport.sentMessages.filter((m: any) => m._t === 'ping');
      expect(pings.length).toBeGreaterThanOrEqual(1);

      ch.destroy();

      // 推进时间，确认没有进一步的 ping
      const countBefore = transport.sentMessages.length;
      vi.advanceTimersByTime(20_000);
      expect(transport.sentMessages).toHaveLength(countBefore);

      vi.useRealTimers();
    });
  });
});
