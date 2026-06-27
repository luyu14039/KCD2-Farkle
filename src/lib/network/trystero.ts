import { joinRoom } from '@trystero-p2p/mqtt';
import { writable } from 'svelte/store';
import type { GameMessage } from './protocol';
import type { PlayerId } from '../game/types';

// ─────────────────────────────────────────────
//  配置
// ─────────────────────────────────────────────

const APP_ID = 'kcd2-farkle-v2';

/**
 * MQTT broker 列表（按国内网络可达性排序）。
 * Trystero 连接第一个可达的 broker，其余作为备选。
 */
const RELAY_URLS = [
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const ROOM_ROLE_KEY_PREFIX = 'kcd2-farkle-room-role:';

export function rememberRoomRole(roomCode: string, role: PlayerId): void {
  try {
    localStorage.setItem(`${ROOM_ROLE_KEY_PREFIX}${roomCode.toUpperCase()}`, role);
  } catch {
    // localStorage may be unavailable in private or restricted contexts.
  }
}

export function getRememberedRoomRole(roomCode: string): PlayerId | null {
  try {
    const value = localStorage.getItem(`${ROOM_ROLE_KEY_PREFIX}${roomCode.toUpperCase()}`);
    return value === 'host' || value === 'guest' ? value : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────

export type ConnectionStatus =
  | 'idle'
  | 'signaling'
  | 'waiting_peer'
  | 'connected'
  | 'disconnected'
  | 'timeout';

export interface NetworkState {
  status: ConnectionStatus;
  roomCode: string | null;
  peerId: string | null;
  waitingSince: number | null;
}

type MessageHandler = (msg: GameMessage, peerId: string) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawHandler = (data: any, peerId: string) => void;

// ─────────────────────────────────────────────
//  响应式状态
// ─────────────────────────────────────────────

export const networkState = writable<NetworkState>({
  status: 'idle',
  roomCode: null,
  peerId: null,
  waitingSince: null,
});

// ─────────────────────────────────────────────
//  内部变量（模块级单例）
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let room: ReturnType<typeof joinRoom> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sendFn: ((data: any) => void) | null = null;
let messageHandlers: MessageHandler[] = [];
let rawHandlers: RawHandler[] = [];

const SIGNALING_PHASE_MS = 3000;
const NO_PEER_RETRY_MS = 15_000;
const MAX_RETRIES = 3;
const CONNECTION_TIMEOUT_MS = 60_000;
const PEER_HEALTH_CHECK_MS = 5000;

let signalingTimer: ReturnType<typeof setTimeout> | null = null;
let noPeerTimer: ReturnType<typeof setTimeout> | null = null;
let connectionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let peerCheckInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

let currentRoomCode: string | null = null;
let connecting = false;
let reconnecting = false;

/** 防止 onPeerJoin 中重复调用 makeAction 注册 receive handler */
let gameActionSetup = false;

/**
 * 是否由此端主动发起重连。
 * Host 端应设为 false（原地等待 Guest 重连），Guest 端应设为 true。
 * 避免双方同时重连造成的竞争条件。
 */
let autoReconnectEnabled = true;
export function setAutoReconnect(enabled: boolean) {
  autoReconnectEnabled = enabled;
  console.log(`[Network] 自动重连: ${enabled ? '启用 (Guest 模式)' : '禁用 (Host 模式)'}`);
}

// ─────────────────────────────────────────────
//  内部工具
// ─────────────────────────────────────────────

function clearAllTimers() {
  if (signalingTimer !== null) { clearTimeout(signalingTimer); signalingTimer = null; }
  if (noPeerTimer !== null) { clearTimeout(noPeerTimer); noPeerTimer = null; }
  if (connectionTimeoutTimer !== null) { clearTimeout(connectionTimeoutTimer); connectionTimeoutTimer = null; }
  if (peerCheckInterval !== null) { clearInterval(peerCheckInterval); peerCheckInterval = null; }
  if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function cleanupRoom() {
  if (room) {
    try { room.leave(); } catch { /* ignore */ }
    room = null;
  }
  gameActionSetup = false;
}

function stopPeerHealthCheck() {
  if (peerCheckInterval !== null) {
    clearInterval(peerCheckInterval);
    peerCheckInterval = null;
  }
}

/**
 * 监控 WebRTC 底层连接状态。
 * 通过 Trystero 的 getPeers() 访问 RTCPeerConnection 对象。
 */
/** 连接建立的时间戳，用于健康检查冷静期 */
let connectedAt = 0;

function startPeerHealthCheck() {
  stopPeerHealthCheck();
  connectedAt = Date.now();

  peerCheckInterval = setInterval(() => {
    if (!room) { stopPeerHealthCheck(); return; }

    // 连接后 10 秒冷静期：不检测断线，避免 WebRTC 稳定前的误报
    const gracePeriodMs = 10_000;
    if (Date.now() - connectedAt < gracePeriodMs) return;

    try {
      const peers = room.getPeers();
      const peerIds = Object.keys(peers);

      if (peerIds.length === 0) {
        const ns = getNetworkStatus();
        if (ns === 'connected') {
          console.warn('[Network] 健康检查: 无 peer 连接，标记为断线');
          networkState.update(s => ({ ...s, status: 'disconnected', peerId: null }));
          stopPeerHealthCheck();
          if (autoReconnectEnabled) startReconnect();
        }
        return;
      }

      for (const pid of peerIds) {
        const pc = peers[pid];
        const state = pc.connectionState;
        if (state === 'failed') {
          console.warn(`[Network] WebRTC connectionState=failed for ${pid}`);
          networkState.update(s => ({ ...s, status: 'disconnected', peerId: null }));
          stopPeerHealthCheck();
          if (autoReconnectEnabled) startReconnect();
          return;
        }
        if (state === 'disconnected') {
          console.warn(`[Network] WebRTC connectionState=disconnected for ${pid}，等待恢复...`);
        }
      }
    } catch (err) {
      console.warn('[Network] 健康检查异常:', err);
    }
  }, PEER_HEALTH_CHECK_MS);
}

function getNetworkStatus(): ConnectionStatus {
  let s: ConnectionStatus = 'idle';
  const unsub = networkState.subscribe(ns => { s = ns.status; });
  unsub();
  return s;
}

// ─────────────────────────────────────────────
//  核心：单房间 + 重试连接
// ─────────────────────────────────────────────

/**
 * 创建单个 MQTT 房间（Trystero 自动连接 relayUrls 中第一个可达的 broker）。
 * 调用方在 15s 内等待 onPeerJoin，超时后重试（随机打乱 relay 顺序）。
 */
function trySingleConnect(roomCode: string, relayUrls: string[], attempt: number, isReconnect: boolean): void {
  const label = isReconnect ? '重连' : '连接';
  console.log(`[Network] ${label}尝试 #${attempt}，relay 顺序: ${relayUrls.map(u => { try { return new URL(u).hostname; } catch { return u; } }).join(', ')}`);

  // 清理之前的连接
  cleanupRoom();
  sendFn = null;

  const timedOut = { value: false };

  // 全局超时
  connectionTimeoutTimer = setTimeout(() => {
    timedOut.value = true;
    cleanupRoom();
    sendFn = null;
    connecting = false;
    if (isReconnect) reconnecting = false;
    console.warn(`[Network] ${label}总超时（${CONNECTION_TIMEOUT_MS / 1000}s）`);
    networkState.set({ status: 'timeout', roomCode, peerId: null, waitingSince: null });
  }, CONNECTION_TIMEOUT_MS);

  // 15s 无 peer → 重试
  function scheduleNoPeerRetry() {
    noPeerTimer = setTimeout(() => {
      if (timedOut.value) return;

      if (attempt < MAX_RETRIES) {
        console.log(`[Network] ${label} ${NO_PEER_RETRY_MS / 1000}s 无 peer，重试 #${attempt + 1}...`);
        cleanupRoom();
        sendFn = null;
        // 每次重试都随机打乱 relay 顺序，避免反复撞到不可达节点
        const nextRelays = [...RELAY_URLS].sort(() => Math.random() - 0.5);
        // 随机延迟 2-4s，让双方不在同一瞬间重试（分散竞争窗口）
        const delay = 2000 + Math.random() * 2000;
        setTimeout(() => {
          if (!timedOut.value) {
            trySingleConnect(roomCode, nextRelays, attempt + 1, isReconnect);
          }
        }, delay);
      } else {
        console.warn(`[Network] ${label} 超过最大重试次数（${MAX_RETRIES}），放弃`);
        cleanupRoom();
        sendFn = null;
        connecting = false;
        if (isReconnect) reconnecting = false;
        networkState.set({ status: 'timeout', roomCode, peerId: null, waitingSince: null });
      }
    }, NO_PEER_RETRY_MS);
  }

  try {
    room = joinRoom(
      { appId: APP_ID, relayUrls },
      roomCode,
      {
        onJoinError: (err) => {
          console.warn(`[Network] MQTT 连接错误:`, err.error);
          // onJoinError 表示 MQTT broker 连接失败；Trystero 内部会尝试下一个 relay。
          // 如果所有 relay 都失败，Trystero 不会回调 onPeerJoin，noPeerRetry 会触发。
        },
      }
    );

    room.onPeerJoin((peerId: string) => {
      if (timedOut.value) return;

      clearAllTimers();
      connecting = false;
      reconnecting = false;

      if (!gameActionSetup) {
        // 首次连接：初始化消息通道
        gameActionSetup = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [send, receive] = room!.makeAction<any>('game');
        sendFn = (data: any) => { send(data); };

        receive((msg: unknown, pid: string) => {
          const data = msg as Record<string, unknown>;
          rawHandlers.forEach(h => h(data, pid));
          if (data && typeof data.type === 'string') {
            messageHandlers.forEach(h => h(data as GameMessage, pid));
          }
        });
      } else {
        // 重连：只更新 sendFn（Trystero 同房间 makeAction 返回同一 action，
        // 新的 send 指向新 DataChannel，receive 仍由首次注册的回调处理）
        console.log('[Network] 重连检测到，更新 sendFn（复用已有 receive handler）');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [send, _receive] = room!.makeAction<any>('game');
        sendFn = (data: any) => { send(data); };
      }

      // 捕获当前房间引用，防止重试后闭包误触发
      const thisRoom = room;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thisRoom!.onPeerLeave((_pid: string) => {
        console.log(`[Network] 对手离开 (autoReconnect=${autoReconnectEnabled})`);
        // 仅当离开的是当前活跃房间时触发断开逻辑
        if (room !== thisRoom) {
          console.log('[Network] 忽略旧房间的 onPeerLeave（已重试到新房间）');
          return;
        }
        stopPeerHealthCheck();
        networkState.update(s => ({ ...s, status: 'disconnected', peerId: null }));
        if (autoReconnectEnabled) {
          startReconnect();
        } else {
          console.log('[Network] Host 模式：不主动重连，等待 Guest 重连...');
        }
      });

      startPeerHealthCheck();

      console.log(`[Network] ${label}成功！peerId=${peerId} (attempt #${attempt})`);
      networkState.update(s => ({ ...s, status: 'connected', peerId, waitingSince: null }));
    });

    // 启动无 peer 重试定时器
    scheduleNoPeerRetry();

  } catch (err) {
    console.warn(`[Network] joinRoom 异常:`, err);
    if (!timedOut.value && attempt < MAX_RETRIES) {
      cleanupRoom();
      const shuffled = [...RELAY_URLS].sort(() => Math.random() - 0.5);
      setTimeout(() => {
        if (!timedOut.value) {
          trySingleConnect(roomCode, shuffled, attempt + 1, isReconnect);
        }
      }, 2000);
    }
  }
}

// ─────────────────────────────────────────────
//  重连
// ─────────────────────────────────────────────

function startReconnect() {
  if (reconnecting || !currentRoomCode) return;
  reconnecting = true;
  connecting = false;
  console.log('[Network] 开始自动重连...');

  // 2s 延迟，给 WebRTC 短暂恢复时间
  reconnectTimer = setTimeout(() => {
    if (reconnecting && currentRoomCode) {
      connectWithRetry(currentRoomCode, true);
    }
  }, 2000);
}

function connectWithRetry(roomCode: string, isReconnect: boolean) {
  if (connecting) return;
  connecting = true;

  currentRoomCode = roomCode;

  networkState.set({
    status: 'signaling',
    roomCode,
    peerId: null,
    waitingSince: null,
  });

  // 3s 后从 signaling → waiting_peer
  signalingTimer = setTimeout(() => {
    signalingTimer = null;
    networkState.update(s => {
      if (s.status === 'signaling') {
        return { ...s, status: 'waiting_peer', waitingSince: Date.now() };
      }
      return s;
    });
  }, SIGNALING_PHASE_MS);

  trySingleConnect(roomCode, [...RELAY_URLS], 1, isReconnect);
}

// ─────────────────────────────────────────────
//  公开 API
// ─────────────────────────────────────────────

/** 加入（或创建）房间 */
export function initRoom(roomCode: string): void {
  reconnecting = false;
  connectWithRetry(roomCode, false);
}

/** 发送消息给对手。sendFn 为 null 时记录 warning 并丢弃。 */
export function sendMessage(msg: GameMessage): void {
  if (sendFn) {
    sendFn(msg);
  } else {
    console.warn(`[Network] sendMessage 丢弃（sendFn 为空）: ${msg.type}`);
  }
}

/** 发送任意数据（供 reliable channel 使用） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sendRaw(data: any): void {
  if (sendFn) {
    sendFn(data);
  } else {
    // 连接建立前静默丢弃（reliable channel 的 ping 在 connected 后才启动）
    console.debug('[Network] sendRaw 暂未就绪（连接建立后将恢复）');
  }
}

/** 离开当前房间，清理所有资源 */
export function leaveRoom(): void {
  reconnecting = false;
  connecting = false;
  currentRoomCode = null;
  clearAllTimers();
  stopPeerHealthCheck();
  cleanupRoom();
  sendFn = null;
  gameActionSetup = false;
  messageHandlers = [];
  rawHandlers = [];
  networkState.set({ status: 'idle', roomCode: null, peerId: null, waitingSince: null });
}

// ─────────────────────────────────────────────
//  消息订阅
// ─────────────────────────────────────────────

export function onMessage(handler: MessageHandler): () => void {
  messageHandlers.push(handler);
  return () => {
    messageHandlers = messageHandlers.filter(h => h !== handler);
  };
}

export function onRawMessage(handler: RawHandler): () => void {
  rawHandlers.push(handler);
  return () => {
    rawHandlers = rawHandlers.filter(h => h !== handler);
  };
}

// ─────────────────────────────────────────────
//  手动连接模式支持接口
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function overrideSendFn(fn: (data: any) => void): void {
  sendFn = fn;
}

export function dispatchMessage(msg: GameMessage, peerId: string): void {
  messageHandlers.forEach(h => h(msg, peerId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchRaw(data: any, peerId: string): void {
  rawHandlers.forEach(h => h(data, peerId));
  if (data && typeof data.type === 'string') {
    messageHandlers.forEach(h => h(data as GameMessage, peerId));
  }
}

// ─────────────────────────────────────────────
//  URL 工具
// ─────────────────────────────────────────────

export function getRoomUrl(roomCode: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomCode);
  return url.toString();
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => chars[b % chars.length])
    .join('');
}

export function getRoomCodeFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('room');
}
