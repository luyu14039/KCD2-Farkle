import { networkState, overrideSendFn, dispatchMessage } from './trystero';
import type { GameMessage } from './protocol';

// ─────────────────────────────────────────────
//  ICE 服务器（中国可达优先）
// ─────────────────────────────────────────────

const CN_STUN_SERVERS: RTCIceServer[] = [
  // Cloudflare STUN — 国内可达，延迟稳定
  { urls: 'stun:stun.cloudflare.com:3478' },
  // 腾讯 STUN — 国内最快
  { urls: 'stun:stun.qq.com:3478' },
  // 小米 STUN — 备用
  { urls: 'stun:stun.miwifi.com:3478' },
  // Google STUN — VPN 环境备用
  { urls: 'stun:stun.l.google.com:19302' },
];

/** 默认模式下 ICE candidate 收集最长等待时间（毫秒）。 */
const DEFAULT_ICE_GATHER_TIMEOUT_MS = 30_000;
/** 局域网优先模式下的等待时长（仅 host candidate，通常更快）。 */
const LAN_ICE_GATHER_TIMEOUT_MS = 6_000;

export type ConnectionMode = 'default' | 'lan';

interface ManualSignalPayloadV2 {
  v: 2;
  mode: ConnectionMode;
  sdp: string;
}

// ─────────────────────────────────────────────
//  内部状态（模块级单例）
// ─────────────────────────────────────────────

let pc: RTCPeerConnection | null = null;
let dc: RTCDataChannel | null = null;

/** 固定 peer ID，供 dispatchMessage / networkState 使用 */
const MANUAL_PEER_ID = 'manual-' + Math.random().toString(36).slice(2, 10);

// ─────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────

function createPeerConnection(mode: ConnectionMode): RTCPeerConnection {
  if (mode === 'lan') {
    return new RTCPeerConnection({
      iceServers: [],
      iceCandidatePoolSize: 0,
    });
  }

  return new RTCPeerConnection({
    iceServers: CN_STUN_SERVERS,
    iceCandidatePoolSize: 5,
  });
}

/**
 * 等待所有 ICE candidate 收集完毕（完整 SDP 模式，非 trickle ICE）。
 * 超过 ICE_GATHER_TIMEOUT_MS 后不再等待，以当前候选继续。
 */
function waitForIceComplete(peerConnection: RTCPeerConnection, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, timeoutMs);
    const handler = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        peerConnection.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }
    };
    peerConnection.addEventListener('icegatheringstatechange', handler);
  });
}

/**
 * 压缩 SDP 以减少连接码长度：
 * - 过滤 IPv6 ICE candidate（国内穿透率低且会增加长度）
 * - 过滤 relay 类型 candidate（无 TURN 服务器时无法使用）
 * - 移除 extmap 扩展行（不影响 DataChannel 连通性）
 */
function compressSdp(sdp: string, mode: ConnectionMode): string {
  return sdp
    .split('\r\n')
    .filter((line) => {
      if (line.startsWith('a=candidate:')) {
        const parts = line.split(' ');
        // parts[4] = 连接地址；IPv6 地址包含冒号
        if (parts.length > 4 && parts[4].includes(':')) return false;
        // 局域网优先：仅保留 host candidate，避免公网候选拖慢连接
        if (mode === 'lan' && !line.includes(' typ host')) return false;
        // relay 类型无 TURN 服务器时无效
        if (line.includes(' typ relay')) return false;
      }
      if (line.startsWith('a=extmap:')) return false;
      if (line.startsWith('a=extmap-allow-mixed')) return false;
      return true;
    })
    .join('\r\n');
}

/**
 * SDP 字符串 → URL-safe Base64 连接码
 * 使用 URL-safe 变体（- 和 _），避免粘贴时被格式化工具截断
 */
function encodeBase64Url(text: string): string {
  return btoa(text)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeBase64Url(b64: string): string {
  const standard = b64
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(b64.trim().length + ((4 - (b64.trim().length % 4)) % 4), '=');
  return atob(standard);
}

/** 生成带版本信息的连接码（兼容未来扩展） */
function encodeSignalPayload(sdp: string, mode: ConnectionMode): string {
  const payload: ManualSignalPayloadV2 = {
    v: 2,
    mode,
    sdp: compressSdp(sdp, mode),
  };
  return `kcd2.${encodeBase64Url(JSON.stringify(payload))}`;
}

/** 解析连接码（兼容旧版纯 SDP Base64 连接码） */
function decodeSignalPayload(code: string): { mode: ConnectionMode; sdp: string } {
  const normalized = code.trim();
  if (normalized.startsWith('kcd2.')) {
    const encoded = normalized.slice(5);
    const parsed = JSON.parse(decodeBase64Url(encoded)) as Partial<ManualSignalPayloadV2>;
    if (parsed.v !== 2 || !parsed.sdp || (parsed.mode !== 'default' && parsed.mode !== 'lan')) {
      throw new Error('连接码版本不受支持');
    }
    return { mode: parsed.mode, sdp: parsed.sdp };
  }

  return {
    mode: 'default',
    sdp: decodeBase64Url(normalized),
  };
}

// ─────────────────────────────────────────────
//  DataChannel 设置
// ─────────────────────────────────────────────

function setupDataChannel(channel: RTCDataChannel): void {
  dc = channel;

  channel.onopen = () => {
    console.log('[ManualP2P] DataChannel 已打开，接管 trystero 消息通道');

    // 接管 trystero 的发送函数
    overrideSendFn((msg: GameMessage) => {
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(msg));
      } else {
        console.warn('[ManualP2P] DataChannel 未就绪，消息丢弃:', msg.type);
      }
    });

    // 更新网络状态 → 触发 CreateRoom/JoinRoom 的 connected UI
    networkState.update((s) => ({
      ...s,
      status: 'connected',
      peerId: MANUAL_PEER_ID,
      waitingSince: null,
    }));
  };

  channel.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as GameMessage;
      dispatchMessage(msg, MANUAL_PEER_ID);
    } catch {
      console.error('[ManualP2P] 无法解析消息:', event.data);
    }
  };

  channel.onclose = () => {
    console.log('[ManualP2P] DataChannel 已关闭');
    networkState.update((s) => ({ ...s, status: 'disconnected', peerId: null }));
  };

  channel.onerror = (err) => {
    console.error('[ManualP2P] DataChannel 错误:', err);
  };
}

// ─────────────────────────────────────────────
//  公开 API
// ─────────────────────────────────────────────

/**
 * 创建方（A / 房主）：生成 Offer 连接码。
 * 内部等待 ICE candidate 收集完毕（最长 30s），返回完整连接码。
 */
export async function startOffer(mode: ConnectionMode = 'default'): Promise<string> {
  closeManualConnection();
  pc = createPeerConnection(mode);

  // 创建方主动建立 DataChannel
  const channel = pc.createDataChannel('game', { ordered: true });
  setupDataChannel(channel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  console.log('[ManualP2P] 开始收集 ICE candidate（Offer 方）…');
  await waitForIceComplete(
    pc,
    mode === 'lan' ? LAN_ICE_GATHER_TIMEOUT_MS : DEFAULT_ICE_GATHER_TIMEOUT_MS,
  );

  const candidateCount = pc.localDescription?.sdp
    .split('\r\n')
    .filter((l) => l.startsWith('a=candidate:')).length ?? 0;
  console.log(`[ManualP2P] ICE 收集完毕，有效候选数: ${candidateCount}`);

  return encodeSignalPayload(pc.localDescription!.sdp, mode);
}

/**
 * 加入方（B / 客人）：接受 Offer 码，生成 Answer 码。
 */
export async function acceptOffer(
  offerCode: string,
  preferredMode: ConnectionMode = 'default',
): Promise<{ answerCode: string; mode: ConnectionMode }> {
  closeManualConnection();

  const offerPayload = decodeSignalPayload(offerCode);
  const mode = offerPayload.mode ?? preferredMode;

  pc = createPeerConnection(mode);

  // 加入方等待对方建立的 DataChannel
  pc.ondatachannel = (event: RTCDataChannelEvent) => {
    setupDataChannel(event.channel);
  };

  await pc.setRemoteDescription({ type: 'offer', sdp: offerPayload.sdp });

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  console.log('[ManualP2P] 开始收集 ICE candidate（Answer 方）…');
  await waitForIceComplete(
    pc,
    mode === 'lan' ? LAN_ICE_GATHER_TIMEOUT_MS : DEFAULT_ICE_GATHER_TIMEOUT_MS,
  );

  const candidateCount = pc.localDescription?.sdp
    .split('\r\n')
    .filter((l) => l.startsWith('a=candidate:')).length ?? 0;
  console.log(`[ManualP2P] ICE 收集完毕，有效候选数: ${candidateCount}`);

  return {
    answerCode: encodeSignalPayload(pc.localDescription!.sdp, mode),
    mode,
  };
}

/**
 * 创建方（A）：输入加入方提供的 Answer 码，完成握手。
 * DataChannel 将在握手后自动触发 onopen，届时 networkState 更新为 connected。
 */
export async function finalizeAnswer(answerCode: string): Promise<void> {
  if (!pc) throw new Error('PeerConnection 未初始化，请先调用 startOffer()');
  const answerPayload = decodeSignalPayload(answerCode);
  await pc.setRemoteDescription({ type: 'answer', sdp: answerPayload.sdp });
  console.log('[ManualP2P] Remote description 已设置，等待 DataChannel 建立…');
}

/** 清理手动连接的所有资源（组件取消时调用） */
export function closeManualConnection(): void {
  dc?.close();
  pc?.close();
  dc = null;
  pc = null;
}
