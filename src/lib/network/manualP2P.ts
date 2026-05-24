import { networkState, overrideSendFn, dispatchRaw } from './trystero';

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

/** ICE candidate 收集最长等待时间（毫秒）。超时后以当前已收集的候选继续。 */
const ICE_GATHER_TIMEOUT_MS = 30_000;

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

function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: CN_STUN_SERVERS,
    iceCandidatePoolSize: 5,
  });
}

/**
 * 等待所有 ICE candidate 收集完毕（完整 SDP 模式，非 trickle ICE）。
 * 超过 ICE_GATHER_TIMEOUT_MS 后不再等待，以当前候选继续。
 */
function waitForIceComplete(peerConnection: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
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
function compressSdp(sdp: string): string {
  return sdp
    .split('\r\n')
    .filter((line) => {
      if (line.startsWith('a=candidate:')) {
        const parts = line.split(' ');
        // parts[4] = 连接地址；IPv6 地址包含冒号
        if (parts.length > 4 && parts[4].includes(':')) return false;
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
function encodeSdp(sdp: string): string {
  return btoa(compressSdp(sdp))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** URL-safe Base64 连接码 → SDP 字符串 */
function decodeSdp(b64: string): string {
  const standard = b64
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(b64.trim().length + ((4 - (b64.trim().length % 4)) % 4), '=');
  return atob(standard);
}

// ─────────────────────────────────────────────
//  DataChannel 设置
// ─────────────────────────────────────────────

function setupDataChannel(channel: RTCDataChannel): void {
  dc = channel;

  channel.onopen = () => {
    console.log('[ManualP2P] DataChannel 已打开，接管 trystero 消息通道');

    // 接管 trystero 的发送函数（接受任意可序列化数据，供 reliable channel 使用）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    overrideSendFn((data: any) => {
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(data));
      } else {
        console.warn('[ManualP2P] DataChannel 未就绪，消息丢弃');
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
      const data = JSON.parse(event.data as string);
      dispatchRaw(data, MANUAL_PEER_ID);
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
export async function startOffer(): Promise<string> {
  closeManualConnection();
  pc = createPeerConnection();

  // 创建方主动建立 DataChannel
  const channel = pc.createDataChannel('game', { ordered: true });
  setupDataChannel(channel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  console.log('[ManualP2P] 开始收集 ICE candidate（Offer 方）…');
  await waitForIceComplete(pc);

  const candidateCount = pc.localDescription?.sdp
    .split('\r\n')
    .filter((l) => l.startsWith('a=candidate:')).length ?? 0;
  console.log(`[ManualP2P] ICE 收集完毕，有效候选数: ${candidateCount}`);

  return encodeSdp(pc.localDescription!.sdp);
}

/**
 * 加入方（B / 客人）：接受 Offer 码，生成 Answer 码。
 */
export async function acceptOffer(offerCode: string): Promise<string> {
  closeManualConnection();
  pc = createPeerConnection();

  // 加入方等待对方建立的 DataChannel
  pc.ondatachannel = (event: RTCDataChannelEvent) => {
    setupDataChannel(event.channel);
  };

  const offerSdp = decodeSdp(offerCode);
  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  console.log('[ManualP2P] 开始收集 ICE candidate（Answer 方）…');
  await waitForIceComplete(pc);

  const candidateCount = pc.localDescription?.sdp
    .split('\r\n')
    .filter((l) => l.startsWith('a=candidate:')).length ?? 0;
  console.log(`[ManualP2P] ICE 收集完毕，有效候选数: ${candidateCount}`);

  return encodeSdp(pc.localDescription!.sdp);
}

/**
 * 创建方（A）：输入加入方提供的 Answer 码，完成握手。
 * DataChannel 将在握手后自动触发 onopen，届时 networkState 更新为 connected。
 */
export async function finalizeAnswer(answerCode: string): Promise<void> {
  if (!pc) throw new Error('PeerConnection 未初始化，请先调用 startOffer()');
  const answerSdp = decodeSdp(answerCode);
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  console.log('[ManualP2P] Remote description 已设置，等待 DataChannel 建立…');
}

/** 清理手动连接的所有资源（组件取消时调用） */
export function closeManualConnection(): void {
  dc?.close();
  pc?.close();
  dc = null;
  pc = null;
}
